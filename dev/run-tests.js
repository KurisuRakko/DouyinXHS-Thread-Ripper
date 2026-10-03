// Unit tests, no dependencies:  node dev/run-tests.js
// The browser modules are loaded into a small fake page (window, localStorage, a mock
// fetch serving byte ranges from in-memory files).
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// ---- fake page --------------------------------------------------------------------------
function loadModules(files, { fetch } = {}) {
  const store = new Map();
  const window = {
    fetch: fetch || (async () => { throw new Error("no fetch"); }),
    location: { href: "https://www.douyin.com/", hostname: "www.douyin.com" }
  };
  const env = {
    window,
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    document: { querySelectorAll: () => [], createElement: () => ({ canPlayType: () => "" }) },
    performance,
    URL: Object.assign(function (...a) { return new URL(...a); }, { createObjectURL: () => `blob:fake/${Math.random()}`, revokeObjectURL: () => {} }),
    console: { debug() {}, log: console.log, error: console.error },
    queueMicrotask, setTimeout, clearTimeout, setInterval, clearInterval, Blob, Response, Headers
  };
  const DXTR = { version: "test", sites: {}, designCss: "" };
  for (const f of files) {
    const fn = new Function("DXTR", ...Object.keys(env), read(f));
    fn(DXTR, ...Object.values(env));
  }
  return DXTR;
}

// A file served by fake nodes. behaviour(host, start, end, attempt) can return
//   "ok" | "full200" | "403" | { cutAfter: bytes } (connection drops) | { delay: ms }
function mockServer(bytes, behaviour = () => "ok") {
  const attempts = new Map();
  const log = [];
  const fetch = async (url, init = {}) => {
    const host = new URL(url).host;
    const m = /bytes=(\d+)-(\d+)/.exec(init.headers?.Range || "");
    const start = Number(m[1]);
    const end = Math.min(Number(m[2]), bytes.length - 1);
    const n = (attempts.get(host) || 0) + 1;
    attempts.set(host, n);
    const b = behaviour(host, start, end, n);
    log.push({ host, start, end, b: typeof b === "string" ? b : JSON.stringify(b) });
    if (b && b.delay) await new Promise((r) => setTimeout(r, b.delay));
    if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
    if (b === "403") return new Response("no", { status: 403 });
    if (b === "full200") return new Response(bytes, { status: 200 });
    const body = bytes.subarray(start, end + 1);
    const cut = b && b.cutAfter;
    let sent = 0;
    const stream = new ReadableStream({
      pull(ctrl) {
        if (sent >= body.length) { ctrl.close(); return; }
        if (cut != null && sent >= cut) { ctrl.error(new TypeError("network error")); return; }
        const piece = body.subarray(sent, sent + 64 * 1024);
        sent += piece.length;
        ctrl.enqueue(piece);
      }
    });
    return new Response(stream, { status: 206, headers: { "content-range": `bytes ${start}-${end}/${bytes.length}` } });
  };
  return { fetch, log };
}

function randomBytes(n) {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) b[i] = (i * 2654435761 + (i >> 7)) & 255;
  return b;
}

const CORE = ["src/core/settings.js", "src/core/range-core.js", "src/core/downloader.js"];
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---- range-core ---------------------------------------------------------------------------
test("parseContentRange", () => {
  const { rangeCore } = loadModules(CORE);
  assert.deepEqual(rangeCore.parseContentRange("bytes 0-99/1000"), { start: 0, end: 99, total: 1000 });
  assert.equal(rangeCore.parseContentRange("bytes 5-4/10"), null);
  assert.equal(rangeCore.parseContentRange("bytes 0-10/10"), null);
  assert.equal(rangeCore.parseContentRange("bytes 0-9/*").total, null);
});

test("planChunks covers the file exactly", () => {
  const { rangeCore } = loadModules(CORE);
  const chunks = rangeCore.planChunks(100, 10_000_000, rangeCore.chunkSizeFor(10_000_000, 8));
  assert.equal(chunks[0].start, 100);
  assert.equal(chunks.at(-1).end, 9_999_999);
  for (let i = 1; i < chunks.length; i += 1) assert.equal(chunks[i].start, chunks[i - 1].end + 1);
});

test("checkResponse rejects wrong windows and 200", () => {
  const { rangeCore } = loadModules(CORE);
  assert.equal(rangeCore.checkResponse(200, null, 0, 9, 0).ok, false);
  assert.equal(rangeCore.checkResponse(206, "bytes 10-19/100", 0, 9, 0).ok, false);
  assert.equal(rangeCore.checkResponse(206, "bytes 0-9/100", 0, 9, 50).ok, false);
  assert.equal(rangeCore.checkResponse(206, "bytes 0-9/100", 0, 9, 100).ok, true);
  assert.equal(rangeCore.checkResponse(206, "bytes 0-49/50", 0, 99, 0).ok, true); // short file
});

// ---- downloader ---------------------------------------------------------------------------
async function download(bytes, behaviour, hosts = ["a.example", "b.example"]) {
  const server = mockServer(bytes, behaviour);
  const DXTR = loadModules(CORE, { fetch: server.fetch });
  const dl = DXTR.downloader.download({ urls: hosts.map((h) => `https://${h}/v.mp4`), priority: 0, label: "t" });
  const blob = await dl.promise;
  return { got: new Uint8Array(await blob.arrayBuffer()), server, dl, DXTR };
}

test("downloads a multi-chunk file intact", async () => {
  const bytes = randomBytes(5 * 1048576 + 12345);
  const { got, server } = await download(bytes);
  assert.equal(got.length, bytes.length);
  assert.deepEqual(got, bytes);
  assert.ok(server.log.length > 4, "split into several requests");
  assert.ok(new Set(server.log.map((l) => l.host)).size === 2, "used both nodes");
});

