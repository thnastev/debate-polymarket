export type MarketScope = 'tournament' | 'round' | 'room' | 'custom';
export type MarketStatus = 'draft' | 'open' | 'closed' | 'resolved' | 'void';
export type BetKind = 'back' | 'cash_out' | 'settle' | 'refund' | 'adjust' | 'grant';
export type UserRole = 'trader' | 'game_maker';

export interface Profile {
  id: string;
  display_name: string;
  role: UserRole;
  balance: number;
  tab_speaker_id: string | null;
  tab_adj_id: string | null;
  is_active: boolean;
  is_approved: boolean;
}

export interface Tournament {
  id: string;
  name: string;
  slug: string;
  tab_base_url: string | null;
  tab_slug: string | null;
  starting_balance: number;
  use_elo: boolean;
  is_active: boolean;
  self_bet_policy: 'block' | 'tag';
  elo_widen: boolean;
  show_prior_to_traders: boolean;
  auto_settle_enabled: boolean;
}

export interface Outcome {
  id: string;
  market_id: string;
  idx: number;
  label: string;
  sublabel: string | null;
  color: string;
  q: number;
  tab_team_id: string | null;
}

export interface Market {
  id: string;
  tournament_id: string;
  scope: MarketScope;
  title: string;
  resolution_rule: string;
  resolver_name: string;
  layout: string;
  b: number;
  status: MarketStatus;
  opens_at: string | null;
  closes_at: string | null;
  winner_index: number | null;
  close_prices: number[] | null;
  seeded_from_elo: boolean;
  prior: number[] | null;
  round_id: string | null;
  debate_id: string | null;
  template_key: string | null;
  created_at: string;
  market_outcomes?: Outcome[];
}

export interface Bet {
  id: number;
  created_at: string;
  profile_id: string;
  market_id: string | null;
  outcome_id: string | null;
  kind: BetKind;
  shares: number;
  amount: number;
  effective_odds: number | null;
  balance_after: number;
  prices_after: number[] | null;
  note: string | null;
}

export interface Position {
  profile_id: string;
  outcome_id: string;
  shares: number;
  cost_basis: number;
}

export interface LeaderboardRow {
  id: string;
  display_name: string;
  balance: number;
  open_value: number;
  total: number;
}

export interface PublicTrade {
  id: number;
  created_at: string;
  display_name: string;
  market_id: string;
  outcome_id: string;
  kind: BetKind;
  shares: number;
  stake: number;
  effective_odds: number | null;
  self_bet: boolean;
}

export interface TradeResult {
  ok?: boolean;
  replayed?: boolean;
  kind?: BetKind;
  shares: number;
  amount?: number;
  prices: number[];
  balance_after: number;
}
