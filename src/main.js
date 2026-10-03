// Entry point: pick the site module, install the hooks, expose the debug report.
(() => {
  "use strict";
  const host = location.hostname;
  const site = /(^|\.)douyin\.com$/.test(host) ? "douyin" : /(^|\.)xiaohongshu\.com$/.test(host) ? "xhs" : "";
  if (!site) return;
  DXTR.site = site;
  DXTR.sites[site].install();
  if (site === "xhs") DXTR.xhsImages?.install();
  if (site === "douyin") DXTR.douyinImages?.install();
  DXTR.panel?.install();

  window.__dxtrDebug = {
    version: DXTR.version,
    sampleUrls: () => DXTR.videos.sampleUrls(),
    prefetchPictures: (urls) => DXTR.douyinImages?.prefetch(urls, 0),
    report() {
      return JSON.stringify({
        version: DXTR.version,
        site,
        settings: DXTR.settings.get(),
        downloader: DXTR.downloader.stats(),
        nodes: [...DXTR.downloader.nodes.values()].map((n) => ({ host: n.host, mbps: +(n.speed * 8 / 1000).toFixed(1), ttfb: Math.round(n.ttfb), ok: n.ok, fail: n.fail, mb: +(n.bytes / 1048576).toFixed(1) })),
        videos: DXTR.videos.snapshot(),
        media: DXTR.mediaHook.stats(),
        mseFetch: DXTR.mediaFetch.stats(),
        images: DXTR.xhsImages?.stats?.() || null,
        ads: site === "douyin" ? DXTR.sites.douyin.adStats() : null,
        pictures: site === "douyin" ? DXTR.douyinImages.stats() : null,
        log: DXTR.log.lines().slice(-60)
      }, null, 2);
    }
  };
  DXTR.log("已启动", site, DXTR.version);
})();
