// Opens a page in the shared Chrome with the built userscript injected before any site
// script (same timing as @run-at document-start), then prints __dxtrDebug.report().
//   node dev/inject.mjs <url> [waitSeconds] [--off] [--eval <js>]
import { readFileSync } from "node:fs";
import { connectPage, sleep } from "./cdp.mjs";

const args = process.argv.slice(2);
const url = args[0];
const wait = Number(args[1] || 15) * 1000;
const off = args.includes("--off");
const evalAt = args.indexOf("--eval");
const extra = evalAt >= 0 ? args[evalAt + 1] : "";
const setAt = args.indexOf("--settings");
const settings = setAt >= 0 ? args[setAt + 1] : "";
const script = readFileSync(new URL("../user_scripts/dxtr.user.js", import.meta.url), "utf8");

const page = await connectPage();
try {
  if (settings) await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("dxtr.settings", ${JSON.stringify(settings)}); } catch (e) {}` });
  if (!off) await page.send("Page.addScriptToEvaluateOnNewDocument", { source: script });
  page.on("Runtime.exceptionThrown", (e) => console.log("PAGE EXCEPTION:", e.exceptionDetails?.exception?.description?.slice(0, 300)));
  await page.send("Page.navigate", { url });
  await sleep(wait);
  if (extra) console.log(await page.evaluate(extra));
  if (!off) console.log(await page.evaluate("window.__dxtrDebug ? __dxtrDebug.report() : 'NOT LOADED'"));
} finally {
  await page.close();
}
