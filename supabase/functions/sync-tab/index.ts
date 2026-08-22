/**
 * sync-tab — the poller (§8).
 *
 * Runs on a cron trigger: 30s during an active round, 5 minutes otherwise,
 * never faster than 20s (enforced in tabbycat.ts).
 *
 * Two rules govern everything below.
 *
 *   1. READ ONLY. This function never issues a POST, PATCH or DELETE to a tab
 *      site. tabbycat.ts exposes no method that could.
 *
 *   2. SILENCE IS SAFER THAN A WRONG SETTLEMENT. Anything ambiguous,
 *      incomplete, or contradicting an existing settlement raises a flag in
 *      the admin queue and stops. It never guesses.
 *
 * Idempotency comes from markets.template_key plus the unique index on
 * (tournament_id, template_key, debate/round/tournament): running this twice
 * creates nothing twice.
 *
 * Deploy:  supabase functions deploy sync-tab
 * Secrets: supabase secrets set TAB_API_TOKEN=...   (optional; public mode
 *          works without it, but then results are only readable if the
 *          tournament publishes them)
 * Cron:    select cron.schedule('sync-tab','30 seconds', $$ ... $$);
 */
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getRounds, getPairings, getBallots, type TabConfig } from '../_shared/tabbycat.ts';
import { parsePairings, looksSwing } from '../_shared/parse.ts';

// Only these may ever be settled by a machine (§8). Anything else, and every
// custom market always, waits for a human.
const AUTO_SETTLEABLE = new Set([
  'room.call', 'room.fourth', 'round.gov_vs_opp', 'tournament.winner',
]);

const BP_ORDER = ['og', 'oo', 'cg', 'co'];

interface Ctx {
  db: SupabaseClient;
  tab: TabConfig;
  tournamentId: string;
  autoSettle: boolean;
  systemProfileId: string;
  log: string[];
}

