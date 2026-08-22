import { supabase } from './supabase';
import type {
  Market, Outcome, Profile, Tournament, LeaderboardRow, PublicTrade,
  Bet, Position, TradeResult, MarketScope, MarketStatus,
} from './types';

/**
 * Every call here sends intent and receives a result. The client never sends a
 * computed cost, share count or balance — the server does all the arithmetic
 * inside place_bet (§1.5).
 */

const num = (x: unknown) => (x === null || x === undefined ? 0 : Number(x));

/** Postgres numerics arrive as strings over PostgREST; coerce them once, here. */
function normaliseMarket(m: Record<string, unknown>): Market {
  const outcomes = ((m.market_outcomes as Outcome[]) ?? [])
    .map((o) => ({ ...o, q: num(o.q) }))
    .sort((a, b) => a.idx - b.idx);
  return {
    ...(m as unknown as Market),
    b: num(m.b),
    prior: (m.prior as string[] | null)?.map(Number) ?? null,
    close_prices: (m.close_prices as string[] | null)?.map(Number) ?? null,
    market_outcomes: outcomes,
  };
}

const MARKET_COLS =
  'id, tournament_id, scope, title, resolution_rule, resolver_name, layout, b, status,' +
  ' opens_at, closes_at, winner_index, close_prices, seeded_from_elo, prior,' +
  ' round_id, debate_id, template_key, created_at,' +
  ' market_outcomes ( id, market_id, idx, label, sublabel, color, q, tab_team_id )';

export async function fetchMarkets(tournamentId?: string): Promise<Market[]> {
  let qy = supabase.from('markets').select(MARKET_COLS).order('created_at', { ascending: true });
  if (tournamentId) qy = qy.eq('tournament_id', tournamentId);
  const { data, error } = await qy;
  if (error) throw error;
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map(normaliseMarket);
}

export async function fetchMarket(id: string): Promise<Market> {
  const { data, error } = await supabase.from('markets').select(MARKET_COLS).eq('id', id).single();
  if (error) throw error;
  return normaliseMarket(data as unknown as Record<string, unknown>);
}

export async function fetchOutcomes(marketId: string): Promise<Outcome[]> {
  const { data, error } = await supabase
    .from('market_outcomes').select('*').eq('market_id', marketId).order('idx');
  if (error) throw error;
  return (data ?? []).map((o) => ({ ...o, q: num(o.q) }));
}

export async function fetchActiveTournament(): Promise<Tournament | null> {
  const { data, error } = await supabase
    .from('tournaments').select('*').eq('is_active', true).limit(1).maybeSingle();
  if (error) throw error;
  return data ? { ...data, starting_balance: num(data.starting_balance) } : null;
}

export async function fetchTournaments(): Promise<Tournament[]> {
  const { data, error } = await supabase.from('tournaments').select('*').order('created_at');
  if (error) throw error;
  return (data ?? []).map((t) => ({ ...t, starting_balance: num(t.starting_balance) }));
}

export async function fetchProfile(id: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? { ...data, balance: num(data.balance) } : null;
}

export async function fetchMyPositions(): Promise<Position[]> {
  const { data, error } = await supabase.from('positions').select('*').gt('shares', 0);
  if (error) throw error;
  return (data ?? []).map((p) => ({ ...p, shares: num(p.shares), cost_basis: num(p.cost_basis) }));
}

export async function fetchMyBets(marketId?: string): Promise<Bet[]> {
  let qy = supabase.from('bets').select('*').order('id', { ascending: false }).limit(200);
  if (marketId) qy = qy.eq('market_id', marketId);
  const { data, error } = await qy;
  if (error) throw error;
  return (data ?? []).map((b) => ({
    ...b, shares: num(b.shares), amount: num(b.amount),
    balance_after: num(b.balance_after),
    effective_odds: b.effective_odds === null ? null : num(b.effective_odds),
    prices_after: (b.prices_after as string[] | null)?.map(Number) ?? null,
  }));
}

export async function fetchLeaderboard(): Promise<LeaderboardRow[]> {
  const { data, error } = await supabase
    .from('leaderboard').select('*').order('total', { ascending: false }).limit(100);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    ...r, balance: num(r.balance), open_value: num(r.open_value), total: num(r.total),
  }));
}

export async function fetchTrades(marketId: string, limit = 40): Promise<PublicTrade[]> {
  const { data, error } = await supabase
    .from('public_trades').select('*').eq('market_id', marketId)
    .order('id', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []).map((t) => ({
    ...t, shares: num(t.shares), stake: num(t.stake),
    effective_odds: t.effective_odds === null ? null : num(t.effective_odds),
  }));
}

