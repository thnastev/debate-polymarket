-- ============================================================
-- 03_trade.sql — place_bet, settle_market, void_market, verify_ledger
-- ============================================================
\set ON_ERROR_STOP on
\echo ''
\echo 'The trade path'

do $$
declare
  v_gm uuid; v_a uuid; v_b uuid;
  v_tour uuid; v_mkt uuid; v_res jsonb;
  v_shares numeric; v_bal numeric; v_p numeric[]; v_n int;
begin
  insert into tournaments (name, slug, is_active) values ('Test Open','test',true)
    returning id into v_tour;

  v_gm := t.mkuser('Thomas', 'game_maker');
  v_a  := t.mkuser('Ivan');
  v_b  := t.mkuser('Maria');

  perform t.as_user(v_gm);
  v_mkt := create_market(v_tour, 'room', 'R1 Aula 1 — the call',
    'Which bench takes the 1st, per the call announced by the chair and recorded on the ballot.',
    '[{"label":"OG","color":"#C8853A"},{"label":"OO","color":"#3E7A9A"},
      {"label":"CG","color":"#F0C48A"},{"label":"CO","color":"#93BFD6"}]'::jsonb,
    300, 'room');

  ---------------- opens flat ----------------
  v_p := lmsr_prices(v_mkt);
  perform t.close(1.0/v_p[1]::double precision, 4.0, 1e-9,
    'a new 4-way market with use_elo off opens at ×4.00');

  ---------------- a back ----------------
  perform t.as_user(v_a);
  v_res := place_bet(v_mkt, 0, 25);
  v_shares := (v_res->>'shares')::numeric;
  perform t.close(v_shares::double precision, 89.501176, 1e-4,
    'place_bet(stake 25) returns the §3 share count 89.501176');
  select balance into v_bal from profiles where id = v_a;
  perform t.close(v_bal::double precision, 975.0, 1e-9,
    '  └─ and takes exactly the stake from the balance');
  select shares into v_shares from positions p
    join market_outcomes mo on mo.id = p.outcome_id
   where p.profile_id = v_a and mo.market_id = v_mkt and mo.idx = 0;
  perform t.close(v_shares::double precision, 89.501176, 1e-4,
    '  └─ and the position records the shares');
  v_p := lmsr_prices(v_mkt);
  perform t.close(v_p[1]::double precision, 0.31, 1e-4,
    '  └─ and the price moved 25 → ~0.31 (a/b ≈ 7 points, as §3 calibrates)');

  ---------------- effective odds are recorded ----------------
  select effective_odds into v_bal from bets
   where profile_id = v_a and market_id = v_mkt order by id desc limit 1;
  perform t.close(v_bal::double precision, 89.501176/25, 1e-4,
    'the ledger records effective odds (shares / stake), not the headline');

  ---------------- round trip ----------------
  perform t.as_user(v_b);
  perform place_bet(v_mkt, 2, 40);
  select shares into v_shares from positions p
    join market_outcomes mo on mo.id = p.outcome_id
   where p.profile_id = v_b and mo.market_id = v_mkt and mo.idx = 2;
  perform place_bet(v_mkt, 2, null, v_shares);
  select balance into v_bal from profiles where id = v_b;
  -- q and shares are stored as numeric(18,6), so the exact 1e-9 identity of the
  -- pure module becomes 1e-6 once it has been through the database.
  perform t.close(v_bal::double precision, 1000.0, 1e-6,
    'buy then immediately cash out returns the exact stake (±1e-6 after numeric(18,6) storage)');

  ---------------- validation ----------------
  perform t.as_user(v_a);
  perform t.raises(format('select place_bet(%L, 0, 100000)', v_mkt),
    'insufficient_balance', 'a stake beyond the balance is refused');
  perform t.raises(format('select place_bet(%L, 9, 10)', v_mkt),
    'bad_outcome_index', 'an out-of-range outcome index is refused');
  perform t.raises(format('select place_bet(%L, 0, -5)', v_mkt),
    'bad_stake', 'a negative stake is refused');
  perform t.raises(format('select place_bet(%L, 0, null, -3)', v_mkt),
    'bad_share_count', 'a negative share count is refused');
  perform t.raises(format('select place_bet(%L, 1, null, 500)', v_mkt),
    'insufficient_shares', 'cashing out shares you do not hold is refused');

  ---------------- idempotency ----------------
  select count(*) into v_n from bets where profile_id = v_a and market_id = v_mkt;
  perform place_bet(v_mkt, 1, 10, null, 'idem-key-1');
  v_res := place_bet(v_mkt, 1, 10, null, 'idem-key-1');
  perform t.ok((v_res->>'replayed')::boolean, 'replaying an idempotency key returns the original result');
  perform t.ok((select count(*) from bets where profile_id = v_a and market_id = v_mkt) = v_n + 1,
    '  └─ and creates exactly one bet, not two');

  ---------------- closed market ----------------
  perform t.as_user(v_gm);
  perform update_market(v_mkt, p_status => 'closed');
  perform t.as_user(v_a);
  perform t.raises(format('select place_bet(%L, 0, 10)', v_mkt),
    'market_not_open', 'a closed market refuses bets');
  perform t.as_user(v_gm);
  perform update_market(v_mkt, p_status => 'open');

  perform assert_ledger_ok();
  raise notice '  ok    verify_ledger() passes after that sequence';
