/* ESPN（非公式・無料・APIキー不要）アダプタ
   FIFA World Cup の公開 JSON を使う。スコア・順位は事実データ。
   - 順位表: 1リクエスト（全12組）
   - 日程/結果: 1リクエスト（大会期間を日付レンジ一括取得）
   出力は共通中間形 { standings, matches }（update.mjs が DATA キーへマップ）。
   ※ 非公式エンドポイントのため将来仕様変更の可能性あり。失敗時は update.mjs がフォールバック。 */
import { fetchJson } from '../lib.mjs';

const SITE = process.env.FOOTBALL_ESPN_BASE || 'https://site.api.espn.com/apis';
const LEAGUE = process.env.FOOTBALL_ESPN_LEAGUE || 'fifa.world';
const DATES = process.env.FOOTBALL_ESPN_DATES || '20260611-20260719';

export const name = 'espn';

export async function fetchAll() {
  const [standRes, sbRes] = await Promise.all([
    fetchJson(`${SITE}/v2/sports/soccer/${LEAGUE}/standings`),
    fetchJson(`${SITE}/site/v2/sports/soccer/${LEAGUE}/scoreboard?dates=${DATES}&limit=400`)
  ]);
  return { standings: mapStandings(standRes), matches: mapMatches(sbRes) };
}

/* children[] = グループ。entries[].stats[] を name で引く */
function mapStandings(res) {
  const out = [];
  for (const g of res?.children || []) {
    const letter = groupLetter(g.name);
    if (!letter) continue;
    const entries = g?.standings?.entries || [];
    out.push({
      group: letter,
      rows: entries.map((e) => {
        const s = statMap(e.stats);
        return {
          name: e.team?.displayName || e.team?.name || '',
          tla: e.team?.abbreviation || null,
          rank: int(s.rank, 99),
          played: int(s.gamesPlayed),
          win: int(s.wins),
          draw: int(s.ties),
          lose: int(s.losses),
          gf: int(s.pointsFor),
          ga: int(s.pointsAgainst)
        };
      })
    });
  }
  return out;
}

function mapMatches(res) {
  const out = [];
  for (const e of res?.events || []) {
    const comp = (e.competitions || [])[0];
    if (!comp) continue;
    const cs = comp.competitors || [];
    const home = cs.find((c) => c.homeAway === 'home') || cs[0];
    const away = cs.find((c) => c.homeAway === 'away') || cs[1];
    if (!home || !away) continue;
    const phase = phaseFromStatus((e.status || comp.status)?.type?.name);
    out.push({
      stage: stageFromSlug(e.season?.slug),
      round: null, // グループ節番号は ESPN に無いので update.mjs 側で日付順に採番
      group: null,
      utc: e.date,
      phase,
      home: { name: home.team?.displayName || '', tla: home.team?.abbreviation || null },
      away: { name: away.team?.displayName || '', tla: away.team?.abbreviation || null },
      goals: { home: scoreVal(home.score, phase), away: scoreVal(away.score, phase) }
    });
  }
  return out;
}

function statMap(stats) {
  const m = {};
  for (const s of stats || []) m[s.name] = s.value;
  return m;
}

function int(v, dflt = 0) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : dflt;
}

function scoreVal(score, phase) {
  if (phase === 'pre') return null;
  const n = parseInt(score, 10);
  return Number.isFinite(n) ? n : null;
}

function groupLetter(name) {
  const m = /group\s+([a-l])/i.exec(name || '');
  return m ? m[1].toUpperCase() : null;
}

function stageFromSlug(slug) {
  switch (slug) {
    case 'group-stage': return 'GROUP';
    case 'round-of-32': return 'R32';
    case 'round-of-16': return 'R16';
    case 'quarterfinals': return 'QF';
    case 'semifinals': return 'SF';
    case 'third-place':
    case '3rd-place': return '3RD';
    case 'final': return 'FINAL';
    default: return 'OTHER';
  }
}

function phaseFromStatus(s) {
  const n = (s || '').toUpperCase();
  if (n.includes('FINAL') || n.includes('FULL_TIME') || n === 'STATUS_FT') return 'done';
  if (n.includes('HALF') || n.includes('IN_PROGRESS') || n.includes('EXTRA') ||
      n.includes('SHOOTOUT') || n.includes('LIVE') || n.includes('SECOND') || n.includes('FIRST')) return 'live';
  return 'pre'; // STATUS_SCHEDULED, STATUS_PRE 等
}
