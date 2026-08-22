-- ============================================================
-- 02_lmsr_vectors.sql — the §3 test vectors, asserted from the database.
--
-- These are the same numbers src/lib/lmsr.test.ts asserts. Both
-- implementations must agree to 1e-6; that is the point of running them twice.
-- ============================================================
\set ON_ERROR_STOP on
\echo '§3 test vectors — SQL'

do $$
declare p double precision[]; q double precision[]; s double precision; c double precision;
begin
  ---------------- cost ----------------
  perform t.close(lmsr_cost(array[0,0,0,0]::double precision[], 50),
                  69.314718, 1e-6, 'C([0,0,0,0], b=50) = 69.314718');
  perform t.close(lmsr_cost(array[0,0,20,0]::double precision[], 50),
                  75.112951, 1e-6, 'C([0,0,20,0], b=50) = 75.112951');

  ---------------- trade cost ----------------
  perform t.close(lmsr_trade_cost(array[0,0,0,0]::double precision[], 50, 2, 20),
                  5.798232, 1e-6, 'tradeCost([0,0,0,0], 50, i=2, Δ=20) = 5.798232');
  perform t.close(lmsr_trade_cost(array[0,0,20,0]::double precision[], 50, 2, 30),
                  12.070468, 1e-6, 'tradeCost([0,0,20,0], 50, i=2, Δ=30) = 12.070468');

  ---------------- prices ----------------
  p := lmsr_prices_of(array[0,0,20,0]::double precision[], 50);
  perform t.close(p[1], 0.222627, 1e-6, 'prices([0,0,20,0], 50)[0] = 0.222627');
  perform t.close(p[2], 0.222627, 1e-6, 'prices([0,0,20,0], 50)[1] = 0.222627');
  perform t.close(p[3], 0.332120, 1e-6, 'prices([0,0,20,0], 50)[2] = 0.332120');
  perform t.close(p[4], 0.222627, 1e-6, 'prices([0,0,20,0], 50)[3] = 0.222627');

  p := lmsr_prices_of(array[0,0,50,0]::double precision[], 50);
  perform t.close(p[1], 0.174878, 1e-6, 'prices([0,0,50,0], 50)[0] = 0.174878');
  perform t.close(p[3], 0.475367, 1e-6, 'prices([0,0,50,0], 50)[2] = 0.475367');

  ---------------- shares for stake ----------------
  s := lmsr_shares_for_stake(array[0,0,20,0]::double precision[], 50, 2, 25);
  perform t.close(s, 54.145717, 1e-6, 'sharesForStake([0,0,20,0], 50, i=2, a=25) = 54.145717');
  perform t.close(lmsr_trade_cost(array[0,0,20,0]::double precision[], 50, 2, s),
                  25.0, 1e-9, '  └─ tradeCost(q, 50, 2, that) = 25.000000 (inverse consistency)');

  s := lmsr_shares_for_stake(array[0,0,0,0]::double precision[], 300, 0, 25);
  perform t.close(s, 89.501176, 1e-6, 'sharesForStake([0,0,0,0], 300, i=0, a=25) = 89.501176');
  p := lmsr_prices_of(array[s,0,0,0]::double precision[], 300);
  perform t.close(p[1], 0.3100, 1e-4, '  └─ prices after [0] = 0.3100');
  perform t.close(p[2], 0.2300, 1e-4, '  └─ prices after [1] = 0.2300');
  perform t.close(p[3], 0.2300, 1e-4, '  └─ prices after [2] = 0.2300');
  perform t.close(p[4], 0.2300, 1e-4, '  └─ prices after [3] = 0.2300');

  ---------------- q from prior ----------------
  q := lmsr_q_from_prior(array[0.55,0.20,0.15,0.10]::double precision[], 300);
  perform t.close(q[1],  301.1724, 1e-4, 'qFromPrior([.55,.20,.15,.10], 300)[0] =  301.1724');
  perform t.close(q[2],   -2.3079, 1e-4, 'qFromPrior([.55,.20,.15,.10], 300)[1] =   -2.3079');
  perform t.close(q[3],  -88.6125, 1e-4, 'qFromPrior([.55,.20,.15,.10], 300)[2] =  -88.6125');
  perform t.close(q[4], -210.2520, 1e-4, 'qFromPrior([.55,.20,.15,.10], 300)[3] = -210.2520');
  p := lmsr_prices_of(q, 300);
  perform t.close(p[1], 0.55, 1e-12, '  └─ prices of that = 0.55 exactly');
  perform t.close(p[2], 0.20, 1e-12, '  └─ prices of that = 0.20 exactly');
  perform t.close(p[3], 0.15, 1e-12, '  └─ prices of that = 0.15 exactly');
  perform t.close(p[4], 0.10, 1e-12, '  └─ prices of that = 0.10 exactly');

  ---------------- overflow ----------------
  p := lmsr_prices_of(array[0,0,1e6,0]::double precision[], 300);
  perform t.ok(p[1] = 0 and p[2] = 0 and p[3] = 1 and p[4] = 0,
               'prices([0,0,1e6,0], 300) = [0,0,1,0] — no NaN, no Infinity');
  perform t.ok((select bool_and(x = x and x <> 'Infinity'::double precision) from unnest(p) x),
               '  └─ every element is finite');
end $$;

\echo ''
\echo 'Invariants — SQL'
do $$
declare q double precision[]; s double precision; proceeds double precision;
        b double precision := 50; revenue double precision := 0;
        step double precision := 2; d double precision; worst double precision := -1e9;
begin
  ---------------- round trip ----------------
  q := array[0,0,20,0]::double precision[];
  s := lmsr_shares_for_stake(q, 50, 2, 25);
  q[3] := q[3] + s;
  proceeds := -lmsr_trade_cost(q, 50, 2, -s);
  perform t.close(proceeds, 25.0, 1e-9,
    'round trip: buy for 25, sell it back, receive exactly 25 (±1e-9)');

  ---------------- bounded loss ----------------
  q := array[0,0,0,0]::double precision[];
  while q[3] < 2000 - 1e-12 loop
    d := least(step, 2000 - q[3]);
    revenue := revenue + lmsr_trade_cost(q, b, 2, d);
    q[3] := q[3] + d;
    worst := greatest(worst, q[3] - revenue);
  end loop;
  perform t.close(revenue, 2000 - 69.314718, 1e-6,
    'bounded loss: revenue to q_2 = 2000 is 2000 − 69.314718');
  perform t.ok(worst <= 50 * ln(4.0) + 1e-9,
    '  └─ maker loss never exceeds b·ln(n) = 69.314718');
  perform t.close(worst, 50 * ln(4.0), 1e-6,
    '  └─ and converges to exactly b·ln(n)');

  ---------------- flat market ----------------
  q := lmsr_q_from_prior(array[0.25,0.25,0.25,0.25]::double precision[], 300);
  perform t.close(1.0 / (lmsr_prices_of(q, 300))[1], 4.0, 1e-12,
    'use_elo = false: a 4-way market opens at exactly ×4.00');
end $$;
