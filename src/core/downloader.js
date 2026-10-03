// Multi-connection, multi-node Range downloader.
//
// One scheduler runs every download on the page. It keeps at most `limit` requests in
// flight, always serving the most urgent download first (priority 0 = the video on screen,
// 1, 2 … = upcoming feed videos). Each download splits its file into chunks; each chunk
// goes to whichever node is fastest for its load right now. A chunk that stalls is aborted
// and the rest of it retried elsewhere, starting from the last byte received. When a
// download has no queued chunks left but a slow request still has a lot to go, the tail
// of that request is split off and handed to an idle connection (work stealing).
DXTR.downloader = (() => {
  "use strict";

  const { KB, chunkSizeFor, planChunks, checkResponse } = DXTR.rangeCore;
  const FIRST_CHUNK = 512 * KB;
  const MIN_STEAL = 384 * KB;
  const FIRST_BYTE_TIMEOUT = 6000;
  const STALL_TIMEOUT = 4000;
  const MAX_CHUNK_FAILURES = 6;
  const nativeFetch = window.fetch.bind(window);

  // ---- per-node statistics, shared across downloads ------------------------------------
  const nodes = new Map(); // host → { speed (bytes/ms, EWMA), ttfb (ms, EWMA), ok, fail, badUntil }
  function nodeOf(url) {
    let host = "";
    try { host = new URL(url).host; } catch (_error) {}
    if (!nodes.has(host)) nodes.set(host, { host, speed: 0, ttfb: 0, ok: 0, fail: 0, badUntil: 0, bytes: 0 });
    return nodes.get(host);
  }
  function recordSpeed(node, bytes, ms, ttfb) {
    if (bytes < 32 * KB || ms <= 0) return;
    const sample = bytes / ms;
    node.speed = node.speed ? node.speed * 0.7 + sample * 0.3 : sample;
    node.ttfb = node.ttfb ? node.ttfb * 0.7 + ttfb * 0.3 : ttfb;
  }

  // ---- scheduler ------------------------------------------------------------------------
  const active = new Set(); // downloads with work left
  let inflight = 0;
  let autoLimit = 8;
  let lastTune = { at: 0, bytes: 0, rate: 0, limit: 8, dir: 1 };
  let totalBytes = 0;

  function limit() {
    const t = DXTR.settings.get().threads;
    return t === "auto" ? autoLimit : t;
  }

  // Simple hill climb for "auto": every 3 s compare throughput with the last window; keep
  // moving the thread count in the same direction while it helps, turn back when it doesn't.
  function tune() {
    const now = performance.now();
    if (now - lastTune.at < 3000) return;
    const rate = (totalBytes - lastTune.bytes) / Math.max(1, now - lastTune.at);
    const busy = inflight >= autoLimit - 1;
    if (lastTune.at && busy) {
      if (rate < lastTune.rate * 0.95) lastTune.dir = -lastTune.dir;
      if (rate < lastTune.rate * 0.95 || rate > lastTune.rate * 1.05) {
        autoLimit = Math.min(24, Math.max(4, autoLimit + 2 * lastTune.dir));
      }
    }
    lastTune = { at: now, bytes: totalBytes, rate: busy ? rate : lastTune.rate, limit: autoLimit, dir: lastTune.dir };
  }

  function pump() {
    tune();
    const ordered = [...active].sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
    for (const dl of ordered) {
      while (inflight < limit()) {
        const job = dl.nextJob();
        if (!job) break;
        inflight += 1;
        dl.run(job).finally(() => { inflight -= 1; queueMicrotask(pump); });
      }
      if (inflight >= limit()) break;
    }
  }

  // ---- one download ---------------------------------------------------------------------
  class Download {
    constructor({ urls, size = 0, priority = 1, label = "" }) {
      this.candidates = [...new Set(urls.filter(Boolean))].map((url) => ({ url, origin: url, node: nodeOf(url), resolved: false, dead: false, keepOrigin: false }));
      this.sizeHint = size || 0; // from site metadata; the server's Content-Range decides
      this.total = 0;
      this.priority = priority;
      this.label = label;
      this.createdAt = performance.now();
      this.chunks = [];          // { start, end, parts: [], got, state: "queued"|"running"|"done", failures, req }
      this.planned = false;
      this.received = 0;
      this.startedAt = 0;
      this.finishedAt = 0;
      this.error = null;
      this.aborted = false;
      this.focus = 0;           // byte offset the player needs next
      this.blob = null;
      this.promise = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
      this.promise.catch(() => {});
      // The first chunk also tells us the real total.
      this.chunks.push(this.newChunk(0, FIRST_CHUNK - 1));
    }

    newChunk(start, end) {
      return { start, end, parts: [], got: 0, state: "queued", failures: 0, req: null };
    }

    start() {
      if (!this.candidates.length) { this.fail(new Error("没有可用地址")); return this; }
      this.startedAt = performance.now();
      active.add(this);
      pump();
      return this;
    }

    setPriority(p) {
      if (p === this.priority) return;
      this.priority = p;
      pump();
    }

    abort() {
      if (this.finishedAt || this.aborted) return;
      this.aborted = true;
      for (const c of this.chunks) c.req?.abort();
      this.fail(new Error("aborted"));
    }

    fail(error) {
      if (this.finishedAt) return;
      this.error = error;
      this.finishedAt = performance.now();
      active.delete(this);
      for (const c of this.chunks) c.req?.abort();
      this.chunks = [];
      this.reject(error);
    }

    // Best node for a new request: fastest per open request, unknown nodes get tried early.
    pickCandidate(exclude) {
      const now = performance.now();
      const usable = this.candidates.filter((c) => !c.dead && c.node.badUntil < now);
      const pool = usable.length ? usable : this.candidates.filter((c) => !c.dead);
      if (!pool.length) return null;
      let best = null;
      let bestScore = -Infinity;
      for (const c of pool) {
        const load = this.chunks.filter((k) => k.req && k.req.candidate === c).length;
        const speed = c.node.speed || 1e9; // explore unmeasured nodes first
        let score = speed / (load + 1);
        if (c === exclude) score /= 4;
        if (score > bestScore) { bestScore = score; best = c; }
      }
      return best;
    }

    nextJob() {
      if (this.finishedAt) return null;
      if (!this.planned && this.chunks[0].state !== "queued") return null; // wait for the size
      // Bytes the player asked for come first, then the file in order.
      const queued = this.chunks.find((c) => c.state === "queued" && c.end >= this.focus) ||
        this.chunks.find((c) => c.state === "queued");
      if (queued) return queued;
      return this.steal();
    }

    // Split the remaining part of the slowest running request and queue the tail.
    steal() {
      if (!this.planned) return null;
      let victim = null;
      let most = 0;
      for (const c of this.chunks) {
        if (c.state !== "running") continue;
        const left = c.end - (c.start + c.got) + 1;
        const node = c.req?.candidate.node;
        // Rough time to finish; only steal when a fresh connection would clearly win.
        const eta = node?.speed ? left / node.speed : Infinity;
        if (left > 2 * MIN_STEAL && eta > 1500 && left > most) { most = left; victim = c; }
      }
      if (!victim) return null;
      const cut = victim.start + victim.got + Math.floor((victim.end - victim.start - victim.got + 1) / 2);
      const tail = this.newChunk(cut, victim.end);
      victim.end = cut - 1;
      this.chunks.splice(this.chunks.indexOf(victim) + 1, 0, tail);
      return tail;
    }

    plan(total) {
      this.total = total;
      const first = this.chunks[0];
      if (first.end > total - 1) first.end = total - 1;
      const size = chunkSizeFor(total, limit());
      for (const piece of planChunks(first.end + 1, total, size)) this.chunks.push(this.newChunk(piece.start, piece.end));
      this.planned = true;
    }

    async run(chunk) {
      const candidate = this.pickCandidate(chunk.lastCandidate);
      if (!candidate) { this.fail(new Error("所有节点都失败了")); return; }
      chunk.state = "running";
      const ctrl = new AbortController();
      const req = { candidate, abort: () => ctrl.abort() };
      chunk.req = req;
      chunk.lastCandidate = candidate;
      const node = candidate.node;
      const from = chunk.start + chunk.got;
      const requestedEnd = chunk.end;
      const t0 = performance.now();
      let ttfb = 0;
      let bytesThisRequest = 0;
      let timer = 0;
      const arm = (ms) => { clearTimeout(timer); timer = setTimeout(() => ctrl.abort(), ms); };
      try {
        arm(FIRST_BYTE_TIMEOUT);
        const res = await nativeFetch(candidate.url, { headers: { Range: `bytes=${from}-${chunk.end}` }, signal: ctrl.signal, cache: "no-store" });
        ttfb = performance.now() - t0;
        if (res.status === 403 || res.status === 404 || res.status === 410) {
          if (candidate.url !== candidate.origin) {
            // A node we were redirected to refuses us: go back through the redirect each time.
            candidate.url = candidate.origin;
            candidate.node = nodeOf(candidate.origin);
            candidate.keepOrigin = true;
          } else {
            candidate.dead = true; // signature expired or file gone on this node
          }
          throw new Error(`HTTP ${res.status}`);
        }
        const check = checkResponse(res.status, res.headers.get("content-range"), from, chunk.end, this.total || this.sizeHint, res.headers.get("content-length"));
        if (!check.ok) { candidate.dead = res.status === 200; throw new Error(check.reason); }
        // Without a readable Content-Range the total must come from the site's metadata.
        const total = check.total || this.total || this.sizeHint;
        if (!total) { candidate.dead = true; throw new Error("不知道文件总长"); }
        // A redirect (douyin.com/aweme/v1/play → CDN) is resolved once and reused.
        if (!candidate.resolved && !candidate.keepOrigin && res.url && res.url !== candidate.url) {
          candidate.url = res.url;
          candidate.node = nodeOf(res.url);
        }
        candidate.resolved = true;
        if (!this.planned) this.plan(total);
        const reader = res.body.getReader();
        for (;;) {
          arm(STALL_TIMEOUT);
          const { done, value } = await reader.read();
          if (done) break;
          if (this.finishedAt) { reader.cancel().catch(() => {}); return; }
          let bytes = value;
          const room = chunk.end - (chunk.start + chunk.got) + 1; // end may shrink when stolen from
          if (bytes.byteLength > room) {
            // More than asked for from a response we could not check: do not trust it.
            if (check.unverified && chunk.end === requestedEnd) { candidate.dead = true; throw new Error("响应超长"); }
            bytes = bytes.subarray(0, Math.max(0, room));
          }
          if (bytes.byteLength) {
            chunk.parts.push(bytes);
            chunk.got += bytes.byteLength;
            bytesThisRequest += bytes.byteLength;
            this.received += bytes.byteLength;
            totalBytes += bytes.byteLength;
            candidate.node.bytes += bytes.byteLength;
          }
          if (chunk.start + chunk.got > chunk.end) { reader.cancel().catch(() => {}); break; }
        }
        clearTimeout(timer);
        if (chunk.start + chunk.got <= chunk.end) throw new Error("连接提前结束");
        chunk.state = "done";
        chunk.req = null;
        candidate.node.ok += 1;
        candidate.node.badUntil = 0;
        recordSpeed(candidate.node, bytesThisRequest, performance.now() - t0 - ttfb, ttfb);
        this.maybeFinish();
      } catch (error) {
        clearTimeout(timer);
        chunk.req = null;
        if (this.finishedAt) return;
        recordSpeed(candidate.node, bytesThisRequest, performance.now() - t0 - ttfb, ttfb);
        candidate.node.fail += 1;
        candidate.node.badUntil = performance.now() + 5000;
        chunk.failures += 1;
        chunk.state = "queued";
        DXTR.log("块失败", this.label, candidate.node.host, `${from}-${chunk.end}`, String(error.message || error));
        if (chunk.failures > MAX_CHUNK_FAILURES || this.candidates.every((c) => c.dead)) {
          this.fail(new Error(`下载失败：${error.message || error}`));
        }
      }
    }

    maybeFinish() {
      if (!this.planned || this.finishedAt) return;
      if (!this.chunks.every((c) => c.state === "done")) return;
      const parts = [];
      for (const c of this.chunks) parts.push(...c.parts);
      const blob = new Blob(parts, { type: "video/mp4" });
      if (blob.size !== this.total) { this.fail(new Error(`拼接长度不符 ${blob.size}/${this.total}`)); return; }
      this.chunks = this.chunks.map((c) => ({ ...c, parts: [] }));
      this.blob = blob;
      this.finishedAt = performance.now();
      active.delete(this);
      DXTR.log("下载完成", this.label, `${(this.total / 1048576).toFixed(1)}MB`, `${Math.round(this.finishedAt - this.startedAt)}ms`);
      this.resolve(blob);
    }

    // The bytes [start, end] if they are already here, else null. Never waits for the network.
    async tryRead(start, end) {
      if (this.blob) {
        if (end >= this.blob.size) end = this.blob.size - 1;
        if (start > end) return null;
        return new Uint8Array(await this.blob.slice(start, end + 1).arrayBuffer());
      }
      if (!this.planned || this.finishedAt) return null;
      if (end >= this.total) end = this.total - 1;
      const out = new Uint8Array(end - start + 1);
      let filled = start;
      for (const c of this.chunks) {
        if (c.end < start || c.start > end) continue;
        if (c.start > filled) return null; // gap
        // Bytes of this chunk received so far, walked part by part.
        let pos = c.start;
        for (const part of c.parts) {
          const partEnd = pos + part.byteLength - 1;
          if (partEnd >= filled && pos <= end) {
            const from = Math.max(filled, pos);
            const to = Math.min(end, partEnd);
            out.set(part.subarray(from - pos, to - pos + 1), from - start);
            filled = to + 1;
          }
          pos = partEnd + 1;
          if (filled > end) return out;
        }
        if (filled <= Math.min(end, c.end)) return null; // this chunk is not far enough yet
      }
      return filled > end ? out : null;
    }

    // Tell the scheduler where the player is reading.
    want(offset) {
      this.focus = offset;
    }

    progress() {
      return this.total ? this.received / this.total : 0;
    }

    // How many requests of this download are open right now.
    running() {
      return this.chunks.filter((c) => c.state === "running").length;
    }
  }

  return {
    Download,
    nodes,
    stats: () => ({ inflight, limit: limit(), autoLimit, totalBytes, active: active.size }),
    download: (opts) => new Download(opts).start()
  };
})();
