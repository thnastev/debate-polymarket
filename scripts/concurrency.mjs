/**
 * §12 step 3 — the test that decides whether the project works.
 *
 * Fires 50 genuinely simultaneous place_bet calls at one market, on 50 separate
 * connections, released together from a barrier. Then asserts:
 *
 *   1. every call landed — no lost updates, no dropped trades
 *   2. replaying the same trades sequentially through src/lib/lmsr.ts, in the
 *      order the lock granted them, reproduces the final q exactly
 *   3. C(q_final) − C(q_0) equals the sum of the stakes — the order-independent
 *      identity that would break if any two trades had read the same q
 *   4. Σ bets.amount equals the negative of the change in total balances
 *   5. verify_ledger() passes
 *   6. a trade on a different market is not blocked by a lock on this one
 *
 * If §1.3 is wrong — if two bets ever read the same q and overwrite each other
 * — assertions 2 and 3 are what catch it.
 */
import pg from 'pg';
import { cost, sharesForStake } from '../src/lib/lmsr.ts';

const CONN = {
  host: process.env.PGHOST ?? '/tmp',
  port: Number(process.env.PGPORT ?? 55432),
  user: process.env.PGUSER ?? 'postgres',
  database: process.env.BISER_DB ?? 'biser_test',
};
const N = 50;
const B = 300;

const fails = [];
const ok = (cond, label) => {
  if (cond) console.log(`  ok    ${label}`);
  else { console.error(`  FAIL  ${label}`); fails.push(label); }
};
const close = (a, b, tol, label) =>
  ok(Number.isFinite(a) && Math.abs(a - b) <= tol, `${label} (${a} ≈ ${b}, Δ ${Math.abs(a - b).toExponential(2)})`);

const admin = new pg.Client(CONN);
await admin.connect();

// ---------- fixture ----------
const { rows: [tour] } = await admin.query(
  `insert into tournaments (name, slug, is_active) values ('Concurrency','conc',false) returning id`);
const gm = (await admin.query(
  `insert into auth.users (email) values ('gm-conc@example.test') returning id`)).rows[0].id;
await admin.query(`update profiles set role='game_maker', is_approved=true, display_name='GM' where id=$1`, [gm]);

await admin.query(`select set_config('request.jwt.claim.sub', $1, false)`, [gm]);
const market = (await admin.query(
  `select create_market($1,'custom','Concurrency','rule',$2::jsonb,$3) as id`,
  [tour.id,
   JSON.stringify([0, 1, 2, 3].map((i) => ({ label: `O${i}`, color: '#A78BFA' }))),
   B])).rows[0].id;

// 50 traders, each with a stake to place. Varying stakes and outcomes so the
// order actually matters — identical trades would hide a lost update.
const traders = [];
for (let i = 0; i < N; i++) {
  const id = (await admin.query(
    `insert into auth.users (email) values ($1) returning id`, [`c${i}@example.test`])).rows[0].id;
  await admin.query(`update profiles set is_approved = true, display_name = $2 where id = $1`,
    [id, `Trader ${i}`]);
  traders.push({ id, outcome: i % 4, stake: 5 + (i % 7) * 11 });
}

const q0 = (await admin.query(
  `select array_agg(q order by idx) as q from market_outcomes where market_id=$1`, [market])).rows[0].q.map(Number);
const balBefore = Number((await admin.query(`select sum(balance) s from profiles`)).rows[0].s);

// ---------- fire them all at once ----------
const clients = await Promise.all(traders.map(async () => {
  const c = new pg.Client(CONN);
  await c.connect();
  return c;
}));
// Every connection is prepared and idle; the barrier releases them together.
let release;
const barrier = new Promise((r) => { release = r; });
const runs = traders.map(async (tr, k) => {
  const c = clients[k];
  await c.query(`select set_config('request.jwt.claim.sub', $1, false)`, [tr.id]);
  await barrier;
  try {
    await c.query(`select place_bet($1, $2, $3)`, [market, tr.outcome, tr.stake]);
    return { k, ok: true };
  } catch (e) {
    return { k, ok: false, err: e.message };
  }
});
release();
const results = await Promise.all(runs);
await Promise.all(clients.map((c) => c.end()));

const landed = results.filter((r) => r.ok).length;
ok(landed === N, `all ${N} concurrent bets landed (${landed}/${N})`);
results.filter((r) => !r.ok).slice(0, 3).forEach((r) => console.error(`        trader ${r.k}: ${r.err}`));

// ---------- 2. sequential replay in the order the lock granted ----------
const ledger = (await admin.query(
  `select b.profile_id, b.shares, b.amount, mo.idx
     from bets b join market_outcomes mo on mo.id = b.outcome_id
    where b.market_id = $1 and b.kind = 'back' order by b.id`, [market])).rows;
ok(ledger.length === N, `the ledger holds exactly ${N} back rows (${ledger.length})`);

const replay = q0.slice();
let worstShareDrift = 0;
for (const row of ledger) {
  const stake = -Number(row.amount);           // amount is signed: negative = paid in
  const delta = sharesForStake(replay, B, row.idx, stake);
  // mirror the database's numeric(18,6) storage so this is a like-for-like compare
  replay[row.idx] = Math.round((replay[row.idx] + delta) * 1e6) / 1e6;
  worstShareDrift = Math.max(worstShareDrift,
    Math.abs(Math.round(delta * 1e6) / 1e6 - Number(row.shares)));
}
ok(worstShareDrift <= 1e-6,
  `every one of the ${N} recorded share counts matches the replay (worst Δ ${worstShareDrift.toExponential(2)})`);
