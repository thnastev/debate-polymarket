-- ============================================================
-- 0001_init.sql — schema
--
-- Money rules, in one line each:
--   * `q` lives on market_outcomes, `b` lives on markets, prices are DERIVED.
--   * `bets` is append-only and is the audit source of truth.
--   * profiles.balance and positions.shares are running aggregates that
--     `verify_ledger()` re-derives from `bets` and asserts against.
-- ============================================================

create extension if not exists pgcrypto;

create type market_scope  as enum ('tournament','round','room','custom');
create type market_status as enum ('draft','open','closed','resolved','void');
create type bet_kind      as enum ('back','cash_out','settle','refund','adjust','grant');
create type user_role     as enum ('trader','game_maker');

-- ---------- people ----------
create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null,
  role          user_role not null default 'trader',
  balance       numeric(18,6) not null default 1000,
  -- links this account to a person in the tab, for anti-abuse checks
  tab_speaker_id text,
  tab_adj_id     text,
  is_active     boolean not null default true,
  -- an account whose email did not match the registration list cannot trade
  -- until the game maker approves it (§10, one account per person)
  is_approved   boolean not null default false,
  created_at    timestamptz not null default now(),
  constraint balance_non_negative check (balance >= 0)
);

-- ---------- tournament mirror (populated from Tabbycat) ----------
create table tournaments (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null,
  tab_base_url  text,              -- e.g. https://sofiaopen.calicotab.com
  tab_slug      text,              -- e.g. open
  starting_balance numeric(18,6) not null default 1000,
  use_elo       boolean not null default false,
  is_active     boolean not null default false,
  -- §10: what happens when a debater bets on their own room
  self_bet_policy text not null default 'block'
    check (self_bet_policy in ('block','tag')),
  -- §7: widen Monte-Carlo noise for debaters with few recorded rounds
  elo_widen     boolean not null default true,
  -- §7 open question 4: is the Elo prior visible to traders?
  show_prior_to_traders boolean not null default true,
  -- §8: never on for the first tournament
  auto_settle_enabled boolean not null default false,
  created_at    timestamptz not null default now()
);

create table tab_teams (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  tab_id        text,
  name          text not null,
  -- The identifiers §10 matches profiles.tab_speaker_id against. Keep these as
  -- tab speaker IDs, not names: the anti-abuse check is an equality test and a
  -- name is not a key. Display names live alongside.
  speakers      text[] not null default '{}',
  speaker_names text[] not null default '{}',
  elo           numeric(8,2),      -- null = no rating available
  elo_rounds    int not null default 0,
  is_swing      boolean not null default false,
  unique (tournament_id, tab_id)
);

create table tab_rounds (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  seq           int not null,
  name          text not null,
  draw_released boolean not null default false,
  results_in    boolean not null default false,
  motion        text,
  motion_category text,
  unique (tournament_id, seq)
);

create table tab_debates (
  id            uuid primary key default gen_random_uuid(),
  round_id      uuid not null references tab_rounds(id) on delete cascade,
  tab_id        text,
  venue         text not null,
  -- team ids in fixed BP order: [OG, OO, CG, CO]
  team_ids      uuid[] not null,
  adjudicator_ids text[] not null default '{}',
  result_json   jsonb,             -- raw ballot once published
  unique (round_id, tab_id)
);

-- ---------- markets ----------
create table markets (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  scope         market_scope not null,
  title         text not null,
  -- The resolution rule. This is the most important text field in the system.
  resolution_rule text not null,
  resolver_name text not null default 'Game maker',
  layout        text not null default 'list',   -- 'list' | 'room'
  b             numeric(12,4) not null default 300,
  status        market_status not null default 'open',
  opens_at      timestamptz,
  closes_at     timestamptz,      -- soft hint for the UI; server enforces status
  winner_index  int,
  close_prices  numeric(10,8)[],  -- snapshot at settlement, for scoring
  seeded_from_elo boolean not null default false,
  prior         numeric(10,8)[],  -- the opening probability vector
  -- provenance so the poller can find its own markets again
  round_id      uuid references tab_rounds(id) on delete set null,
  debate_id     uuid references tab_debates(id) on delete set null,
  template_key  text,             -- e.g. 'room.call', 'round.motion_category'
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now(),
  constraint b_positive check (b > 0)
);
create unique index markets_template_uniq
  on markets (tournament_id, template_key, coalesce(debate_id, round_id, tournament_id))
  where template_key is not null;
create index markets_tournament on markets (tournament_id, scope, created_at);

create table market_outcomes (
  id            uuid primary key default gen_random_uuid(),
  market_id     uuid not null references markets(id) on delete cascade,
  idx           int not null,          -- 0-based, dense
  label         text not null,
  sublabel      text,
  color         text not null,
  q             numeric(18,6) not null default 0,
  -- for anti-abuse: which tab team/speaker this outcome refers to, if any
  tab_team_id   uuid references tab_teams(id) on delete set null,
  unique (market_id, idx)
);

create table positions (
  profile_id    uuid not null references profiles(id) on delete cascade,
  outcome_id    uuid not null references market_outcomes(id) on delete cascade,
  shares        numeric(18,6) not null default 0,
  cost_basis    numeric(18,6) not null default 0,
  primary key (profile_id, outcome_id),
  constraint shares_non_negative check (shares >= 0)
);

-- Append-only ledger. Never update or delete a row here.
create table bets (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  profile_id    uuid not null references profiles(id),
  -- DEVIATION FROM THE BRIEF, deliberate: the brief declares market_id NOT NULL
  -- but also declares the bet kinds 'grant' and 'adjust', which are the opening
  -- bankroll and a game-maker balance correction. Neither belongs to a market.
  -- Forcing a market_id on them would mean either inventing a fake market or
  -- keeping those movements out of the ledger — and the ledger has to be
  -- complete for verify_ledger() to mean anything. So: required for every kind
  -- that touches a market, null for the two that do not.
  market_id     uuid references markets(id),
  outcome_id    uuid references market_outcomes(id),
  kind          bet_kind not null,
  shares        numeric(18,6) not null default 0,
  -- signed: negative = bisers left the trader, positive = bisers arrived
  amount        numeric(18,6) not null,
  effective_odds numeric(12,6),        -- shares / stake, for display
  balance_after numeric(18,6) not null,
  prices_after  numeric(10,8)[],
  idempotency_key text,
  note          text,
  constraint market_required_for_market_kinds check (
    (kind in ('adjust','grant')) or (market_id is not null)
  )
);
create unique index bets_idem on bets (profile_id, idempotency_key)
  where idempotency_key is not null;
create index bets_market on bets (market_id, created_at desc);
create index bets_profile on bets (profile_id, created_at desc);
create index bets_rate_limit on bets (profile_id, created_at desc);

-- Admin action audit. Every game-maker action lands here.
create table admin_log (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  actor_id      uuid not null references profiles(id),
  action        text not null,
  market_id     uuid references markets(id),
  target_id     uuid,
  detail        jsonb
);

-- Things the poller refused to decide on its own. §8: silence is safer than a
-- wrong settlement, so anything ambiguous lands here for a human.
create table tab_flags (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  market_id     uuid references markets(id) on delete cascade,
  kind          text not null,
  detail        jsonb,
  resolved_at   timestamptz,
  resolved_by   uuid references profiles(id)
);
create index tab_flags_open on tab_flags (tournament_id, created_at desc)
  where resolved_at is null;
