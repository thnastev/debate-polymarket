-- ============================================================
-- 07_elo_seeding.sql — §13: "With use_elo = true and a loaded ledger, the same
-- market opens at ratings-implied odds", and its counterpart, that with Elo off
-- a 4-way market opens at exactly ×4.00 on every outcome.
-- ============================================================
\set ON_ERROR_STOP on
\echo ''
\echo 'Opening odds'

do $$
declare
  v_tour uuid; v_gm uuid; v_flat uuid; v_seeded uuid;
  v_p numeric[]; v_prior numeric[]; i int;
begin
  insert into tournaments (name, slug, is_active, use_elo)
    values ('Elo Open','elo',true,true) returning id into v_tour;
  v_gm := t.mkuser('Elo GM','game_maker');
  perform t.as_user(v_gm);

  ---------------- Elo off: the first-class uniform mode ----------------
  v_flat := create_market(v_tour,'room','Unseeded call','Which bench takes the 1st.',
    '[{"label":"OG","color":"#C8853A"},{"label":"OO","color":"#3E7A9A"},
      {"label":"CG","color":"#F0C48A"},{"label":"CO","color":"#93BFD6"}]'::jsonb,
    300,'room');
  v_p := lmsr_prices(v_flat);
  for i in 1 .. 4 loop
    perform t.close(1.0 / v_p[i]::double precision, 4.0, 1e-9,
      format('with no prior, outcome %s opens at exactly ×4.00', i - 1));
  end loop;
  perform t.ok(not (select seeded_from_elo from markets where id = v_flat),
    '  └─ and the market is not marked Elo-seeded');
  perform t.ok((select prior from markets where id = v_flat) is not null,
    '  └─ but still records its uniform prior, so scoring can compare against it');

  ---------------- Elo on: ratings-implied odds ----------------
  -- A prior the Monte Carlo might produce for a room with one clear favourite.
  v_prior := array[0.55, 0.20, 0.15, 0.10]::numeric[];
  v_seeded := create_market(v_tour,'room','Seeded call','Which bench takes the 1st.',
    '[{"label":"OG","color":"#C8853A"},{"label":"OO","color":"#3E7A9A"},
      {"label":"CG","color":"#F0C48A"},{"label":"CO","color":"#93BFD6"}]'::jsonb,
    300,'room','CA team', v_prior, true);

  v_p := lmsr_prices(v_seeded);
  for i in 1 .. 4 loop
    perform t.close(v_p[i]::double precision, v_prior[i]::double precision, 1e-6,
      format('a seeded market opens at the ratings-implied price for outcome %s', i - 1));
  end loop;
  perform t.close(1.0 / v_p[1]::double precision, 1.0/0.55, 1e-6,
    '  └─ the favourite opens at ×1.82, not ×4.00');
  perform t.close(1.0 / v_p[4]::double precision, 10.0, 1e-6,
    '  └─ and the outsider at ×10.00');
  perform t.ok((select seeded_from_elo from markets where id = v_seeded),
    '  └─ the market is marked Elo-seeded, so the chart draws the dotted prior');
  perform t.ok((select prior from markets where id = v_seeded) is not null,
    '  └─ and the prior is stored for the Brier / log-score comparison');

  ---------------- q is stored, prices are derived ----------------
  perform t.close(
    (select q from market_outcomes where market_id = v_seeded and idx = 0)::double precision,
    301.1724, 1e-3,
    '  └─ q is seeded by qFromPrior, matching the §3 vector');

  ---------------- a bad prior is ignored rather than half-applied ----------------
  v_seeded := create_market(v_tour,'custom','Wrong-length prior','rule',
    '[{"label":"A","color":"#111"},{"label":"B","color":"#222"}]'::jsonb,
    300,'list','Game maker', array[0.5,0.3,0.2]::numeric[], true);
  v_p := lmsr_prices(v_seeded);
  perform t.close(v_p[1]::double precision, 0.5, 1e-9,
    'a prior whose length does not match the outcomes falls back to uniform');
end $$;