Deno.serve(async (req) => {
  // The cron trigger authenticates with the service role key; nothing else
  // should be able to run this.
  const auth = req.headers.get('Authorization') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  if (!auth.includes(serviceKey)) {
    return new Response('forbidden', { status: 403 });
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, {
    auth: { persistSession: false },
  });

  const { data: tournament } = await db
    .from('tournaments').select('*').eq('is_active', true).maybeSingle();
  if (!tournament) return json({ ok: true, note: 'no active tournament' });
  if (!tournament.tab_base_url || !tournament.tab_slug) {
    return json({ ok: true, note: 'tournament has no tab configured' });
  }

  // A dedicated system profile owns every automated admin_log entry, so an
  // automated settlement is never mistaken for the operator's own.
  const { data: sys } = await db
    .from('profiles').select('id').eq('display_name', 'Tab poller').maybeSingle();

  const ctx: Ctx = {
    db,
    tab: {
      baseUrl: tournament.tab_base_url,
      slug: tournament.tab_slug,
      token: Deno.env.get('TAB_API_TOKEN') ?? undefined,
    },
    tournamentId: tournament.id,
    autoSettle: Boolean(tournament.auto_settle_enabled),
    systemProfileId: sys?.id ?? '',
    log: [],
  };

  try {
    await syncRounds(ctx);
    return json({ ok: true, log: ctx.log });
  } catch (e) {
    // A tab that has gone private or offline is not an emergency; record it
    // and try again on the next tick.
    await flag(ctx, null, 'sync_failed', { error: String(e) });
    return json({ ok: false, error: String(e), log: ctx.log }, 200);
  }
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// ---------------------------------------------------------------- rounds

async function syncRounds(ctx: Ctx) {
  const rounds = await getRounds(ctx.tab);

  for (const raw of rounds as Array<Record<string, unknown>>) {
    const seq = Number(raw.seq);
    if (!Number.isFinite(seq)) continue;

    const drawReleased = String(raw.draw_status ?? '').toLowerCase() === 'released'
      || raw.draw_status === 'R' || raw.draw_released === true;
    const completed = raw.completed === true;

    const { data: round } = await ctx.db.from('tab_rounds').upsert({
      tournament_id: ctx.tournamentId,
      seq,
      name: String(raw.name ?? `Round ${seq}`),
      draw_released: drawReleased,
      results_in: completed,
      motion: motionOf(raw),
    }, { onConflict: 'tournament_id,seq' }).select().single();
    if (!round) continue;

    if (!drawReleased) continue;
    await syncDraw(ctx, round, seq);

    // Speeches have started: shut the room markets for this round.
    if (raw.stage === 'current' || completed) {
      const { data: closed } = await ctx.db.from('markets')
        .update({ status: 'closed' })
        .eq('round_id', round.id).eq('status', 'open')
        .like('template_key', 'room.%').select('id');
      if (closed?.length) ctx.log.push(`closed ${closed.length} room markets in ${round.name}`);
    }

    if (completed) await syncResults(ctx, round, seq);
  }
}

function motionOf(raw: Record<string, unknown>): string | null {
  const ms = raw.motions as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(ms) && ms.length === 1) return String(ms[0].text ?? '') || null;
  // More than one motion means the round is not unambiguous; leave it null and
  // let a human decide rather than picking one.
  return null;
}

// ------------------------------------------------------------------ draw

async function syncDraw(ctx: Ctx, round: Record<string, unknown>, seq: number) {
  let pairings: unknown[];
  try { pairings = await getPairings(ctx.tab, seq); }
  catch (e) {
    // A closed tab is a supported mode, not a failure: the game maker enters
    // the draw by hand from the paste box.
    ctx.log.push(`pairings for round ${seq} unavailable: ${e}`);
    return;
  }

  const parsed = parsePairings(pairings);
  if (!parsed.debates.length) return;

  const { data: teams } = await ctx.db.from('tab_teams').upsert(
    parsed.teams.map((t) => ({
      tournament_id: ctx.tournamentId, tab_id: t.tabId, name: t.name,
      speakers: t.speakerIds, speaker_names: t.speakerNames,
      is_swing: looksSwing(t.name),
    })), { onConflict: 'tournament_id,tab_id' }).select();

  const idOf = new Map((teams ?? []).map((t) => [t.tab_id, t.id]));
  const full = parsed.debates.filter((d) => d.teamTabIds.every((x) => x && idOf.has(x)));

  if (full.length < parsed.debates.length) {
    await flag(ctx, null, 'incomplete_rooms', {
      round: round.name,
      skipped: parsed.debates.length - full.length,
      warnings: parsed.warnings,
    });
  }

  const { data: debates } = await ctx.db.from('tab_debates').upsert(
    full.map((d) => ({
      round_id: round.id, tab_id: d.tabId, venue: d.venue,
      team_ids: d.teamTabIds.map((x) => idOf.get(x as string)),
      adjudicator_ids: d.adjudicatorIds,
    })), { onConflict: 'round_id,tab_id' }).select();

  ctx.log.push(`round ${seq}: ${debates?.length ?? 0} rooms upserted`);

  // NOTE: the poller mirrors the draw but does NOT create markets on its own.
  // Which templates run, at which b, is the game maker's call — and thirty
  // markets nobody trades looks worse than five that are busy (§11). The
  // admin generator picks them up the moment this lands.
}

// --------------------------------------------------------------- results

async function syncResults(ctx: Ctx, round: Record<string, unknown>, seq: number) {
  const { data: debates } = await ctx.db
    .from('tab_debates').select('*').eq('round_id', round.id);
  if (!debates?.length) return;

  for (const debate of debates) {
    if (debate.result_json) continue;   // already recorded

    let ballots: unknown[];
    try { ballots = await getBallots(ctx.tab, seq, debate.tab_id); }
    catch {
      // Closed tab, or results not published. Both are normal.
      continue;
    }

    const call = readCall(ballots);
    if (!call) {
      await flag(ctx, null, 'ballot_unreadable', { venue: debate.venue, round: round.name });
      continue;
    }

    await ctx.db.from('tab_debates')
      .update({ result_json: { ballots, call } }).eq('id', debate.id);

    await settleRoomMarkets(ctx, debate, call);
  }
}

/**
 * Read the finishing order off a ballot. Returns positions 0..3 in BP order
 * with their ranks, or null if the ballot does not unambiguously say — a
 * confirmed ballot with four distinct ranks is the only thing accepted.
 */
function readCall(ballots: unknown[]): number[] | null {
  const confirmed = (ballots as Array<Record<string, unknown>>)
    .filter((b) => b.confirmed === true);
  if (confirmed.length !== 1) return null;

  const sheets = confirmed[0].result as Record<string, unknown> | undefined;
  const teams = (sheets?.sheets as Array<Record<string, unknown>> | undefined)?.[0]?.teams
    ?? (confirmed[0].teams as unknown);
  if (!Array.isArray(teams) || teams.length !== 4) return null;

  const ranks: number[] = [0, 0, 0, 0];
  for (const t of teams as Array<Record<string, unknown>>) {
    const side = String(t.side ?? '').toLowerCase();
    const idx = BP_ORDER.indexOf(side);
    const points = Number(t.points ?? t.rank ?? NaN);
    if (idx < 0 || !Number.isFinite(points)) return null;
    // Tabbycat records points 3..0 for 1st..4th.
    ranks[idx] = 4 - points;
  }
  if (new Set(ranks).size !== 4) return null;   // a tie is not a call
  return ranks;
}

async function settleRoomMarkets(ctx: Ctx, debate: Record<string, unknown>, ranks: number[]) {
  const first = ranks.indexOf(1);
  const fourth = ranks.indexOf(4);

  const { data: markets } = await ctx.db
    .from('markets').select('id, template_key, status, title')
    .eq('debate_id', debate.id).in('status', ['open', 'closed']);

  for (const m of markets ?? []) {
    const key = m.template_key ?? '';
    const winner = key === 'room.call' ? first : key === 'room.fourth' ? fourth : null;

    if (winner === null) {
      // room.top_speaker and anything else needs eyes on it (§8).
      await flag(ctx, m.id, 'needs_confirmation', {
        title: m.title, template: key, ranks,
        why: 'not a machine-resolvable template',
      });
      continue;
    }
    if (!AUTO_SETTLEABLE.has(key)) {
      await flag(ctx, m.id, 'needs_confirmation', { title: m.title, template: key, ranks });
      continue;
    }
    if (!ctx.autoSettle) {
      await flag(ctx, m.id, 'ready_to_settle', {
        title: m.title, template: key, winner,
        why: 'auto-settle is off — settle it from the market editor',
      });
      continue;
    }

    const { error } = await ctx.db.rpc('settle_market_as_system', {
      p_market: m.id, p_winner: winner, p_actor: ctx.systemProfileId,
    });
    if (error) await flag(ctx, m.id, 'settle_failed', { error: error.message, winner });
    else ctx.log.push(`settled ${m.title} as outcome ${winner}`);
  }
}

async function flag(ctx: Ctx, marketId: string | null, kind: string, detail: unknown) {
  await ctx.db.from('tab_flags').insert({
    tournament_id: ctx.tournamentId, market_id: marketId, kind, detail,
  });
  ctx.log.push(`flagged ${kind}`);
}
