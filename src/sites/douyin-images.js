// 抖音图集 (picture posts): load the pictures before they are shown.
//
// Picture URLs are signed per node (the same path on another douyinpic node is refused), so
// unlike Xiaohongshu there is no faster node to switch to. What helps is time: the pictures
// of the next posts in the feed, and all pictures of the post on screen, are downloaded in
// the background (6 at a time, the post on screen first) and kept as blob: URLs. When the
// page then sets an <img> to one of them, it gets the copy in memory. A picture is
// identified by its path (the query string differs between API responses).
DXTR.douyinImages = (() => {
  "use strict";

  const MB = 1048576;
  const PIC_RE = /^https:\/\/[^/]+\.douyinpic\.com(\/[^?#]+~tplv-dy-aweme-images[^?#]*)/;
  const nativeFetch = window.fetch.bind(window);
  const imgSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
  const pics = new Map();      // path → { url, state: "queued"|"loading"|"ready"|"failed", priority, blobUrl, bytes, usedAt }
  const blobToOriginal = new Map();
  const queue = [];
  let running = 0;
  const counters = { hits: 0, misses: 0, downloaded: 0, failed: 0 };

  const enabled = () => { const s = DXTR.settings.get(); return s.enabled && s.video; };
  const keyOf = (url) => { const m = PIC_RE.exec(String(url)); return m ? m[1] : ""; };

  // Queue pictures; a lower priority number is fetched first (0 = the post on screen).
  function prefetch(urls, priority) {
    if (!enabled()) return;
    for (const url of urls) {
      const key = keyOf(url);
      if (!key) continue;
      let p = pics.get(key);
      if (!p) {
        p = { url, key, state: "queued", priority, blobUrl: "", bytes: 0, usedAt: performance.now() };
        pics.set(key, p);
        queue.push(p);
      } else if (p.state === "queued" && priority < p.priority) {
        p.priority = priority;
      }
      p.usedAt = performance.now();
    }
    queue.sort((a, b) => a.priority - b.priority);
    pump();
  }

  function pump() {
    while (running < 6 && queue.length) {
      const p = queue.shift();
      if (p.state !== "queued") continue;
      p.state = "loading";
      running += 1;
      nativeFetch(p.url, { credentials: "omit" })
        .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((blob) => {
          p.blobUrl = URL.createObjectURL(blob);
          p.bytes = blob.size;
          p.state = "ready";
          blobToOriginal.set(p.blobUrl, p.url);
          counters.downloaded += 1;
          evict();
        }, () => { p.state = "failed"; counters.failed += 1; })
        .finally(() => { running -= 1; pump(); });
    }
  }

  // Keep at most 150 MB of pictures; never one an <img> shows right now.
  function evict() {
    let total = 0;
    for (const p of pics.values()) total += p.bytes;
    if (total <= 150 * MB) return;
    const shown = new Set([...document.querySelectorAll("img")].map((i) => i.attributes.getNamedItem("src")?.value));
    for (const p of [...pics.values()].filter((x) => x.state === "ready").sort((a, b) => a.usedAt - b.usedAt)) {
      if (total <= 150 * MB) break;
      if (shown.has(p.blobUrl)) continue;
      URL.revokeObjectURL(p.blobUrl);
      blobToOriginal.delete(p.blobUrl);
      pics.delete(p.key);
      total -= p.bytes;
    }
  }

  // Posts: which pictures belong together, so showing one starts the rest.
  const postOf = new Map();    // picture path → { urls: all picture URLs of its post, entryKey }

  function registerPost(urls, entryKey) {
    for (const url of urls) { const k = keyOf(url); if (k) postOf.set(k, { urls, entryKey }); }
    if (postOf.size > 5000) postOf.clear();
  }

  function substitute(url) {
    if (!enabled() || typeof url !== "string") return url;
    const key = keyOf(url);
    if (!key) return url;
    const post = postOf.get(key);
    if (post) {
      prefetch(post.urls, 0);                    // this post is being shown
      DXTR.videos.prefetchWindowOf(post.entryKey); // and the posts after it
    }
    const p = pics.get(key);
    if (p && p.state === "ready") {
      counters.hits += 1;
      p.usedAt = performance.now();
      return p.blobUrl;
    }
    counters.misses += 1;
    return url;
  }

  function install() {
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      configurable: true,
      enumerable: imgSrc.enumerable,
      get() { const v = imgSrc.get.call(this); return blobToOriginal.get(v) || v; },
      set(value) { imgSrc.set.call(this, substitute(value)); }
    });
    const prevSet = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function setAttribute(name, value) {
      if (this instanceof HTMLImageElement && String(name).toLowerCase() === "src") return prevSet.call(this, name, substitute(String(value)));
      return prevSet.call(this, name, value);
    };
    const prevGet = Element.prototype.getAttribute;
    Element.prototype.getAttribute = function getAttribute(name) {
      const v = prevGet.call(this, name);
      if (v && this instanceof HTMLImageElement && String(name).toLowerCase() === "src") return blobToOriginal.get(v) || v;
      return v;
    };
  }

  return {
    install,
    prefetch,
    registerPost,
    keyOf,
    stats: () => ({ ...counters, cached: [...pics.values()].filter((p) => p.state === "ready").length, queued: queue.length, running })
  };
})();
