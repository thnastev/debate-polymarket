/**
 * In-memory stand-in for src/lib/api.ts, used ONLY by the preview harness.
 *
 * The preview aliases the real api module to this one so the whole trading
 * path — BetPanel → tradeQueue → placeBet — runs unchanged against a market
 * that lives in a browser tab instead of Postgres. The arithmetic is the real
 * src/lib/lmsr.ts, so the prices you see move exactly as they would in Supabase.
 *
 * The real app does none of this in the browser: the server computes every
 * cost, share count and balance. This file exists so the UI can be shown
 * without standing up a database.
 */
import { prices, sharesForStake, tradeCost, qFromPrior } from '../src/lib/lmsr';
import type { TradeResult } from '../src/lib/types';

export interface DemoMarket {
  id: string; b: number; q: number[];
  labels: string[]; prior: number[];
}

export const store = {
  balance: 1000,
  markets: {} as Record<string, DemoMarket>,
  shares: {} as Record<string, number[]>,   // marketId -> per-outcome shares
  history: {} as Record<string, number[][]>,
  trades: [] as Array<{ market: string; outcome: string; stake: number; odds: number; at: number }>,
  seen: new Set<string>(),                  // idempotency keys already applied
};

export function seedMarket(m: DemoMarket) {
  store.markets[m.id] = { ...m, q: qFromPrior(m.prior, m.b) };
  store.shares[m.id] = m.labels.map(() => 0);
  store.history[m.id] = [prices(qFromPrior(m.prior, m.b), m.b)];
}

let onChange: () => void = () => {};
export const subscribe = (fn: () => void) => { onChange = fn; };

export async function placeBet(args: {
  marketId: string; outcomeIdx: number;
  stake?: number; shares?: number; idempotencyKey: string;
}): Promise<TradeResult> {
  const m = store.markets[args.marketId];
  if (!m) throw new Error('market_not_found');

  // The same dedupe the server does, so a double-tap here behaves as it would
  // in production: one bet, and the losers replay the original result.
  //
  // The key is claimed BEFORE the simulated round trip, not after. Checking it
  // after the await is the exact race place_bet had against Postgres — three
  // taps all look, all find nothing, and all three trade. Postgres closes it
  // by re-reading inside the market row lock; here, claiming the key
  // synchronously does the same job.
  if (store.seen.has(args.idempotencyKey)) {
    return {
      replayed: true, shares: 0, prices: prices(m.q, m.b), balance_after: store.balance,
    };
  }
  store.seen.add(args.idempotencyKey);

  await new Promise((r) => setTimeout(r, 220));   // a plausible round trip

  const i = args.outcomeIdx;
  let got = 0;

  if (args.stake != null) {
    if (args.stake > store.balance) throw new Error('insufficient_balance');
    got = sharesForStake(m.q, m.b, i, args.stake);
    m.q[i] += got;
    store.balance -= args.stake;
    store.shares[args.marketId][i] += got;
    store.trades.unshift({
      market: args.marketId, outcome: m.labels[i], stake: args.stake,
      odds: got / args.stake, at: Date.now(),
    });
  } else if (args.shares != null) {
    const held = store.shares[args.marketId][i];
    if (args.shares > held + 1e-9) throw new Error('insufficient_shares');
    const proceeds = -tradeCost(m.q, m.b, i, -args.shares);
    m.q[i] -= args.shares;
    store.balance += proceeds;
    store.shares[args.marketId][i] -= args.shares;
    store.trades.unshift({
      market: args.marketId, outcome: m.labels[i], stake: -proceeds,
      odds: 0, at: Date.now(),
    });
  }

  const p = prices(m.q, m.b);
  store.history[args.marketId].push(p);
  onChange();
  return { ok: true, shares: got, prices: p, balance_after: store.balance };
}

// The preview never calls these, but the module has to satisfy the import shape.
export const fetchMarkets = async () => [];
export const fetchMarket = async () => { throw new Error('preview'); };
export const fetchOutcomes = async () => [];
export const fetchMyPositions = async () => [];
export const fetchMyBets = async () => [];
export const fetchLeaderboard = async () => [];
export const fetchTrades = async () => [];
export const fetchPriceHistory = async () => [];
export const fetchActiveTournament = async () => null;
export const fetchProfile = async () => null;
