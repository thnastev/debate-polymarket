/**
 * TS ↔ SQL parity. Generates random markets, runs every LMSR function through
 * both src/lib/lmsr.ts and the plpgsql in 0002_trade.sql, and asserts they
 * agree to 1e-6. Two independent implementations of the same formula is the
 * whole point; this is what makes that worth anything.
 */
import pg from 'pg';
import { cost, prices, tradeCost, sharesForStake, qFromPrior } from '../src/lib/lmsr.ts';

const TOL = 1e-6;
const client = new pg.Client({
  host: process.env.PGHOST ?? '/tmp',
  port: Number(process.env.PGPORT ?? 55432),
  user: process.env.PGUSER ?? 'postgres',
  database: process.env.BISER_DB ?? 'biser_test',
});

let checks = 0;
const fails = [];
function agree(label, ts, sql) {
  checks++;
  if (!Number.isFinite(ts) || !Number.isFinite(sql) || Math.abs(ts - sql) > TOL) {
    fails.push(`${label}: ts=${ts} sql=${sql} Δ=${Math.abs(ts - sql)}`);
  }
}

// Deterministic PRNG so a failure is reproducible.
let seed = 20260821;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

await client.connect();
const arr = (a) => `array[${a.join(',')}]::double precision[]`;

for (let trial = 0; trial < 120; trial++) {
  const n = 2 + Math.floor(rnd() * 10);
  const b = [50, 120, 250, 300, 400, 1000][Math.floor(rnd() * 6)];
  // Spread of shapes: flat, mild, lopsided, and one extreme enough to underflow.
  const scale = [0, 20, 200, 4000, 1e6][Math.floor(rnd() * 5)];
  const q = Array.from({ length: n }, () => (rnd() - 0.5) * 2 * scale);
  const i = Math.floor(rnd() * n);
  const stake = [1, 5, 25, 100, 750][Math.floor(rnd() * 5)];

  const r = await client.query(
    `select lmsr_cost($1,$2)                     as cost,
            lmsr_prices_of($1,$2)                as prices,
            lmsr_trade_cost($1,$2,$3,$4)         as tcost,
            lmsr_shares_for_stake($1,$2,$3,$5)   as shares,
            lmsr_q_from_prior($6,$2)             as qprior`,
    [`{${q.join(',')}}`, b, i, 12.5, stake,
     `{${prices(q, b).map((x) => Math.max(x, 1e-6)).join(',')}}`],
  );
  const row = r.rows[0];
  const tag = `n=${n} b=${b} scale=${scale} i=${i}`;

  agree(`cost ${tag}`, cost(q, b), Number(row.cost));
  agree(`tradeCost ${tag}`, tradeCost(q, b, i, 12.5), Number(row.tcost));
  agree(`sharesForStake ${tag}`, sharesForStake(q, b, i, stake), Number(row.shares));
  const tp = prices(q, b);
  row.prices.forEach((p, k) => agree(`prices[${k}] ${tag}`, tp[k], Number(p)));
  const tq = qFromPrior(tp.map((x) => Math.max(x, 1e-6)), b);
  row.qprior.forEach((v, k) => agree(`qFromPrior[${k}] ${tag}`, tq[k], Number(v)));
}

await client.end();
if (fails.length) {
  console.error(`  FAIL  TS/SQL parity: ${fails.length} of ${checks} disagreed`);
  fails.slice(0, 10).forEach((f) => console.error(`        ${f}`));
  process.exit(1);
}
console.log(`  ok    TS and SQL agree to 1e-6 across ${checks} checks (120 random markets)`);
