// Settings live in this site's localStorage (each site is one origin, so no sharing needed).
DXTR.settings = (() => {
  "use strict";

  const STORAGE_KEY = "dxtr.settings";
  const THREAD_CHOICES = [4, 8, 12, 16, 24, 32];

  const DEFAULTS = {
    enabled: true,          // master switch
    video: true,            // multi-thread video download + instant next
    quality: "best",        // "best" | "site" (leave the site's own choice)
    threads: "auto",        // "auto" | one of THREAD_CHOICES
    prefetchNext: 2,        // how many upcoming feed videos to download ahead (0–5)
    prefetchMaxMB: 40,      // skip prefetching files bigger than this
    maxFileMB: 200,         // never take over files bigger than this
    cacheMB: 300,           // total size of finished videos kept in memory
    images: true,           // Xiaohongshu image node racing + prefetch
    adblock: true,          // Douyin: drop ads from the feed
    floatingButton: true,
    floatingTop: null,      // share of window height where the ball was dragged to
    debug: false
  };

  function normalize(input) {
    const s = input && typeof input === "object" ? input : {};
    const num = (v, lo, hi, def) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : def);
    return {
      enabled: s.enabled !== false,
      video: s.video !== false,
      quality: s.quality === "site" ? "site" : "best",
      threads: THREAD_CHOICES.includes(Number(s.threads)) ? Number(s.threads) : "auto",
      prefetchNext: num(s.prefetchNext, 0, 5, DEFAULTS.prefetchNext),
      prefetchMaxMB: num(s.prefetchMaxMB, 5, 500, DEFAULTS.prefetchMaxMB),
      maxFileMB: num(s.maxFileMB, 20, 1000, DEFAULTS.maxFileMB),
      cacheMB: num(s.cacheMB, 50, 2000, DEFAULTS.cacheMB),
      images: s.images !== false,
      adblock: s.adblock !== false,
      floatingButton: s.floatingButton !== false,
      floatingTop: s.floatingTop != null && Number(s.floatingTop) >= 0 && Number(s.floatingTop) <= 1 ? Number(s.floatingTop) : null,
      debug: s.debug === true
    };
  }

  let current = DEFAULTS;
  try { current = normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")); } catch (_error) {}
  const listeners = new Set();

  return {
    THREAD_CHOICES,
    get: () => current,
    set(patch) {
      current = normalize({ ...current, ...patch });
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); } catch (_error) {}
      for (const fn of listeners) { try { fn(current); } catch (_error) {} }
      return current;
    },
    onChange: (fn) => listeners.add(fn),
    normalize
  };
})();

// Debug log: kept in memory, printed only when debug is on.
DXTR.log = (() => {
  const lines = [];
  function log(...parts) {
    const line = `[${new Date().toISOString().slice(11, 23)}] ${parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ")}`;
    lines.push(line);
    if (lines.length > 300) lines.shift();
    if (DXTR.settings.get().debug) console.debug("[DXTR]", ...parts);
  }
  log.lines = () => lines.slice();
  return log;
})();
