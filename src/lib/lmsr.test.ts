import { describe, it, expect } from 'vitest';
import {
  cost, prices, tradeCost, sharesForStake, qFromPrior, maxSubsidy, reseedForB,
} from './lmsr';

/**
 * The vectors in §3 of the brief. They are tested, not illustrative — every
 * number below is asserted verbatim. Where the brief prints a value to k
 * decimal places we assert to that many places; the invariants at the bottom
 * are asserted far tighter, because they are exact identities.
 */
describe('§3 test vectors', () => {
  it('C([0,0,0,0], b=50) = 69.314718', () => {
    expect(cost([0, 0, 0, 0], 50)).toBeCloseTo(69.314718, 6);
  });

  it('C([0,0,20,0], b=50) = 75.112951', () => {
    expect(cost([0, 0, 20, 0], 50)).toBeCloseTo(75.112951, 6);
  });

  it('tradeCost([0,0,0,0], 50, i=2, Δ=20) = 5.798232', () => {
    expect(tradeCost([0, 0, 0, 0], 50, 2, 20)).toBeCloseTo(5.798232, 6);
  });

  it('prices([0,0,20,0], 50) = [0.222627, 0.222627, 0.332120, 0.222627]', () => {
    const p = prices([0, 0, 20, 0], 50);
    expect(p[0]).toBeCloseTo(0.222627, 6);
    expect(p[1]).toBeCloseTo(0.222627, 6);
    expect(p[2]).toBeCloseTo(0.332120, 6);
    expect(p[3]).toBeCloseTo(0.222627, 6);
  });

  it('tradeCost([0,0,20,0], 50, i=2, Δ=30) = 12.070468', () => {
    expect(tradeCost([0, 0, 20, 0], 50, 2, 30)).toBeCloseTo(12.070468, 6);
  });

  it('prices([0,0,50,0], 50) = [0.174878, 0.174878, 0.475367, 0.174878]', () => {
    const p = prices([0, 0, 50, 0], 50);
    expect(p[0]).toBeCloseTo(0.174878, 6);
    expect(p[1]).toBeCloseTo(0.174878, 6);
    expect(p[2]).toBeCloseTo(0.475367, 6);
    expect(p[3]).toBeCloseTo(0.174878, 6);
  });

  it('sharesForStake([0,0,20,0], 50, i=2, a=25) = 54.145717', () => {
    expect(sharesForStake([0, 0, 20, 0], 50, 2, 25)).toBeCloseTo(54.145717, 6);
  });

  it('…and tradeCost(q, 50, 2, 54.145717) = 25.000000 — inverse consistency', () => {
    const q = [0, 0, 20, 0];
    const shares = sharesForStake(q, 50, 2, 25);
    expect(tradeCost(q, 50, 2, shares)).toBeCloseTo(25.0, 9);
  });

  it('sharesForStake([0,0,0,0], 300, i=0, a=25) = 89.501176', () => {
    expect(sharesForStake([0, 0, 0, 0], 300, 0, 25)).toBeCloseTo(89.501176, 6);
  });

  it('…and prices after = [0.3100, 0.2300, 0.2300, 0.2300]', () => {
    const q = [0, 0, 0, 0];
    const shares = sharesForStake(q, 300, 0, 25);
    const p = prices([q[0] + shares, q[1], q[2], q[3]], 300);
    expect(p[0]).toBeCloseTo(0.31, 4);
    expect(p[1]).toBeCloseTo(0.23, 4);
    expect(p[2]).toBeCloseTo(0.23, 4);
    expect(p[3]).toBeCloseTo(0.23, 4);
  });

  it('qFromPrior([0.55,0.20,0.15,0.10], 300) = [301.1724, -2.3079, -88.6125, -210.2520]', () => {
    const q = qFromPrior([0.55, 0.2, 0.15, 0.1], 300);
    expect(q[0]).toBeCloseTo(301.1724, 4);
    expect(q[1]).toBeCloseTo(-2.3079, 4);
    expect(q[2]).toBeCloseTo(-88.6125, 4);
    expect(q[3]).toBeCloseTo(-210.2520, 4);
  });

  it('…and prices of that = [0.55, 0.20, 0.15, 0.10] exactly', () => {
    const p = prices(qFromPrior([0.55, 0.2, 0.15, 0.1], 300), 300);
    expect(p[0]).toBeCloseTo(0.55, 12);
    expect(p[1]).toBeCloseTo(0.2, 12);
    expect(p[2]).toBeCloseTo(0.15, 12);
    expect(p[3]).toBeCloseTo(0.1, 12);
  });

  it('prices([0,0,1e6,0], 300) = [0, 0, 1, 0] — no NaN, no Infinity', () => {
    const p = prices([0, 0, 1e6, 0], 300);
    expect(p.every(Number.isFinite)).toBe(true);
    expect(p[0]).toBe(0);
    expect(p[1]).toBe(0);
    expect(p[2]).toBe(1);
    expect(p[3]).toBe(0);
  });
});