/** Price history for the chart, derived from the ledger — prices are never stored. */
export async function fetchPriceHistory(marketId: string): Promise<number[][]> {
  const { data, error } = await supabase
    .from('bets').select('created_at, prices_after')
    .eq('market_id', marketId).order('id', { ascending: true });
  if (error) throw error;
  return (data ?? [])
    .filter((r) => r.prices_after)
    .map((r) => (r.prices_after as string[]).map(Number));
}

// ---------------------------------------------------------------- trading

export async function placeBet(args: {
  marketId: string; outcomeIdx: number;
  stake?: number; shares?: number; idempotencyKey: string;
}): Promise<TradeResult> {
  const { data, error } = await supabase.rpc('place_bet', {
    p_market: args.marketId,
    p_outcome_idx: args.outcomeIdx,
    p_stake: args.stake ?? null,
    p_shares: args.shares ?? null,
    p_idem: args.idempotencyKey,
  });
  if (error) throw error;
  const r = data as Record<string, unknown>;
  return {
    ...(r as unknown as TradeResult),
    shares: num(r.shares),
    balance_after: num(r.balance_after),
    prices: ((r.prices as string[]) ?? []).map(Number),
  };
}

// ---------------------------------------------------------------- game maker

export async function createMarket(args: {
  tournamentId: string; scope: MarketScope; title: string; rule: string;
  outcomes: Array<{ label: string; sublabel?: string; color: string; tab_team_id?: string }>;
  b?: number; layout?: string; resolver?: string; prior?: number[] | null;
  seeded?: boolean; roundId?: string | null; debateId?: string | null;
  templateKey?: string | null; closesAt?: string | null; status?: MarketStatus;
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_market', {
    p_tournament: args.tournamentId,
    p_scope: args.scope,
    p_title: args.title,
    p_rule: args.rule,
    p_outcomes: args.outcomes,
    p_b: args.b ?? 300,
    p_layout: args.layout ?? 'list',
    p_resolver: args.resolver ?? 'Game maker',
    p_prior: args.prior ?? null,
    p_seeded: args.seeded ?? false,
    p_round: args.roundId ?? null,
    p_debate: args.debateId ?? null,
    p_template: args.templateKey ?? null,
    p_closes_at: args.closesAt ?? null,
    p_status: args.status ?? 'open',
  });
  if (error) throw error;
  return data as string;
}

export async function updateMarket(id: string, patch: {
  title?: string; rule?: string; resolver?: string;
  b?: number; status?: MarketStatus; closesAt?: string;
}) {
  const { error } = await supabase.rpc('update_market', {
    p_market: id,
    p_title: patch.title ?? null,
    p_rule: patch.rule ?? null,
    p_resolver: patch.resolver ?? null,
    p_b: patch.b ?? null,
    p_status: patch.status ?? null,
    p_closes_at: patch.closesAt ?? null,
  });
  if (error) throw error;
}

export async function settleMarket(id: string, winnerIdx: number) {
  const { data, error } = await supabase.rpc('settle_market', { p_market: id, p_winner: winnerIdx });
  if (error) throw error;
  return data;
}

export async function voidMarket(id: string, reason: string) {
  const { error } = await supabase.rpc('void_market', { p_market: id, p_reason: reason });
  if (error) throw error;
}

export async function deleteMarket(id: string, reason: string) {
  const { error } = await supabase.rpc('delete_market', { p_market: id, p_reason: reason });
  if (error) throw error;
}

export async function adjustBalance(profileId: string, delta: number, note: string) {
  const { error } = await supabase.rpc('adjust_balance', {
    p_profile: profileId, p_delta: delta, p_note: note,
  });
  if (error) throw error;
}

export async function setProfileFlags(profileId: string, flags: {
  approved?: boolean; active?: boolean; role?: 'trader' | 'game_maker';
  speaker?: string; adj?: string;
}) {
  const { error } = await supabase.rpc('set_profile_flags', {
    p_profile: profileId,
    p_approved: flags.approved ?? null,
    p_active: flags.active ?? null,
    p_role: flags.role ?? null,
    p_speaker: flags.speaker ?? null,
    p_adj: flags.adj ?? null,
  });
  if (error) throw error;
}