const qFinal = (await admin.query(
  `select array_agg(q order by idx) as q from market_outcomes where market_id=$1`, [market])).rows[0].q.map(Number);
for (let i = 0; i < 4; i++) {
  close(replay[i], qFinal[i], 1e-6,
    `final q[${i}] equals the sequential replay of the same trades`);
}

// ---------- 3. cost identity ----------
const stakes = ledger.reduce((a, r) => a - Number(r.amount), 0);
close(cost(qFinal, B) - cost(q0, B), stakes, 1e-4,
  'C(q_final) − C(q_0) equals the sum of the stakes — no trade read a stale q');

// ---------- 4. money conservation ----------
const balAfter = Number((await admin.query(`select sum(balance) s from profiles`)).rows[0].s);
const netAmount = Number((await admin.query(
  `select coalesce(sum(amount),0) s from bets where market_id=$1`, [market])).rows[0].s);
close(netAmount, -(balBefore - balAfter), 1e-6,
  'Σ bets.amount equals the negative of the change in total balances');
close(balBefore - balAfter, stakes, 1e-6,
  '  └─ and total balances fell by exactly the total staked');

// ---------- 5. ledger ----------
const bad = await admin.query(`select * from verify_ledger()`);
ok(bad.rowCount === 0, `verify_ledger() passes (${bad.rowCount} mismatches)`);

// ---------- 6. different markets do not block each other ----------
await admin.query(`select set_config('request.jwt.claim.sub', $1, false)`, [gm]);
const other = (await admin.query(
  `select create_market($1,'custom','Other','rule',$2::jsonb,300) as id`,
  [tour.id, JSON.stringify([{ label: 'Yes', color: '#7FD4A8' }, { label: 'No', color: '#E4707A' }])])).rows[0].id;

const holder = new pg.Client(CONN); await holder.connect();
await holder.query('begin');
await holder.query('select * from markets where id = $1 for update', [market]);

const other2 = new pg.Client(CONN); await other2.connect();
await other2.query(`select set_config('request.jwt.claim.sub', $1, false)`, [traders[0].id]);
await other2.query(`set statement_timeout = '3s'`);
let crossOk = true, crossErr = '';
try { await other2.query(`select place_bet($1, 0, 5)`, [other]); }
catch (e) { crossOk = false; crossErr = e.message; }
ok(crossOk, `a trade on a different market is not blocked by a lock on this one${crossOk ? '' : ` — ${crossErr}`}`);

// …and one on the SAME market is, which is the whole point.
const same = new pg.Client(CONN); await same.connect();
await same.query(`select set_config('request.jwt.claim.sub', $1, false)`, [traders[1].id]);
await same.query(`set statement_timeout = '1s'`);
let blocked = false;
try { await same.query(`select place_bet($1, 0, 5)`, [market]); }
catch (e) { blocked = /timeout/i.test(e.message); }
ok(blocked, 'a trade on the SAME market waits for the lock — trades are serialised');

await holder.query('rollback'); await holder.end(); await other2.end(); await same.end();

// ---------- 7. a double-tap is exactly one bet ----------
// §13. The client mints the idempotency key on the FIRST press and reuses it,
// so a double-tap arrives as N simultaneous calls carrying one key. All of
// them must land as a single bet, and the losers must REPLAY rather than fail:
// the unique index alone stops the second bet existing, but it does so by
// aborting with a constraint violation, which tells a trader their bet failed
// when it went through and makes the offline queue drop a good trade.
const TAP = 5, KEY = 'double-tap-key';
const tapper = traders[2];
const taps = await Promise.all(Array.from({ length: TAP }, async () => {
  const c = new pg.Client(CONN); await c.connect();
  await c.query(`select set_config('request.jwt.claim.sub', $1, false)`, [tapper.id]);
  return c;
}));
let tapRelease;
const tapGate = new Promise((r) => { tapRelease = r; });
const tapRuns = taps.map(async (c) => {
  await tapGate;
  try {
    const r = await c.query(`select place_bet($1, 0, 25, null, $2) as res`, [other, KEY]);
    return { ok: true, res: r.rows[0].res };
  } catch (e) { return { ok: false, err: e.message }; }
});
tapRelease();
const tapOut = await Promise.all(tapRuns);
await Promise.all(taps.map((c) => c.end()));

const tapBets = Number((await admin.query(
  `select count(*) n from bets where market_id = $1 and idempotency_key = $2`, [other, KEY])).rows[0].n);
const tapApplied = tapOut.filter((r) => r.ok && r.res.ok).length;
const tapReplayed = tapOut.filter((r) => r.ok && r.res.replayed).length;
const tapErrors = tapOut.filter((r) => !r.ok);
ok(tapBets === 1, `${TAP} simultaneous taps on one idempotency key create exactly one bet (${tapBets})`);
ok(tapApplied === 1 && tapReplayed === TAP - 1,
  `  └─ one applied, ${TAP - 1} replayed (got ${tapApplied} / ${tapReplayed})`);
ok(tapErrors.length === 0,
  `  └─ and none of them errors${tapErrors.length ? ` — ${tapErrors[0].err}` : ''}`);

const bad2 = await admin.query(`select * from verify_ledger()`);
ok(bad2.rowCount === 0, `  └─ verify_ledger() still passes (${bad2.rowCount} mismatches)`);

await admin.end();

if (fails.length) { console.error(`\n  ${fails.length} assertion(s) failed`); process.exit(1); }
console.log(`\n  ${N} concurrent bets: no lost updates, ledger balanced.`);
