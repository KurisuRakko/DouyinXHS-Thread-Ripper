// 抖音 clean mode: the wide left navigation and the top bar are folded into one 56px rail,
// and opening the home page goes straight to the recommend feed instead of 精选.
//
// The site's own elements are kept wherever possible, only restyled, so their routing (no
// page reload), active state, red dots and popups keep working:
//   - the left navigation shrinks to the rail and shows only 推荐 / 关注 / 我的 as icons;
//   - the top bar's menu (#douyin-header-menuCt) moves to the bottom of the rail with only
//     通知 / 消息 / the avatar; their popups are moved to open to the right of the rail.
// What the site has no element for is drawn by us in a shadow root: the search button
// (with its own input) at the top of the rail, and on pages without the site's navigation
// (the search results page) a fallback rail with plain links.
//
// Selectors use ids, data-e2e, the site's semantic class names (tab-recommend,
// isCssFullScreen) and structure only, never the hashed class names, which change with
// every site release.
DXTR.douyinClean = (() => {
  "use strict";

  const RAIL = 56;
  const JUMPED_KEY = "dxtr.cleanJumped";
  // Same address as the site's own 推荐 link.
  const RECOMMEND_URL = "https://www.douyin.com/?recommend=1&from_nav=1";
  const KEEP_TABS = ".tab-recommend, .tab-follow, .tab-user_self";

  const NAV = "#douyin-navigation";
  const LIST = '[data-e2e="douyin-navigation"]';
  const MENU = "#douyin-header-menuCt";
  const TAB = ":is(.tab-recommend, .tab-follow, .tab-user_self)";

  const PAGE_CSS = `
/* Left navigation → the rail. The fixed panel (2nd child) keeps its own background. */
${NAV} { width: ${RAIL}px !important; min-width: ${RAIL}px !important; flex: none !important; }
${NAV} > :not(:nth-child(2)) { display: none !important; }
${NAV} > div { width: ${RAIL}px !important; }
${NAV} > div > :first-child { display: none !important; }
${NAV} > div > :nth-child(2) { width: ${RAIL}px !important; height: auto !important; margin-top: 52px !important; }
${LIST}, ${LIST} > div, ${LIST} > div > div, ${LIST} > div > div > div { width: ${RAIL}px !important; height: auto !important; overflow: visible !important; padding: 0 !important; }
/* Drop the download card, filing info and footer, then every entry but the three we keep. */
${LIST} > :not(:first-child), ${LIST} > :first-child > :not(:first-child) { display: none !important; }
${LIST} > div > div > div > :not(:has(${KEEP_TABS})) { display: none !important; }
${LIST} > div > div > div > div { width: ${RAIL}px !important; height: 48px !important; margin: 0 !important; padding: 0 !important; display: flex !important; justify-content: center !important; align-items: center !important; }
${TAB} { width: 40px !important; min-width: 0 !important; height: 40px !important; padding: 0 !important; margin: 0 !important; border-radius: 10px !important; }
${TAB} > a { position: relative !important; width: 40px !important; height: 40px !important; padding: 0 !important; display: flex !important; justify-content: center !important; align-items: center !important; }
${TAB} > a > :first-child { margin: 0 !important; width: 24px !important; }
${TAB} > a > :nth-child(2) { display: none !important; }
/* The red dot: into the icon's top right corner. */
${TAB} > a > :nth-child(3) { position: absolute !important; right: 4px !important; top: 4px !important; width: 8px !important; height: 8px !important; margin: 0 !important; }
${TAB} > a > :nth-child(3) > * { top: 0 !important; right: 0 !important; left: auto !important; }

/* Top bar → nothing but its menu, which sits at the bottom of the rail. */
#douyin-right-container { padding-top: 0 !important; }
#douyin-header { left: 0 !important; top: auto !important; bottom: 12px !important; width: ${RAIL}px !important; height: auto !important; background: none !important; }
#douyin-header > :not(:first-child) { display: none !important; }
#douyin-header > div, #douyin-header header, #douyin-header header > div, #douyin-header header > div > div { width: ${RAIL}px !important; height: auto !important; padding: 0 !important; margin: 0 !important; background: none !important; display: block !important; position: static !important; }
#douyin-header header > div > div > :not(${MENU}) { display: none !important; }
${MENU} { width: ${RAIL}px !important; height: auto !important; margin: 0 !important; padding: 0 !important; }
${MENU} pace-island > div { display: flex !important; flex-direction: column !important; align-items: center !important; width: ${RAIL}px !important; height: auto !important; gap: 4px !important; }
/* 通知 and 消息 are the menu's <ul> entries; of the <div> entries only the avatar stays
   (充钻石 / 客户端 / 投稿 go). Nothing more stable tells them apart. */
${MENU} pace-island > div > div:not(:has([data-e2e="live-avatar"])) { display: none !important; }
/* Popups: the notification list is fixed to the top right, the avatar menu hangs below the
   avatar. Open both to the right of the rail instead, bottom-aligned. The avatar menu gets
   a transparent left padding so the pointer can cross the gap without closing it. */
${MENU} ul:not(:has([data-e2e="im-entry"])) [data-e2e="something-button"] + div { left: ${RAIL}px !important; right: auto !important; top: auto !important; bottom: 12px !important; }
${MENU} a:has([data-e2e="live-avatar"]) + div { left: 34px !important; right: auto !important; top: auto !important; bottom: -4px !important; width: max-content !important; padding-left: 14px !important; }

/* Pages where the site shows no navigation (search results; set by tick()): leave room for
   our rail. The search toolbar is fixed (site: left 30px, width 100vw - 72px); shift it too. */
html[data-dxtr-bare] #douyin-right-container { margin-left: ${RAIL}px !important; width: calc(100% - ${RAIL}px) !important; }
html[data-dxtr-bare] #search-result-container { width: auto !important; max-width: none !important; }
html[data-dxtr-bare] #search-toolbar-container { left: ${RAIL + 30}px !important; width: calc(100vw - ${RAIL + 72}px) !important; }
/* 网页全屏: the player covers the page (z-index 2000); our rail must not sit on top. */
html:has(.isCssFullScreen) dxtr-rail { display: none !important; }
`;

  const RAIL_CSS = `
:host { all: initial; position: fixed; left: 0; top: 0; width: ${RAIL}px; height: ${RAIL}px; z-index: 501; font-family: var(--font-sans); color: var(--color-neutral-9); }
:host([data-full]) { height: 100vh; background: var(--color-neutral-1); }
* { box-sizing: border-box; }
.rail { display: flex; flex-direction: column; align-items: center; padding-top: 4px; }
.slot { width: ${RAIL}px; height: 48px; display: grid; place-items: center; }
.links { display: none; }
:host([data-full]) .links { display: contents; }
.item {
  width: 40px; height: 40px; border-radius: 10px; border: 0; padding: 0; cursor: pointer;
  display: grid; place-items: center; background: transparent; color: var(--color-neutral-7);
  transition: background var(--motion-duration-state) var(--motion-ease-standard), color var(--motion-duration-state) var(--motion-ease-standard);
}
.item:hover, .item[aria-expanded="true"] { background: color-mix(in srgb, var(--color-neutral-10) 8%, transparent); color: var(--color-neutral-10); }
.item[aria-current="page"] { background: color-mix(in srgb, var(--color-neutral-10) 12%, transparent); color: var(--color-neutral-10); }
.item svg { width: 22px; height: 22px; }
.pop {
  position: fixed; left: ${RAIL + 8}px; top: 8px; width: 380px; padding: 8px; border-radius: 14px;
  background: var(--color-neutral-2); box-shadow: var(--shadow-whisper), inset 0 0 0 1px var(--color-border);
}
.pop[hidden] { display: none; }
input {
  width: 100%; height: 40px; padding: 0 12px; border-radius: 10px; outline: none;
  font: 14px/20px var(--font-sans); color: var(--color-neutral-10);
  background: var(--color-neutral-1); border: 1px solid var(--color-border);
}
input::placeholder { color: var(--color-neutral-5); }
input::-webkit-search-cancel-button { display: none; }
input:focus { border-color: var(--color-accent); }
.hint { margin: 6px 4px 0; font-size: 12px; line-height: 18px; color: var(--color-neutral-6); }
@media (prefers-reduced-motion: reduce) { .item { transition: none; } }
`;

  const ICONS = {
    search: '<path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 0M20 20l-4-4"/>',
    recommend: '<path d="M12 3.5l2.2 5.3 5.3 2.2-5.3 2.2L12 18.5l-2.2-5.3L4.5 11l5.3-2.2L12 3.5Z"/>',
    follow: '<path d="M10 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM3.5 20a6.5 6.5 0 0 1 11-4.7M15 18l2 2 4-4"/>',
    self: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM5 20a7 7 0 0 1 14 0"/>'
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

  // Where to send this page instead, or "" to leave it. Only the bare home page and 精选
  // are sent to the feed: query strings other than from_* (a shared ?modal_id= video, an
  // explicit ?recommend=1) mean the page was asked for on purpose. `jumped` = this tab was
  // already sent once, so a logged-out visitor whom the site bounces back stays put.
  function recommendTarget(href, jumped) {
    if (jumped) return "";
    let url;
    try { url = new URL(href); } catch (_error) { return ""; }
    if (!/(^|\.)douyin\.com$/.test(url.hostname)) return "";
    if (!/^\/(jingxuan\/?)?$/.test(url.pathname)) return "";
    if ([...url.searchParams.keys()].some((k) => !/^from/.test(k))) return "";
    return RECOMMEND_URL;
  }

  // The search results page for a query (same route the site's own search box opens).
  const searchUrl = (query) => `https://www.douyin.com/search/${encodeURIComponent(query)}?type=general`;

  // The query of the search results page on screen, to put back into our input.
  function currentQuery(href) {
    try {
      const m = /^\/(?:root\/)?search\/([^/?#]+)/.exec(new URL(href).pathname);
      return m ? decodeURIComponent(m[1]) : "";
    } catch (_error) {
      return "";
    }
  }

  // Which fallback link matches the page on screen.
  function activeTab(href) {
    let url;
    try { url = new URL(href); } catch (_error) { return ""; }
    if (url.pathname === "/" && url.searchParams.has("recommend")) return "recommend";
    if (/^\/follow(\/|$)/.test(url.pathname)) return "follow";
    if (/^\/user\/self(\/|$)/.test(url.pathname)) return "self";
    return "";
  }

  const jumped = () => { try { return sessionStorage.getItem(JUMPED_KEY) === "1"; } catch (_error) { return true; } };

  // Send the page to the feed if it should go. Inside the app the site's own 推荐 link is
  // used (no reload); at document-start there is nothing to click yet.
  function jumpIfNeeded(useLink) {
    const target = recommendTarget(location.href, jumped());
    if (!target) return false;
    try { sessionStorage.setItem(JUMPED_KEY, "1"); } catch (_error) { return false; }
    const link = useLink && document.querySelector(".tab-recommend a");
    DXTR.log("净化：跳到推荐", location.pathname);
    if (link) link.click();
    else location.replace(target);
    return true;
  }

  // The site moves "/" to "/jingxuan" with history.replaceState after it boots; catch that
  // and any later in-app move to 精选.
  function watchHistory() {
    for (const name of ["pushState", "replaceState"]) {
      const native = history[name];
      history[name] = function (...args) {
        const result = native.apply(this, args);
        queueMicrotask(() => jumpIfNeeded(true));
        return result;
      };
    }
    window.addEventListener("popstate", () => jumpIfNeeded(true));
  }

  let style = null;
  let host = null;
  let root = null;
  let pop = null;
  let input = null;
  let searchButton = null;

  function addStyle() {
    style = document.createElement("style");
    style.id = "dxtr-clean";
    style.textContent = PAGE_CSS;
    // At document-start there may be no <html> element yet.
    if (document.documentElement) { document.documentElement.append(style); return; }
    new MutationObserver((_records, observer) => {
      if (!document.documentElement) return;
      observer.disconnect();
      document.documentElement.append(style);
    }).observe(document, { childList: true });
  }

  function search(raw) {
    const query = raw.trim();
    if (!query) return;
    closeSearch();
    // The site's own (hidden) search box opens the results without a page reload.
    const box = document.querySelector('[data-e2e="searchbar-input"]');
    const go = document.querySelector('[data-e2e="searchbar-button"]');
    if (box && go) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(box, query);
      box.dispatchEvent(new Event("input", { bubbles: true }));
      go.click();
    } else {
      location.assign(searchUrl(query));
    }
  }

  function openSearch() {
    pop.hidden = false;
    searchButton.setAttribute("aria-expanded", "true");
    input.value = currentQuery(location.href);
    input.focus();
    input.select();
    // The site may move focus back to the player right after the click; take it back once.
    setTimeout(() => { if (!pop.hidden && root.activeElement !== input) input.focus(); }, 50);
  }

  function closeSearch() {
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    searchButton.setAttribute("aria-expanded", "false");
    input.blur();
  }

  // Our rail's events must not reach the site: it uses space, arrows and letters as player
  // shortcuts, and its own capture listeners on window/document/body swallow clicks it does
  // not expect. Seen from window, an event inside our closed shadow root has the host as its
  // target; stopping it there in the capture phase (registered at document-start, before
  // the site's listeners) keeps it from every site listener, while default actions (typing,
  // focusing the input, following a link) still happen. Because that also keeps the events
  // from our own elements, the clicks and keys we need are handled right here.
  const GUARDED = ["keydown", "keypress", "keyup", "pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick"];
  const hit = (node, e) => { const r = node.getBoundingClientRect(); return e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom; };

  function guard(e) {
    if (!host) return;
    if (e.target !== host) {
      if (e.type === "pointerdown") closeSearch(); // a press anywhere else closes the search box
      return;
    }
    e.stopImmediatePropagation();
    if (e.type === "click" && hit(searchButton, e)) { if (pop.hidden) openSearch(); else closeSearch(); }
    if (e.type !== "keydown" || e.isComposing) return;
    if (e.key === "Enter" && root.activeElement === input) { e.preventDefault(); search(input.value); }
    else if (e.key === "Escape") closeSearch();
  }

  function mount() {
    if (host || !document.body) return;
    host = document.createElement("dxtr-rail");
    root = host.attachShadow({ mode: "closed" });
    const css = document.createElement("style");
    css.textContent = DXTR.designCss + RAIL_CSS;
    const link = (name, href, label) => `<div class="slot links"><a class="item" data-tab="${name}" href="${href}" title="${label}" aria-label="${label}">${icon(name)}</a></div>`;
    const rail = document.createElement("nav");
    rail.className = "rail";
    rail.innerHTML =
      `<div class="slot"><button class="item search" title="搜索" aria-label="搜索" aria-haspopup="dialog" aria-expanded="false" data-ripple>${icon("search")}</button></div>` +
      link("recommend", RECOMMEND_URL, "推荐") +
      link("follow", "https://www.douyin.com/follow", "关注") +
      link("self", "https://www.douyin.com/user/self", "我的");
    pop = document.createElement("div");
    pop.className = "pop";
    pop.hidden = true;
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "搜索");
    pop.innerHTML = '<input type="search" placeholder="搜索你感兴趣的内容" enterkeyhint="search" autocomplete="off"><p class="hint">回车搜索 · Esc 关闭</p>';
    input = pop.querySelector("input");
    searchButton = rail.querySelector(".search");
    root.append(css, rail, pop);
    document.body.append(host);
    tick();
  }

  // Runs twice a second: SPA re-renders can drop our nodes, and the page under the rail
  // changes without reloads.
  function tick() {
    if (!style.isConnected && document.documentElement) document.documentElement.append(style);
    if (!host) return;
    if (!host.isConnected && document.body) document.body.append(host);
    // The search page keeps the navigation in the DOM but hides it (display: none).
    const nav = document.querySelector(NAV);
    const bare = !nav || nav.getClientRects().length === 0;
    document.documentElement.toggleAttribute("data-dxtr-bare", bare);
    host.toggleAttribute("data-full", bare);
    host.setAttribute("data-theme", document.body?.getAttribute("theme-mode") === "light" ? "light" : "dark");
    const tab = activeTab(location.href);
    for (const a of root.querySelectorAll("[data-tab]")) {
      if (a.dataset.tab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    }
  }

  function install() {
    const s = DXTR.settings.get();
    if (!s.enabled || !s.clean) return;
    if (jumpIfNeeded(false)) return;
    addStyle();
    watchHistory();
    for (const type of GUARDED) window.addEventListener(type, guard, true);
    if (document.body) mount();
    else document.addEventListener("DOMContentLoaded", mount, { once: true });
    setInterval(tick, 500);
  }

  return { install, recommendTarget, searchUrl, currentQuery, activeTab };
})();
