// Checks the "instant next" path on a Douyin video page: once the script has prefetched
// upcoming videos, a <video> given one of their original URLs must start from the blob;
// a not-prefetched one plays natively. Prints time-to-first-frame for both.
import { readFileSync } from "node:fs";
import { connectPage, sleep } from "./cdp.mjs";

const script = readFileSync(new URL("../user_scripts/dxtr.user.js", import.meta.url), "utf8");
const page = await connectPage();
const measure = (pick) => `(async () => {
  const recs = __dxtrDebug && JSON.parse(__dxtrDebug.report());
  const url = ${pick};
  if (!url) return 'no candidate';
  const v = document.createElement('video');
  v.muted = true; v.style.cssText = 'position:fixed;left:0;top:0;width:160px;height:90px;z-index:99999';
  document.body.append(v);
  const t0 = performance.now();
  v.src = url;
  v.play().catch(()=>{});
  await new Promise(r => { const f = () => (v.currentTime > 0.1 ? r() : requestAnimationFrame(f)); f(); setTimeout(r, 15000); });
  const ms = Math.round(performance.now() - t0);
  const real = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentSrc');
  const out = { ms, h: v.videoHeight, reportedSrc: v.src.slice(0, 40), attr: v.getAttribute('src').slice(0, 40) };
  v.pause(); v.remove();
  return JSON.stringify(out);
})()`;
try {
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: script });
  await page.send("Page.navigate", { url: process.argv[2] || "https://www.douyin.com/video/7672068956210875689" });
  for (let i = 0; i < 45; i += 1) {
    await sleep(1000);
    if (i > 10 && await page.evaluate("!!(window.__dxtrDebug && __dxtrDebug.sampleUrls().ready)")) break;
  }
  // URLs registered by the script: pick one that is ready (prefetched) and one that is not.
  console.log("prefetched:", await page.evaluate(measure("__dxtrDebug.sampleUrls().ready")));
  console.log("native   :", await page.evaluate(measure("__dxtrDebug.sampleUrls().cold")));
  const r = JSON.parse(await page.evaluate("__dxtrDebug.report()"));
  console.log(JSON.stringify({ hits: r.videos.hits, misses: r.videos.misses, swaps: r.media.swaps, entries: r.videos.entries }));
  console.log(await page.evaluate("JSON.stringify([...document.querySelectorAll('video')].map(v=>[v.currentSrc.slice(8,60), v.currentTime, v.readyState]))"));
  console.log(r.log.slice(-8).join("\n"));
} finally {
  await page.close();
}
