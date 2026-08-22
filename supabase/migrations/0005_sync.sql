-- ============================================================
-- 0005_sync.sql — what the poller needs, and nothing more
--
-- The settlement logic is factored out of settle_market so that the game maker
-- and the poller run the SAME code, and differ only in who is allowed to call
-- it and whose name lands in admin_log.
-- ============================================================

create or replace function settle_market_internal(
  p_market uuid, p_winner int, p_actor uuid, p_note text default 'settled winner')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_mkt markets%rowtype; v_win uuid; v_prices numeric[]; v_paid numeric := 0;
begin
  select * into v_mkt from markets where id = p_market for update;
  if not found then raise exception 'market_not_found'; end if;
  if v_mkt.status in ('resolved','void') then raise exception 'already_settled'; end if;

  v_prices := lmsr_prices(p_market);
  select id into v_win from market_outcomes where market_id = p_market and idx = p_winner;
  if v_win is null then raise exception 'bad_winner_index'; end if;

  -- every winning share pays exactly 1 biser
  with winners as (
    select p.profile_id, p.shares from positions p
     where p.outcome_id = v_win and p.shares > 0
  ), paid as (
    update profiles pr set balance = pr.balance + w.shares
      from winners w where pr.id = w.profile_id
    returning w.shares
  ) select coalesce(sum(shares),0) into v_paid from paid;

  insert into bets (profile_id, market_id, outcome_id, kind, shares, amount,
                    balance_after, prices_after, note)
  select p.profile_id, p_market, v_win, 'settle', p.shares, p.shares,
         pr.balance, v_prices, p_note
    from positions p join profiles pr on pr.id = p.profile_id
   where p.outcome_id = v_win and p.shares > 0;

  update positions set shares = 0
   where outcome_id in (select id from market_outcomes where market_id = p_market);

  update markets set status = 'resolved', winner_index = p_winner,
                     close_prices = v_prices
   where id = p_market;

  insert into admin_log (actor_id, action, market_id, detail)
  values (p_actor, 'settle', p_market,
          jsonb_build_object('winner', p_winner, 'paid', v_paid,
                             'automated', p_actor <> auth.uid() is not false));

  return jsonb_build_object('ok', true, 'paid', v_paid, 'close_prices', v_prices);
end $$;

-- The game maker's entry point, unchanged in behaviour.
create or replace function settle_market(p_market uuid, p_winner int)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform assert_game_maker();
  return settle_market_internal(p_market, p_winner, auth.uid(), 'settled winner');
end $$;

-- The poller's entry point. Callable only with the service role key, and only
-- for a whitelisted machine-resolvable template — never a custom market (§8).
create or replace function settle_market_as_system(
  p_market uuid, p_winner int, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_key text; v_scope market_scope; v_auto boolean;
begin
  select m.template_key, m.scope, t.auto_settle_enabled
    into v_key, v_scope, v_auto
    from markets m join tournaments t on t.id = m.tournament_id
   where m.id = p_market;
  if not found then raise exception 'market_not_found'; end if;

  if not v_auto then raise exception 'auto_settle_disabled'; end if;
  if v_scope = 'custom' then raise exception 'never_auto_settle_custom'; end if;
  if v_key is null or v_key not in
       ('room.call','room.fourth','round.gov_vs_opp','tournament.winner') then
    raise exception 'not_machine_resolvable' using detail = coalesce(v_key,'(no template)');
  end if;

  return settle_market_internal(p_market, p_winner, p_actor, 'auto-settled from the tab');
end $$;

revoke all on function settle_market_internal(uuid,int,uuid,text) from public;
revoke all on function settle_market_as_system(uuid,int,uuid) from public;
revoke all on function settle_market_as_system(uuid,int,uuid) from authenticated;
grant execute on function settle_market_as_system(uuid,int,uuid) to service_role;

-- The poller writes flags with the service role, which bypasses RLS.
grant select, insert, update on tab_flags to service_role;

-- ------------------------------------------------------------
-- The system profile that owns automated admin_log entries, so an automated
-- settlement is never mistaken for the operator's own.
--
-- It is suspended and holds no bisers: it must never be able to trade and must
-- never appear on the leaderboard (the view filters on is_active).
-- ------------------------------------------------------------
do $$
declare v_id uuid := '00000000-0000-4000-8000-000000000001'; v_bal numeric;
begin
  if not exists (select 1 from auth.users where id = v_id) then
    insert into auth.users (id, email) values (v_id, 'tab-poller@biser.local');
  end if;
  if not exists (select 1 from profiles where id = v_id) then
    insert into profiles (id, display_name, balance, is_active, is_approved)
    values (v_id, 'Tab poller', 0, false, false);
  end if;

  -- handle_new_user() may have opened it with a bankroll. Zero it THROUGH the
  -- ledger rather than behind it, so verify_ledger() keeps passing.
  select balance into v_bal from profiles where id = v_id;
  if v_bal <> 0 then
    update profiles set balance = 0, is_active = false, is_approved = false,
                        display_name = 'Tab poller'
     where id = v_id;
    insert into bets (profile_id, kind, amount, balance_after, note)
    values (v_id, 'adjust', -v_bal, 0, 'system profile holds no bisers');
  else
    update profiles set is_active = false, is_approved = false,
                        display_name = 'Tab poller' where id = v_id;
  end if;
end $$;

-- ------------------------------------------------------------
-- Scheduling.
--
-- 30 seconds during active rounds, 5 minutes otherwise, never faster than 20s
-- (tabbycat.ts enforces the floor regardless of what is scheduled here).
-- pg_cron's finest granularity is a minute, so the fast cadence comes from the
-- Supabase dashboard's own scheduler; this is the fallback that always runs.
--
-- Run once, by hand, after `supabase functions deploy sync-tab`:
--
--   create extension if not exists pg_cron;
--   create extension if not exists pg_net;
--   select cron.schedule('sync-tab', '* * * * *', $CRON$
--     select net.http_post(
--       url     := 'https://<project>.supabase.co/functions/v1/sync-tab',
--       headers := jsonb_build_object(
--         'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
--         'Content-Type',  'application/json'),
--       body    := '{}'::jsonb);
--   $CRON$);
--
-- It is left commented because it embeds a project URL and a secret, and a
-- migration is the wrong place for either.
-- ------------------------------------------------------------
