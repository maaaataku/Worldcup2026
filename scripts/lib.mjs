/* 共通ユーティリティ（依存ゼロ）。Node18+ の global fetch / AbortController を使用 */

/** リトライ付き JSON fetch。429/5xx は指数バックオフで数回再試行し、最終的に失敗したら throw */
export async function fetchJson(url, { headers = {}, timeoutMs = 12000, retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers, signal: ac.signal });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status} ${url}`);
        if (attempt < retries) { await sleep(800 * (attempt + 1)); continue; }
        throw lastErr;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return await res.json();
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt < retries && (e.name === 'AbortError' || e.code === 'ECONNRESET')) {
        await sleep(800 * (attempt + 1)); continue;
      }
      throw lastErr;
    }
  }
  throw lastErr;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WD = ['日', '月', '火', '水', '木', '金', '土'];

/** Asia/Tokyo の年月日時分を取り出す */
function jstParts(isoUtc) {
  const d = new Date(isoUtc);
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  let hour = parseInt(p.hour, 10);
  if (hour === 24) hour = 0; // en-US hour12:false は 0時を 24 と返すことがある
  const wdShort = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', weekday: 'short' }).format(d);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wdShort);
  return { y: +p.year, mo: +p.month, d: +p.day, h: hour, mi: +p.minute, wd };
}

const pad = (n) => String(n).padStart(2, '0');

/** UTC ISO → 画面表示用 "6/15(月) 5:00"（時は非ゼロ詰め、分は2桁） */
export function formatDateJST(isoUtc) {
  const { mo, d, h, mi, wd } = jstParts(isoUtc);
  return `${mo}/${d}(${WD[wd]}) ${h}:${pad(mi)}`;
}

/** UTC ISO → カウントダウン用 ISO "2026-06-15T05:00:00+09:00" */
export function toKickoffJST(isoUtc) {
  const { y, mo, d, h, mi } = jstParts(isoUtc);
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:00+09:00`;
}

/** 今日(JST)の "YYYY-MM-DD" */
export function todayJST() {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(new Date()); // en-CA は YYYY-MM-DD
}
