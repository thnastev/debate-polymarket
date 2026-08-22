-- ============================================================
-- 0004_admin.sql — profile bootstrap and the game maker's RPCs
--
-- Every one of these is security definer and starts with assert_game_maker(),
-- and every one of them writes to admin_log. The client can call them; the
-- client cannot do what they do by any other route.
-- ============================================================

-- ------------------------------------------------------------
-- Profile bootstrap.
--
-- A profile's opening bankroll is booked as a 'grant' row in the ledger, so
-- that `balance == sum(bets.amount)` holds for everyone from the first second.
-- That identity is what makes verify_ledger() meaningful.
-- ------------------------------------------------------------
create or replace function book_opening_grant() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.balance <> 0 then
    insert into bets (profile_id, kind, amount, balance_after, note)
    values (new.id, 'grant', new.balance, new.balance, 'opening bankroll');
  end if;
  return new;
end $$;

create trigger profiles_opening_grant after insert on profiles
  for each row execute function book_opening_grant();

-- New auth user -> profile, at the active tournament's starting balance.
-- An account is approved only if its email is on the imported registration
-- list; otherwise it lands pending and cannot trade (§10).
create table registrations (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  email         text not null,
  display_name  text,
  tab_speaker_id text,
  tab_adj_id     text,
  claimed_by    uuid references profiles(id),
  unique (tournament_id, email)
);
alter table registrations enable row level security;
create policy reg_admin on registrations for all
  using (is_game_maker()) with check (is_game_maker());

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_start numeric := 1000; v_reg registrations%rowtype; v_email text;
begin
  v_email := lower(coalesce(new.email, ''));
  select starting_balance into v_start from tournaments where is_active limit 1;
  select r.* into v_reg
    from registrations r
    join tournaments t on t.id = r.tournament_id and t.is_active
   where lower(r.email) = v_email
   limit 1;

  insert into profiles (id, display_name, balance, is_approved,
                        tab_speaker_id, tab_adj_id)
  values (new.id,
          coalesce(v_reg.display_name, split_part(v_email, '@', 1)),
          coalesce(v_start, 1000),
          v_reg.id is not null,
          v_reg.tab_speaker_id, v_reg.tab_adj_id);

  if v_reg.id is not null then
    update registrations set claimed_by = new.id where id = v_reg.id;
  end if;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ------------------------------------------------------------
