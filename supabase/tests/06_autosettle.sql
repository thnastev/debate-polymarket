-- ============================================================
-- 06_autosettle.sql — §8's auto-settlement rules, which are all refusals.
-- ============================================================
\set ON_ERROR_STOP on
\echo ''
\echo 'Auto-settlement guards'

do $$
declare
  v_tour uuid; v_gm uuid; v_a uuid; v_sys uuid := '00000000-0000-4000-8000-000000000001';
  v_call uuid; v_custom uuid; v_top uuid; v_n int;
begin
  insert into tournaments (name, slug, is_active, auto_settle_enabled)
    values ('Auto Open','auto',true,false) returning id into v_tour;
  v_gm := t.mkuser('Auto GM','game_maker');
  v_a  := t.mkuser('Auto Trader');

  perform t.as_user(v_gm);
  v_call := create_market(v_tour,'room','R1 Aula 1 — the call','Which bench takes the 1st.',
    '[{"label":"OG","color":"#C8853A"},{"label":"OO","color":"#3E7A9A"},
      {"label":"CG","color":"#F0C48A"},{"label":"CO","color":"#93BFD6"}]'::jsonb,
    300,'room','CA team',null,false,null,null,'room.call');
  v_top := create_market(v_tour,'room','Top speaker in the room','Highest individual score.',
    '[{"label":"A","color":"#111"},{"label":"B","color":"#222"}]'::jsonb,
    300,'list','CA team',null,false,null,null,'room.top_speaker');
  v_custom := create_market(v_tour,'custom','Will the PM take a POI?','Thomas resolves.',
    '[{"label":"Yes","color":"#7FD4A8"},{"label":"No","color":"#E4707A"}]'::jsonb, 250);

  perform t.as_user(v_a);
  perform place_bet(v_call, 0, 40);
  perform place_bet(v_custom, 0, 20);

  ---------------- the default is OFF ----------------
  perform t.raises(format('select settle_market_as_system(%L, 0, %L)', v_call, v_sys),
    'auto_settle_disabled',
    'auto-settle is off by default, so even a whitelisted market is refused');

  update tournaments set auto_settle_enabled = true where id = v_tour;

  ---------------- never a custom market ----------------
  perform t.raises(format('select settle_market_as_system(%L, 0, %L)', v_custom, v_sys),
    'never_auto_settle_custom',
    'a custom market is never auto-settled, even with auto-settle on');

  ---------------- only whitelisted templates ----------------
  perform t.raises(format('select settle_market_as_system(%L, 0, %L)', v_top, v_sys),
    'not_machine_resolvable',
    'room.top_speaker is not machine-resolvable and is refused');

  ---------------- the whitelisted case works ----------------
  perform settle_market_as_system(v_call, 0, v_sys);
  perform t.ok((select status from markets where id = v_call) = 'resolved',
    'room.call IS auto-settled once auto-settle is on');
  perform t.ok((select actor_id from admin_log
                 where market_id = v_call and action = 'settle') = v_sys,
    '  └─ and admin_log records the system profile, not a person');
  perform t.ok((select note from bets where market_id = v_call and kind = 'settle' limit 1)
                 = 'auto-settled from the tab',
    '  └─ and the ledger says the settlement was automated');
  perform assert_ledger_ok();
  raise notice '  ok    verify_ledger() passes after an automated settlement';

  ---------------- settling twice ----------------
  perform t.raises(format('select settle_market_as_system(%L, 1, %L)', v_call, v_sys),
    'already_settled', 'a contradicting second settlement is refused');
end $$;

-- A trader with a valid session must not be able to reach the system path.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from profiles where display_name='Auto Trader'), true);
do $$
declare v_m uuid;
begin
  select id into v_m from markets where template_key = 'room.top_speaker' limit 1;
  perform t.raises(
    format('select settle_market_as_system(%L, 0, %L)', v_m, '00000000-0000-4000-8000-000000000001'),
    'permission denied',
    'a trader cannot call the system settle path at all');
end $$;
rollback;

\echo ''
\echo 'The system profile'
do $$
declare v_sys uuid := '00000000-0000-4000-8000-000000000001';
begin
  perform t.ok((select balance from profiles where id = v_sys) = 0,
    'the tab poller holds no bisers');
  perform t.ok(not (select is_active from profiles where id = v_sys),
    '  └─ is suspended, so it can never trade');
  perform t.ok((select count(*) from leaderboard where id = v_sys) = 0,
    '  └─ and never appears on the leaderboard');
end $$;
