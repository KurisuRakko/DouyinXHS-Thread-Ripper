// Picture note: how many carousel pictures are already loaded 4 s after opening the note,
// and how long each "next picture" click takes to show a loaded picture. On vs off.
//   node dev/note-bench.mjs <note url> [<note url> …]
import { readFileSync } from "node:fs";
import { connectPage, sleep } from "./cdp.mjs";

const urls = process.argv.slice(2);
const script = readFileSync(new URL("../user_scripts/dxtr.user.js", import.meta.url), "utf8");
const slides = `(() => {
  const imgs = [...document.querySelectorAll('.note-slider img, .swiper-slide img, .media-container img')].filter(i => /xhscdn|xiaohongshu/.test(i.currentSrc || i.getAttribute('src') || ''));
  const uniq = [...new Map(imgs.map(i => [i.getAttribute('src'), i])).values()];
  return JSON.stringify({ total: uniq.length, loaded: uniq.filter(i => i.complete && i.naturalWidth).length });
})()`;
async function once(url, on) {
  const page = await connectPage();
  try {
    if (on) await page.send("Page.addScriptToEvaluateOnNewDocument", { source: script });
    await page.send("Network.enable");
    await page.send("Network.setCacheDisabled", { cacheDisabled: true });
    await page.send("Page.navigate", { url });
    await sleep(4000);
    const before = JSON.parse(await page.evaluate(slides));
    // Click "next" through the carousel; time until the active slide's picture is loaded.
    const clicks = [];
    for (let k = 1; k < before.total; k += 1) {
      const ok = await page.evaluate(`(() => { const b = document.querySelector('.arrow-controller.right, .swiper-button-next, [class*=arrow][class*=right]'); if (!b) return false; b.click(); return true; })()`);
      if (!ok) break;
      const t0 = Date.now();
      let done = false;
      while (Date.now() - t0 < 10000) {
        await sleep(30);
        done = await page.evaluate(`(() => { const a = document.querySelector('.swiper-slide-active img, .note-slider .active img'); return !!(a && a.complete && a.naturalWidth); })()`);
        if (done) break;
      }
      clicks.push(done ? Date.now() - t0 : 10000);
      await sleep(400);
    }
    const img = on ? JSON.parse(await page.evaluate("__dxtrDebug.report()")).images : null;
    return { ...before, clicks, prefetched: img?.prefetched };
  } finally { await page.close(); }
}
for (const url of urls) {
  for (const on of [false, true, false, true]) {
    const r = await once(url, on);
    console.log(`${on ? "ON " : "OFF"} ${url.slice(35, 59)}: ${r.total} pictures; next-click to shown: ${r.clicks.join(" ")} ms${on ? `  (prefetched ${r.prefetched})` : ""}`);
  }
}