export async function fetchAllProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles').select('*').order('display_name');
  if (error) throw error;
  return (data ?? []).map((p) => ({ ...p, balance: num(p.balance) }));
}

export async function fetchAllBets(limit = 300): Promise<Array<Bet & { display_name: string }>> {
  const { data, error } = await supabase
    .from('bets')
    .select('*, profiles!bets_profile_id_fkey ( display_name ), markets ( title )')
    .order('id', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []).map((b: Record<string, unknown>) => ({
    ...(b as unknown as Bet),
    shares: num(b.shares), amount: num(b.amount), balance_after: num(b.balance_after),
    effective_odds: b.effective_odds === null ? null : num(b.effective_odds),
    display_name: (b.profiles as { display_name: string } | null)?.display_name ?? '—',
    market_title: (b.markets as { title: string } | null)?.title ?? '—',
  })) as Array<Bet & { display_name: string }>;
}

export async function verifyLedger() {
  const { data, error } = await supabase.rpc('verify_ledger');
  if (error) throw error;
  return (data ?? []) as Array<{ display_name: string; ledger: number; stored: number; delta: number }>;
}

// ---------------------------------------------------------------- tab mirror

export interface TabTeam {
  id: string; tournament_id: string; tab_id: string | null; name: string;
  speakers: string[]; speaker_names: string[];
  elo: number | null; elo_rounds: number; is_swing: boolean;
}
export interface TabRound {
  id: string; tournament_id: string; seq: number; name: string;
  draw_released: boolean; results_in: boolean;
  motion: string | null; motion_category: string | null;
}
export interface TabDebate {
  id: string; round_id: string; tab_id: string | null; venue: string;
  team_ids: string[]; adjudicator_ids: string[]; result_json: unknown;
}

export async function fetchTabTeams(tournamentId: string): Promise<TabTeam[]> {
  const { data, error } = await supabase
    .from('tab_teams').select('*').eq('tournament_id', tournamentId).order('name');
  if (error) throw error;
  return (data ?? []).map((t) => ({ ...t, elo: t.elo === null ? null : Number(t.elo) }));
}

export async function fetchTabRounds(tournamentId: string): Promise<TabRound[]> {
  const { data, error } = await supabase
    .from('tab_rounds').select('*').eq('tournament_id', tournamentId).order('seq');
  if (error) throw error;
  return data ?? [];
}

export async function fetchTabDebates(roundId: string): Promise<TabDebate[]> {
  const { data, error } = await supabase
    .from('tab_debates').select('*').eq('round_id', roundId).order('venue');
  if (error) throw error;
  return data ?? [];
}

export async function upsertTabTeams(rows: Array<Partial<TabTeam>>) {
  const { data, error } = await supabase
    .from('tab_teams').upsert(rows, { onConflict: 'tournament_id,tab_id' }).select();
  if (error) throw error;
  return data ?? [];
}

export async function upsertTabRound(row: Partial<TabRound>) {
  const { data, error } = await supabase
    .from('tab_rounds').upsert(row, { onConflict: 'tournament_id,seq' }).select().single();
  if (error) throw error;
  return data as TabRound;
}

export async function upsertTabDebates(rows: Array<Partial<TabDebate>>) {
  const { data, error } = await supabase
    .from('tab_debates').upsert(rows, { onConflict: 'round_id,tab_id' }).select();
  if (error) throw error;
  return (data ?? []) as TabDebate[];
}

export async function updateTournament(id: string, patch: Record<string, unknown>) {
  const { error } = await supabase.from('tournaments').update(patch).eq('id', id);
  if (error) throw error;
}

export async function createTournament(name: string, slug: string) {
  const { data, error } = await supabase
    .from('tournaments').insert({ name, slug, is_active: true }).select().single();
  if (error) throw error;
  return data;
}

export async function fetchFlags(tournamentId: string) {
  const { data, error } = await supabase
    .from('tab_flags').select('*, markets ( title )')
    .eq('tournament_id', tournamentId).is('resolved_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function resolveFlag(id: number) {
  const { error } = await supabase
    .from('tab_flags').update({ resolved_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function importRegistrations(
  tournamentId: string,
  rows: Array<{ email: string; display_name?: string; tab_speaker_id?: string; tab_adj_id?: string }>,
) {
  const { error } = await supabase.from('registrations').upsert(
    rows.map((r) => ({ ...r, tournament_id: tournamentId, email: r.email.toLowerCase() })),
    { onConflict: 'tournament_id,email' },
  );
  if (error) throw error;
}
