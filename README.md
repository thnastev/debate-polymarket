# Biser Market

A play-money prediction market for British Parliamentary debate tournaments,
built for the Bulgarian BP circuit. Spectators, debaters and judges bet fake
currency — **bisers**, symbol **ƀ** — on which bench takes the 1st in a room,
what the motion will be about, who breaks, who tops the speaker tab.

Prices come from an automated market maker (LMSR), so there is always a price
and never a need for a counterparty.

> **There is no real money anywhere in this system and there must never be.**
> Real-money betting on events is a licensed gambling activity in Bulgaria.
> Do not add payment processing, crypto, cash-out, or any bridge to real value.

---

## Running it

```bash
npm install
cp .env.example .env        # fill in your Supabase URL and anon key
npm run dev
```

Apply the migrations to a Supabase project with `supabase db push`, then make
yourself the game maker:

```sql
update profiles set role = 'game_maker', is_approved = true
 where id = (select id from auth.users where email = 'you@example.com');
```

Deploy the poller (optional — everything works without it):

```bash
supabase functions deploy sync-tab
supabase secrets set TAB_API_TOKEN=...      # optional; public mode needs none
```

Hosting is Cloudflare Pages (`npm run build` → `dist/`) on the free tier, with
Supabase's free tier behind it. Total monthly cost: zero.

---

## Testing

```bash
npm run test:all      # everything, in the brief's build order
```

| Stage | What it proves |
|---|---|
| `npm test` | 60 unit tests: LMSR vectors, odds display, Elo replay, tab parser, trade queue |
| `npm run db:test` | 141 SQL assertions: LMSR parity, trading, RLS, anti-abuse, auto-settle guards, 50-way concurrency |
| `npm run test:ui` | Renders the real components in Chromium: no percentages for traders, quadrant geometry, 380px layout |

### The database tests without Docker

`supabase start` needs Docker. Where Docker is unavailable, `scripts/local-db.sh`
applies the same migrations to a bare Postgres 16 cluster with the `auth` schema
stubbed by `supabase/tests/00_local_auth_stub.sql`. The migrations are not
modified — they go to Supabase as-is.

```bash
initdb -D /tmp/pg && pg_ctl -D /tmp/pg -o "-k /tmp -p 55432" start
npm run db:test
```

### The three tests that matter most

- **`scripts/concurrency.mjs`** fires 50 simultaneous `place_bet` calls from 50
  connections released off a barrier, then replays the same trades sequentially
  through `src/lib/lmsr.ts` in the order the lock granted them. The final `q`
  must match exactly. It does, with drift 0. This is the test that decides
  whether the project works.
- **`scripts/parity.mjs`** runs 120 random markets through the TypeScript and
  plpgsql implementations and asserts they agree to 1e-6 across ~2000 checks.
- **`verify_ledger()`** recomputes every balance from the append-only `bets`
  table and returns the rows that disagree. It is asserted after every
  sequence of trades, settlements, voids and admin adjustments.

---

## How it fits together

```
src/lib/lmsr.ts ────────── the market maker, pure functions
     │  (must agree to 1e-6)
supabase/migrations/0002_trade.sql ── the same maths in plpgsql
     │
     └── place_bet()  ─ the ONLY way a balance or a q ever changes
         settle_market() / void_market() / adjust_balance()
```

**The client is never trusted with money.** The browser sends "user X wants to
stake N bisers on outcome Y of market Z" and receives a result. It never sends
a computed cost, share count or balance. `src/lib/lmsr.ts` exists so the UI can
*preview* a trade; the server recomputes everything.

**Prices are never stored.** They are derived from `q` on `market_outcomes` and
`b` on `markets`. The one exception is `markets.close_prices`, a deliberate
snapshot at settlement used for the Elo-vs-market scoring.

**`bets` is append-only and is the audit source of truth.** `profiles.balance`
and `positions.shares` are running aggregates. Nothing updates or deletes a
`bets` row — a correction is a new row.

### Concurrency

`place_bet` takes `select ... from markets where id = $1 for update` **before
reading any `q`**. That serialises trades on the same market while leaving
trades on different markets free to run in parallel. Both halves of that are
asserted in `scripts/concurrency.mjs`.

### What traders see

Odds, never probabilities. `×2.63`, not `38%`. The bet preview shows the
trader's **effective** odds — `shares_received / stake` — because their own
stake moves the price, and showing them the headline instead would be a lie by
omission. `scripts/ui-check.mjs` asserts that no percentage appears anywhere in
a trader-facing render.

---

## Layout

```
src/lib/          lmsr.ts, elo.ts, tab.ts, templates.ts, api.ts, tradeQueue.ts
src/components/   Quadrant, OutcomeList, OddsChart, BetPanel, admin/*
src/screens/      Auth, MarketList, MarketDetail, GameMaker, Leaderboard
supabase/migrations/   0001 schema · 0002 trade · 0003 RLS · 0004 admin · 0005 sync
supabase/tests/        the SQL suite
supabase/functions/    sync-tab, the Tabbycat poller
preview/          component preview harness for scripts/ui-check.mjs (not shipped)
```

---

## Deviations from the brief

The brief said to use its SQL verbatim. These changed, each for a reason
recorded at the point of change:

1. **`lmsr_exp()`** — Postgres `exp()` *raises* on underflow where C and JS
   return 0. The mandated max-shift makes every non-maximal exponent negative,
   so the brief's own test vector `prices([0,0,1e6,0], 300)` errored out
   instead of returning `[0,0,1,0]` — and so would any lopsided live market.
2. **The shares-for-stake formula** is written as
   `Δ = b·ln(S·e^{a/b} − A) − q_i + b·m` rather than the brief's
   `b·ln((S·e^{a/b} − A)/E)`. Algebraically identical; `ln(E)` is known exactly
   while `E` underflows to zero for a very unlikely outcome, and dividing by it
   then raises. Backing a ~0% outcome is exactly when a trader wants a number.
3. **`revoke update (balance, …) on profiles from authenticated`** does nothing
   — a column-level revoke cannot carve a hole out of a table-level grant, and
   `balance` stayed writable by any trader with a session. Replaced with a
   table revoke plus a `display_name`-only column grant.
4. **`void_market` reads `balance_after` from `RETURNING`** rather than
   re-joining `profiles`, which a CTE's shared snapshot made stale.
5. **`bets.market_id` is nullable.** The brief declares it `not null` but also
   declares the `grant` and `adjust` bet kinds, which have no market. The
   ledger has to be complete for `verify_ledger()` to mean anything.
6. **`tab_teams.speaker_names`** added alongside `speakers`, which §10 matches
   `tab_speaker_id` against as an equality test. A name is not a key.

## Open questions, not guessed at

Per §15, these are flagged rather than decided:

1. **Bankroll reset policy** — built per-tournament; the schema takes either.
2. **Tie handling on split-payout markets** (`room.top_speaker`,
   `tournament.top_speaker`). The rule text says ties split, but settlement
   pays 1 biser to a single winning outcome. Splitting needs `1/k` to each of
   `k` tied outcomes — a real extension, deliberately not implemented as a
   guess. Those templates are not on the auto-settle whitelist.
3. **A calibration leaderboard** (log score across settled bets) alongside the
   bisers one. Recommended — "most bisers wins" rewards variance — but not
   built without a decision.
4. **Whether traders see the Elo prior** — currently a per-tournament flag,
   `show_prior_to_traders`, default on.
