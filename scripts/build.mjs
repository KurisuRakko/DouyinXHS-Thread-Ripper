// Zero-dependency build: concatenates src/ into one userscript.
//   node scripts/build.mjs [version]     → user_scripts/dxtr.user.js
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "KurisuRakko/DouyinXHS-Thread-Ripper";
const RAW = `https://raw.githubusercontent.com/${REPO}/main/user_scripts/dxtr.user.js`;

// Order matters: later files use what earlier ones define on DXTR.
export const FILES = [
  "src/core/settings.js",
  "src/core/range-core.js",
  "src/core/downloader.js",
  "src/core/video-cache.js",
  "src/core/json-hook.js",
  "src/core/media-hook.js",
  "src/sites/douyin.js",
  "src/sites/xhs.js",
  "src/sites/xhs-images.js",
  "src/ui/panel.js",
  "src/main.js"
];

function version() {
  if (process.argv[2]) return process.argv[2];
  try { return execSync("git describe --tags --abbrev=0", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim().replace(/^v/, ""); }
  catch { return "0.1.0"; }
}

// Rakko Design tokens, scoped to the panel's shadow root (:root → :host).
export function designCss() {
  const v = (p) => readFileSync(join(ROOT, "vendor/rakko-design", p), "utf8");
  return [
    v("tokens.generated.css").replace(/:root\s*\{/, ":host {").replace(/\[data-theme='dark'\]\s*\{/, ":host([data-theme='dark']) {"),
    v("design-system/src/glass.css"),
    v("design-system/src/state-layer.css")
  ].join("\n");
}

export function build(ver = version()) {
  const header = [
    ["name", "抖音 / 小红书 线程撕裂者"],
    ["namespace", `https://github.com/${REPO}`],
    ["version", ver],
    ["description", "抖音、小红书网页版：多线程多节点下载视频、刷下一条秒开、自动最高画质、小红书图片测速换最快节点。不改网站播放器代码。"],
    ["author", "Rakko"],
    ["license", "MIT"],
    ["homepageURL", `https://github.com/${REPO}`],
    ["supportURL", `https://github.com/${REPO}/issues`],
    ["updateURL", RAW],
    ["downloadURL", RAW],
    ["match", "https://www.douyin.com/*"],
    ["match", "https://www.xiaohongshu.com/*"],
    ["run-at", "document-start"],
    ["grant", "none"],
    ["inject-into", "page"],
    ["noframes", ""]
  ];
  const width = Math.max(...header.map(([k]) => k.length)) + 1;
  const meta = ["// ==UserScript==", ...header.map(([k, v]) => `// @${k.padEnd(width)}${v}`.trimEnd()), "// ==/UserScript=="].join("\n");
  const body = FILES.map((f) => `// ---- ${f}\n${readFileSync(join(ROOT, f), "utf8")}`).join("\n");
  const css = JSON.stringify(designCss());
  return `${meta}\n\n(function () {\n"use strict";\nif (window.__dxtrLoaded) return;\nwindow.__dxtrLoaded = true;\nconst DXTR = { version: ${JSON.stringify(ver)}, sites: {}, designCss: ${css} };\n${body}\n})();\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = join(ROOT, "user_scripts/dxtr.user.js");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, build());
  console.log(`built ${out}`);
}
