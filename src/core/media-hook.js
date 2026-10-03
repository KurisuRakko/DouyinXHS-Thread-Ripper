// Takes over only the address a <video> / <source> is given.
//
// When the player sets a video URL we know (from the site's API data):
//   - the file is already downloaded → the element gets our blob: URL instead (instant start);
//   - otherwise the original URL goes through untouched and we download in the background.
//     If native playback then falls behind (stalls / buffer nearly empty) and our copy is
//     complete, the element is switched to the blob at the same position.
// Reading back .src / .currentSrc / getAttribute("src") still returns the original URL, so
// the player's own logic never sees a difference.
DXTR.mediaHook = (() => {
  "use strict";

  const V = DXTR.videos;
  const mediaSrc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
  const sourceSrc = Object.getOwnPropertyDescriptor(HTMLSourceElement.prototype, "src");
  const currentSrc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentSrc");
  const setAttr = Element.prototype.setAttribute;
  const getAttr = Element.prototype.getAttribute;
  const watched = new WeakMap(); // <video> → watcher state
  let swaps = 0;

  function enabled() {
    const s = DXTR.settings.get();
    return s.enabled && s.video;
  }

  // What the element should really be given for `url`.
  function substitute(el, url) {
    if (!enabled() || typeof url !== "string" || !/^https?:/.test(url)) return url;
    const entry = V.lookup(url);
    if (!entry) return url;
    const rec = V.ensure(entry, 0);
    const video = el instanceof HTMLMediaElement ? el : el.closest?.("video") || el.parentElement;
    if (rec && rec.state === "ready") {
      V.countHit(true);
      DXTR.log("命中缓存，秒开", entry.label || entry.key);
      if (video) watch(video, entry);
      return rec.blobUrl;
    }
    V.countHit(false);
    if (video instanceof HTMLMediaElement) watch(video, entry);
    else if (el instanceof HTMLSourceElement) queueMicrotask(() => { const v = el.parentElement; if (v instanceof HTMLMediaElement) watch(v, entry); });
    return url;
  }

  // ---- setters / getters ------------------------------------------------------------------
  Object.defineProperty(HTMLMediaElement.prototype, "src", {
    configurable: true,
    enumerable: mediaSrc.enumerable,
    get() { const v = mediaSrc.get.call(this); return V.originalOf(v) || v; },
    set(value) { mediaSrc.set.call(this, substitute(this, value)); }
  });
  Object.defineProperty(HTMLSourceElement.prototype, "src", {
    configurable: true,
    enumerable: sourceSrc.enumerable,
    get() { const v = sourceSrc.get.call(this); return V.originalOf(v) || v; },
    set(value) { sourceSrc.set.call(this, substitute(this, value)); }
  });
  Object.defineProperty(HTMLMediaElement.prototype, "currentSrc", {
    configurable: true,
    enumerable: currentSrc.enumerable,
    get() { const v = currentSrc.get.call(this); return V.originalOf(v) || v; }
  });
  Element.prototype.setAttribute = function setAttribute(name, value) {
    if ((this instanceof HTMLMediaElement || this instanceof HTMLSourceElement) && String(name).toLowerCase() === "src") {
      return setAttr.call(this, name, substitute(this, String(value)));
    }
    return setAttr.call(this, name, value);
  };
  Element.prototype.getAttribute = function getAttribute(name) {
    const v = getAttr.call(this, name);
    if (v && (this instanceof HTMLMediaElement || this instanceof HTMLSourceElement) && String(name).toLowerCase() === "src") {
      return V.originalOf(v) || v;
    }
    return v;
  };

  // ---- per-video watcher ------------------------------------------------------------------
  function realSrc(video) {
    return currentSrc.get.call(video);
  }

  function bufferedAhead(video) {
    const t = video.currentTime;
    const b = video.buffered;
    for (let i = 0; i < b.length; i += 1) if (b.start(i) <= t + 0.2 && b.end(i) >= t) return b.end(i) - t;
    return 0;
  }

  function watch(video, entry) {
    let w = watched.get(video);
    if (!w) {
      w = { entry, stalls: 0, timer: 0, swapped: null };
      watched.set(video, w);
      video.addEventListener("waiting", () => { w.stalls += 1; check(video); });
      video.addEventListener("stalled", () => check(video));
      video.addEventListener("playing", () => {
        const e = V.lookup(video.currentSrc);
        if (e) { w.entry = e; V.prefetchAfter(e); }
      });
      w.timer = setInterval(() => {
        if (!video.isConnected) { clearInterval(w.timer); return; }
        check(video);
      }, 1000);
    }
    if (w.entry.key !== entry.key) { w.swapped = null; w.stalls = 0; }
    w.entry = entry;
    const rec = V.ensure(entry, 0);
    if (rec) V.onSettled(rec, () => check(video));
    if (!video.paused) V.prefetchAfter(entry);
  }

  // The player may set its URL before the API response that describes it has arrived.
  // Pick such videos up once we know them.
  setInterval(() => {
    if (!enabled()) return;
    for (const video of document.querySelectorAll("video")) {
      const src = realSrc(video);
      if (!src || V.isOurs(src)) continue;
      const entry = V.lookup(src);
      if (entry && watched.get(video)?.entry.key !== entry.key) watch(video, entry);
    }
  }, 1000);

  // Switch to our copy when native loading is behind and our copy is complete.
  function check(video) {
    const w = watched.get(video);
    if (!w || !enabled()) return;
    const src = realSrc(video);
    if (!src || V.isOurs(src)) return;
    const entry = V.lookup(src);
    if (!entry || entry.key !== w.entry.key) return;
    if (w.swapped === entry.key) return;
    const rec = V.record(entry.key);
    if (!rec || rec.state !== "ready") return;
    const duration = video.duration || 0;
    const ahead = bufferedAhead(video);
    const fullyBuffered = duration && ahead >= duration - video.currentTime - 0.3;
    if (fullyBuffered) return;
    // Before the first frame (autoplay waiting for data) a switch costs nothing; during
    // playback only when native loading is about to run dry or already stalled.
    // A paused video that already shows a frame is never touched: reloading it blanks the
    // element (on Xiaohongshu that turned live photos black). Before any frame is drawn
    // (readyState < 2) a reload is invisible, so a preloading next video can still switch.
    if (video.paused && video.readyState >= 2) return;
    const notStarted = video.currentTime < 0.5 && video.readyState < (video.paused ? 2 : 3);
    const struggling = !video.paused && (video.readyState < 3 || ahead < 2 || w.stalls > 0);
    if (!notStarted && !struggling) return;
    w.swapped = entry.key;
    swapTo(video, rec);
  }

  function swapTo(video, rec) {
    const state = { time: video.currentTime, paused: video.paused, rate: video.playbackRate, muted: video.muted, volume: video.volume };
    swaps += 1;
    DXTR.log("切换到多线程副本", rec.entry.label || rec.entry.key, `@${state.time.toFixed(1)}s`);
    const restore = () => {
      video.removeEventListener("loadedmetadata", restore);
      try { if (state.time) video.currentTime = state.time; } catch (_error) {}
      video.playbackRate = state.rate;
      video.muted = state.muted;
      video.volume = state.volume;
      if (!state.paused) video.play().catch(() => {});
    };
    video.addEventListener("loadedmetadata", restore);
    // Point every <source> child and the element itself at the blob, then reload.
    for (const s of video.querySelectorAll("source")) sourceSrc.set.call(s, rec.blobUrl);
    if (getAttr.call(video, "src")) mediaSrc.set.call(video, rec.blobUrl);
    else video.load();
  }

  return { stats: () => ({ swaps }) };
})();

