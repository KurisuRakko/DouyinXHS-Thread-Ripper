// 小红书 images: same picture, faster node.
//
// Note images come as https://sns-webpic-*.xhscdn.com/<time>/<sig>/<token>!<style>. The
// very same <token>!<style> is served byte for byte by a dozen other image nodes
// (checked: identical size and type). From overseas some of them are much faster, and
// which ones depends on the viewer's network, so nothing is hard-coded:
//   - every image load on the page is timed passively (Resource Timing) per node;
//   - new images go to the node with the best recent load time, with a little exploration;
//   - an image still not there after a short wait is requested from the runner-up node
//     too, and whichever arrives first is shown (hedging);
//   - a node that fails falls back to the original address.
// Images of a note the site has just fetched (all of its pages) and covers of the next feed
// page are loaded ahead of time.
DXTR.xhsImages = (() => {
  "use strict";

  const WEBPIC_RE = /^https?:\/\/sns-webpic[^/]*\.xhscdn\.com\/\d+\/[0-9a-f]+\/([^?#]+)$/;
  const ORIG = "原地址";
  const NODES = [
    ORIG,
    "sns-img-bd.xhscdn.com", "sns-img-hw.xhscdn.com", "sns-img-qc.xhscdn.com", "sns-img-al.xhscdn.com",
    "ci.xiaohongshu.com",
    "sns-na-i1.xhscdn.com", "sns-na-i2.xhscdn.com", "sns-na-i4.xhscdn.com", "sns-na-i6.xhscdn.com",
    "sns-na-i8.xhscdn.com", "sns-na-i9.xhscdn.com", "sns-na-i10.xhscdn.com", "sns-na-i11.xhscdn.com"
  ];
  const STATS_KEY = "dxtr.imageNodes";
  const imgSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
  const setAttr = Element.prototype.setAttribute;
  const getAttr = Element.prototype.getAttribute;

  // ---- node statistics ---------------------------------------------------------------------
  const stats = new Map(NODES.map((n) => [n, { ms: 0, n: 0, fail: 0 }]));
  try {
    const saved = JSON.parse(localStorage.getItem(STATS_KEY) || "{}");
    if (saved.at && Date.now() - saved.at < 6 * 3600 * 1000) {
      for (const [node, s] of Object.entries(saved.nodes || {})) {
        if (stats.has(node)) Object.assign(stats.get(node), { ms: s.ms, n: Math.min(s.n, 5), fail: 0 });
      }
    }
  } catch (_error) {}
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STATS_KEY, JSON.stringify({ at: Date.now(), nodes: Object.fromEntries(stats) })); } catch (_error) {}
    }, 2000);
  }

  function nodeOfUrl(url) {
    let host = "";
    try { host = new URL(url).host; } catch (_error) { return null; }
    if (/^sns-webpic/.test(host)) return ORIG;
    return stats.has(host) ? host : null;
  }

  function sample(node, ms) {
    const s = stats.get(node);
    if (!s) return;
    s.ms = s.n ? s.ms * 0.8 + ms * 0.2 : ms;
    s.n += 1;
    save();
  }

  // Passive timing of every image the page loads from one of our nodes.
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.initiatorType !== "img" && e.initiatorType !== "other" && e.initiatorType !== "fetch") continue;
        const node = nodeOfUrl(e.name);
        if (node && e.duration > 15) sample(node, e.duration); // < 15 ms: browser cache
      }
    }).observe({ type: "resource", buffered: true });
  } catch (_error) {}

  let ranked = [];
  let rankedAt = 0;
  function ranking() {
    const now = performance.now();
    if (now - rankedAt < 500 && ranked.length) return ranked;
    rankedAt = now;
    ranked = NODES.filter((n) => stats.get(n).fail < 3)
      .sort((a, b) => score(a) - score(b));
    return ranked;
  }
  // Lower is better. Unmeasured nodes rank last (the original address first among them);
  // they get measured by the start-up benchmark and by exploration, not by bulk traffic.
  // Open requests count against a node so a burst of pictures is spread out.
  const inflight = new Map(NODES.map((n) => [n, 0]));
  function score(node) {
    const s = stats.get(node);
    const base = s.n ? s.ms * (1 + s.fail * 0.5) : node === ORIG ? 5000 : 6000;
    return base * (1 + inflight.get(node) / 4);
  }

  // Mostly the best node; sometimes a less-measured one so the ranking stays honest.
  function choose() {
    rankedAt = 0;
    const list = ranking();
    if (!list.length) return ORIG;
    const unexplored = list.filter((n) => stats.get(n).n < 3);
    if (unexplored.length && Math.random() < 0.1) return unexplored[Math.floor(Math.random() * unexplored.length)];
    return list[0];
  }

  // ---- rewriting -----------------------------------------------------------------------------
  const chosen = new Map();     // token → node, so a prefetched picture and the page agree
  const original = new Map();   // rewritten URL → original URL
  const counters = { rewritten: 0, hedged: 0, hedgeWins: 0, fallbacks: 0, prefetched: 0 };

  const enabled = () => { const s = DXTR.settings.get(); return s.enabled && s.images; };
  const urlOn = (node, token, orig) => (node === ORIG ? orig : `https://${node}/${token}`);

  // Once per page (at most every 6 h): load one already-shown picture from every node at
  // the same time, so the ranking starts from real numbers instead of guesses.
  let benchmarked = false;
  function benchmark(token) {
    if (benchmarked) return;
    benchmarked = true;
    const fresh = NODES.filter((n) => n !== ORIG && stats.get(n).n < 2);
    if (!fresh.length) return;
    setTimeout(() => {
      for (const node of fresh) {
        const img = new Image();
        img.decoding = "async";
        img.onerror = () => { stats.get(node).fail += 1; };
        img.src = `https://${node}/${token}`;
      }
    }, 300);
  }

  function rewrite(url) {
    if (!enabled() || typeof url !== "string") return url;
    const m = WEBPIC_RE.exec(url);
    if (!m) return url;
    const token = m[1];
    benchmark(token);
    let node = chosen.get(token);
    if (!node) {
      node = choose();
      chosen.set(token, node);
      if (chosen.size > 3000) chosen.delete(chosen.keys().next().value);
    }
    const out = urlOn(node, token, url);
    if (out !== url) {
      original.set(out, url);
      if (original.size > 3000) original.delete(original.keys().next().value);
      counters.rewritten += 1;
    }
    return out;
  }

  // Watch one <img>: hedge if slow, fall back to the original address on error.
  const watching = new WeakMap();
  function watch(img, url) {
    const m = WEBPIC_RE.exec(original.get(url) || url);
    if (!m) return;
    const token = m[1];
    const orig = original.get(url) || url;
    const state = { url, done: false };
    watching.set(img, state);
    const node0 = nodeOfUrl(url);
    let counted = !!node0;
    if (counted) inflight.set(node0, inflight.get(node0) + 1);
    const settle = () => { if (counted) { counted = false; inflight.set(node0, Math.max(0, inflight.get(node0) - 1)); } };
    setTimeout(settle, 10000);
    const best = stats.get(ranking()[0] || ORIG);
    const delay = Math.min(1500, Math.max(500, (best?.n ? best.ms : 600) * 2.5));
    setTimeout(() => {
      if (watching.get(img) !== state || state.done || (img.complete && img.naturalWidth)) return;
      const used = nodeOfUrl(url);
      const backupNode = ranking().find((n) => n !== used);
      if (!backupNode) return;
      const backup = urlOn(backupNode, token, orig);
      counters.hedged += 1;
      const probe = new Image();
      probe.decoding = "async";
      probe.onload = () => {
        if (watching.get(img) !== state || state.done || (img.complete && img.naturalWidth)) return;
        state.done = true;
        settle();
        counters.hedgeWins += 1;
        if (used && stats.get(used)) stats.get(used).ms += 200; // it lost a race
        original.set(backup, orig);
        imgSrc.set.call(img, backup); // from the browser cache now
      };
      probe.src = backup;
    }, delay);
    const onError = () => {
      img.removeEventListener("error", onError);
      if (watching.get(img) !== state || state.done) return;
      state.done = true;
      settle();
      const node = nodeOfUrl(url);
      if (node && node !== ORIG) {
        stats.get(node).fail += 1;
        chosen.delete(token);
        counters.fallbacks += 1;
        imgSrc.set.call(img, orig);
      }
    };
    img.addEventListener("error", onError);
    img.addEventListener("load", () => { state.done = true; settle(); }, { once: true });
  }

  function install() {
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      configurable: true,
      enumerable: imgSrc.enumerable,
      get() { const v = imgSrc.get.call(this); return original.get(v) || v; },
      set(value) {
        const out = rewrite(value);
        imgSrc.set.call(this, out);
        if (enabled() && WEBPIC_RE.test(String(value))) watch(this, out);
      }
    });
    const prevSet = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function setAttribute(name, value) {
      if (this instanceof HTMLImageElement && String(name).toLowerCase() === "src") {
        const out = rewrite(String(value));
        const r = prevSet.call(this, name, out);
        if (enabled() && WEBPIC_RE.test(String(value))) watch(this, out);
        return r;
      }
      return prevSet.call(this, name, value);
    };
    const prevGet = Element.prototype.getAttribute;
    Element.prototype.getAttribute = function getAttribute(name) {
      const v = prevGet.call(this, name);
      if (v && this instanceof HTMLImageElement && String(name).toLowerCase() === "src") return original.get(v) || v;
      return v;
    };
    DXTR.jsonHook.add({
      match: (url) => /^https:\/\/edith\.xiaohongshu\.com\/api\/sns\/web\/v\d+\/(?:feed|homefeed|search\/notes|user_posted)/.test(url),
      transform: (obj, url) => { collect(obj, /\/feed\b/.test(url) && !/homefeed/.test(url)); return false; }
    });
    preconnect();
  }

  // ---- prefetch ------------------------------------------------------------------------------
  const queue = [];
  let running = 0;
  const seen = new Set();
  function prefetch(url, front) {
    if (!enabled() || seen.has(url)) return;
    seen.add(url);
    if (seen.size > 5000) seen.clear();
    front ? queue.unshift(url) : queue.push(url);
    if (queue.length > 80) queue.length = 80;
    pumpPrefetch();
  }
  function pumpPrefetch() {
    while (running < 6 && queue.length) {
      const url = rewrite(queue.shift());
      running += 1;
      counters.prefetched += 1;
      const img = new Image();
      img.decoding = "async";
      img.onload = img.onerror = () => { running -= 1; pumpPrefetch(); };
      img.src = url;
    }
  }

  // Every webpic URL in an API response. For a note's own data (the "feed" endpoint, i.e.
  // the note being opened) all pictures jump the queue; feed pages only queue covers.
  function collect(obj, urgent) {
    const urls = [];
    (function walk(node, depth) {
      if (!node || depth > 12) return;
      if (typeof node === "string") { if (WEBPIC_RE.test(node)) urls.push(node); return; }
      if (typeof node !== "object") return;
      if (Array.isArray(node)) { for (const v of node) walk(v, depth + 1); return; }
      for (const key in node) {
        if (key === "info_list" || key === "infoList") continue; // other styles of the same picture
        walk(node[key], depth + 1);
      }
    })(obj, 0);
    for (const u of urgent ? urls.reverse() : urls) prefetch(u, urgent);
  }

  function preconnect() {
    const add = () => {
      for (const node of ranking().slice(0, 2)) {
        if (node === ORIG) continue;
        const link = document.createElement("link");
        link.rel = "preconnect";
        link.href = `https://${node}`;
        (document.head || document.documentElement).append(link);
      }
    };
    if (document.head) add(); else document.addEventListener("DOMContentLoaded", add, { once: true });
  }

  return {
    install,
    rewrite,
    collect: (obj, urgent) => { if (enabled()) collect(obj, urgent); },
    stats: () => ({
      ...counters,
      nodes: ranking().map((n) => ({ node: n, ms: Math.round(stats.get(n).ms), samples: stats.get(n).n, fail: stats.get(n).fail }))
    })
  };
})();
