#!/usr/bin/env node
/* ============================================================================
   SAMURAI BLUE ダッシュボード データ更新スクリプト
   - football-data.org / API-Football を env で切替（FOOTBALL_API_PROVIDER）
   - 取得結果を data/static.json と merge して data/wc2026.json を生成
   - 取得失敗・レート制限時は前回値を保持（画面を壊さない）
   使い方:  FOOTBALL_API_KEY=xxx node scripts/update.mjs
   ============================================================================ */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { formatDateJST, toKickoffJST, todayJST } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATIC_PATH = join(ROOT, 'data', 'static.json');
const OUT_PATH = join(ROOT, 'data', 'wc2026.json');

const JP = '日本';

// 直接実行時のみ main を走らせる（import 時はテスト用に関数だけ使う）
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error('[update] 致命的エラー:', e); process.exit(1); });
}

export { buildBase, applyApi, resolveKnockout, computePhases, makeNameResolver };

async function main() {
  loadDotEnv(); // .env があれば読む（既存の環境変数=CI secrets は上書きしない）
  const STATIC = readJSON(STATIC_PATH);
  if (!STATIC) { console.error('[update] data/static.json が読めません。中断。'); process.exit(1); }
  const prev = readJSON(OUT_PATH); // 前回の出力（フォールバック源）

  // --- ベース構築：手管理キーは常に static から最新化、API キーは前回値（無ければ seed） ---
  const out = buildBase(STATIC, prev);

  // --- API 取得（失敗しても out はフォールバックのまま）---
  const provider = await loadProvider();
  const key = process.env.FOOTBALL_API_KEY;
  if (!provider) {
    console.warn('[update] プロバイダ未指定。FOOTBALL_API_PROVIDER を設定してください。フォールバックで書き出します。');
  } else if (!key) {
    console.warn(`[update] FOOTBALL_API_KEY 未設定（provider=${provider.name}）。フォールバックで書き出します。`);
  } else {
    try {
      console.log(`[update] provider=${provider.name} で取得開始…`);
      const data = await provider.fetchAll({ key });
      applyApi(out, data, STATIC);
      console.log('[update] API 取得・反映 完了');
    } catch (e) {
      console.warn('[update] API 取得に失敗。前回値を保持します:', e.message);
    }
  }

  // --- 変更が無ければ書かない（差分のみ commit させる）---
  const next = JSON.stringify(out, null, 2) + '\n';
  const current = existsSync(OUT_PATH) ? readFileSync(OUT_PATH, 'utf8') : '';
  if (next === current) { console.log('[update] 差分なし。'); return; }
  writeFileSync(OUT_PATH, next, 'utf8');
  console.log('[update] data/wc2026.json を更新しました。');
}

/* ---------------------------------------------------------------------------
   ベース（フォールバック）の組み立て
--------------------------------------------------------------------------- */
function buildBase(S, prev) {
  const seed = S.seed || {};
  return {
    meta: { updated: todayJST() },
    nextMatch: prev?.nextMatch ?? seed.nextMatch,
    schedule: {
      group: prev?.schedule?.group ?? seed.scheduleGroup,
      knockout: prev?.schedule?.knockout ?? seed.scheduleKnockout
    },
    groupF: prev?.groupF ?? seed.groupF,
    opponents: S.opponents,        // ← 以下は手管理。static の編集が常に反映される
    lineups: S.lineups,
    squadNote: S.squadNote,
    squad: S.squad,
    nedNote: S.nedNote,
    nedSquad: S.nedSquad,
    nedKey: S.nedKey,
    groups: S.groups,
    bracket: prev?.bracket ?? seed.bracket,
    phases: computePhases(S.phases)
  };
}

/* date/name は固定、now のみ今日(JST)から計算 */
function computePhases(phases) {
  const today = todayJST();
  return (phases || []).map((p) => ({
    date: p.date, name: p.name,
    now: !!(p.start && p.end && today >= p.start && today <= p.end)
  }));
}

