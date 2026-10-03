// Minimal CDP client (Node >= 22 has a global WebSocket). Used by the e2e tests and probes.
//   import { connectPage } from "./cdp.mjs";
//   const page = await connectPage({ url: "https://www.douyin.com/" });  // opens a new tab
//   await page.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
const BASE = process.env.CDP_BASE || "http://127.0.0.1:9222";

export async function listTargets() {
  return (await fetch(`${BASE}/json`)).json();
}

export async function connectPage({ url = "about:blank", targetId = null } = {}) {
  let target;
  if (targetId) target = (await listTargets()).find((t) => t.id === targetId);
  else target = await (await fetch(`${BASE}/json/new?${encodeURI("about:blank")}`, { method: "PUT" })).json();
  if (!target) throw new Error("target not found");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) {
      for (const fn of listeners.get(msg.method) || []) fn(msg.params);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const on = (method, fn) => {
    if (!listeners.has(method)) listeners.set(method, []);
    listeners.get(method).push(fn);
  };
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const close = async () => {
    try { ws.close(); } catch {}
    if (!targetId) await fetch(`${BASE}/json/close/${target.id}`).catch(() => {});
  };
  await send("Page.enable");
  await send("Runtime.enable");
  if (url !== "about:blank") await send("Page.navigate", { url });
  return { target, send, on, evaluate, close };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
