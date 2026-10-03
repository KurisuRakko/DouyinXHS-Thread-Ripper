// Floating button + settings panel, in a shadow root so the site's CSS cannot reach it.
// Styling comes only from Rakko Design tokens (DXTR.designCss, inlined at build time).
DXTR.panel = (() => {
  "use strict";

  const S = DXTR.settings;
  let host = null;
  let root = null;
  let open = false;
  let timer = 0;

  const CSS = `
:host { all: initial; position: fixed; right: 16px; z-index: 2147483000; font-family: var(--font-sans); color: var(--color-neutral-9); }
* { box-sizing: border-box; }
.ball {
  width: 40px; height: 40px; border-radius: 9999px; border: 0; cursor: pointer;
  display: grid; place-items: center; color: var(--color-neutral-9);
  font: 600 12px/1 var(--font-sans);
}
.ball[data-glass] { background: color-mix(in srgb, var(--color-paper) var(--glass-panel-opacity), transparent); box-shadow: var(--shadow-whisper), inset 0 0 0 1px var(--color-border); }
.ball .dot { position: absolute; right: 7px; top: 7px; width: 6px; height: 6px; border-radius: 9999px; background: var(--color-success); }
.ball[data-off] .dot { background: var(--color-neutral-5); }
.panel {
  position: absolute; right: 0; bottom: 48px; width: 300px; max-height: min(560px, 80vh); overflow: auto;
  border-radius: 16px; padding: 14px 14px 10px;
  background: var(--color-paper);
  box-shadow: var(--shadow-whisper), inset 0 0 0 1px var(--color-border);
  font-size: 13px; line-height: 20px;
}
.panel[hidden] { display: none; }
h2 { margin: 0 0 2px; font: 600 15px/24px var(--font-sans); color: var(--color-neutral-10); }
.sub { margin: 0 0 10px; font-size: 12px; line-height: 18px; color: var(--color-neutral-7); }
.row { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 36px; padding: 0 2px; }
.row label { color: var(--color-neutral-9); }
.row .hint { display: block; font-size: 12px; line-height: 18px; color: var(--color-neutral-7); }
.switch { position: relative; width: 36px; height: 20px; flex: none; border-radius: 9999px; border: 0; cursor: pointer; background: var(--color-neutral-4); transition: background var(--motion-duration-state) var(--motion-ease-standard); }
.switch::after { content: ""; position: absolute; left: 2px; top: 2px; width: 16px; height: 16px; border-radius: 9999px; background: var(--color-paper); transition: transform var(--motion-duration-state) var(--motion-ease-standard); }
.switch[aria-checked="true"] { background: var(--color-accent); }
.switch[aria-checked="true"]::after { transform: translateX(16px); }
select { font: inherit; font-size: 13px; color: var(--color-neutral-9); background: var(--color-neutral-2); border: 1px solid var(--color-border); border-radius: 8px; padding: 4px 8px; }
hr { border: 0; border-top: 1px solid var(--color-border); margin: 8px 0; }
.stats { font: 12px/18px var(--font-mono); color: var(--color-neutral-8); white-space: pre-wrap; word-break: break-all; }
.actions { display: flex; gap: 8px; margin-top: 8px; }
.btn { flex: 1; border: 1px solid var(--color-border); background: var(--color-neutral-2); color: var(--color-neutral-9); border-radius: 8px; padding: 6px 8px; font: 500 12px/18px var(--font-sans); cursor: pointer; }
@media (prefers-reduced-motion: reduce) { .switch, .switch::after { transition: none; } }
`;

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "on") for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
      else if (v !== false && v != null) node.setAttribute(k, v === true ? "" : String(v));
    }
    for (const c of children) node.append(c);
    return node;
  }

  // A switch for a boolean setting, or for any setting given its own get/flip.
  function toggle(key, label, hint, get = () => !!S.get()[key], flip = () => S.set({ [key]: !S.get()[key] })) {
    const sw = el("button", { class: "switch", role: "switch", "aria-checked": String(get()), "data-ripple": true, "aria-label": label,
      on: { click: () => { flip(); render(); } } });
    return el("div", { class: "row" }, el("label", {}, label, hint ? el("span", { class: "hint" }, hint) : ""), sw);
  }

  function choice(key, label, options) {
    const select = el("select", { "aria-label": label, on: { change: (e) => { const v = e.target.value; S.set({ [key]: /^\d+$/.test(v) ? Number(v) : v }); render(); } } },
      ...options.map(([value, text]) => el("option", { value, ...(String(S.get()[key]) === String(value) ? { selected: true } : {}) }, text)));
    return el("div", { class: "row" }, el("label", {}, label), select);
  }

  function statsText() {
    const d = DXTR.downloader.stats();
    const v = DXTR.videos.snapshot();
    const lines = [];
    lines.push(`线程 ${d.inflight}/${d.limit}  已下载 ${(d.totalBytes / 1048576).toFixed(1)} MB`);
    lines.push(`秒开命中 ${v.hits}  未命中 ${v.misses}  切换 ${DXTR.mediaHook.stats().swaps}  内存应答 ${DXTR.mediaFetch.stats().served}`);
    for (const n of [...DXTR.downloader.nodes.values()].filter((n) => n.ok).sort((a, b) => b.speed - a.speed).slice(0, 4)) {
      lines.push(`${n.host.split(".")[0]}  ${(n.speed * 8 / 1000).toFixed(0)} Mbps`);
    }
    for (const r of v.records.slice(-4)) lines.push(`${r.state === "ready" ? "✓" : r.state === "failed" ? "✗" : `${Math.round(r.progress * 100)}%`} ${r.mb}MB ${r.label}`);
    if (DXTR.site === "douyin") { const a = DXTR.sites.douyin.adStats(); lines.push(`广告 已删 ${a.removed}  已划走 ${a.skipped}`); }
    const img = DXTR.xhsImages && DXTR.site === "xhs" ? DXTR.xhsImages.stats() : null;
    if (img) {
      lines.push(`图片 改写 ${img.rewritten}  补发 ${img.hedged}/${img.hedgeWins}胜  回退 ${img.fallbacks}  预取 ${img.prefetched}`);
      for (const n of img.nodes.slice(0, 4)) lines.push(`  ${n.node.split(".")[0]}  ${n.samples ? `${n.ms} ms` : "未测"}  ×${n.samples}`);
    }
    return lines.join("\n");
  }

  function render() {
    if (!root) return;
    const s = S.get();
    const ball = root.querySelector(".ball");
    if (s.enabled) ball.removeAttribute("data-off"); else ball.setAttribute("data-off", "");
    host.style.display = s.floatingButton ? "" : "none";
    const panel = root.querySelector(".panel");
    panel.hidden = !open;
    if (!open) return;
    panel.replaceChildren(
      el("h2", {}, "线程撕裂者"),
      el("p", { class: "sub" }, `${DXTR.site === "xhs" ? "小红书" : "抖音"} · v${DXTR.version} · 改动刷新页面后完全生效`),
      toggle("enabled", "总开关"),
      toggle("video", "视频多线程 + 秒开", "多节点并发下载，提前下好后面几条"),
      toggle("quality", "自动最高画质", "只在网站给出的画质里挑", () => S.get().quality === "best",
        () => S.set({ quality: S.get().quality === "best" ? "site" : "best" })),
      ...(DXTR.site === "xhs" ? [toggle("images", "图片换最快节点", "测速选节点，慢图自动补发")] : []),
      ...(DXTR.site === "douyin" ? [toggle("adblock", "去广告", "推荐流里的广告直接删掉，漏网的自动划走")] : []),
      choice("threads", "并发线程", [["auto", "自动"], ...S.THREAD_CHOICES.map((n) => [n, String(n)])]),
      choice("prefetchNext", "预加载后面几条", [0, 1, 2, 3, 4, 5].map((n) => [n, String(n)])),
      choice("cacheMB", "内存缓存上限", [[150, "150 MB"], [300, "300 MB"], [600, "600 MB"], [1000, "1 GB"]]),
      el("hr"),
      el("div", { class: "stats" }, statsText()),
      el("div", { class: "actions" },
        el("button", { class: "btn", "data-ripple": true, on: { click: copyReport } }, "复制诊断信息"),
        el("button", { class: "btn", "data-ripple": true, title: "Alt+Shift+D 可再叫出来", on: { click: () => { S.set({ floatingButton: false }); open = false; render(); } } }, "隐藏悬浮球"))
    );
  }

  async function copyReport() {
    const text = window.__dxtrDebug.report();
    try { await navigator.clipboard.writeText(text); } catch (_error) { console.log(text); }
  }

  function theme() {
    const dark = DXTR.site === "douyin" || matchMedia("(prefers-color-scheme: dark)").matches;
    host.setAttribute("data-theme", dark ? "dark" : "light");
  }

  function mount() {
    if (host || !document.body) return;
    host = document.createElement("dxtr-panel");
    const top = S.get().floatingTop;
    host.style.cssText = top == null ? "bottom: 96px" : `top: ${Math.round(top * 100)}vh`;
    root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = DXTR.designCss + CSS;
    const ball = el("button", { class: "ball", "data-glass": "panel", "data-ripple": true, title: "线程撕裂者", "aria-label": "线程撕裂者设置" }, "DX", el("span", { class: "dot" }));
    let drag = null;
    ball.addEventListener("pointerdown", (e) => { drag = { y: e.clientY, moved: false }; ball.setPointerCapture(e.pointerId); });
    ball.addEventListener("pointermove", (e) => {
      if (!drag) return;
      if (Math.abs(e.clientY - drag.y) > 4) drag.moved = true;
      if (drag.moved) { host.style.bottom = ""; host.style.top = `${Math.min(innerHeight - 48, Math.max(8, e.clientY - 20))}px`; }
    });
    ball.addEventListener("pointerup", (e) => {
      if (drag?.moved) S.set({ floatingTop: Math.max(0, Math.min(1, (e.clientY - 20) / innerHeight)) });
      else { open = !open; render(); }
      drag = null;
    });
    root.append(style, el("div", { class: "panel", hidden: true }), ball);
    document.body.append(host);
    theme();
    render();
    timer = setInterval(() => { if (open) { const st = root.querySelector(".stats"); if (st) st.textContent = statsText(); } }, 1000);
  }

  function install() {
    if (document.body) mount();
    else document.addEventListener("DOMContentLoaded", mount, { once: true });
    // SPA re-renders can drop our element.
    setInterval(() => { if (host && !host.isConnected && document.body) document.body.append(host); }, 1000);
    // Alt+Shift+D brings the button back (or hides it).
    window.addEventListener("keydown", (e) => {
      if (e.altKey && e.shiftKey && e.code === "KeyD") { S.set({ floatingButton: !S.get().floatingButton }); render(); }
    }, true);
  }

  return { install, render };
})();