/* ---------------------------------------------------------------------------
   API 取得結果（共通中間形）→ DATA キーへ反映
--------------------------------------------------------------------------- */
function applyApi(out, data, S) {
  const toJA = makeNameResolver(S);
  const standings = data.standings || [];
  const matches = data.matches || [];

  // ① グループF 順位表
  const gf = standings.find((g) => g.group === 'F');
  if (gf && gf.rows.length) {
    out.groupF = gf.rows
      .slice()
      .sort((a, b) => (a.rank || 99) - (b.rank || 99))
      .map((r) => {
        const team = toJA(r.name, r.tla);
        return { team, p: r.played, w: r.win, d: r.draw, l: r.lose, gf: r.gf, ga: r.ga, isJP: team === JP };
      });
  }

  // ② 日本の試合 → schedule.group / nextMatch
  const jpMatches = matches
    .filter((m) => toJA(m.home.name, m.home.tla) === JP || toJA(m.away.name, m.away.tla) === JP)
    .filter((m) => m.utc)
    .sort((a, b) => new Date(a.utc) - new Date(b.utc));

  const jpGroup = jpMatches.filter((m) => m.stage === 'GROUP');
  if (jpGroup.length) out.schedule.group = buildScheduleGroup(jpGroup, S, toJA);

  const nm = buildNextMatch(jpMatches, S, toJA);
  if (nm) out.nextMatch = nm;

  // ③ ノックアウト解決（日本の最終順位 + テンプレート + 他組の確定結果）
  const ko = resolveKnockout(out.groupF, standings, S, toJA);
  if (ko) { out.schedule.knockout = ko.knockout; out.bracket = ko.bracket; }
}

function buildScheduleGroup(jpGroup, S, toJA) {
  const venues = S.matchInfo?.group || [];
  let nextAssigned = false;
  return jpGroup.map((m, i) => {
    const round = m.round || i + 1;
    const home = toJA(m.home.name, m.home.tla);
    const away = toJA(m.away.name, m.away.tla);
    const venue = venues[round - 1]?.venue || venues[i]?.venue || '';
    const { result, score } = classifyGroupRow(m, home, () => {
      if (!nextAssigned) { nextAssigned = true; return true; }
      return false;
    });
    return {
      dateJST: formatDateJST(m.utc),
      stage: `F組 第${round}節`,
      home, away, venue, score, result
    };
  });
}

/* 行の result/score を決める。pre かつ最初の未消化試合は "next" */
function classifyGroupRow(m, homeJA, claimNext) {
  if (m.phase === 'pre') {
    return claimNext() ? { result: 'next', score: null } : { result: null, score: null };
  }
  const gh = m.goals.home, ga = m.goals.away;
  if (gh == null || ga == null) return { result: null, score: null };
  const score = `${gh}–${ga}`;
  const jpHome = homeJA === JP;
  const jp = jpHome ? gh : ga, op = jpHome ? ga : gh;
  const result = jp > op ? 'win' : jp < op ? 'loss' : 'draw';
  return { result, score };
}

function buildNextMatch(jpMatches, S, toJA) {
  if (!jpMatches.length) return null;
  const live = jpMatches.find((m) => m.phase === 'live');
  const upcoming = jpMatches.find((m) => m.phase === 'pre');
  const m = live || upcoming || jpMatches[jpMatches.length - 1]; // 全消化なら最後の試合
  const home = toJA(m.home.name, m.home.tla);
  const away = toJA(m.away.name, m.away.tla);
  const status = live ? 'LIVE' : upcoming ? '次戦' : '終了';
  const stage = stageLabel(m);
  const info = matchInfoFor(m, home, S);
  return {
    stage, status,
    home: teamWithMeta(home, S),
    away: teamWithMeta(away, S),
    kickoffJST: toKickoffJST(m.utc),
    info
  };
}

function teamWithMeta(teamJA, S) {
  const meta = S.teamMeta?.[teamJA];
  const o = { name: teamJA };
  if (meta) {
    o.meta = meta.pot ? `FIFA ${meta.fifaRank}位 ・ ${meta.pot}` : `FIFA ${meta.fifaRank}位`;
    if (meta.isJP) o.isJP = true;
  } else {
    o.meta = '';
  }
  return o;
}

