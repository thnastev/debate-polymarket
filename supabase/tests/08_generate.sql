-- ============================================================
-- 08_generate.sql — "Import draw & make the markets", pressed twice.
--
-- The one-press import is only safe if re-running it is a no-op for markets
-- that already exist. That guarantee is the unique index on
-- (tournament_id, template_key, coalesce(debate_id, round_id, tournament_id)),
-- and this is the test of it: a redraw must add the new rooms and leave the
-- existing markets, and their prices, completely alone.
-- ============================================================
\set ON_ERROR_STOP on
\echo ''
\echo 'Generating markets from a draw'

do $$
declare
  v_tour uuid; v_gm uuid; v_trader uuid; v_round uuid; v_round2 uuid;
  v_og uuid; v_oo uuid; v_cg uuid; v_co uuid; v_extra uuid;
  v_d1 uuid; v_d2 uuid; v_d3 uuid;
  v_before int; v_after int; v_dupes int; v_q numeric;
  v_call uuid;
begin
  insert into tournaments (name, slug, is_active) values ('Gen Open','gen',true)
    returning id into v_tour;
  v_gm := t.mkuser('Gen GM','game_maker');
  v_trader := t.mkuser('Gen Trader');

  insert into tab_teams (tournament_id, tab_id, name, speakers, speaker_names) values
    (v_tour,'1','Sofia A',array['s1','s2'],array['Ivan G','Mila P']) returning id into v_og;
  insert into tab_teams (tournament_id, tab_id, name, speakers, speaker_names) values
    (v_tour,'2','Sofia B',array['s3','s4'],array['Boris M','Elena T']) returning id into v_oo;
  insert into tab_teams (tournament_id, tab_id, name, speakers, speaker_names) values
    (v_tour,'3','NBU 1',array['s5','s6'],array['Nikola D','Stefani I']) returning id into v_cg;
  insert into tab_teams (tournament_id, tab_id, name, speakers, speaker_names) values
    (v_tour,'4','Varna 1',array['s7','s8'],array['Sava P','Kosta B']) returning id into v_co;
  insert into tab_teams (tournament_id, tab_id, name, speakers, speaker_names, is_swing) values
    (v_tour,'9','Swing 1',array['s9','s10'],array['Swing A','Swing B'],true) returning id into v_extra;

  insert into tab_rounds (tournament_id, seq, name, draw_released)
    values (v_tour,1,'Round 1',true) returning id into v_round;
  insert into tab_debates (round_id, tab_id, venue, team_ids, adjudicator_ids)
    values (v_round,'d1','Aula 1',array[v_og,v_oo,v_cg,v_co],array['a1'])
    returning id into v_d1;
  insert into tab_debates (round_id, tab_id, venue, team_ids, adjudicator_ids)
    values (v_round,'d2','Aula 2',array[v_co,v_cg,v_oo,v_og],array['a2'])
    returning id into v_d2;

  perform t.as_user(v_gm);

  -- What the one-press import does: the launch set per room, per round, and
  -- for the tournament.
  v_call := create_market(v_tour,'room','Round 1 · Aula 1 — The call','Which bench takes the 1st.',
    '[{"label":"OG","color":"#C8853A"},{"label":"OO","color":"#3E7A9A"},
      {"label":"CG","color":"#F0C48A"},{"label":"CO","color":"#93BFD6"}]'::jsonb,
    300,'room','Game maker',null,false,v_round,v_d1,'room.call');
  perform create_market(v_tour,'room','Round 1 · Aula 2 — The call','Which bench takes the 1st.',
    '[{"label":"OG","color":"#C8853A"},{"label":"OO","color":"#3E7A9A"},
      {"label":"CG","color":"#F0C48A"},{"label":"CO","color":"#93BFD6"}]'::jsonb,
    300,'room','Game maker',null,false,v_round,v_d2,'room.call');
  perform create_market(v_tour,'round','Round 1 — motion category','The category the CA team assigns.',
    '[{"label":"Economics","color":"#111"},{"label":"IR","color":"#222"},{"label":"Politics","color":"#333"}]'::jsonb,
    300,'list','Game maker',null,false,v_round,null,'round.motion_category');
  perform create_market(v_tour,'tournament','Tournament winner','The Grand Final call.',
    '[{"label":"Sofia A","color":"#111"},{"label":"Sofia B","color":"#222"}]'::jsonb,
    300,'list','Game maker',null,false,null,null,'tournament.winner');

  select count(*) into v_before from markets where tournament_id = v_tour;
  perform t.ok(v_before = 4, format('a two-room draw generates 4 markets (%s)', v_before));
  perform t.ok((select count(*) from markets where template_key='room.call' and tournament_id=v_tour) = 2,
    '  └─ one "the call" per room, not one per round');

  -- Someone bets, so we can prove a re-import does not disturb a live market.
  perform t.as_user(v_trader);
  perform place_bet(v_call, 0, 60);
  select q into v_q from market_outcomes where market_id = v_call and idx = 0;
  perform t.as_user(v_gm);

  ---------------- press it a second time ----------------
  v_dupes := 0;
  begin
    perform create_market(v_tour,'room','Round 1 · Aula 1 — The call','Which bench takes the 1st.',
      '[{"label":"OG","color":"#C8853A"},{"label":"OO","color":"#3E7A9A"},
        {"label":"CG","color":"#F0C48A"},{"label":"CO","color":"#93BFD6"}]'::jsonb,
      300,'room','Game maker',null,false,v_round,v_d1,'room.call');
  exception when unique_violation then v_dupes := v_dupes + 1;
  end;
  begin
    perform create_market(v_tour,'round','Round 1 — motion category','The category the CA team assigns.',
      '[{"label":"Economics","color":"#111"},{"label":"IR","color":"#222"},{"label":"Politics","color":"#333"}]'::jsonb,
      300,'list','Game maker',null,false,v_round,null,'round.motion_category');
  exception when unique_violation then v_dupes := v_dupes + 1;
  end;
  begin
    perform create_market(v_tour,'tournament','Tournament winner','The Grand Final call.',
      '[{"label":"Sofia A","color":"#111"},{"label":"Sofia B","color":"#222"}]'::jsonb,
      300,'list','Game maker',null,false,null,null,'tournament.winner');
  exception when unique_violation then v_dupes := v_dupes + 1;
  end;

  perform t.ok(v_dupes = 3, format('re-importing rejects all 3 duplicates (%s)', v_dupes));
  select count(*) into v_after from markets where tournament_id = v_tour;
  perform t.ok(v_after = v_before, format('  └─ and creates nothing twice (%s markets, was %s)', v_after, v_before));
  perform t.close((select q from market_outcomes where market_id = v_call and idx = 0)::double precision,
                  v_q::double precision, 1e-9,
    '  └─ and the live market''s prices are untouched');

  ---------------- a redraw adds only the new room ----------------
  insert into tab_debates (round_id, tab_id, venue, team_ids, adjudicator_ids)
    values (v_round,'d3','Aula 3',array[v_og,v_cg,v_oo,v_co],array['a3'])
    returning id into v_d3;
  perform create_market(v_tour,'room','Round 1 · Aula 3 — The call','Which bench takes the 1st.',
    '[{"label":"OG","color":"#C8853A"},{"label":"OO","color":"#3E7A9A"},
      {"label":"CG","color":"#F0C48A"},{"label":"CO","color":"#93BFD6"}]'::jsonb,
    300,'room','Game maker',null,false,v_round,v_d3,'room.call');
  perform t.ok((select count(*) from markets where tournament_id = v_tour) = v_before + 1,
    'a redraw adds the new room and only the new room');

  ---------------- a second round is separate ----------------
  insert into tab_rounds (tournament_id, seq, name, draw_released)
    values (v_tour,2,'Round 2',true) returning id into v_round2;
  perform create_market(v_tour,'round','Round 2 — motion category','The category the CA team assigns.',
    '[{"label":"Economics","color":"#111"},{"label":"IR","color":"#222"},{"label":"Politics","color":"#333"}]'::jsonb,
    300,'list','Game maker',null,false,v_round2,null,'round.motion_category');
  perform t.ok((select count(*) from markets where template_key='round.motion_category' and tournament_id=v_tour) = 2,
    'the same template in a different round is a different market');

  perform assert_ledger_ok();
  raise notice '  ok    verify_ledger() passes after generating and re-generating';
end $$;
