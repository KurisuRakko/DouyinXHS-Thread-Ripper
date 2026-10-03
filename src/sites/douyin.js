// 抖音 (www.douyin.com).
//
// Every aweme in the web API carries `video.play_addr` (what the player plays: one MP4
// file, with 2–3 CDN addresses in url_list) and `video.bit_rate[]` (all qualities, each
// with its own play_addr). We register the file the player will play so the media hook
// can recognise it, and — when "best quality" is on — first move the best playable MP4
// quality into play_addr.
DXTR.sites.douyin = (() => {
  "use strict";

  const API_RE = /^https:\/\/[^/]*douyin\.com\/aweme\/v\d+\/web\/(?:aweme\/(?:detail|related|post|favorite|listcollection)|tab\/feed|module\/feed|feed|general\/search|search|series|mix|hot\/search\/list|channel\/feed|follow\/feed|familiar\/feed|recommend)/;

  function codecSupported(isH265) {
    if (!isH265) return true;
    try {
      const v = document.createElement("video");
      return !!(v.canPlayType('video/mp4; codecs="hvc1.1.6.L120.90"') || v.canPlayType('video/mp4; codecs="hev1.1.6.L120.90"'));
    } catch (_error) {
      return false;
    }
  }

  const resolution = (addr) => Math.max(addr?.width || 0, addr?.height || 0);

  // Best MP4 quality the browser can decode: highest resolution, then highest bitrate.
  function pickBest(video) {
    const list = (video.bit_rate || []).filter((b) =>
      b?.play_addr?.url_list?.length &&
      String(b.format || "mp4").toLowerCase() === "mp4" &&
      codecSupported(b.is_h265 || b.is_bytevc1));
    list.sort((a, b) => resolution(b.play_addr) - resolution(a.play_addr) || (b.bit_rate || 0) - (a.bit_rate || 0));
    return list[0] || null;
  }

  function keyOf(addr) {
    return addr.url_key || [addr.uri, addr.file_hash || addr.data_size].filter(Boolean).join(":") || addr.url_list[0];
  }

  // Direct CDN addresses first; www.douyin.com/aweme/v1/play/ (a redirect) last.
  function cdnOnly(urls) {
    const list = (urls || []).filter((u) => typeof u === "string" && u);
    const isPlay = (u) => /\/aweme\/v\d+\/play\//.test(u);
    return [...list.filter((u) => !isPlay(u)), ...list.filter(isPlay)];
  }

  const isDash = (b) => String(b?.format || "").toLowerCase() === "dash";
  const supported = (b) => codecSupported(b.is_h265 || b.is_bytevc1);
  const rank = (a, b) => resolution(b.play_addr) - resolution(a.play_addr) || (b.bit_rate || 0) - (a.bit_rate || 0);

  function handleVideo(video, label) {
    if (!video?.play_addr?.url_list?.length) return;
    const s = DXTR.settings.get();
    const rates = Array.isArray(video.bit_rate) ? video.bit_rate.filter((b) => b?.play_addr?.url_list?.length) : [];
    if (s.enabled && s.quality === "best" && rates.length) {
      const best = pickBest(video);
      const cur = video.play_addr;
      if (best && resolution(best.play_addr) >= resolution(cur) && keyOf(best.play_addr) !== keyOf(cur)) {
        video.play_addr = best.play_addr;
        if (best.is_h265 || best.is_bytevc1) video.play_addr_265 = best.play_addr;
        else video.play_addr_h264 = best.play_addr;
        if (best.play_addr.width && best.play_addr.height) {
          video.width = best.play_addr.width;
          video.height = best.play_addr.height;
        }
        DXTR.log("抖音画质", label, `${resolution(cur)}p → ${resolution(best.play_addr)}p`, best.gear_name || "");
      }
      // The DASH player picks its own gear from bit_rate[]; leave it only the best one of
      // each format, so it cannot drop to a low gear.
      const bestDash = rates.filter((b) => isDash(b) && supported(b)).sort(rank)[0];
      if (best) video.bit_rate = [best, ...(bestDash ? [bestDash] : [])];
    }
    const addr = video.play_addr;
    const owner = keyOf(addr);
    // The tracks a DASH-mode player would fetch: the best (remaining) dash video + audio.
    const parts = [];
    const dash = (Array.isArray(video.bit_rate) ? video.bit_rate : []).filter((b) => isDash(b) && b?.play_addr?.url_list?.length && supported(b)).sort(rank)[0];
    if (dash) {
      const k = keyOf(dash.play_addr);
      DXTR.videos.register({ key: k, urls: cdnOnly(dash.play_addr.url_list), size: dash.play_addr.data_size || 0, label: `${label} [视频轨]`, owner }, { inFeed: false });
      parts.push(k);
    }
    const audio = (video.bit_rate_audio || []).map((a) => a?.audio_meta).filter((m) => m?.url_list)
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
    if (audio) {
      const list = audio.url_list;
      const urls = cdnOnly(Array.isArray(list) ? list : [list.main_url, list.backup_url, list.fallback_url]);
      const k = `dya:${audio.file_id || audio.file_hash || urls[0]}`;
      if (urls.length) {
        DXTR.videos.register({ key: k, urls, size: audio.size || 0, label: `${label} [音轨]`, owner }, { inFeed: false });
        parts.push(k);
      }
    }
    // Every other gear too, so whatever the player fetches is recognised with all its nodes.
    for (const b of Array.isArray(video.bit_rate) ? video.bit_rate : []) {
      if (b?.play_addr?.url_list?.length && b !== dash && keyOf(b.play_addr) !== owner) {
        DXTR.videos.register({ key: keyOf(b.play_addr), urls: cdnOnly(b.play_addr.url_list), size: b.play_addr.data_size || 0, label, owner }, { inFeed: false });
      }
    }
    DXTR.videos.register({ key: owner, urls: cdnOnly(addr.url_list), size: addr.data_size || 0, label, mseParts: parts });
  }

  // Walk the response; anything with a video.play_addr is an aweme. Order is kept.
  function walk(node, depth) {
    if (!node || typeof node !== "object" || depth > 8) return;
    if (Array.isArray(node)) { for (const item of node) walk(item, depth + 1); return; }
    // Picture posts (图文) also carry a video.play_addr: their background music. Skip them.
    const isPictures = Array.isArray(node.images) && node.images.length > 0;
    if (node.video && node.video.play_addr && (node.aweme_id || node.aweme_type !== undefined) && !isPictures) {
      handleVideo(node.video, String(node.desc || node.aweme_id || "").slice(0, 24));
    }
    for (const key in node) {
      if (key === "video") continue;
      const value = node[key];
      if (value && typeof value === "object") walk(value, depth + 1);
    }
  }

  // The same file on any node: /video/tos/<region>/<bucket>/<object id>/ or ?file_id=…
  function urlKey(url) {
    const tos = /\/video\/tos\/[^/]+\/[^/]+\/([^/?#]+)/.exec(url);
    if (tos) return `dy:${tos[1]}`;
    const file = /[?&]file_id=([^&#]+)/.exec(url);
    if (file) return `dyf:${file[1]}`;
    return "";
  }

  // ---- ads ----------------------------------------------------------------------------------
  // Every aweme says whether it is an ad: is_ads, raw_ad_data, commerce_info.is_ad. Ads are
  // taken out of the lists before the page sees them, so the player never gets them.
  let adsRemoved = 0;
  let adsSkipped = 0;

  function isAd(item) {
    const a = item && typeof item === "object" ? (item.aweme_info || item) : null;
    if (!a || !(a.aweme_id || a.aweme_info)) return false;
    let raw = a.raw_ad_data;
    if (typeof raw === "string") raw = raw.trim() && raw !== "null" && raw !== "{}";
    return a.is_ads === true || !!raw || a.commerce_info?.is_ad === true;
  }

  function removeAds(node, depth) {
    if (!node || typeof node !== "object" || depth > 8) return;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i -= 1) {
        if (isAd(node[i])) { node.splice(i, 1); adsRemoved += 1; }
        else removeAds(node[i], depth + 1);
      }
      return;
    }
    if (Array.isArray(node.ad_candidates)) node.ad_candidates = []; // ads queued for later; keep the type
    for (const key in node) {
      if (key === "video") continue;
      const value = node[key];
      if (value && typeof value === "object") removeAds(value, depth + 1);
    }
  }

  // Fallback for ads that arrive some other way: the video on screen shows a "广告" tag →
  // go to the next one (the same as pressing ↓).
  function skipVisibleAds() {
    let lastSkipped = null;
    setInterval(() => {
      const s = DXTR.settings.get();
      if (!s.enabled || !s.adblock) return;
      // The video on screen: playing, and the most of it inside the viewport (the feed also
      // keeps the next video mounted and sometimes playing, off screen).
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        return Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) * Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
      };
      let video = null;
      let best = 0;
      for (const v of document.querySelectorAll("video")) {
        const area = !v.paused && v.isConnected ? visible(v) : 0;
        if (area > best) { best = area; video = v; }
      }
      if (!video || best < innerWidth * innerHeight * 0.2) return;
      // The slide that holds this video: the nearest ancestor that also holds its caption.
      let box = video.parentElement;
      for (let i = 0; i < 8 && box && box.getBoundingClientRect().height < innerHeight * 0.6; i += 1) box = box.parentElement;
      if (!box || box === lastSkipped) return;
      const tag = [...box.querySelectorAll("span, div")].find((el) => el.childElementCount === 0 && el.textContent.trim() === "广告" && visible(el) > 0);
      if (!tag) return;
      lastSkipped = box;
      adsSkipped += 1;
      DXTR.log("跳过广告");
      // The player's own "next" button if there is one, else the ↓ key it listens to.
      const next = document.querySelector('[data-e2e="video-switch-next-arrow"], .xgplayer-playswitch-next');
      if (next) { next.click(); return; }
      for (const type of ["keydown", "keyup"]) {
        document.dispatchEvent(new KeyboardEvent(type, { key: "ArrowDown", code: "ArrowDown", keyCode: 40, which: 40, bubbles: true }));
      }
    }, 700);
  }

  function install() {
    DXTR.videos.addUrlKey(urlKey);
    DXTR.jsonHook.add({
      match: (url) => API_RE.test(url),
      transform: (obj) => {
        const s = DXTR.settings.get();
        if (s.enabled && s.adblock) removeAds(obj, 0);
        walk(obj, 0);
      }
    });
    skipVisibleAds();
  }

  return { install, pickBest, urlKey, walk, removeAds, isAd, adStats: () => ({ removed: adsRemoved, skipped: adsSkipped }) };
})();
