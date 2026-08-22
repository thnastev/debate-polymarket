import { describe, it, expect } from 'vitest';
import {
  computeRound, replay, widenFactor, priorFromRatings, priorForTeams,
  rosterFromLedger, proposeMatches, isSwing, type LedgerEvent, type EloParams,
} from './elo';

const P: EloParams = { K: 32, W: 3, finalK: 72, seed: 1500 };

const inround = (rank: Record<string, number>): LedgerEvent => ({
  roundType: 'inround',
  teams: {
    OG: { ids: ['a1', 'a2'], speaks: [76, 74] },
    OO: { ids: ['b1', 'b2'], speaks: [75, 75] },
    CG: { ids: ['c1', 'c2'], speaks: [73, 73] },
    CO: { ids: ['d1', 'd2'], speaks: [72, 71] },
  },
  rank: rank as LedgerEvent['rank'],
});

describe('Elo replay (§7)', () => {
  it('a valid inround produces a delta for all eight debaters', () => {
    const r = computeRound(inround({ OG: 1, OO: 2, CG: 3, CO: 4 }), {}, P);
    expect(r.valid).toBe(true);
    expect(Object.keys(r.perDebater!)).toHaveLength(8);
  });

  it('the winning bench gains and the fourth loses', () => {
    const r = computeRound(inround({ OG: 1, OO: 2, CG: 3, CO: 4 }), {}, P);
    const og = r.perDebater!.a1.delta + r.perDebater!.a2.delta;
    const co = r.perDebater!.d1.delta + r.perDebater!.d2.delta;
    expect(og).toBeGreaterThan(0);
    expect(co).toBeLessThan(0);
  });

  it('within a team the higher-scoring speaker gains W × the speak gap', () => {
    const r = computeRound(inround({ OG: 1, OO: 2, CG: 3, CO: 4 }), {}, P);
    // OG speaks are 76 and 74: a gap of 2, so the split is ±6 around the team delta.
    expect(r.perDebater!.a1.delta - r.perDebater!.a2.delta).toBeCloseTo(2 * P.W * 2, 9);
  });

  it('rejects a round with duplicate ranks', () => {
    expect(computeRound(inround({ OG: 1, OO: 1, CG: 3, CO: 4 }), {}, P).valid).toBe(false);
  });

  it('rejects a debater appearing on two benches', () => {
    const ev = inround({ OG: 1, OO: 2, CG: 3, CO: 4 });
    ev.teams.OO.ids = ['a1', 'b2'];
    expect(computeRound(ev, {}, P).valid).toBe(false);
  });

  it('an ironman team gets averaged speaks and a single delta', () => {
    const ev = inround({ OG: 1, OO: 2, CG: 3, CO: 4 });
    ev.teams.CG = { ids: ['c1', 'c1'], speaks: [80, 70] };
    const r = computeRound(ev, {}, P);
    expect(r.valid).toBe(true);
    expect(Object.keys(r.perDebater!)).toHaveLength(7);
  });

  it('in a final only the winner gains', () => {
    const ev = inround({ OG: 1, OO: 2, CG: 3, CO: 4 });
    ev.roundType = 'final';
    const r = computeRound(ev, {}, P);
    expect(r.perDebater!.a1.delta).toBeGreaterThan(0);
    for (const id of ['b1', 'c1', 'd1']) expect(r.perDebater![id].delta).toBe(0);
  });

  it('in an elim only comparisons across the advancing boundary count', () => {
    const ev = inround({ OG: 1, OO: 2, CG: 3, CO: 4 });
    ev.roundType = 'elim';
    const r = computeRound(ev, {}, P);
    // 1st and 2nd both advance, so neither is compared with the other: with
    // equal ratings all round, their team deltas match exactly.
    const og = r.perDebater!.a1.delta + r.perDebater!.a2.delta;
    const oo = r.perDebater!.b1.delta + r.perDebater!.b2.delta;
    expect(og).toBeCloseTo(oo, 9);
  });

  it('replay counts rounds per debater and never reads seedElo as a rating', () => {
    const evs = [inround({ OG: 1, OO: 2, CG: 3, CO: 4 }), inround({ OG: 4, OO: 3, CG: 2, CO: 1 })];
    const { ratings, rounds } = replay(evs, P, { a1: 1800 });
    expect(rounds.a1).toBe(2);
    // Started at the seed override and moved from it — not left sitting at 1800.
    expect(ratings.a1).not.toBe(1800);
  });
});

