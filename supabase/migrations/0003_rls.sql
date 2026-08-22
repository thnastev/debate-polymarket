-- ============================================================
-- 0003_rls.sql
--
-- The rule: traders read what's public, write nothing directly, and see
-- nobody else's positions. Every write to money goes through the security
-- definer functions in 0002 and 0004.
-- ============================================================
-- Baseline grants. RLS decides which ROWS; these decide which TABLES and
-- columns. Both have to be right — RLS on a table the client cannot select
-- from is pointless, and a table grant with no RLS is a data leak.
grant select on all tables in schema public to authenticated;
grant insert, update, delete on
  markets, market_outcomes, tournaments, tab_teams, tab_rounds, tab_debates,
  admin_log, tab_flags to authenticated;
grant update on profiles to authenticated;

alter table profiles        enable row level security;
alter table tournaments     enable row level security;
alter table tab_teams       enable row level security;
alter table tab_rounds      enable row level security;
alter table tab_debates     enable row level security;
alter table markets         enable row level security;
alter table market_outcomes enable row level security;
alter table positions       enable row level security;
alter table bets            enable row level security;
alter table admin_log       enable row level security;
alter table tab_flags       enable row level security;

-- profiles: you see your own row fully; the game maker sees everyone.
create policy prof_self on profiles for select using (id = auth.uid());
create policy prof_admin on profiles for select using (is_game_maker());
create policy prof_update_self on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
-- NOTE: balance is NOT writable by the client.
--
-- DEVIATION FROM THE BRIEF, and it matters. The brief writes
--   revoke update (balance, role, is_active) on profiles from authenticated;
-- which does nothing. A column-level REVOKE cannot carve a hole out of a
-- TABLE-level grant: Postgres records no column ACL and the table grant keeps
-- covering every column, balance included. Check it with
--   select attname, attacl from pg_attribute where attrelid = 'profiles'::regclass;
-- — attacl comes back null, and `update profiles set balance = 999999` succeeds
-- for any trader with a valid session, which is the one thing §13 says must be
-- impossible.
--
-- The form that works is to revoke the table grant and hand back only the
-- column a trader is allowed to touch.
revoke update on profiles from authenticated;
grant update (display_name) on profiles to authenticated;

-- Money tables are written by security definer functions and by nothing else,
-- so the client role has no write privilege on them at all. The absent RLS
-- policies already deny it; this is the second lock on the same door.
revoke insert, update, delete on positions from authenticated;
revoke insert, update, delete on bets from authenticated;
revoke update, delete on admin_log from authenticated;

-- public reference data: readable by all signed-in users, writable by nobody
create policy tour_read on tournaments for select using (true);
create policy team_read on tab_teams   for select using (true);
create policy rnd_read  on tab_rounds  for select using (true);
create policy deb_read  on tab_debates for select using (true);
create policy tour_write on tournaments for all
  using (is_game_maker()) with check (is_game_maker());
create policy team_write on tab_teams for all
  using (is_game_maker()) with check (is_game_maker());
create policy rnd_write on tab_rounds for all
  using (is_game_maker()) with check (is_game_maker());
create policy deb_write on tab_debates for all
  using (is_game_maker()) with check (is_game_maker());

-- markets: everyone reads non-draft markets; only the game maker writes
create policy mk_read on markets for select
  using (status <> 'draft' or is_game_maker());
create policy mk_write on markets for all
  using (is_game_maker()) with check (is_game_maker());
create policy oc_read on market_outcomes for select using (true);
create policy oc_write on market_outcomes for all
  using (is_game_maker()) with check (is_game_maker());

-- positions: strictly your own. This is what keeps holdings private.
create policy pos_self on positions for select using (profile_id = auth.uid());
create policy pos_admin on positions for select using (is_game_maker());
-- no insert/update/delete policy at all: only place_bet (security definer) writes.

-- bets: you see your own; the game maker sees everything.
create policy bet_self on bets for select using (profile_id = auth.uid());
create policy bet_admin on bets for select using (is_game_maker());

create policy log_admin on admin_log for all
  using (is_game_maker()) with check (is_game_maker());
create policy flag_admin on tab_flags for all
  using (is_game_maker()) with check (is_game_maker());

-- ------------------------------------------------------------
-- The public leaderboard.
--
-- Do NOT solve this by loosening the policies on profiles or positions. This
-- view exposes totals and nothing else — never which markets someone is in,
-- which would leak positions.
-- ------------------------------------------------------------
create or replace view leaderboard as
select p.id, p.display_name, p.balance,
       coalesce(sum(po.shares * pr.price), 0) as open_value,
       p.balance + coalesce(sum(po.shares * pr.price), 0) as total
  from profiles p
  left join positions po on po.profile_id = p.id and po.shares > 0
  left join lateral (
     select (lmsr_prices(mo.market_id))[mo.idx + 1] as price
       from market_outcomes mo where mo.id = po.outcome_id
  ) pr on true
 where p.is_active
 group by p.id, p.display_name, p.balance;

alter view leaderboard set (security_invoker = off);
grant select on leaderboard to authenticated;

-- The trade log traders can see: who bet on what, without amounts held or
-- balances. The self-bet marker from the 'tag' policy shows here, publicly.
create or replace view public_trades as
select b.id, b.created_at, pr.display_name, b.market_id, b.outcome_id,
       b.kind, b.shares, abs(b.amount) as stake, b.effective_odds,
       (b.note is not null and b.note like 'self-bet%') as self_bet
  from bets b
  join profiles pr on pr.id = b.profile_id
 where b.kind in ('back','cash_out');

alter view public_trades set (security_invoker = off);
grant select on public_trades to authenticated;
