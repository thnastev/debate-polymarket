/**
 * BP Elo Ledger integration (§7). Optional, default OFF.
 *
 * Ratings are NOT read from `seedElo`. They are recomputed by replaying every
 * event in order — `computeRound` and `replay` are ported verbatim from the
 * two prototypes, where they are already correct.
 */

export interface LedgerPerson { id: string; name: string; seedElo?: number | null }
export interface LedgerEvent {
  id?: string;
  roundType: 'inround' | 'elim' | 'final';
  teams: Record<Pos, { ids: string[]; speaks: number[] }>;
  rank: Record<Pos, number>;
}
export interface Ledger {
  K?: number; W?: number; finalK?: number; seed?: number;
  people: LedgerPerson[];
  events: LedgerEvent[];
}
export interface EloParams { K: number; W: number; finalK: number; seed: number }

export type Pos = 'OG' | 'OO' | 'CG' | 'CO';
export const POS: Pos[] = ['OG', 'OO', 'CG', 'CO'];

const expected = (ra: number, rb: number) => 1 / (1 + Math.pow(10, (rb - ra) / 400));
const marginMult = (d: number) => 1 + Math.log(1 + d) / Math.log(7);

export function computeRound(
  ev: LedgerEvent, ratingsById: Record<string, number>, params: EloParams,
): { valid: boolean; perDebater?: Record<string, { delta: number }> } {
  const { K, W, finalK, seed } = params;
  const isOut = ev.roundType !== 'inround';
  const teams: Record<string, {
    ids: string[]; speaks: number[]; ironman: boolean; combined: number; teamRating: number;
  }> = {};
  let valid = true;

  for (const p of POS) {
    const ids = ev.teams[p].ids.slice();
    const raw = ev.teams[p].speaks.map(Number);
    if (ids.some((i) => !i)) valid = false;
    const iron = Boolean(ids[0]) && ids[0] === ids[1];
    let sp = raw;
    // Ironman teams (same id twice) get averaged speaks and a single delta.
    if (iron) { const a = (raw[0] + raw[1]) / 2; sp = [a, a]; }
    const rt = ids.map((i) => (ratingsById[i] != null ? ratingsById[i] : seed));
    teams[p] = {
      ids, speaks: sp, ironman: iron,
      combined: sp[0] + sp[1], teamRating: (rt[0] + rt[1]) / 2,
    };
  }

  const seen: Record<string, string> = {};
  for (const p of POS) for (const id of ev.teams[p].ids) {
    if (!id) continue;
    if (seen[id] && seen[id] !== p) valid = false;
    seen[id] = p;
  }
  if (new Set(POS.map((p) => ev.rank[p])).size !== 4) valid = false;
  if (!valid) return { valid: false };

  const ordered = [...POS].sort((a, b) => ev.rank[a] - ev.rank[b]);
  const adv = [ordered[0], ordered[1]];
  const winner = ordered[0];
  const td: Record<string, number> = {};
  POS.forEach((p) => { td[p] = 0; });

  if (ev.roundType === 'final') {
    // Only the winner gains, against all three losers, scaled by finalK/3.
    for (const lo of ordered.slice(1)) {
      td[winner] += finalK * (1 - expected(teams[winner].teamRating, teams[lo].teamRating));
    }
    td[winner] /= 3;
  } else {
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
      const hi = ordered[i], lo = ordered[j];
      // For elims, only compare across the advancing/eliminated boundary.
      if (ev.roundType === 'elim' && (adv.includes(hi) === adv.includes(lo))) continue;
      const d = isOut ? 0 : Math.abs(teams[hi].combined - teams[lo].combined);
      const M = isOut ? 1 : marginMult(d);
      const Ehi = expected(teams[hi].teamRating, teams[lo].teamRating);
      td[hi] += K * M * (1 - Ehi);
      td[lo] += K * M * (0 - (1 - Ehi));
    }
    POS.forEach((p) => { td[p] /= 2; });
  }

  const per: Record<string, { delta: number }> = {};
  for (const p of POS) {
    const t = teams[p];
    const [s0, s1] = t.speaks;
    if (t.ironman) { per[t.ids[0]] = { delta: td[p] }; continue; }
    let d0: number, d1: number;
    if (isOut) { d0 = td[p]; d1 = td[p]; }
    else {
      // Within a team, the higher-scoring speaker gains W × (speak gap).
      const g = Math.abs(s0 - s1), hi = s0 >= s1 ? 0 : 1, bo = W * g;
      d0 = td[p] + (hi === 0 ? bo : -bo);
      d1 = td[p] + (hi === 1 ? bo : -bo);
    }
    per[t.ids[0]] = { delta: d0 };
    per[t.ids[1]] = { delta: d1 };
  }
  return { valid: true, perDebater: per };
}

export function replay(
  events: LedgerEvent[], params: EloParams, seedById?: Record<string, number>,
): { ratings: Record<string, number>; rounds: Record<string, number> } {
  const ratings: Record<string, number> = {};
  const rounds: Record<string, number> = {};
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const startOf = (id: string) =>
    (seedById && seedById[id] != null ? seedById[id] : params.seed);

  events.forEach((ev) => {
    const base = { ...ratings };
    POS.forEach((p) => ev.teams[p].ids.forEach((id) => {
      if (id && base[id] == null) base[id] = startOf(id);
    }));
    const res = computeRound(ev, base, params);
    if (!res.valid || !res.perDebater) return;
    Object.entries(res.perDebater).forEach(([id, pd]) => {
      const before = ratings[id] != null ? ratings[id] : startOf(id);
      ratings[id] = r1(before + pd.delta);
      rounds[id] = (rounds[id] ?? 0) + 1;
    });
  });
  return { ratings, rounds };
}

