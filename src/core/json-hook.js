// Lets site modules read (and lightly edit) the JSON the site's own API returns, through
// both fetch and XMLHttpRequest. Only responses whose URL a rule matches are touched; a
// rule that throws leaves the response exactly as it was.
DXTR.jsonHook = (() => {
  "use strict";

  const rules = []; // { match(url) → bool, transform(obj, url) → void (edit in place) }

  function apply(url, obj) {
    let changed = false;
    for (const rule of rules) {
      if (!rule.match(url)) continue;
      try { if (rule.transform(obj, url) !== false) changed = true; }
      catch (error) { DXTR.log("JSON 处理出错", String(error?.message || error)); }
    }
    return changed;
  }

  function matches(url) {
    return rules.some((r) => { try { return r.match(url); } catch (_error) { return false; } });
  }

  function absolute(url) {
    try { return new URL(url, location.href).href; } catch (_error) { return String(url); }
  }

  // ---- fetch -------------------------------------------------------------------------------
  const nativeFetch = window.fetch;
  window.fetch = async function fetch(input, init) {
    const response = await nativeFetch.apply(this, arguments);
    const url = absolute(typeof input === "string" ? input : input?.url || String(input));
    if (!matches(url)) return response;
    try {
      const type = response.headers.get("content-type") || "";
      if (!/json|text\/plain/.test(type)) return response;
      const text = await response.clone().text();
      const obj = JSON.parse(text);
      if (!apply(url, obj)) return response;
      const edited = new Response(JSON.stringify(obj), { status: response.status, statusText: response.statusText, headers: response.headers });
      Object.defineProperty(edited, "url", { value: response.url });
      Object.defineProperty(edited, "redirected", { value: response.redirected });
      return edited;
    } catch (_error) {
      return response;
    }
  };

  // ---- XMLHttpRequest ------------------------------------------------------------------------
  const XHR = XMLHttpRequest.prototype;
  const open = XHR.open;
  const responseText = Object.getOwnPropertyDescriptor(XHR, "responseText");
  const response = Object.getOwnPropertyDescriptor(XHR, "response");
  const cache = new WeakMap(); // xhr → { text, obj }

  XHR.open = function (method, url) {
    this.__dxtrUrl = absolute(url);
    cache.delete(this);
    return open.apply(this, arguments);
  };

  function edited(xhr) {
    if (xhr.readyState !== 4 || !xhr.__dxtrUrl || !matches(xhr.__dxtrUrl)) return null;
    if (cache.has(xhr)) return cache.get(xhr);
    let result = null;
    try {
      const type = xhr.responseType;
      if (type === "" || type === "text") {
        const obj = JSON.parse(responseText.get.call(xhr));
        if (apply(xhr.__dxtrUrl, obj)) result = { text: JSON.stringify(obj), obj: null };
      } else if (type === "json") {
        const obj = response.get.call(xhr);
        if (obj && typeof obj === "object") { apply(xhr.__dxtrUrl, obj); result = { text: null, obj }; }
      }
    } catch (_error) {}
    cache.set(xhr, result);
    return result;
  }

  Object.defineProperty(XHR, "responseText", {
    configurable: true,
    enumerable: responseText.enumerable,
    get() { const e = edited(this); return e && e.text !== null ? e.text : responseText.get.call(this); }
  });
  Object.defineProperty(XHR, "response", {
    configurable: true,
    enumerable: response.enumerable,
    get() {
      const e = edited(this);
      if (e) return e.obj !== null ? e.obj : e.text;
      return response.get.call(this);
    }
  });

  return { add: (rule) => rules.push(rule) };
})();
