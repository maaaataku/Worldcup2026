/* API-Football (api-sports.io) v3 アダプタ
   WC2026 = league=1 / season=2026。日本 team=12。
   出力は共通中間形 { standings, matches }（update.mjs が DATA キーへマップ）。 */
import { fetchJson } from '../lib.mjs';

const BASE = process.env.FOOTBALL_API_BASE || 'https://v3.football.api-sports.io';
const LEAGUE = process.env.FOOTBALL_LEAGUE_ID || '1';
const SEASON = process.env.FOOTBALL_SEASON || '2026';

export const name = 'api-football';
export const requiresKey = true;

export async function fetchAll({ key }) {
  const headers = { 'x-apisports-key': key };
  const [standRes, fixRes] = await Promise.all([
    fetchJson(`${BASE}/standings?league=${LEAGUE}&season=${SEASON}`, { headers }),
    fetchJson(`${BASE}/fixtures?league=${LEAGUE}&season=${SEASON}`, { headers })
  ]);
  return { standings: mapStandings(standRes), matches: mapFixtures(fixRes) };
}

/* response[0].league.standings = グループごとの配列 */
function mapStandings(res) {
  const groups = res?.response?.[0]?.league?.standings || [];
  const out = [];
  for (const g of groups) {
    if (!Array.isArray(g) || !g.length) continue;
    const letter = groupLetter(g[0]?.group);
    if (!letter) continue;
    out.push({
      group: letter,
      rows: g.map((t) => ({
        name: t.team?.name || '',
        tla: null,
        rank: t.rank,
        played: t.all?.played ?? 0,
        win: t.all?.win ?? 0,
        draw: t.all?.draw ?? 0,
        lose: t.all?.lose ?? 0,
        gf: t.all?.goals?.for ?? 0,
        ga: t.all?.goals?.against ?? 0
      }))
    });
  }
  return out;
}

function mapFixtures(res) {
  const arr = res?.response || [];
  return arr.map((f) => {
    const round = f.league?.round || '';
    return {
      stage: stageFromRound(round),
      round: groupRoundNumber(round),
      group: null, // API-Football の fixtures は group letter を持たないので standings 側で解決
      utc: f.fixture?.date,
      phase: phaseFromShort(f.fixture?.status?.short),
      home: { name: f.teams?.home?.name || '', tla: null },
      away: { name: f.teams?.away?.name || '', tla: null },
      goals: { home: f.goals?.home, away: f.goals?.away }
    };
  });
}

function groupLetter(group) {
  // "Group F" → "F"
  const m = /group\s+([a-l])/i.exec(group || '');
  return m ? m[1].toUpperCase() : null;
}

function groupRoundNumber(round) {
  // "Group Stage - 1" → 1
  const m = /group stage\s*-\s*(\d+)/i.exec(round || '');
  return m ? +m[1] : null;
}

function stageFromRound(round) {
  const r = (round || '').toLowerCase();
  if (r.includes('group')) return 'GROUP';
  if (r.includes('round of 32') || r.includes('1/16')) return 'R32';
  if (r.includes('round of 16') || r.includes('1/8')) return 'R16';
  if (r.includes('quarter')) return 'QF';
  if (r.includes('semi')) return 'SF';
  if (r.includes('3rd') || r.includes('third')) return '3RD';
  if (r.includes('final')) return 'FINAL';
  return 'OTHER';
}

function phaseFromShort(s) {
  if (['FT', 'AET', 'PEN'].includes(s)) return 'done';
  if (['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INT'].includes(s)) return 'live';
  return 'pre'; // NS, TBD, PST, CANC など
}