end $$;

\echo ''
\echo 'Settlement'
do $$
declare v_gm uuid; v_a uuid; v_tour uuid; v_mkt uuid;
        v_res jsonb; v_bal numeric; v_sh numeric; v_cp numeric[];
begin
  select id into v_tour from tournaments where slug = 'test';
  select id into v_gm from profiles where display_name = 'Thomas';
  select id into v_a  from profiles where display_name = 'Ivan';

  perform t.as_user(v_gm);
  v_mkt := create_market(v_tour, 'custom', 'Will the PM take a POI in the first two minutes?',
    'Resolves Yes if the Prime Minister accepts a point of information before the two-minute mark. Thomas resolves.',
    '[{"label":"Yes","color":"#7FD4A8"},{"label":"No","color":"#E4707A"}]'::jsonb, 250);

  perform t.as_user(v_a);
  select balance into v_bal from profiles where id = v_a;
  perform place_bet(v_mkt, 0, 50);
  select shares into v_sh from positions p join market_outcomes mo on mo.id = p.outcome_id
   where p.profile_id = v_a and mo.market_id = v_mkt and mo.idx = 0;

  perform t.as_user(v_gm);
  v_res := settle_market(v_mkt, 0);
  perform t.close((v_res->>'paid')::double precision, v_sh::double precision, 1e-6,
    'settling pays exactly 1 biser per winning share');
  perform t.close((select balance from profiles where id = v_a)::double precision,
                  (v_bal - 50 + v_sh)::double precision, 1e-6,
    '  └─ and the winner''s balance reflects it');
  perform t.ok((select coalesce(sum(shares),0) from positions p
                 join market_outcomes mo on mo.id = p.outcome_id
                where mo.market_id = v_mkt) = 0,
    '  └─ and every position on the market is cleared');
  select close_prices into v_cp from markets where id = v_mkt;
  perform t.ok(v_cp is not null and array_length(v_cp,1) = 2,
    '  └─ and close_prices is snapshotted for scoring');
  perform t.raises(format('select settle_market(%L, 1)', v_mkt),
    'already_settled', 'settling twice is refused');
  perform assert_ledger_ok();
  raise notice '  ok    verify_ledger() passes after settlement';
end $$;

\echo ''
\echo 'Void — refunds NET stake, not starting balance and not market value'
do $$
declare v_gm uuid; v_a uuid; v_tour uuid; v_mkt uuid;
        v_before numeric; v_after numeric; v_sh numeric; v_out numeric;
        v_mv numeric; v_refund numeric;