describe('invariants', () => {
  it('prices always sum to 1, for any q and b', () => {
    const cases: Array<[number[], number]> = [
      [[0, 0, 0, 0], 300],
      [[500, -200, 30, 0], 50],
      [[1e6, 0, 0, 0], 300],
      [[-1e6, 0, 0, 0], 300],
      [[0, 0], 250],
      [Array.from({ length: 40 }, (_, i) => i * 37 - 500), 400],
    ];
    for (const [q, b] of cases) {
      const s = prices(q, b).reduce((a, x) => a + x, 0);
      expect(s).toBeCloseTo(1, 12);
    }
  });

  it('round trip: buy for a stake, sell the shares back, get exactly the stake', () => {
    // No spread, no fee. This must hold to 1e-9 or the maker is quietly taxing.
    for (const [q, b, i, a] of [
      [[0, 0, 0, 0], 300, 0, 25],
      [[0, 0, 20, 0], 50, 2, 25],
      [[301.17, -2.31, -88.61, -210.25], 300, 3, 140],
      [[0, 0], 250, 1, 7.5],
    ] as Array<[number[], number, number, number]>) {
      const shares = sharesForStake(q, b, i, a);
      const after = q.slice();
      after[i] += shares;
      const proceeds = -tradeCost(after, b, i, -shares);
      expect(proceeds).toBeCloseTo(a, 9);
    }
  });

  it('maker loss converges to b·ln(n) and never exceeds it', () => {
    // Buy outcome 2 in small increments at b=50 until q_2 = 2000.
    const b = 50;
    const q = [0, 0, 0, 0];
    const step = 2;
    let revenue = 0;
    let worstLoss = -Infinity;
    while (q[2] < 2000 - 1e-12) {
      const d = Math.min(step, 2000 - q[2]);
      revenue += tradeCost(q, b, 2, d);
      q[2] += d;
      // If outcome 2 settles now, the maker pays q[2] and has taken `revenue`.
      worstLoss = Math.max(worstLoss, q[2] - revenue);
    }
    expect(q[2]).toBeCloseTo(2000, 9);
    expect(revenue).toBeCloseTo(2000 - 69.314718, 6);
    expect(worstLoss).toBeLessThanOrEqual(maxSubsidy(b, 4) + 1e-9);
    expect(worstLoss).toBeCloseTo(maxSubsidy(b, 4), 6);
  });

  it('a 4-way market with no prior opens at exactly ×4.00 on every outcome', () => {
    const p = prices(qFromPrior([0.25, 0.25, 0.25, 0.25], 300), 300);
    for (const x of p) expect(1 / x).toBeCloseTo(4.0, 12);
  });

  it('the §3 subsidy caps come out as tabulated', () => {
    expect(maxSubsidy(250, 2)).toBeCloseTo(173, 0);
    expect(maxSubsidy(300, 4)).toBeCloseTo(416, 0);
    expect(maxSubsidy(300, 8)).toBeCloseTo(624, 0);
    expect(maxSubsidy(400, 16)).toBeCloseTo(1109, 0);
  });

  it('changing b via reseedForB holds every price constant', () => {
    const q = [301.17, -2.31, -88.61, -210.25];
    const before = prices(q, 300);
    const after = prices(reseedForB(q, 300, 120), 120);
    for (let i = 0; i < 4; i++) expect(after[i]).toBeCloseTo(before[i], 9);
  });

  it('a stake of a moves the price by roughly a/b at mid-range', () => {
    // The calibration the §3 table is built on: 25 ƀ at b=300 ≈ 7 points.
    const q = [0, 0, 0, 0];
    const shares = sharesForStake(q, 300, 0, 25);
    const moved = prices([shares, 0, 0, 0], 300)[0] - 0.25;
    expect(moved).toBeGreaterThan(0.05);
    expect(moved).toBeLessThan(0.09);
  });
});
