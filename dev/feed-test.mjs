// Swipes through the Douyin recommend feed and measures how long each next video takes
// to show moving frames.  node dev/feed-test.mjs [--off] [swipes]
import { readFileSync } from "node:fs";
import { connectPage, sleep } from "./cdp.mjs";

const off = process.argv.includes("--off");
const swipes = Number(process.argv.find((a) => /^\d+$/.test(a)) || 5);
const script = readFileSync(new URL("../user_scripts/dxtr.user.js", import.meta.url), "utf8");
const page = await connectPage();
const key = async (k, code) => {
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: 40 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: 40 });
};
// Which video is playing, and since when has it advanced.
const probe = `(() => { const vs = [...document.querySelectorAll('video')].filter(v => !v.paused && v.currentTime > 0.05 && v.readyState >= 3); const v = vs[0]; return v ? (v.currentSrc || '').slice(0, 120) + '|' + v.videoHeight : ''; })()`;
try {
  if (!off) await page.send("Page.addScriptToEvaluateOnNewDocument", { source: script });
  await page.send("Page.navigate", { url: "https://www.douyin.com/?recommend=1" });
  await sleep(14000);
  await page.send("Runtime.evaluate", { expression: "document.querySelectorAll('video').forEach(v=>v.muted=true)" });
  const times = [];
  for (let i = 0; i < swipes; i += 1) {
    await sleep(6000);
    const before = await page.evaluate(probe);
    const t0 = Date.now();
    await key("ArrowDown", "ArrowDown");
    let now = before;
    while (Date.now() - t0 < 15000) {
      await sleep(50);
      now = await page.evaluate(probe);
      if (now && now.split("|")[0] !== before.split("|")[0]) break;
    }
    const ms = Date.now() - t0;
    times.push(ms);
    console.log(`swipe ${i + 1}: ${ms} ms  height=${now.split("|")[1]}`);
  }
  times.sort((a, b) => a - b);
  console.log(`median ${times[Math.floor(times.length / 2)]} ms (${off ? "OFF" : "ON"})`);
  if (!off) {
    const r = JSON.parse(await page.evaluate("__dxtrDebug.report()"));
    console.log(JSON.stringify({ hits: r.videos.hits, misses: r.videos.misses, swaps: r.media.swaps, nodes: r.nodes, recs: r.videos.records.map(x => `${x.state} ${x.mb}MB ${x.ms}ms p${x.priority}`) }, null, 1));
    console.log(r.log.slice(-25).join("\n"));
  }
} finally {
  await page.close();
}