/**
 * Widens the Monte-Carlo noise for teams whose debaters have few recorded
 * rounds. NOT OPTIONAL when Elo is on (§7): the ledger's median rounds per
 * debater is low, so ratings are still dominated by their seeds. Without this,
 * the Monte Carlo emits confident numbers like 8% that are not backed by
 * 8%-worth of evidence; with it the same team prices near 15%.
 */
export const widenFactor = (n: number) => 1 + 8 / ((n || 0) + 8);

/**
 * P(each team takes the 1st), by Monte Carlo over logistic performances.
 *   performance_i = rating_i + logisticNoise() × (400/ln 10) × scale_i
 */
export function priorFromRatings(
  ratings: number[], scale?: number[], trials = 15000,
): number[] {
  const base = 400 / Math.log(10);
  const c = ratings.map(() => 0);
  for (let t = 0; t < trials; t++) {
    let bi = 0, bx = -Infinity;
    for (let i = 0; i < ratings.length; i++) {
      const u = Math.random();
      const x = ratings[i] + Math.log(u / (1 - u)) * base * (scale ? scale[i] : 1);
      if (x > bx) { bx = x; bi = i; }
    }
    c[bi] += 1;
  }
  // Floor at 0.5% so a team that never wins a trial still has a price, then
  // renormalise so the vector is a probability distribution.
  const raw = c.map((x) => Math.max(x / trials, 0.005));
  const s = raw.reduce((a, v) => a + v, 0);
  return raw.map((x) => x / s);
}

export interface RatedTeam {
  elo: number | null; elo_rounds: number; is_swing: boolean;
}

/**
 * A prior for a market whose outcomes are teams — or null, which means "open
 * at uniform odds". Null is returned whenever ANY outcome is unrated, is a
 * swing, or is not a team at all. Never silently guess: an unmatched team gets
 * no prior rather than a made-up one (§7).
 */
export function priorForTeams(
  teams: Array<RatedTeam | null | undefined>, widen: boolean, trials = 15000,
): number[] | null {
  if (teams.length < 2) return null;
  if (teams.some((t) => !t || t.is_swing || t.elo == null)) return null;
  const rated = teams as RatedTeam[];
  const scale = widen ? rated.map((t) => widenFactor(t.elo_rounds)) : undefined;
  return priorFromRatings(rated.map((t) => t.elo as number), scale, trials);
}

/** Is this name a swing? Swings are not people and must never inform a prior. */
export const isSwing = (name: string) => /swing/i.test(name);

export interface RosterEntry { name: string; elo: number; rounds: number }

/** Replay a ledger export into a roster, excluding swings. */
export function rosterFromLedger(d: Ledger): {
  roster: RosterEntry[]; swingsExcluded: number; events: number; medianRounds: number;
} {
  const params: EloParams = {
    K: d.K ?? 32, W: d.W ?? 3, finalK: d.finalK ?? 72, seed: d.seed ?? 1500,
  };
  const seedById = Object.fromEntries(
    d.people.filter((p) => p.seedElo != null).map((p) => [p.id, p.seedElo as number]));
  const { ratings, rounds } = replay(d.events, params, seedById);

  let swingsExcluded = 0;
  const roster: RosterEntry[] = [];
  for (const p of d.people) {
    if (isSwing(p.name)) { swingsExcluded += 1; continue; }
    roster.push({
      name: p.name,
      elo: Math.round(ratings[p.id] ?? p.seedElo ?? params.seed),
      rounds: rounds[p.id] ?? 0,
    });
  }
  roster.sort((a, b) => a.name.localeCompare(b.name));
  const ns = roster.map((r) => r.rounds).sort((a, b) => a - b);
  return {
    roster, swingsExcluded, events: d.events.length,
    medianRounds: ns.length ? ns[Math.floor(ns.length / 2)] : 0,
  };
}

/**
 * Fuzzy name matching for the confirmation screen. Tabbycat gives strings, the
 * ledger gives strings, and they will disagree — "Ivan Georgiev" / "Иван
 * Георгиев" / "Ivan G.". This PROPOSES matches; a human confirms them. It
 * never applies one on its own.
 */
export function proposeMatches(
  tabNames: string[], roster: RosterEntry[],
): Array<{ tabName: string; match: RosterEntry | null; score: number }> {
  return tabNames.map((tabName) => {
    let best: RosterEntry | null = null, bestScore = 0;
    for (const r of roster) {
      const s = similarity(normalise(tabName), normalise(r.name));
      if (s > bestScore) { bestScore = s; best = r; }
    }
    return { tabName, match: bestScore >= 0.55 ? best : null, score: bestScore };
  });
}

function normalise(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zЀ-ӿ\s]/g, '').trim().replace(/\s+/g, ' ');
}

/** Token-overlap with an initial-aware bonus, so "Ivan G." still finds "Ivan Georgiev". */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const ta = a.split(' ').filter(Boolean);
  const tb = b.split(' ').filter(Boolean);
  if (!ta.length || !tb.length) return 0;
  let hits = 0;
  for (const x of ta) {
    for (const y of tb) {
      if (x === y) { hits += 1; break; }
      if (x.length === 1 && y.startsWith(x)) { hits += 0.6; break; }
      if (y.length === 1 && x.startsWith(y)) { hits += 0.6; break; }
      if (x.length > 3 && y.startsWith(x.slice(0, 4))) { hits += 0.8; break; }
    }
  }
  return hits / Math.max(ta.length, tb.length);
}
