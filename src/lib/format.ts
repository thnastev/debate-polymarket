/**
 * Display rules for money and odds (§9).
 *
 * The single most important rule in this file: TRADERS NEVER SEE
 * PROBABILITIES. "CG 38%" invites people to chase the favourite; "×2.63"
 * frames the actual question, which is what a bet returns. Probability
 * formatting exists here for the game-maker UI only, and is named so that
 * putting it on a trader screen looks wrong in review.
 */

export const BISER = 'ƀ';

/**
 * Headline odds for an outcome: × + 1/p.
 * Two decimals below ×10, one decimal above, ×99+ beyond 99.
 */
export function oddsText(p: number): string {
  const o = 1 / Math.max(p, 1e-9);
  if (!Number.isFinite(o) || o > 99) return '×99+';
  return '×' + o.toFixed(o < 10 ? 2 : 1);
}

export function oddsOf(p: number): number {
  return 1 / Math.max(p, 1e-9);
}

/** The concrete line under the headline: "10 ƀ returns 26". */
export function returnsLine(p: number, stake = 10): string {
  const back = stake * oddsOf(p);
  return `${stake} ${BISER} returns ${back > 9999 ? '9999+' : Math.round(back)}`;
}

/**
 * The trader's OWN odds on this trade: shares received / stake. Their stake
 * moves the price, so a headline of ×2.55 can be ×2.33 on 40 bisers. Hiding
 * that is the kind of thing that destroys trust in a market, so the bet
 * preview shows this and not the headline.
 */
export function effectiveOdds(shares: number, stake: number): number {
  return stake > 0 ? shares / stake : 0;
}

export function effectiveOddsText(shares: number, stake: number): string {
  const m = effectiveOdds(shares, stake);
  if (!(m > 0)) return '—';
  return '×' + m.toFixed(m < 10 ? 2 : 1);
}

export function money(x: number): string {
  return Number(x).toLocaleString(undefined, {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

export function shares(x: number): string {
  return Number(x).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

/** GAME MAKER UI ONLY. Never render this on a trader screen. */
export function adminPercent(p: number): string {
  return (p * 100).toFixed(1) + '%';
}

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
