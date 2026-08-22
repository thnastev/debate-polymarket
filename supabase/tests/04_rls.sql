-- ============================================================
-- 04_rls.sql — §13: "A trader cannot, via the browser console with a valid
-- session, read another trader's positions, alter any balance, insert a bet
-- row directly, or create a market."
--
-- Every block below runs as the `authenticated` role with a real
-- request.jwt.claim.sub, which is exactly what a browser console has. The
-- setup runs as the owner, which bypasses RLS — that is the only part of this
-- file a trader could not do.
-- ============================================================
\set ON_ERROR_STOP on
\echo ''
\echo 'Row Level Security'

-- ---------- fixture, as owner ----------
do $$
declare v_tour uuid; v_gm uuid; v_a uuid; v_b uuid; v_mkt uuid; v_draft uuid;
begin
  insert into tournaments (name, slug, is_active) values ('RLS Open','rls',true)
    returning id into v_tour;
  v_gm := t.mkuser('Maker', 'game_maker');
  v_a  := t.mkuser('Alice');
  v_b  := t.mkuser('Bob');

  perform t.as_user(v_gm);
  v_mkt := create_market(v_tour,'custom','Public market','rule',
    '[{"label":"Yes","color":"#7FD4A8"},{"label":"No","color":"#E4707A"}]'::jsonb, 300);
  v_draft := create_market(v_tour,'custom','Draft market','rule',
    '[{"label":"Yes","color":"#7FD4A8"},{"label":"No","color":"#E4707A"}]'::jsonb,
    300,'list','Game maker',null,false,null,null,null,null,'draft');

  perform t.as_user(v_a); perform place_bet(v_mkt, 0, 30);
  perform t.as_user(v_b); perform place_bet(v_mkt, 1, 45);

  -- stash the ids for the role-switched blocks below
  delete from t.fx;
  insert into t.fx values ('tour',v_tour),('gm',v_gm),('a',v_a),('b',v_b),
                          ('mkt',v_mkt),('draft',v_draft);
end $$;

-- ---------- as a trader ----------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select v::text from t.fx where k='a'), true);

do $$
declare v_a uuid; v_b uuid; v_mkt uuid; v_draft uuid; v_n int; v_oc uuid;
begin
  select v into v_a from t.fx where k='a';
  select v into v_b from t.fx where k='b';
  select v into v_mkt from t.fx where k='mkt';
  select v into v_draft from t.fx where k='draft';
  select id into v_oc from market_outcomes where market_id=v_mkt and idx=0;

  ---------------- reading ----------------
  perform t.ok((select count(*) from profiles) = 1,
    'a trader sees exactly one profile row — their own');
  perform t.ok((select count(*) from profiles where id = v_b) = 0,
    '  └─ and cannot read another trader''s profile at all');

  perform t.ok((select count(*) from positions where profile_id = v_b) = 0,
    'a trader cannot read another trader''s positions');
  perform t.ok((select count(*) from positions where profile_id = v_a) > 0,
    '  └─ but can read their own');

  perform t.ok((select count(*) from bets where profile_id = v_b) = 0,
    'a trader cannot read another trader''s bets');
  perform t.ok((select count(*) from bets where profile_id = v_a) > 0,
    '  └─ but can read their own');

  perform t.ok((select count(*) from markets where id = v_draft) = 0,
    'a trader cannot see a draft market');
  perform t.ok((select count(*) from markets where id = v_mkt) = 1,
    '  └─ but can see an open one');
  perform t.ok((select count(*) from admin_log) = 0,
    'a trader cannot read the admin log');

  ---------------- writing ----------------
  perform t.raises(format('update profiles set balance = 999999 where id = %L', v_a),
    'permission denied', 'a trader cannot alter their own balance');
  perform t.raises(format('update profiles set role = ''game_maker'' where id = %L', v_a),
    'permission denied', 'a trader cannot promote themselves to game maker');
  perform t.raises(format('update profiles set is_approved = true where id = %L', v_a),
    'permission denied', 'a trader cannot approve their own account');

  perform t.raises(
    format('insert into bets (profile_id, market_id, kind, amount, balance_after)
            values (%L, %L, ''grant'', 1000000, 1000000)', v_a, v_mkt),
    'permission denied', 'a trader cannot insert a bet row directly');
  perform t.raises(format('delete from bets where profile_id = %L', v_a),
    'permission denied', 'a trader cannot delete from the append-only ledger');
  perform t.raises(
    format('insert into positions (profile_id, outcome_id, shares) values (%L, %L, 1e6)', v_a, v_oc),
    'permission denied', 'a trader cannot mint themselves a position');
  -- RLS filters an UPDATE's rows via USING rather than raising, so the check
  -- that matters is that nothing moved — not that an error came back.
  declare v_q0 numeric; v_rows int;
  begin
    select q into v_q0 from market_outcomes where id = v_oc;
    update market_outcomes set q = 0 where id = v_oc;
    get diagnostics v_rows = row_count;
    perform t.ok(v_rows = 0 and (select q from market_outcomes where id = v_oc) = v_q0,
      'a trader cannot move q directly (0 rows affected, q unchanged)');
    delete from market_outcomes where id = v_oc;
    get diagnostics v_rows = row_count;
    perform t.ok(v_rows = 0 and exists (select 1 from market_outcomes where id = v_oc),
      '  └─ nor delete an outcome out from under a market');
    update markets set status = 'void' where id = v_mkt;
    get diagnostics v_rows = row_count;
    perform t.ok(v_rows = 0 and (select status from markets where id = v_mkt) = 'open',
      '  └─ nor close, void or resolve a market by hand');
  end;
  perform t.raises(
    'insert into markets (tournament_id, scope, title, resolution_rule)
       select id, ''custom'', ''Mine'', ''mine'' from tournaments limit 1',
    'row-level security', 'a trader cannot create a market');

  ---------------- privileged RPCs ----------------
  perform t.raises(format('select settle_market(%L, 0)', v_mkt),
    'forbidden_not_game_maker', 'a trader cannot settle a market');
  perform t.raises(format('select void_market(%L, ''mine'')', v_mkt),
    'forbidden_not_game_maker', 'a trader cannot void a market');
  perform t.raises(format('select adjust_balance(%L, 5000, ''mine'')', v_a),
    'forbidden_not_game_maker', 'a trader cannot adjust a balance');
  perform t.raises(format('select set_profile_flags(%L, p_role => ''game_maker'')', v_a),
    'forbidden_not_game_maker', 'a trader cannot promote anyone');
  perform t.raises(format('select update_market(%L, p_b => 1)', v_mkt),
    'forbidden_not_game_maker', 'a trader cannot re-price a market');

  ---------------- what a trader CAN do ----------------
  update profiles set display_name = 'Alice B' where id = v_a;
  perform t.ok((select display_name from profiles where id = v_a) = 'Alice B',
    'a trader CAN change their own display name');
  perform t.ok((select count(*) from leaderboard) >= 3,
    'a trader CAN read the leaderboard view (totals only, no positions)');
  perform t.ok((select count(*) from public_trades where market_id = v_mkt) = 2,
    'a trader CAN read the public trade log');
end $$;
rollback;

-- ---------- as the game maker ----------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select v::text from t.fx where k='gm'), true);

