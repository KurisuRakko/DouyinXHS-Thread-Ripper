// Zero-dependency build: concatenates src/ into one userscript per site.
//   node scripts/build.mjs [version]     → user_scripts/douyin.user.js, user_scripts/xhs.user.js
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "KurisuRakko/DouyinXHS-Thread-Ripper";
const raw = (file) => `https://raw.githubusercontent.com/${REPO}/main/user_scripts/${file}`;

// Order matters: later files use what earlier ones define on DXTR.
const CORE = [
  "src/core/settings.js",
  "src/core/range-core.js",
  "src/core/downloader.js",
  "src/core/video-cache.js",
  "src/core/json-hook.js",
  "src/core/media-hook.js"
];
const TAIL = ["src/ui/panel.js", "src/main.js"];

// One userscript per site: only that site's modules, one @match.
export const TARGETS = {
  douyin: {
    file: "douyin.user.js",
    name: "抖音 线程撕裂者",
    description: "抖音网页版：多线程多节点下载视频、刷下一条秒开、自动最高画质。不改网站播放器代码。",
    match: "https://www.douyin.com/*",
    files: [...CORE, "src/sites/douyin.js", "src/sites/douyin-images.js", ...TAIL]
  },
  xhs: {
    file: "xhs.user.js",
    name: "小红书 线程撕裂者",
    description: "小红书网页版：多线程多节点下载视频、自动最高画质、图片测速换最快节点。不改网站播放器代码。",
    match: "https://www.xiaohongshu.com/*",
    files: [...CORE, "src/sites/xhs.js", "src/sites/xhs-images.js", ...TAIL]
  }
};

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

export function build(target, ver = version()) {
  const t = TARGETS[target];
  const header = [
    ["name", t.name],
    ["namespace", `https://github.com/${REPO}`],
    ["version", ver],
    ["description", t.description],
    ["author", "Rakko"],
    ["license", "MIT"],
    ["homepageURL", `https://github.com/${REPO}`],
    ["supportURL", `https://github.com/${REPO}/issues`],
    ["updateURL", raw(t.file)],
    ["downloadURL", raw(t.file)],
    ["match", t.match],
    ["run-at", "document-start"],
    ["grant", "none"],
    ["inject-into", "page"],
    ["noframes", ""]
  ];
  const width = Math.max(...header.map(([k]) => k.length)) + 1;
  const meta = ["// ==UserScript==", ...header.map(([k, v]) => `// @${k.padEnd(width)}${v}`.trimEnd()), "// ==/UserScript=="].join("\n");
  const body = t.files.map((f) => `// ---- ${f}\n${readFileSync(join(ROOT, f), "utf8")}`).join("\n");
  const css = JSON.stringify(designCss());
  return `${meta}\n\n(function () {\n"use strict";\nif (window.__dxtrLoaded) return;\nwindow.__dxtrLoaded = true;\nconst DXTR = { version: ${JSON.stringify(ver)}, sites: {}, designCss: ${css} };\n${body}\n})();\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ver = version();
  for (const [target, t] of Object.entries(TARGETS)) {
    const out = join(ROOT, "user_scripts", t.file);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, build(target, ver));
    console.log(`built ${out}`);
  }
}
