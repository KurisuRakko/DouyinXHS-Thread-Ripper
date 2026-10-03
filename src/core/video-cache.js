// What we know about each video (from the site's own API responses) and the finished
// downloads, kept as blob: URLs.
//
// An entry is { key, urls, size, label }. `key` identifies the file (one quality of one
// video); every candidate URL is indexed so that whatever address the player is given,
// we can tell which file it is.
DXTR.videos = (() => {
  "use strict";

  const MB = 1048576;
  const entries = new Map();   // key → entry
  const urlIndex = new Map();  // url key → entry key
  const feed = [];             // entry keys in the order the site listed them
  const records = new Map();   // key → { entry, dl, state, blob, blobUrl, bytes, usedAt }
  const blobToOriginal = new Map();
  let hits = 0;
  let current = null;       // entry of the video on screen
  let mseMode = false;      // the site was seen fetching track files itself
  let refreshQueued = false;
  let misses = 0;

  // Site modules register a function that turns a media URL into a stable key (the same
  // file on different nodes / with different signatures must map to the same key).
  const urlKeyFns = [];
  function urlKeys(url) {
    const keys = [String(url)];
    for (const fn of urlKeyFns) {
      try { const k = fn(String(url)); if (k) keys.push(k); } catch (_error) {}
    }
    return keys;
  }

  function register(entry, { inFeed = true } = {}) {
    if (!entry || !entry.key || !entry.urls?.length) return null;
    const old = entries.get(entry.key);
    if (old) {
      old.urls = [...new Set([...entry.urls, ...old.urls])].slice(0, 8); // newest signatures first
      if (entry.size) old.size = entry.size;
      if (entry.owner) old.owner = entry.owner;
      if (entry.mseParts) old.mseParts = entry.mseParts;
    } else {
      entries.set(entry.key, { ...entry });
    }
    for (const url of entry.urls) for (const k of urlKeys(url)) urlIndex.set(k, entry.key);
    if (inFeed && !feed.includes(entry.key)) {
      feed.push(entry.key);
      // New feed items may belong in the prefetch window of the video on screen.
      if (current && !refreshQueued) {
        refreshQueued = true;
        setTimeout(() => { refreshQueued = false; if (current) prefetchAfter(current); }, 300);
      }
    }
    if (feed.length > 400) feed.splice(0, feed.length - 400);
    return entries.get(entry.key);
  }

  function lookup(url) {
    if (!url) return null;
    for (const k of urlKeys(url)) {
      const key = urlIndex.get(k);
      if (key) return entries.get(key) || null;
    }
    return null;
  }

  // A media URL the site fetches itself (MSE players): the entry we know, or a new one
  // built from just this URL. Only URLs a site module recognises as media get one.
  function entryForUrl(url) {
    const known = lookup(url);
    if (known) return known;
    const key = urlKeyFns.map((fn) => { try { return fn(url); } catch (_error) { return ""; } }).find(Boolean);
    if (!key) return null;
    return register({ key, urls: [url], size: 0, label: key.slice(0, 24) }, { inFeed: false });
  }

  function tooBig(entry, limitMB) {
    return entry.size && entry.size > limitMB * MB;
  }

  // Starts (or re-prioritises) the download of an entry. Returns its record.
  function ensure(entry, priority) {
    const s = DXTR.settings.get();
    let rec = records.get(entry.key);
    if (rec && rec.state === "failed") return rec;
    if (rec) {
      rec.usedAt = performance.now();
      if (rec.dl && rec.state === "loading") rec.dl.setPriority(priority);
      return rec;
    }
    if (tooBig(entry, s.maxFileMB)) return null;
    rec = { entry, dl: null, state: "loading", blob: null, blobUrl: "", bytes: 0, usedAt: performance.now(), waiters: [] };
    records.set(entry.key, rec);
    rec.dl = DXTR.downloader.download({ urls: entry.urls, size: entry.size, priority, label: entry.label || entry.key });
    rec.dl.promise.then((blob) => {
      rec.blob = blob;
      rec.bytes = blob.size;
      rec.blobUrl = URL.createObjectURL(blob);
      blobToOriginal.set(rec.blobUrl, entry.urls[0]);
      rec.state = "ready";
      rec.dl = rec.dl; // keep stats for the panel
      for (const fn of rec.waiters.splice(0)) fn(rec);
      evict();
    }, (error) => {
      rec.state = "failed";
      rec.error = String(error?.message || error);
      if (rec.error === "aborted") records.delete(entry.key); // may be wanted again later
      for (const fn of rec.waiters.splice(0)) fn(rec);
    });
    return rec;
  }

  function onSettled(rec, fn) {
    if (rec.state === "loading") rec.waiters.push(fn);
    else fn(rec);
  }

  function inUse(blobUrl) {
    for (const el of document.querySelectorAll("video, source")) {
      if (el.getAttribute("src") === blobUrl) return true;
    }
    return false;
  }

  // Keeps finished downloads under the cache limit, least recently used first.
  function evict() {
    const limit = DXTR.settings.get().cacheMB * MB;
    let total = 0;
    for (const r of records.values()) if (r.state === "ready") total += r.bytes;
    if (total <= limit) return;
    const ready = [...records.values()].filter((r) => r.state === "ready").sort((a, b) => a.usedAt - b.usedAt);
    for (const r of ready) {
      if (total <= limit) break;
      if (inUse(r.blobUrl)) continue;
      URL.revokeObjectURL(r.blobUrl);
      blobToOriginal.delete(r.blobUrl);
      records.delete(r.entry.key);
      total -= r.bytes;
    }
  }

  // Download the next few videos of the feed after `entry`; drop prefetches that fell out
  // of that window and have not finished yet.
  // The files a feed item will be played from: the MP4 itself, or — when the site plays
  // through MediaSource (Douyin's DASH mode) — its separate video and audio tracks.
  function filesOf(item) {
    if (mseMode && item.mseParts?.length) return item.mseParts.map((k) => entries.get(k)).filter(Boolean);
    return [item];
  }

  function prefetchAfter(entry) {
    const s = DXTR.settings.get();
    if (!s.enabled || !s.video) return;
    if (entry.owner && entries.has(entry.owner)) entry = entries.get(entry.owner);
    current = entry;
    const at = feed.indexOf(entry.key);
    const wanted = new Set([entry.key, ...(entry.mseParts || [])]);
    if (at >= 0 && s.prefetchNext > 0) {
      let added = 0;
      for (let i = at + 1; i < feed.length && added < s.prefetchNext; i += 1) {
        const next = entries.get(feed[i]);
        if (!next) continue;
        const files = filesOf(next);
        const bytes = files.reduce((sum, f) => sum + (f.size || 0), 0);
        if (bytes > s.prefetchMaxMB * MB) continue;
        for (const f of files) { wanted.add(f.key); ensure(f, 1 + added); }
        added += 1;
      }
    }
    for (const [key, rec] of records) {
      if (rec.state === "loading" && !wanted.has(key) && rec.dl.priority > 0) rec.dl.abort();
    }
  }

  return {
    register,
    lookup,
    entryForUrl,
    ensure,
    onSettled,
    prefetchAfter,
    isCurrent: (entry) => !!current && (entry.key === current.key || entry.owner === current.key),
    noteMse: (entry) => { if (entry.owner && entry.owner !== entry.key && !mseMode) { mseMode = true; DXTR.log("站点使用 MSE 分轨播放"); } },
    addUrlKey: (fn) => urlKeyFns.push(fn),
    originalOf: (blobUrl) => blobToOriginal.get(blobUrl) || null,
    isOurs: (url) => blobToOriginal.has(url),
    record: (key) => records.get(key) || null,
    // For dev/hit-test.mjs: one downloaded entry not on screen, one never downloaded.
    sampleUrls() {
      const playing = new Set([...document.querySelectorAll("video")].map((v) => v.currentSrc));
      const ready = [...records.values()].find((r) => r.state === "ready" && !r.entry.urls.some((u) => playing.has(u)));
      const cold = [...entries.values()].find((e) => !records.has(e.key) && !(e.size > 40 * MB));
      const cdn = (urls) => (urls || []).find((u) => /zjcdn|xhscdn/.test(u)) || "";
      return { ready: cdn(ready?.entry.urls), cold: cdn(cold?.urls) };
    },
    countHit: (hit) => { if (hit) hits += 1; else misses += 1; },
    snapshot: () => ({
      entries: entries.size,
      feed: feed.length,
      hits,
      misses,
      records: [...records.values()].map((r) => ({
        label: r.entry.label || r.entry.key,
        state: r.state,
        mb: +((r.bytes || r.dl?.total || r.entry.size || 0) / MB).toFixed(1),
        progress: r.state === "ready" ? 1 : +(r.dl?.progress() || 0).toFixed(2),
        priority: r.dl?.priority,
        ms: r.dl?.finishedAt ? Math.round(r.dl.finishedAt - r.dl.startedAt) : null,
        error: r.error,
        hosts: r.entry.urls.map((u) => { try { return new URL(u).host; } catch (_error) { return "?"; } })
      }))
    })
  };
})();