function matchInfoFor(m, homeJA, S) {
  if (m.stage === 'GROUP') {
    const round = m.round || 1;
    const gi = (S.matchInfo?.group || [])[round - 1];
    if (gi) return [['会場', gi.venue], ...gi.broadcast];
  }
  // ノックアウト等：会場は未確定にしておき放送のみ
  const bc = S.matchInfo?.defaultBroadcast || [];
  return [['会場', '未定'], ...bc];
}

function stageLabel(m) {
  switch (m.stage) {
    case 'GROUP': return `グループF 第${m.round || 1}節`;
    case 'R32': return 'ラウンド32';
    case 'R16': return 'ラウンド16';
    case 'QF': return '準々決勝';
    case 'SF': return '準決勝';
    case '3RD': return '3位決定戦';
    case 'FINAL': return '決勝';
    default: return '次戦';
  }
}

/* ---------------------------------------------------------------------------
   ノックアウト解決：日本の F組最終順位 → テンプレート選択 → トークン置換
--------------------------------------------------------------------------- */
function resolveKnockout(groupF, standings, S, toJA) {
  const tpl = S.knockoutTemplate;
  if (!tpl) return null;

  // 日本の順位（ページと同じ並べ替え基準：勝点→得失→得点）
  const sorted = groupF.slice().map((t) => ({ ...t, pts: t.w * 3 + t.d, gd: t.gf - t.ga }))
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
  const jpIdx = sorted.findIndex((t) => t.isJP);
  const jpPos = jpIdx >= 0 ? jpIdx + 1 : 1;
  const final = groupF.length > 0 && groupF.every((t) => (t.p || 0) >= 3);

  // 未確定なら 1位想定の最短ルート（= master の現状維持）
  const key = final ? String(Math.min(jpPos, 3)) : '1';
  const chosen = tpl[key] || tpl['1'];
  if (!chosen) return null;

  // 他組の確定順位マップ（"C1"/"C2"…）。全試合消化済みの組のみ採用
  const posMap = buildGroupPositions(standings, toJA);
  const fill = (s) => (s || '').replace(/([A-L])組([12])位/g, (mAll, L, n) => posMap[L + n] || mAll);

  const knockout = (chosen.knockout || []).map((k) => ({ ...k, desc: fill(k.desc) }));
  const bracket = JSON.parse(JSON.stringify(chosen.bracket || {}));
  for (const round of Object.keys(bracket)) {
    for (const tie of bracket[round]) {
      if (tie.a) tie.a.t = fill(tie.a.t);
      if (tie.b) tie.b.t = fill(tie.b.t);
    }
  }
  return { knockout, bracket };
}

function buildGroupPositions(standings, toJA) {
  const map = {};
  for (const g of standings) {
    const complete = g.rows.length >= 2 && g.rows.every((r) => (r.played || 0) >= 3);
    if (!complete) continue;
    const ranked = g.rows.slice().sort((a, b) => (a.rank || 99) - (b.rank || 99));
    if (ranked[0]) map[`${g.group}1`] = toJA(ranked[0].name, ranked[0].tla);
    if (ranked[1]) map[`${g.group}2`] = toJA(ranked[1].name, ranked[1].tla);
  }
  return map;
}

/* ---------------------------------------------------------------------------
   ヘルパ
--------------------------------------------------------------------------- */
function makeNameResolver(S) {
  const byName = S.teamNames || {};
  const byTla = S.tlaNames || {};
  return (name, tla) => byName[name] || (tla && byTla[tla]) || name || '';
}

async function loadProvider() {
  const id = (process.env.FOOTBALL_API_PROVIDER || '').toLowerCase();
  if (id === 'api-football') return await import('./providers/api-football.mjs');
  if (id === 'football-data') return await import('./providers/football-data.mjs');
  return null;
}

function readJSON(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); }
  catch { return null; }
}

/* 依存ゼロの最小 .env ローダー。KEY=VALUE 行のみ対応。既存の env は上書きしない */
function loadDotEnv() {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const raw of readFileSync(envPath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}