do $$
declare v_gm uuid; v_a uuid; v_mkt uuid; v_draft uuid; v_new uuid; v_tour uuid;
begin
  select v into v_gm from t.fx where k='gm';
  select v into v_a from t.fx where k='a';
  select v into v_mkt from t.fx where k='mkt';
  select v into v_draft from t.fx where k='draft';
  select v into v_tour from t.fx where k='tour';

  perform t.ok((select count(*) from profiles) >= 3, 'the game maker sees every profile');
  perform t.ok((select count(*) from positions) >= 2, 'the game maker sees every position');
  perform t.ok((select count(*) from bets) >= 2, 'the game maker sees every bet');
  perform t.ok((select count(*) from markets where id = v_draft) = 1,
    'the game maker sees draft markets');
  perform t.ok((select count(*) from admin_log) > 0, 'the game maker reads the admin log');

  v_new := create_market(v_tour,'custom','Made by the maker','rule',
    '[{"label":"A","color":"#111"},{"label":"B","color":"#222"}]'::jsonb, 300);
  perform t.ok(v_new is not null, 'the game maker can create a market');
  perform update_market(v_new, p_title => 'Renamed');
  perform t.ok((select title from markets where id = v_new) = 'Renamed',
    '  └─ and edit it');
  perform adjust_balance(v_a, 250, 'test grant');
  perform t.ok((select balance from profiles where id = v_a) > 900,
    'the game maker can adjust a balance');
  perform t.ok((select count(*) from bets where profile_id = v_a and kind = 'adjust') = 1,
    '  └─ and the adjustment lands in the ledger, so verify_ledger keeps passing');
  perform assert_ledger_ok();
  raise notice '  ok    verify_ledger() passes after an admin adjustment';
  perform settle_market(v_new, 0);
  perform t.ok((select status from markets where id = v_new) = 'resolved',
    'the game maker can settle');
end $$;
rollback;

-- ---------- an unauthenticated caller ----------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);
do $$
declare v_mkt uuid;
begin
  select v into v_mkt from t.fx where k='mkt';
  perform t.raises(format('select place_bet(%L, 0, 10)', v_mkt),
    'not_authenticated', 'a session with no user cannot trade');
  perform t.ok((select count(*) from profiles) = 0,
    '  └─ and sees no profiles at all');
end $$;
rollback;
