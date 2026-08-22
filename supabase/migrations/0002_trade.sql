-- ============================================================
-- 0002_trade.sql — the market maker and the only path money takes
--
-- Everything about money happens in place_bet / settle_market / void_market.
-- Nothing else may write profiles.balance, positions.shares or
-- market_outcomes.q. All three lock the market row before reading any q, which
-- is what serialises concurrent trades (§1.3, §5.2).
--
-- The role guards live here rather than in 0003 as the brief lays them out, so
-- that this migration is applicable on its own — 0003's functions are called by
-- 0002's functions, and a migration that cannot be applied alone is a trap.
-- ============================================================

create or replace function is_game_maker() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles
                  where id = auth.uid() and role = 'game_maker');
$$;

create or replace function assert_game_maker() returns void
language plpgsql stable as $$
begin
  if not is_game_maker() then raise exception 'forbidden_not_game_maker'; end if;
end $$;

-- ------------------------------------------------------------
-- exp() that behaves like C's and JavaScript's.
--
-- Postgres RAISES `value out of range: underflow` where C returns 0.0. Every
-- softmax here shifts by max(q)/b, which makes the largest exponent exactly 0
-- and every other one negative — so a lopsided market (§3's [0,0,1e6,0] vector)
-- hands exp() something like -3333 and the whole price query errors out
-- instead of quoting 0. Below ~-745 a double is zero anyway, so return zero.
-- The shift guarantees the argument is never positive, so there is no
-- corresponding overflow case in the softmax; the one place an exponent can be
-- large and positive is the stake term in lmsr_shares_for_stake / place_bet,
-- which is bounded there instead.
-- ------------------------------------------------------------
create or replace function lmsr_exp(x double precision)
returns double precision language sql immutable parallel safe as $$
  select case when x < -700 then 0::double precision else exp(x) end;
$$;

-- Softmax over q with max-shift. Returns prices in idx order.
create or replace function lmsr_prices(p_market uuid)
returns numeric[] language plpgsql stable as $$
declare
  v_b double precision;
  v_q double precision[];
  v_m double precision;
  v_sum double precision := 0;
  v_out numeric[] := '{}';
  i int;
begin
  select b into v_b from markets where id = p_market;
  select array_agg(q order by idx) into v_q from market_outcomes where market_id = p_market;
  if v_q is null then return null; end if;
  select max(x) / v_b into v_m from unnest(v_q) x;
  for i in 1 .. array_length(v_q,1) loop
    v_sum := v_sum + lmsr_exp(v_q[i]/v_b - v_m);
  end loop;
  for i in 1 .. array_length(v_q,1) loop
    v_out := v_out || (lmsr_exp(v_q[i]/v_b - v_m) / v_sum)::numeric;
  end loop;
  return v_out;
end $$;

-- The same softmax over a bare vector, for tests and for pricing a hypothetical.
create or replace function lmsr_prices_of(p_q double precision[], p_b double precision)
returns double precision[] language plpgsql immutable as $$
declare v_m double precision; v_sum double precision := 0;
        v_out double precision[] := '{}'; i int;
begin
  select max(x)/p_b into v_m from unnest(p_q) x;
  for i in 1 .. array_length(p_q,1) loop v_sum := v_sum + lmsr_exp(p_q[i]/p_b - v_m); end loop;
  for i in 1 .. array_length(p_q,1) loop
    v_out := v_out || (lmsr_exp(p_q[i]/p_b - v_m) / v_sum);
  end loop;
  return v_out;
end $$;

-- C(q) = b·( m + ln( Σ_j lmsr_exp(q_j/b − m) ) )
create or replace function lmsr_cost(p_q double precision[], p_b double precision)
returns double precision language plpgsql immutable as $$
declare v_m double precision; v_sum double precision := 0; i int;
begin
  select max(x)/p_b into v_m from unnest(p_q) x;
  for i in 1 .. array_length(p_q,1) loop v_sum := v_sum + lmsr_exp(p_q[i]/p_b - v_m); end loop;
  return p_b * (v_m + ln(greatest(v_sum, 1e-300)));
end $$;

create or replace function lmsr_trade_cost(p_q double precision[], p_b double precision,
                                           p_i int, p_delta double precision)
returns double precision language plpgsql immutable as $$
declare v_q2 double precision[] := p_q;
begin
  v_q2[p_i + 1] := v_q2[p_i + 1] + p_delta;
  return lmsr_cost(v_q2, p_b) - lmsr_cost(p_q, p_b);
end $$;

-- Δ = b · ln( S·e^{a/b} − A ) − q_i + b·m
--
-- Algebraically identical to the brief's Δ = b·ln( (S·e^{a/b} − A) / E ), but
-- ln(E) is known exactly (it is q_i/b − m) whereas E itself underflows to 0
-- whenever the target outcome is astronomically unlikely — and dividing by it
-- then raises division_by_zero. Backing a ~0% outcome is exactly when a trader
-- most wants a number back, so the logarithm is subtracted rather than the
-- exponential divided by. Both implementations use this form; see
-- src/lib/lmsr.ts and scripts/parity.mjs.
create or replace function lmsr_shares_for_stake(p_q double precision[], p_b double precision,
                                                 p_i int, p_a double precision)
returns double precision language plpgsql immutable as $$
declare v_m double precision; v_S double precision := 0;
        v_E double precision; v_A double precision; v double precision; i int;
begin
  if p_a <= 0 then return 0; end if;
  -- The stake term e^{a/b} is the one exponent the max-shift does not bound.
  -- a > 500·b is not a trade any play-money balance can make; refuse it rather
  -- than overflow.
  if p_a / p_b > 500 then raise exception 'stake_too_large_for_b'; end if;
  select max(x)/p_b into v_m from unnest(p_q) x;
  for i in 1 .. array_length(p_q,1) loop v_S := v_S + lmsr_exp(p_q[i]/p_b - v_m); end loop;
  v_E := lmsr_exp(p_q[p_i + 1]/p_b - v_m);
  v_A := v_S - v_E;
  v := v_S * lmsr_exp(p_a/p_b) - v_A;
  if v <= 0 or v = 'Infinity'::double precision then return 0; end if;
  return p_b * ln(v) - p_q[p_i + 1] + p_b * v_m;
end $$;

-- q_i = b·ln(p_i) − mean_j( b·ln(p_j) )
create or replace function lmsr_q_from_prior(p_p double precision[], p_b double precision)
returns double precision[] language plpgsql immutable as $$
declare v_raw double precision[] := '{}'; v_mean double precision;
        v_out double precision[] := '{}'; i int;
begin
  for i in 1 .. array_length(p_p,1) loop
    v_raw := v_raw || (p_b * ln(greatest(p_p[i], 1e-6)));
  end loop;
  select avg(x) into v_mean from unnest(v_raw) x;
  for i in 1 .. array_length(v_raw,1) loop v_out := v_out || (v_raw[i] - v_mean); end loop;
  return v_out;
end $$;

-- ------------------------------------------------------------
-- Anti-abuse (§10). Raises on violation; returns void otherwise.
-- ------------------------------------------------------------
create or replace function assert_bet_allowed(p_uid uuid, p_market uuid, p_idx int)
returns void language plpgsql stable security definer set search_path = public as $$
declare v_debate uuid; v_prof profiles%rowtype; v_mode text; v_recent int;
begin
  select * into v_prof from profiles where id = p_uid;
  if not v_prof.is_approved then
    raise exception 'account_not_approved';
  end if;

  -- Rate limit: 30 trades a minute. Stops double-taps and scripted extraction
  -- of the maker subsidy alike. Grants and settlements are not trades.
  select count(*) into v_recent from bets
   where profile_id = p_uid
     and kind in ('back','cash_out')
     and created_at > now() - interval '1 minute';
  if v_recent >= 30 then raise exception 'rate_limited'; end if;

  select debate_id into v_debate from markets where id = p_market;
  if v_debate is null then return; end if;

  -- judges: absolute block. This is not insider trading, it is a bribe with
  -- extra steps. No exceptions, no tagging option.
  if v_prof.tab_adj_id is not null and exists (
       select 1 from tab_debates d
        where d.id = v_debate and v_prof.tab_adj_id = any(d.adjudicator_ids))
  then raise exception 'judge_cannot_bet_on_own_room'; end if;

  -- debaters: per-tournament policy
  select coalesce(t.self_bet_policy,'block') into v_mode
    from markets m join tournaments t on t.id = m.tournament_id
   where m.id = p_market;

  if v_mode = 'block' and v_prof.tab_speaker_id is not null and exists (
       select 1 from tab_debates d
         join tab_teams tt on tt.id = any(d.team_ids)
        where d.id = v_debate and v_prof.tab_speaker_id = any(tt.speakers))
  then raise exception 'debater_cannot_bet_on_own_room'; end if;
end $$;

-- True when this trader is a debater in the market's own room. Under the 'tag'
-- policy the bet is allowed but marked, publicly, in the trade log.
create or replace function is_self_bet(p_uid uuid, p_market uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from markets m
      join tab_debates d on d.id = m.debate_id
      join tab_teams tt on tt.id = any(d.team_ids)
      join profiles pr on pr.id = p_uid
     where m.id = p_market
       and pr.tab_speaker_id is not null
       and pr.tab_speaker_id = any(tt.speakers));
$$;

-- ------------------------------------------------------------
-- The one entry point for trading.
-- ------------------------------------------------------------
create or replace function place_bet(
  p_market      uuid,
  p_outcome_idx int,
  p_stake       numeric default null,   -- back:      bisers to spend
  p_shares      numeric default null,   -- cash_out:  shares to sell
  p_idem        text    default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_prof    profiles%rowtype;
  v_mkt     markets%rowtype;
  v_b       double precision;
  v_q       double precision[];
  v_ids     uuid[];
  v_n       int;
  v_i       int;          -- 1-based array position of the target outcome
  v_m       double precision;
  v_S       double precision := 0;
  v_E       double precision;
  v_A       double precision;
  v_delta   double precision;   -- signed share change
  v_cost    numeric;            -- signed: positive = trader pays
  v_c0      double precision;
  v_c1      double precision;
  v_held    numeric;
  v_prices  numeric[];
  v_kind    bet_kind;
  v_existing jsonb;
  v_note    text;
  k int;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- Idempotency, fast path: a key we have already seen returns the original
  -- result without taking the market lock at all.
  if p_idem is not null then
    select jsonb_build_object('replayed', true, 'balance_after', balance_after,
                              'prices', prices_after, 'shares', shares)
      into v_existing from bets
     where profile_id = v_uid and idempotency_key = p_idem;
    if v_existing is not null then return v_existing; end if;
  end if;

  -- LOCK FIRST. Nothing is read before this.
  select * into v_mkt from markets where id = p_market for update;
  if not found then raise exception 'market_not_found'; end if;

  -- Idempotency, again, now that the lock is held.
  --
  -- The check above races: two taps of one button arrive together, both look,
  -- both find nothing, and both go on to trade. The unique index on
  -- (profile_id, idempotency_key) does stop the second bet existing — but it
  -- stops it by aborting the transaction with `duplicate key value violates
  -- unique constraint "bets_idem"`, which is the RIGHT outcome wearing a
  -- frightening error. The trader is told their bet failed when it went
  -- through, and the offline queue reads a constraint violation as a
  -- deliberate rejection and drops the trade instead of reporting success.
  --
  -- Re-reading here closes it: the lock serialises the two, so by the time the
  -- loser is woken the winner has committed and its bet row is visible. The
  -- loser returns the winner's result, which is what a replay should do.
  --
  -- This runs BEFORE the status checks on purpose — a bet that already
  -- happened should replay cleanly even if the market has since closed.
  if p_idem is not null then
    select jsonb_build_object('replayed', true, 'balance_after', balance_after,
                              'prices', prices_after, 'shares', shares)
      into v_existing from bets
     where profile_id = v_uid and idempotency_key = p_idem;
    if v_existing is not null then return v_existing; end if;
  end if;

  if v_mkt.status <> 'open' then
    raise exception 'market_not_open' using detail = v_mkt.status::text;
  end if;
  if v_mkt.closes_at is not null and now() > v_mkt.closes_at then
    raise exception 'market_closed_by_time';
  end if;

  select * into v_prof from profiles where id = v_uid for update;
  if not found then raise exception 'no_profile'; end if;
  if not v_prof.is_active then raise exception 'account_suspended'; end if;

  -- anti-abuse (see §10). Raises on violation.
  perform assert_bet_allowed(v_uid, p_market, p_outcome_idx);
  if is_self_bet(v_uid, p_market) then
    v_note := 'self-bet: trader is debating in this room';
  end if;

  select array_agg(q order by idx), array_agg(id order by idx)
    into v_q, v_ids
    from market_outcomes where market_id = p_market;
  v_n := array_length(v_q, 1);
  if v_n is null then raise exception 'market_has_no_outcomes'; end if;
  if p_outcome_idx < 0 or p_outcome_idx >= v_n then
    raise exception 'bad_outcome_index';
  end if;
  v_i := p_outcome_idx + 1;
  v_b := v_mkt.b;

  -- shifted softmax denominators
  select max(x)/v_b into v_m from unnest(v_q) x;
  for k in 1 .. v_n loop v_S := v_S + lmsr_exp(v_q[k]/v_b - v_m); end loop;
  v_E := lmsr_exp(v_q[v_i]/v_b - v_m);
  v_A := v_S - v_E;

  if p_stake is not null then
    ---------------- BACK ----------------
    v_kind := 'back';
    if p_stake <= 0 or p_stake > 1e9 or p_stake <> p_stake then
      raise exception 'bad_stake';
    end if;
    if p_stake::double precision / v_b > 500 then
      raise exception 'stake_too_large_for_b';
    end if;
    if v_prof.balance < p_stake then
      raise exception 'insufficient_balance'
        using detail = format('has %s needs %s', v_prof.balance, p_stake);
    end if;
    -- Δ = b·ln( S·e^{a/b} − A ) − q_i + b·m  (see lmsr_shares_for_stake above
    -- for why this and not the division form)
    v_delta := v_b * ln( greatest(v_S * lmsr_exp(p_stake::double precision / v_b) - v_A, 1e-300) )
               - v_q[v_i] + v_b * v_m;
    v_cost  := p_stake;
  else
    ---------------- CASH OUT ----------------
    v_kind := 'cash_out';
    if p_shares is null or p_shares <= 0 then raise exception 'bad_share_count'; end if;
    select coalesce(shares,0) into v_held
      from positions where profile_id = v_uid and outcome_id = v_ids[v_i];
    if coalesce(v_held,0) < p_shares then
      raise exception 'insufficient_shares'
        using detail = format('has %s needs %s', coalesce(v_held,0), p_shares);
    end if;
    v_delta := -p_shares::double precision;
    -- cost = C(q') − C(q), negative here, so the trader receives −cost
    -- Selling the whole of a dominant outcome can drive every shifted
    -- exponential to zero; floor the argument so ln() gets a positive number.
    v_c0 := v_b * (v_m + ln(greatest(v_S, 1e-300)));
    v_c1 := v_b * (v_m + ln(greatest(v_A + lmsr_exp((v_q[v_i] + v_delta)/v_b - v_m), 1e-300)));
    v_cost := (v_c1 - v_c0)::numeric;      -- negative
  end if;

  -- apply
  update market_outcomes
     set q = q + v_delta::numeric
   where id = v_ids[v_i];

  update profiles set balance = balance - v_cost where id = v_uid;

  insert into positions (profile_id, outcome_id, shares, cost_basis)
  values (v_uid, v_ids[v_i], greatest(v_delta::numeric, 0),
          greatest(v_cost, 0))
  on conflict (profile_id, outcome_id) do update
     set shares     = positions.shares + v_delta::numeric,
         cost_basis = greatest(positions.cost_basis + v_cost, 0);

  v_prices := lmsr_prices(p_market);

  insert into bets (profile_id, market_id, outcome_id, kind, shares, amount,
                    effective_odds, balance_after, prices_after, idempotency_key, note)
  select v_uid, p_market, v_ids[v_i], v_kind, abs(v_delta::numeric), -v_cost,
         case when v_kind = 'back' and p_stake > 0
              then abs(v_delta::numeric) / p_stake else null end,
         p.balance, v_prices, p_idem, v_note
    from profiles p where p.id = v_uid;

  return jsonb_build_object(
    'ok', true,
    'kind', v_kind,
    'shares', abs(v_delta),
    'amount', -v_cost,
    'prices', v_prices,
    'balance_after', (select balance from profiles where id = v_uid)
  );
end $$;

revoke all on function place_bet(uuid,int,numeric,numeric,text) from public;
grant execute on function place_bet(uuid,int,numeric,numeric,text) to authenticated;

-- ------------------------------------------------------------
-- Settlement and voiding
-- ------------------------------------------------------------
create or replace function settle_market(p_market uuid, p_winner int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_mkt markets%rowtype; v_win uuid; v_prices numeric[]; v_paid numeric := 0;
begin
  perform assert_game_maker();
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
         pr.balance, v_prices, 'settled winner'
    from positions p join profiles pr on pr.id = p.profile_id
   where p.outcome_id = v_win and p.shares > 0;

  -- clear every position on this market
  update positions set shares = 0
   where outcome_id in (select id from market_outcomes where market_id = p_market);

  update markets set status = 'resolved', winner_index = p_winner,
                     close_prices = v_prices
   where id = p_market;

  insert into admin_log (actor_id, action, market_id, detail)
  values (auth.uid(), 'settle', p_market,
          jsonb_build_object('winner', p_winner, 'paid', v_paid));

  return jsonb_build_object('ok', true, 'paid', v_paid, 'close_prices', v_prices);
end $$;

-- Void refunds each trader their NET amount staked on this market.
--
-- Someone who bought for 40 and cashed out half for 25 is refunded 15. It is
-- NOT a return to the starting balance and it is NOT a payout at current
-- prices. Say so in the UI where the operator presses the button.
create or replace function void_market(p_market uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_total numeric := 0; v_short record;
begin
  perform assert_game_maker();
  perform 1 from markets where id = p_market for update;
  if not found then raise exception 'market_not_found'; end if;

  -- A trader who cashed out at a profit owes bisers back on a void. If they
  -- have already spent them elsewhere the refund cannot be applied without
  -- driving the balance negative, so name the trader rather than either
  -- failing opaquely on the check constraint or silently losing the money.
  select pr.display_name, pr.balance, n.owed into v_short
    from (select profile_id, -sum(amount) as owed from bets
           where market_id = p_market and kind in ('back','cash_out')
           group by profile_id) n
    join profiles pr on pr.id = n.profile_id
   where pr.balance + n.owed < 0
   limit 1;
  if found then
    raise exception 'void_would_overdraw'
      using detail = format('%s holds %s and owes %s back', v_short.display_name,
                            v_short.balance, -v_short.owed);
  end if;

  with net as (
    select profile_id, -sum(amount) as owed
      from bets
     where market_id = p_market and kind in ('back','cash_out')
     group by profile_id
    having -sum(amount) <> 0
  ), refunded as (
    update profiles pr set balance = pr.balance + n.owed
      from net n where pr.id = n.profile_id
    -- DEVIATION FROM THE BRIEF, deliberate: the brief joins `profiles` again in
    -- the outer INSERT to read balance_after. A CTE and its outer query share
    -- one snapshot, so that join returns the balance from BEFORE the refund and
    -- writes a wrong balance_after into the append-only ledger. RETURNING sees
    -- the new row, so the post-refund balance is taken from here instead.
    returning n.profile_id as pid, n.owed as owed, pr.balance as bal_after
  )
  insert into bets (profile_id, market_id, kind, amount, balance_after, note)
  select r.pid, p_market, 'refund', r.owed, r.bal_after, p_reason
    from refunded r;

  update positions set shares = 0
   where outcome_id in (select id from market_outcomes where market_id = p_market);
  update markets set status = 'void' where id = p_market;

  insert into admin_log (actor_id, action, market_id, detail)
  values (auth.uid(), 'void', p_market, jsonb_build_object('reason', p_reason));

  return jsonb_build_object('ok', true);
end $$;

-- ------------------------------------------------------------
-- verify_ledger — recompute every balance from the append-only ledger and
-- return the rows that disagree with profiles.balance. An empty result is the
-- system telling you the money is all accounted for.
--
-- This works because the opening bankroll is itself booked as a 'grant' row
-- (see the profiles trigger in 0004), so a profile's balance is exactly the
-- sum of its ledger.
-- ------------------------------------------------------------
create or replace function verify_ledger()
returns table (profile_id uuid, display_name text,
               ledger numeric, stored numeric, delta numeric)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name,
         coalesce(l.total, 0)::numeric(18,6),
         p.balance,
         (p.balance - coalesce(l.total, 0))::numeric(18,6)
    from profiles p
    left join (select b.profile_id as pid, sum(b.amount) as total
                 from bets b group by b.profile_id) l on l.pid = p.id
   where abs(p.balance - coalesce(l.total, 0)) > 0.000001;
$$;

-- Raises if the ledger and the balances have drifted. Call it in tests, and
-- from the game maker screen.
create or replace function assert_ledger_ok() returns void
language plpgsql stable security definer set search_path = public as $$
declare v_bad record; v_n int;
begin
  select count(*) into v_n from verify_ledger();
  if v_n > 0 then
    select * into v_bad from verify_ledger() limit 1;
    raise exception 'ledger_mismatch'
      using detail = format('%s profile(s) disagree; first: %s ledger=%s stored=%s',
                            v_n, v_bad.display_name, v_bad.ledger, v_bad.stored);
  end if;
end $$;