describe('priors (§7)', () => {
  it('widenFactor matches the documented shape', () => {
    expect(widenFactor(0)).toBeCloseTo(2, 9);
    expect(widenFactor(2)).toBeCloseTo(1.8, 9);
    expect(widenFactor(30)).toBeCloseTo(1.2105, 3);
  });

  it('a prior sums to 1 and favours the stronger team', () => {
    const p = priorFromRatings([1900, 1700, 1600, 1500], undefined, 20000);
    expect(p.reduce((a, x) => a + x, 0)).toBeCloseTo(1, 9);
    expect(p[0]).toBeGreaterThan(p[1]);
    expect(p[1]).toBeGreaterThan(p[3]);
  });

  it('widening pulls a confident underdog price up, which is the entire point', () => {
    const ratings = [1900, 1700, 1600, 1500];
    const tight = priorFromRatings(ratings, undefined, 60000);
    const wide = priorFromRatings(ratings, ratings.map(() => widenFactor(2)), 60000);
    // The 1500 team is priced meaningfully higher once the noise reflects how
    // little evidence sits behind those ratings.
    expect(wide[3]).toBeGreaterThan(tight[3] * 1.2);
    expect(wide[0]).toBeLessThan(tight[0]);
  });

  it('returns null rather than guessing when any team is unrated', () => {
    const rated = { elo: 1700, elo_rounds: 10, is_swing: false };
    expect(priorForTeams([rated, rated, rated, rated], true, 2000)).not.toBeNull();
    expect(priorForTeams([rated, { elo: null, elo_rounds: 0, is_swing: false }], true, 2000)).toBeNull();
    expect(priorForTeams([rated, null], true, 2000)).toBeNull();
  });

  it('a swing team poisons nothing — the market opens uniform instead', () => {
    const rated = { elo: 1700, elo_rounds: 10, is_swing: false };
    const swing = { elo: 1650, elo_rounds: 4, is_swing: true };
    expect(priorForTeams([rated, rated, rated, swing], true, 2000)).toBeNull();
  });
});

describe('ledger import', () => {
  const ledger = {
    K: 32, W: 3, finalK: 72, seed: 1500,
    people: [
      { id: 'a1', name: 'Ivan Georgiev', seedElo: 1750 },
      { id: 'a2', name: 'Mila Petrova', seedElo: 1700 },
      { id: 'b1', name: 'Boris Marinov' },
      { id: 'b2', name: 'Elena Todorova' },
      { id: 'c1', name: 'Swing Speaker 1' },
      { id: 'c2', name: 'Nikola Denchev' },
      { id: 'd1', name: 'Rada Nikolova' },
      { id: 'd2', name: 'Sava Popov' },
    ],
    events: [inround({ OG: 1, OO: 2, CG: 3, CO: 4 })],
  };

  it('excludes swings and reports how many', () => {
    const { roster, swingsExcluded } = rosterFromLedger(ledger);
    expect(swingsExcluded).toBe(1);
    expect(roster.find((r) => isSwing(r.name))).toBeUndefined();
    expect(roster).toHaveLength(7);
  });

  it('replays rather than trusting seedElo', () => {
    const { roster } = rosterFromLedger(ledger);
    const ivan = roster.find((r) => r.name === 'Ivan Georgiev')!;
    expect(ivan.rounds).toBe(1);
    expect(ivan.elo).not.toBe(1750);
  });

  it('proposes name matches but leaves confirmation to a human', () => {
    const { roster } = rosterFromLedger(ledger);
    const props = proposeMatches(['Ivan Georgiev', 'Ivan G.', 'Someone Unrelated'], roster);
    expect(props[0].match?.name).toBe('Ivan Georgiev');
    expect(props[1].match?.name).toBe('Ivan Georgiev');
    expect(props[2].match).toBeNull();
  });
});
