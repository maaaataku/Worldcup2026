/* football-data.org v4 アダプタ
   competition=WC（FIFA World Cup）。
   出力は共通中間形 { standings, matches }（update.mjs が DATA キーへマップ）。
   ※ 無料枠は WC2026 のカバレッジ／レートに不確実性あり（README 参照）。 */
import { fetchJson } from '../lib.mjs';

const BASE = process.env.FOOTBALL_API_BASE || 'https://api.football-data.org/v4';
const COMP = process.env.FOOTBALL_COMPETITION || 'WC';

export const name = 'football-data';
export const requiresKey = true;

export async function fetchAll({ key }) {
  const headers = { 'X-Auth-Token': key };
  const [standRes, matchRes] = await Promise.all([
    fetchJson(`${BASE}/competitions/${COMP}/standings`, { headers }),
    fetchJson(`${BASE}/competitions/${COMP}/matches`, { headers })
  ]);
  return { standings: mapStandings(standRes), matches: mapMatches(matchRes) };
}

/* standings = [{ type:"TOTAL", group:"GROUP_F", table:[...] }, ...] */
function mapStandings(res) {
  const arr = (res?.standings || []).filter((s) => !s.type || s.type === 'TOTAL');
  const out = [];
  for (const s of arr) {
    const letter = groupLetter(s.group);
    if (!letter) continue;
    out.push({
      group: letter,
      rows: (s.table || []).map((t) => ({
        name: t.team?.name || '',
        tla: t.team?.tla || null,
        rank: t.position,
        played: t.playedGames ?? 0,
        win: t.won ?? 0,
        draw: t.draw ?? 0,
        lose: t.lost ?? 0,
        gf: t.goalsFor ?? 0,
        ga: t.goalsAgainst ?? 0
      }))
    });
  }
  return out;
}

function mapMatches(res) {
  const arr = res?.matches || [];
  return arr.map((m) => ({
    stage: stageFromEnum(m.stage),
    round: m.matchday || null,
    group: groupLetter(m.group),
    utc: m.utcDate,
    phase: phaseFromStatus(m.status),
    home: { name: m.homeTeam?.name || '', tla: m.homeTeam?.tla || null },
    away: { name: m.awayTeam?.name || '', tla: m.awayTeam?.tla || null },
    goals: { home: m.score?.fullTime?.home, away: m.score?.fullTime?.away }
  }));
}

function groupLetter(group) {
  // "GROUP_F" → "F"
  const m = /group[_\s]*([a-l])/i.exec(group || '');
  return m ? m[1].toUpperCase() : null;
}

function stageFromEnum(stage) {
  switch (stage) {
    case 'GROUP_STAGE': return 'GROUP';
    case 'LAST_32': return 'R32';
    case 'LAST_16': return 'R16';
    case 'QUARTER_FINALS': return 'QF';
    case 'SEMI_FINALS': return 'SF';
    case 'THIRD_PLACE': return '3RD';
    case 'FINAL': return 'FINAL';
    default: return 'OTHER';
  }
}

function phaseFromStatus(s) {
  if (s === 'FINISHED') return 'done';
  if (s === 'IN_PLAY' || s === 'PAUSED') return 'live';
  return 'pre'; // SCHEDULED, TIMED, POSTPONED, CANCELLED など
}