-- Market creation, atomically with its outcomes.
-- ------------------------------------------------------------
create or replace function create_market(
  p_tournament uuid,
  p_scope      market_scope,
  p_title      text,
  p_rule       text,
  p_outcomes   jsonb,          -- [{label, sublabel, color, tab_team_id}, …]
  p_b          numeric default 300,
  p_layout     text default 'list',
  p_resolver   text default 'Game maker',
  p_prior      numeric[] default null,
  p_seeded     boolean default false,
  p_round      uuid default null,
  p_debate     uuid default null,
  p_template   text default null,
  p_closes_at  timestamptz default null,
  p_status     market_status default 'open'
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_n int; v_prior double precision[]; v_q double precision[];
        v_el jsonb; i int;
begin
  perform assert_game_maker();
  v_n := jsonb_array_length(p_outcomes);
  if v_n < 2 or v_n > 64 then raise exception 'bad_outcome_count'; end if;
  if p_b <= 0 then raise exception 'bad_b'; end if;

  -- Uniform when no prior is supplied — the fully supported first-class mode,
  -- not a degraded one (§7).
  if p_prior is null or array_length(p_prior,1) <> v_n then
    v_prior := array(select 1.0::double precision / v_n from generate_series(1, v_n));
  else
    v_prior := array(select x::double precision from unnest(p_prior) x);
  end if;
  v_q := lmsr_q_from_prior(v_prior, p_b::double precision);

  insert into markets (tournament_id, scope, title, resolution_rule, resolver_name,
                       layout, b, status, opens_at, closes_at, prior,
                       seeded_from_elo, round_id, debate_id, template_key, created_by)
  values (p_tournament, p_scope, p_title, p_rule, p_resolver, p_layout, p_b,
          p_status, now(), p_closes_at,
          array(select x::numeric(10,8) from unnest(v_prior) x),
          p_seeded, p_round, p_debate, p_template, auth.uid())
  returning id into v_id;

  for i in 0 .. v_n - 1 loop
    v_el := p_outcomes -> i;
    insert into market_outcomes (market_id, idx, label, sublabel, color, q, tab_team_id)
    values (v_id, i,
            v_el ->> 'label',
            v_el ->> 'sublabel',
            coalesce(v_el ->> 'color', '#A78BFA'),
            v_q[i + 1]::numeric(18,6),
            nullif(v_el ->> 'tab_team_id','')::uuid);
  end loop;

  insert into admin_log (actor_id, action, market_id, detail)
  values (auth.uid(), 'create_market', v_id,
          jsonb_build_object('title', p_title, 'template', p_template,
                             'n', v_n, 'b', p_b, 'seeded', p_seeded));
  return v_id;
end $$;

-- ------------------------------------------------------------
-- Editing a live market.
--
-- Changing b re-derives q so every price is held constant. Changing b alone
-- silently moves every price, which is never what the operator means (§3).
-- ------------------------------------------------------------
create or replace function update_market(
  p_market   uuid,
  p_title    text default null,
  p_rule     text default null,
  p_resolver text default null,
  p_b        numeric default null,
  p_status   market_status default null,
  p_closes_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_mkt markets%rowtype; v_p double precision[]; v_q double precision[]; i int;
begin
  perform assert_game_maker();
  select * into v_mkt from markets where id = p_market for update;
  if not found then raise exception 'market_not_found'; end if;

  if p_b is not null and p_b <> v_mkt.b then
    if p_b <= 0 then raise exception 'bad_b'; end if;
    select array_agg(q::double precision order by idx) into v_q
      from market_outcomes where market_id = p_market;
    v_p := lmsr_prices_of(v_q, v_mkt.b::double precision);
    v_q := lmsr_q_from_prior(v_p, p_b::double precision);
    for i in 1 .. array_length(v_q,1) loop
      update market_outcomes set q = v_q[i]::numeric(18,6)
       where market_id = p_market and idx = i - 1;
    end loop;
  end if;

  update markets set
    title           = coalesce(p_title, title),
    resolution_rule = coalesce(p_rule, resolution_rule),
    resolver_name   = coalesce(p_resolver, resolver_name),
    b               = coalesce(p_b, b),
    status          = coalesce(p_status, status),
    closes_at       = coalesce(p_closes_at, closes_at)
  where id = p_market;

  insert into admin_log (actor_id, action, market_id, detail)
  values (auth.uid(), 'update_market', p_market,
          jsonb_build_object('b', p_b, 'status', p_status, 'title', p_title));
  return jsonb_build_object('ok', true, 'prices', lmsr_prices(p_market));
end $$;

-- Deleting a market refunds every bet on it first, then removes it. The bets
-- rows survive — the ledger is append-only — with market_id nulled by the FK.
create or replace function delete_market(p_market uuid, p_reason text default 'deleted')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_st market_status;
begin
  perform assert_game_maker();
  select status into v_st from markets where id = p_market;
  if not found then raise exception 'market_not_found'; end if;
  if v_st not in ('void','resolved') then perform void_market(p_market, p_reason); end if;
  insert into admin_log (actor_id, action, market_id, detail)
  values (auth.uid(), 'delete_market', p_market, jsonb_build_object('reason', p_reason));
  delete from markets where id = p_market;
  return jsonb_build_object('ok', true);
end $$;

-- ------------------------------------------------------------
-- Balance adjustment. Booked into the ledger like everything else, so
-- verify_ledger() keeps passing.
-- ------------------------------------------------------------
create or replace function adjust_balance(p_profile uuid, p_delta numeric, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_bal numeric;
begin
  perform assert_game_maker();
  if p_delta = 0 then raise exception 'zero_adjustment'; end if;
  update profiles set balance = balance + p_delta where id = p_profile
    returning balance into v_bal;
  if v_bal is null then raise exception 'profile_not_found'; end if;

  insert into bets (profile_id, kind, amount, balance_after, note)
  values (p_profile, 'adjust', p_delta, v_bal, p_note);

  insert into admin_log (actor_id, action, target_id, detail)
  values (auth.uid(), 'adjust_balance', p_profile,
          jsonb_build_object('delta', p_delta, 'note', p_note, 'balance_after', v_bal));
  return jsonb_build_object('ok', true, 'balance', v_bal);
end $$;

create or replace function set_profile_flags(
  p_profile uuid, p_approved boolean default null, p_active boolean default null,
  p_role user_role default null, p_speaker text default null, p_adj text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform assert_game_maker();
  update profiles set
    is_approved    = coalesce(p_approved, is_approved),
    is_active      = coalesce(p_active, is_active),
    role           = coalesce(p_role, role),
    tab_speaker_id = coalesce(p_speaker, tab_speaker_id),
    tab_adj_id     = coalesce(p_adj, tab_adj_id)
  where id = p_profile;
  if not found then raise exception 'profile_not_found'; end if;
  insert into admin_log (actor_id, action, target_id, detail)
  values (auth.uid(), 'set_profile_flags', p_profile,
          jsonb_build_object('approved', p_approved, 'active', p_active, 'role', p_role));
  return jsonb_build_object('ok', true);
end $$;

revoke all on function create_market(uuid,market_scope,text,text,jsonb,numeric,text,text,numeric[],boolean,uuid,uuid,text,timestamptz,market_status) from public;
revoke all on function update_market(uuid,text,text,text,numeric,market_status,timestamptz) from public;
revoke all on function delete_market(uuid,text) from public;
revoke all on function adjust_balance(uuid,numeric,text) from public;
revoke all on function set_profile_flags(uuid,boolean,boolean,user_role,text,text) from public;
revoke all on function settle_market(uuid,int) from public;
revoke all on function void_market(uuid,text) from public;

grant execute on function create_market(uuid,market_scope,text,text,jsonb,numeric,text,text,numeric[],boolean,uuid,uuid,text,timestamptz,market_status) to authenticated;
grant execute on function update_market(uuid,text,text,text,numeric,market_status,timestamptz) to authenticated;
grant execute on function delete_market(uuid,text) to authenticated;
grant execute on function adjust_balance(uuid,numeric,text) to authenticated;
grant execute on function set_profile_flags(uuid,boolean,boolean,user_role,text,text) to authenticated;
grant execute on function settle_market(uuid,int) to authenticated;
grant execute on function void_market(uuid,text) to authenticated;
grant execute on function verify_ledger() to authenticated;
grant execute on function assert_ledger_ok() to authenticated;
