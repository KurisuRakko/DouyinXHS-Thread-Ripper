// 小红书 (www.xiaohongshu.com) videos.
//
// A video note carries note.video.media.stream.{h264,h265,h266,av1}[]: each item is one
// MP4 file with masterUrl + backupUrls on several sns-video-* nodes. The data comes from
// the note API (/api/sns/web/v1/feed) or, on a directly opened note page, from
// window.__INITIAL_STATE__. We register every file so the media hook recognises it, and
// with "best quality" put the best file first in every codec list.
DXTR.sites.xhs = (() => {
  "use strict";

  const API_RE = /^https:\/\/edith\.xiaohongshu\.com\/api\/sns\/web\/v\d+\/(?:feed|homefeed|search\/notes|user_posted|note)/;
  const height = (item) => Math.max(item.height || 0, item.width || 0);
  const urlsOf = (item) => [item.masterUrl, ...(item.backupUrls || [])].filter((u) => typeof u === "string" && u).map((u) => u.replace(/^http:/, "https:"));

  function keyOf(item) {
    try { return `xhs:${new URL(urlsOf(item)[0]).pathname}`; } catch (_error) { return ""; }
  }

  function handleStream(stream, label) {
    const items = [];
    for (const codec of Object.keys(stream)) {
      if (!Array.isArray(stream[codec])) continue;
      for (const item of stream[codec]) if (item && urlsOf(item).length) items.push({ codec, item });
    }
    if (!items.length) return;
    for (const { item } of items) {
      const key = keyOf(item);
      if (key) DXTR.videos.register({ key, urls: urlsOf(item), size: item.size || 0, label }, { inFeed: false });
    }
    const s = DXTR.settings.get();
    if (!(s.enabled && s.quality === "best")) return;
    // Codec lists are named with codes (EF4, EF5 …) we cannot map to real codecs, so no list
    // is ever removed: only the best file of each list is moved to its front.
    let changed = false;
    for (const codec of Object.keys(stream)) {
      const list = stream[codec];
      if (!Array.isArray(list) || list.length < 2) continue;
      const first = list[0];
      list.sort((a, b) => height(b) - height(a) || (b.videoBitrate || b.avgBitrate || 0) - (a.videoBitrate || a.avgBitrate || 0));
      if (list[0] !== first) changed = true;
    }
    if (changed) DXTR.log("小红书画质", label, "每个编码列表最高清的排到第一");
  }

  function walk(node, depth, label) {
    if (!node || typeof node !== "object" || depth > 12) return;
    if (Array.isArray(node)) { for (const item of node) walk(item, depth + 1, label); return; }
    if (node.title || node.displayTitle) label = String(node.title || node.displayTitle).slice(0, 24);
    // A picture with a stream is a live photo (实况图): its short clip is left entirely to
    // the site's own player.
    const isPicture = node.livePhoto || node.live_photo || "urlDefault" in node || "url_default" in node || "infoList" in node || "info_list" in node;
    if (node.stream && typeof node.stream === "object" && !Array.isArray(node.stream) && !isPicture) handleStream(node.stream, label || "");
    for (const key in node) {
      if (key === "stream") continue;
      const value = node[key];
      if (value && typeof value === "object") walk(value, depth + 1, label);
    }
  }

  function urlKey(url) {
    const m = /^https?:\/\/sns-video[^/]*\.xhscdn\.com(\/[^?#]+)/.exec(url);
    return m ? `xhs:${m[1]}` : "";
  }

  // window.__INITIAL_STATE__ is assigned by an inline script; look at it on the way in.
  function hookInitialState() {
    let value;
    try {
      Object.defineProperty(window, "__INITIAL_STATE__", {
        configurable: true,
        enumerable: true,
        get: () => value,
        set(v) {
          value = v;
          try { walk(v?.note?.noteDetailMap || v?.note, 0, ""); } catch (_error) {}
          // All pictures of a directly opened note, ahead of the carousel.
          try { if (v?.note?.noteDetailMap) DXTR.xhsImages?.collect(v.note.noteDetailMap, true); } catch (_error) {}
        }
      });
    } catch (_error) {}
  }

  function install() {
    DXTR.videos.addUrlKey(urlKey);
    DXTR.jsonHook.add({ match: (url) => API_RE.test(url), transform: (obj) => walk(obj, 0, "") });
    hookInitialState();
  }

  return { install, walk, urlKey };
})();