begin
  select id into v_tour from tournaments where slug = 'test';
  select id into v_gm from profiles where display_name = 'Thomas';
  select id into v_a  from profiles where display_name = 'Maria';

  perform t.as_user(v_gm);
  v_mkt := create_market(v_tour, 'round', 'R2 — motion category',
    'The category the CA team assigns on release. Ambiguity voids.',
    '[{"label":"Economics","color":"#C8853A"},{"label":"IR","color":"#3E7A9A"},
      {"label":"Politics","color":"#F0C48A"}]'::jsonb, 300);

  perform t.as_user(v_a);
  select balance into v_before from profiles where id = v_a;
  -- The brief's own worked example: buy for 40, cash out half, expect 15 back.
  perform place_bet(v_mkt, 0, 40);
  select shares into v_sh from positions p join market_outcomes mo on mo.id = p.outcome_id
   where p.profile_id = v_a and mo.market_id = v_mkt and mo.idx = 0;
  perform place_bet(v_mkt, 0, null, round(v_sh/2, 6));
  select -sum(amount) into v_out from bets
   where profile_id = v_a and market_id = v_mkt and kind in ('back','cash_out');

  -- What the market is worth to them right now, which is NOT what a void pays.
  select p.shares * (lmsr_prices(v_mkt))[mo.idx + 1] into v_mv
    from positions p join market_outcomes mo on mo.id = p.outcome_id
   where p.profile_id = v_a and mo.market_id = v_mkt and mo.idx = 0;

  perform t.as_user(v_gm);
  perform void_market(v_mkt, 'test void');
  select balance into v_after from profiles where id = v_a;

  select amount into v_refund from bets
   where profile_id = v_a and market_id = v_mkt and kind = 'refund';
  perform t.close(v_refund::double precision, v_out::double precision, 1e-6,
    format('void refunds the NET %s staked (40 in, %s cashed out)',
           round(v_out,4), round(40 - v_out,4)));
  perform t.ok(abs(v_refund - v_mv) > 1,
    format('  └─ and NOT the position''s market value (%s)', round(v_mv,4)));
  perform t.close(v_after::double precision, v_before::double precision, 1e-6,
    '  └─ leaving the trader exactly where they started, without a payout');
  perform t.ok((select status from markets where id = v_mkt) = 'void',
    '  └─ and the market reads void');
  perform t.close((select balance_after from bets
                    where profile_id = v_a and market_id = v_mkt and kind = 'refund')::double precision,
                  v_after::double precision, 1e-6,
    '  └─ and the ledger''s balance_after is the post-refund balance');
  perform assert_ledger_ok();
  raise notice '  ok    verify_ledger() passes after a void';
end $$;

\echo ''
\echo 'Changing b on a live market'
do $$
declare v_gm uuid; v_tour uuid; v_mkt uuid; v_p0 numeric[]; v_p1 numeric[]; i int;
begin
  select id into v_tour from tournaments where slug = 'test';
  select id into v_gm from profiles where display_name = 'Thomas';
  perform t.as_user(v_gm);
  v_mkt := create_market(v_tour, 'custom', 'b change', 'rule',
    '[{"label":"A","color":"#111"},{"label":"B","color":"#222"},{"label":"C","color":"#333"}]'::jsonb, 300);
  perform t.as_user((select id from profiles where display_name = 'Ivan'));
  perform place_bet(v_mkt, 1, 60);
  v_p0 := lmsr_prices(v_mkt);
  perform t.as_user(v_gm);
  perform update_market(v_mkt, p_b => 120);
  v_p1 := lmsr_prices(v_mkt);
  for i in 1 .. 3 loop
    perform t.close(v_p1[i]::double precision, v_p0[i]::double precision, 1e-6,
      format('changing b re-derives q and holds price %s constant', i));
  end loop;
  perform t.ok((select b from markets where id = v_mkt) = 120, '  └─ and b really changed');
end $$;