// Players that feed MediaSource themselves (Douyin's DASH mode) fetch the file in Range
// pieces. The first request for a file passes through untouched and starts our download of
// the whole file in the background; from then on every piece that is already here is
// answered from memory, anything else still goes to the network as before.
DXTR.mediaFetch = (() => {
  "use strict";

  const V = DXTR.videos;
  const pageFetch = window.fetch;
  let served = 0;
  let passed = 0;
  const seenOwners = new Set();

  function rangeOf(input, init) {
    let headers = init && init.headers;
    if (!headers && input && typeof input === "object" && input.headers) headers = input.headers;
    let value = "";
    try {
      if (headers instanceof Headers) value = headers.get("range") || "";
      else if (Array.isArray(headers)) value = (headers.find(([k]) => String(k).toLowerCase() === "range") || [])[1] || "";
      else if (headers) for (const k of Object.keys(headers)) if (k.toLowerCase() === "range") value = headers[k];
    } catch (_error) {}
    const m = /^bytes=(\d+)-(\d*)$/i.exec(String(value).trim());
    return m ? { start: Number(m[1]), end: m[2] === "" ? Infinity : Number(m[2]) } : null;
  }

  window.fetch = async function fetch(input, init) {
    const s = DXTR.settings.get();
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
    const range = s.enabled && s.video && url && /^https:/.test(url) ? rangeOf(input, init) : null;
    const entry = range ? V.entryForUrl(url) : null;
    if (!entry) return pageFetch.apply(this, arguments);
    // The site also preloads upcoming videos itself; only the one on screen is urgent.
    const rec = V.ensure(entry, V.isCurrent(entry) || entry.owner && !seenOwners.has(entry.owner) ? 0 : 1);
    const dl = rec?.dl;
    if (entry.owner && !seenOwners.has(entry.owner)) {
      seenOwners.add(entry.owner);
      V.noteMse(entry);
      V.prefetchAfter(entry);
    }
    if (dl && rec.state !== "failed") {
      dl.want(range.start);
      const bytes = await dl.tryRead(range.start, range.end);
      if (bytes) {
        if (init?.signal?.aborted) throw new DOMException("The user aborted a request.", "AbortError");
        served += 1;
        const end = range.start + bytes.byteLength - 1;
        const res = new Response(bytes, {
          status: 206,
          statusText: "Partial Content",
          headers: {
            "Content-Type": "video/mp4",
            "Content-Length": String(bytes.byteLength),
            "Content-Range": `bytes ${range.start}-${end}/${dl.total}`,
            "Accept-Ranges": "bytes"
          }
        });
        Object.defineProperty(res, "url", { value: url });
        return res;
      }
    }
    passed += 1;
    return pageFetch.apply(this, arguments);
  };

  return { stats: () => ({ served, passed }) };
})();
