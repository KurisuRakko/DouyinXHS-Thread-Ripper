// Time until every feed cover in view has loaded, script on vs off, alternating.
//   node dev/image-bench.mjs [rounds] [url]
import { readFileSync } from "node:fs";
import { connectPage, sleep } from "./cdp.mjs";

const rounds = Number(process.argv[2] || 3);
const url = process.argv[3] || "https://www.xiaohongshu.com/explore";
const script = readFileSync(new URL("../user_scripts/dxtr.user.js", import.meta.url), "utf8");
const probe = `(() => {
  const imgs = [...document.querySelectorAll('img')].filter(i => /sns-webpic|sns-img|sns-na-i|ci\\.xiao/.test(i.currentSrc || i.getAttribute('src') || ''));
  const inView = imgs.filter(i => { const r = i.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.width > 50; });
  const done = inView.filter(i => i.complete && i.naturalWidth > 0).length;
  return JSON.stringify({ n: inView.length, done, t: Math.round(performance.now()) });
})()`;
async function once(on) {
  const page = await connectPage();
  try {
    if (on) await page.send("Page.addScriptToEvaluateOnNewDocument", { source: script });
    await page.send("Network.enable");
    await page.send("Network.setCacheDisabled", { cacheDisabled: true }); // no browser cache: cold every time
    await page.send("Page.navigate", { url });
    const t0 = Date.now();
    let last = null;
    while (Date.now() - t0 < 30000) {
      await sleep(100);
      try { last = JSON.parse(await page.evaluate(probe)); } catch { continue; }
      if (last.n >= 8 && last.done === last.n) break;
    }
    const first = { ...last, ok: last && last.n >= 8 && last.done === last.n };
    // Scroll a screen at a time; time until the newly visible covers are all loaded.
    const scrolls = [];
    for (let k = 0; k < 6; k += 1) {
      await sleep(1500);
      await page.evaluate("window.scrollBy(0, innerHeight); 0");
      const s0 = Date.now();
      let st = null;
      while (Date.now() - s0 < 15000) {
        await sleep(50);
        try { st = JSON.parse(await page.evaluate(probe)); } catch { continue; }
        if (st.n >= 4 && st.done === st.n) break;
      }
      scrolls.push(st && st.done === st.n ? Date.now() - s0 : 15000);
    }
    first.scrolls = scrolls;
    if (on) first.img = JSON.parse(await page.evaluate("__dxtrDebug.report()")).images;
    return first;
  } finally { await page.close(); }
}
const res = { on: [], off: [] };
const scr = { on: [], off: [] };
for (let i = 0; i < rounds; i += 1) {
  for (const on of [false, true]) {
    const r = await once(on);
    res[on ? "on" : "off"].push(r.ok ? r.t : null);
    scr[on ? "on" : "off"].push(...r.scrolls);
    console.log(`${on ? "ON " : "OFF"} first screen ${r.t} ms${r.ok ? "" : " (timeout)"}; after each scroll: ${r.scrolls.join(" ")} ms`);
    if (r.img) console.log(`    used: rewritten ${r.img.rewritten} hedged ${r.img.hedged}/${r.img.hedgeWins} top: ${r.img.nodes.slice(0, 4).map((n) => `${n.node.split(".")[0]}:${n.ms}ms×${n.samples}`).join(" ")}`);
  }
}
const med = (a) => { const b = a.filter((x) => x != null).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : null; };
console.log(`first screen median OFF ${med(res.off)} ms, ON ${med(res.on)} ms`);
console.log(`per-scroll median OFF ${med(scr.off)} ms, ON ${med(scr.on)} ms`);