test("file smaller than the first chunk", async () => {
  const bytes = randomBytes(1000);
  const { got } = await download(bytes);
  assert.deepEqual(got, bytes);
});

test("a node answering 200 (ignoring Range) is dropped", async () => {
  const bytes = randomBytes(3 * 1048576);
  const { got } = await download(bytes, (host) => (host === "b.example" ? "full200" : "ok"));
  assert.deepEqual(got, bytes);
});

test("a dropped connection resumes from the last byte", async () => {
  const bytes = randomBytes(3 * 1048576);
  // The first request (bytes 0-524287) drops after 256 KB.
  const { got, server } = await download(bytes, (host, s, e, n) => (host === "a.example" && n === 1 ? { cutAfter: 200 * 1024 } : "ok"));
  assert.deepEqual(got, bytes);
  assert.ok(server.log.some((l) => l.start === 262144 && l.end === 524287), `resumed at 256 KB: ${JSON.stringify(server.log.slice(0, 4))}`);
});

test("403 on one node, the other finishes", async () => {
  const bytes = randomBytes(2 * 1048576);
  const { got } = await download(bytes, (host) => (host === "a.example" ? "403" : "ok"));
  assert.deepEqual(got, bytes);
});

test("all nodes 403 → rejects (caller falls back to native)", async () => {
  const bytes = randomBytes(2 * 1048576);
  await assert.rejects(download(bytes, () => "403"), /失败|HTTP 403/);
});

test("tryRead serves finished bytes before the whole file is done", async () => {
  const bytes = randomBytes(4 * 1048576);
  const server = mockServer(bytes, (host, s) => (s >= 3 * 1048576 ? { delay: 300 } : "ok"));
  const DXTR = loadModules(CORE, { fetch: server.fetch });
  const dl = DXTR.downloader.download({ urls: ["https://a.example/v.mp4"], priority: 0 });
  await new Promise((r) => setTimeout(r, 120));
  const part = await dl.tryRead(1000, 600_000);
  assert.ok(part, "early bytes available");
  assert.deepEqual(part, bytes.subarray(1000, 600_001));
  assert.equal(await dl.tryRead(3_500_000, 3_600_000), null, "late bytes not yet");
  await dl.promise;
  assert.deepEqual(await dl.tryRead(3_500_000, 3_600_000), bytes.subarray(3_500_000, 3_600_001));
});

// ---- sites --------------------------------------------------------------------------------
const SITE = [...CORE, "src/core/video-cache.js", "src/sites/douyin.js", "src/sites/xhs.js"];
function loadSites() {
  const DXTR = loadModules(SITE);
  DXTR.videos.addUrlKey(DXTR.sites.douyin.urlKey);
  DXTR.videos.addUrlKey(DXTR.sites.xhs.urlKey);
  return DXTR;
}

test("douyin: best MP4 gear goes into play_addr, bit_rate trimmed, tracks registered", () => {
  const DXTR = loadSites();
  const data = JSON.parse(read("dev/fixtures/douyin-detail.json"));
  DXTR.sites.douyin.walk(data, 0);
  const v = data.aweme_detail.video;
  assert.equal(Math.max(v.play_addr.width, v.play_addr.height), 1920);
  assert.equal(v.bit_rate.length, 2);
  assert.deepEqual(v.bit_rate.map((b) => b.format), ["mp4", "dash"]);
  const entry = DXTR.videos.lookup(v.play_addr.url_list[1]);
  assert.ok(entry, "play address registered");
  assert.equal(entry.mseParts.length, 2, "dash video + audio");
  assert.equal(entry.urls.at(-1).includes("/aweme/v1/play/"), true, "redirect address last");
  // the same file on another node (different signature) is still recognised
  const other = v.play_addr.url_list[0].replace("v3-dy-o", "v26-other").replace("fake=", "sig=");
  assert.equal(DXTR.videos.lookup(other)?.key, entry.key);
});

test("douyin: quality=site leaves the data alone", () => {
  const DXTR = loadSites();
  DXTR.settings.set({ quality: "site" });
  const data = JSON.parse(read("dev/fixtures/douyin-detail.json"));
  const before = JSON.stringify(data.aweme_detail.video.play_addr);
  DXTR.sites.douyin.walk(data, 0);
  assert.equal(JSON.stringify(data.aweme_detail.video.play_addr), before);
  assert.ok(data.aweme_detail.video.bit_rate.length > 2);
});

test("xhs: stream files registered, best first in each list, no list removed", () => {
  const DXTR = loadSites();
  const mk = (h, br, n) => ({ height: h, width: h * 9 / 16, videoBitrate: br, size: 1000, masterUrl: `http://sns-video-bd.xhscdn.com/stream/1/110/${n}.mp4`, backupUrls: [`https://sns-video-hw.xhscdn.com/stream/1/110/${n}.mp4?sign=x`] });
  const note = { title: "t", video: { media: { stream: { EF4: [mk(720, 1000, "a"), mk(1080, 2000, "b")], EF5: [mk(1080, 1500, "c")], EF6: [] } } } };
  DXTR.sites.xhs.walk({ data: { items: [{ note_card: note }] } }, 0, "");
  const st = note.video.media.stream;
  assert.equal(st.EF4[0].height, 1080);
  assert.equal(st.EF5.length, 1, "lists are never emptied (codec names are opaque)");
  assert.ok(DXTR.videos.lookup("https://sns-video-al.xhscdn.com/stream/1/110/b.mp4?other=1"), "any node, any query");
});

// ---- run ----------------------------------------------------------------------------------
(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log(`ok   ${t.name}`); }
    catch (error) { failed += 1; console.log(`FAIL ${t.name}\n     ${error.stack.split("\n").slice(0, 3).join("\n     ")}`); }
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
