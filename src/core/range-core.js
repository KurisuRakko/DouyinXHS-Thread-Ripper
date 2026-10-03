// Byte-range helpers: parsing Content-Range, planning chunks, checking what came back.
DXTR.rangeCore = (() => {
  "use strict";

  const KB = 1024;
  const MB = 1024 * KB;

  // "bytes 0-1023/4096" → { start, end, total }; total is null for "*".
  function parseContentRange(value) {
    if (typeof value !== "string") return null;
    const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(value.trim());
    if (!match) return null;
    const start = Number(match[1]);
    const end = Number(match[2]);
    const total = match[3] === "*" ? null : Number(match[3]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return null;
    if (total !== null && (!Number.isSafeInteger(total) || total <= end)) return null;
    return { start, end, total };
  }

  // Chunk size for a file: small enough that every thread gets work twice over, never below
  // 256 KB (request overhead dominates) and never above 2 MB (a slow node holds less data).
  function chunkSizeFor(total, threads) {
    const wanted = Math.ceil(total / Math.max(1, threads * 2));
    return Math.max(256 * KB, Math.min(2 * MB, wanted));
  }

  // Splits [from, total) into chunks of about `size` bytes. Ends are inclusive.
  function planChunks(from, total, size) {
    const chunks = [];
    for (let start = from; start < total; start += size) {
      chunks.push({ start, end: Math.min(total, start + size) - 1 });
    }
    return chunks;
  }

  // Is a 206 response really the bytes asked for? A server that ignores Range answers 200
  // with the whole file; a cache can answer a different window. Both are thrown away.
  //
  // Some CDNs (Xiaohongshu's) do not expose Content-Range to scripts. Then a 206 is taken
  // only if its Content-Length is exactly the length asked for, and the caller must still
  // count the body (`unverified`) and know the total from elsewhere.
  function checkResponse(status, contentRange, wantStart, wantEnd, knownTotal, contentLength) {
    if (status !== 206) return { ok: false, reason: `HTTP ${status}` };
    const range = parseContentRange(contentRange);
    if (!range) {
      if (contentRange) return { ok: false, reason: `Content-Range 无法解析：${contentRange}` };
      const wanted = knownTotal ? Math.min(wantEnd, knownTotal - 1) - wantStart + 1 : wantEnd - wantStart + 1;
      if (Number(contentLength) !== wanted) return { ok: false, reason: `长度不符 ${contentLength}/${wanted}` };
      return { ok: true, total: null, unverified: true };
    }
    if (range.start !== wantStart) return { ok: false, reason: `起点不符 ${range.start}/${wantStart}` };
    if (range.end < Math.min(wantEnd, (range.total ?? Infinity) - 1)) return { ok: false, reason: "长度不足" };
    if (knownTotal && range.total && range.total !== knownTotal) return { ok: false, reason: `总长不符 ${range.total}/${knownTotal}` };
    return { ok: true, total: range.total };
  }

  return { KB, MB, parseContentRange, chunkSizeFor, planChunks, checkResponse };
})();
