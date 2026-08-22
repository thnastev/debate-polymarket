-- ============================================================
-- 05_antiabuse.sql — §10
-- ============================================================
\set ON_ERROR_STOP on
\echo ''
\echo 'Anti-abuse'

do $$
declare
  v_tour uuid; v_gm uuid; v_judge uuid; v_deb uuid; v_out uuid;
  v_round uuid; v_debate uuid; v_og uuid; v_oo uuid; v_mkt uuid; v_free uuid;
  i int;
begin
  insert into tournaments (name, slug, is_active, self_bet_policy)
    values ('Abuse Open','abuse',true,'block') returning id into v_tour;

  insert into tab_teams (tournament_id, tab_id, name, speakers, speaker_names)
    values (v_tour,'t1','Sofia A', array['sp-101','sp-102'], array['Ivan Georgiev','Mila Petrova'])
    returning id into v_og;
  insert into tab_teams (tournament_id, tab_id, name, speakers, speaker_names)
    values (v_tour,'t2','Sofia B', array['sp-201','sp-202'], array['Boris Marinov','Elena Todorova'])
    returning id into v_oo;

  insert into tab_rounds (tournament_id, seq, name, draw_released)
    values (v_tour, 1, 'Round 1', true) returning id into v_round;
  insert into tab_debates (round_id, tab_id, venue, team_ids, adjudicator_ids)
    values (v_round,'d1','Aula 1', array[v_og,v_oo,v_og,v_oo], array['adj-7','adj-9'])
    returning id into v_debate;

  v_gm    := t.mkuser('Abuse GM', 'game_maker');
  v_judge := t.mkuser('Judge');
  v_deb   := t.mkuser('Debater');
  v_out   := t.mkuser('Spectator');
  update profiles set tab_adj_id = 'adj-7' where id = v_judge;
  update profiles set tab_speaker_id = 'sp-102' where id = v_deb;

  perform t.as_user(v_gm);
  v_mkt := create_market(v_tour,'room','R1 Aula 1 — the call',
    'Which bench takes the 1st.',
    '[{"label":"OG","color":"#C8853A"},{"label":"OO","color":"#3E7A9A"},
      {"label":"CG","color":"#F0C48A"},{"label":"CO","color":"#93BFD6"}]'::jsonb,
    300,'room','CA team',null,false,v_round,v_debate,'room.call');
  v_free := create_market(v_tour,'tournament','Tournament winner','The Grand Final call.',
    '[{"label":"Sofia A","color":"#C8853A"},{"label":"Sofia B","color":"#3E7A9A"}]'::jsonb, 300);

  ---------------- judges ----------------
  perform t.as_user(v_judge);
  perform t.raises(format('select place_bet(%L, 0, 10)', v_mkt),
    'judge_cannot_bet_on_own_room',
    'a judge is blocked from betting on a room they adjudicate');
  perform place_bet(v_free, 0, 10);
  perform t.ok(true, '  └─ but can bet on a market not attached to that debate');

  ---------------- debaters, policy = block ----------------
  perform t.as_user(v_deb);
  perform t.raises(format('select place_bet(%L, 0, 10)', v_mkt),
    'debater_cannot_bet_on_own_room',
    'under self_bet_policy = block a debater cannot bet on their own room');

  ---------------- debaters, policy = tag ----------------
  update tournaments set self_bet_policy = 'tag' where id = v_tour;
  perform place_bet(v_mkt, 0, 10);
  perform t.ok(true, 'under self_bet_policy = tag the same bet is allowed');
  perform t.ok((select note like 'self-bet%' from bets
                 where profile_id = v_deb and market_id = v_mkt order by id desc limit 1),
    '  └─ and the ledger records it as a self-bet');
  perform t.ok((select self_bet from public_trades
                 where market_id = v_mkt order by id desc limit 1),
    '  └─ and the marker shows publicly in the trade log');
  update tournaments set self_bet_policy = 'block' where id = v_tour;

  ---------------- unrelated traders ----------------
  perform t.as_user(v_out);
  perform place_bet(v_mkt, 1, 10);
  perform t.ok(true, 'a spectator with no tab identity bets freely');

  ---------------- approval gate ----------------
  update profiles set is_approved = false where id = v_out;
  perform t.raises(format('select place_bet(%L, 1, 10)', v_mkt),
    'account_not_approved', 'an unapproved account cannot trade');
  update profiles set is_approved = true where id = v_out;

  ---------------- suspension ----------------
  update profiles set is_active = false where id = v_out;
  perform t.raises(format('select place_bet(%L, 1, 10)', v_mkt),
    'account_suspended', 'a suspended account cannot trade');
  update profiles set is_active = true where id = v_out;

  ---------------- rate limit ----------------
  for i in 1 .. 29 loop perform place_bet(v_mkt, 1, 1); end loop;
  perform t.raises(format('select place_bet(%L, 1, 1)', v_mkt),
    'rate_limited', 'the 31st bet in a minute is refused (30/min cap)');

  perform assert_ledger_ok();
  raise notice '  ok    verify_ledger() passes after the anti-abuse sequence';
end $$;
