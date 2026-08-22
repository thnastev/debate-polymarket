/**
 * LMSR — Hanson's Logarithmic Market Scoring Rule.
 *
 * This module is the reference implementation of every price the system quotes.
 * It is pure: no I/O, no state, no clock. The identical arithmetic lives in
 * `supabase/migrations/0002_trade.sql` and the two must agree to 1e-6; the
 * parity is asserted by `supabase/tests/02_lmsr_vectors.sql`.
 *
 * The client uses this to *display* prices and previews. It never sends a
 * computed cost, share count or balance to the server — the server recomputes
 * everything inside `place_bet`.
 *
 * Numerical stability: `exp(q_i / b)` overflows once `q_i / b` grows past ~709,
 * which a lopsided market reaches easily. Every function here subtracts
 * `max(q)/b` first, so the largest exponent is always exactly 0.
 */

/** Shifted exponentials: `exp(q_j/b - m)` where `m = max(q)/b`. */
function shiftedExp(q: readonly number[], b: number): { e: number[]; m: number } {
  const m = Math.max(...q) / b;
  return { e: q.map((x) => Math.exp(x / b - m)), m };
}

/** C(q) = b · ln( Σ_j exp(q_j / b) ) — the maker's running collected value. */
export function cost(q: readonly number[], b: number): number {
  const { e, m } = shiftedExp(q, b);
  let s = 0;
  for (const x of e) s += x;
  return b * (m + Math.log(s));
}

/** p_i = softmax(q/b)_i. Sums to exactly 1 by construction. */
export function prices(q: readonly number[], b: number): number[] {
  const { e } = shiftedExp(q, b);
  let s = 0;
  for (const x of e) s += x;
  return e.map((x) => x / s);
}

/** Cost of moving outcome `i` by `delta` shares. Negative delta = a sale, so a negative cost = proceeds. */
export function tradeCost(q: readonly number[], b: number, i: number, delta: number): number {
  const q2 = q.slice();
  q2[i] += delta;
  return cost(q2, b) - cost(q, b);
}

/**
 * Shares bought for a stake of `a` bisers on outcome `i`. Closed form:
 *   Δ = b · ln( (S · exp(a/b) − A) / E )
 *
 * Written here as the equivalent
 *   Δ = b · ln( S · exp(a/b) − A ) − q_i + b·m
 * because ln(E) is known exactly — it is `q_i/b − m` — while E itself
 * underflows to 0 whenever the target outcome is astronomically unlikely, and
 * the division form then returns Infinity (JS) or raises (Postgres). Backing a
 * ~0% outcome is precisely when a trader most wants a number, so subtracting
 * the logarithm instead of dividing by the exponential is the form that works.
 * `S·exp(a/b) − A` stays O(n) and positive for every a > 0.
 */
export function sharesForStake(q: readonly number[], b: number, i: number, a: number): number {
  if (!(a > 0)) return 0;
  // e^{a/b} is the one exponent the max-shift does not bound. A stake of more
  // than 500·b is not a trade any play-money balance can make.
  if (a / b > 500) throw new RangeError('stake_too_large_for_b');
  const { e, m } = shiftedExp(q, b);
  let S = 0;
  for (const x of e) S += x;
  const A = S - e[i];
  const v = S * Math.exp(a / b) - A;
  if (!(v > 0) || !Number.isFinite(v)) return 0;
  return b * Math.log(v) - q[i] + b * m;
}

/**
 * Seed q from a prior probability vector: q_i = b·ln(p_i) − mean_j(b·ln(p_j)).
 * The mean subtraction is cosmetic (softmax is shift-invariant) but keeps the
 * stored numbers small enough to read in the admin UI.
 */
export function qFromPrior(p: readonly number[], b: number): number[] {
  const raw = p.map((x) => b * Math.log(Math.max(x, 1e-6)));
  const mean = raw.reduce((acc, x) => acc + x, 0) / raw.length;
  return raw.map((x) => x - mean);
}

/** A uniform prior over n outcomes — what every market opens at when Elo is off. */
export function flatPrior(n: number): number[] {
  return Array(n).fill(1 / n);
}

/** The maker's worst-case loss on a market: b · ln(n). This is what the system prints. */
export function maxSubsidy(b: number, n: number): number {
  return b * Math.log(n);
}

/**
 * Re-derive q for a new b while holding every price constant. Changing `b`
 * alone silently moves every price, which is never what the operator means.
 */
export function reseedForB(q: readonly number[], bOld: number, bNew: number): number[] {
  return qFromPrior(prices(q, bOld), bNew);
}
