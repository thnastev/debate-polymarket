/**
 * Market generation, shared by the one-press tab import and the by-scope
 * generator panel. Both create markets the same way; they differ only in how
 * many decisions the operator makes first.
 *
 * Idempotency is the database's job: the unique index on
 * (tournament_id, template_key, debate/round/tournament) means running any of
 * this twice creates nothing twice. A duplicate is counted as "already there",
 * not raised — re-importing a redrawn round must be safe.
 */
import { createMarket, type TabTeam, type TabDebate, type TabRound } from './api';
import {
  roomTemplates, roundTemplates, tournamentTemplates,
  defaultB, BP_POSITIONS, type TemplateSpec,
} from './templates';
import { priorForTeams } from './elo';
import type { Tournament, MarketScope } from './types';

export interface GenerateResult {
  created: number;
  existed: number;
  seeded: number;
  titles: string[];
}

const empty = (): GenerateResult => ({ created: 0, existed: 0, seeded: 0, titles: [] });

function merge(a: GenerateResult, b: GenerateResult): GenerateResult {
  return {
    created: a.created + b.created,
    existed: a.existed + b.existed,
    seeded: a.seeded + b.seeded,
    titles: [...a.titles, ...b.titles],
  };
}

async function createFromSpecs(opts: {
  tournament: Tournament;
  specs: TemplateSpec[];
  scope: MarketScope;
  keep: (s: TemplateSpec) => boolean;
  titlePrefix?: string;
  roundId?: string | null;
  debateId?: string | null;
  teamsById?: Map<string, TabTeam>;
}): Promise<GenerateResult> {
  const out = empty();
  for (const s of opts.specs) {
    if (!opts.keep(s)) continue;
    const b = s.b ?? defaultB(s.outcomes.length);

    // Elo seeding only when the tournament asks for it AND every outcome maps
    // to a rated, non-swing team. Anything else opens uniform (§7) — an
    // unmatched team gets no prior rather than a made-up one.
    const prior = opts.tournament.use_elo && opts.teamsById
      ? priorForTeams(
          s.outcomes.map((o) => (o.tab_team_id ? opts.teamsById!.get(o.tab_team_id) ?? null : null)),
          opts.tournament.elo_widen,
        )
      : null;

    const title = opts.titlePrefix ? `${opts.titlePrefix}${s.title}` : s.title;
    try {
      await createMarket({
        tournamentId: opts.tournament.id,
        scope: opts.scope,
        title,
        rule: s.rule,
        outcomes: s.outcomes,
        b,
        layout: s.layout ?? 'list',
        resolver: opts.tournament.name ? 'Game maker' : 'Game maker',
        prior,
        seeded: Boolean(prior),
        roundId: opts.roundId ?? null,
        debateId: opts.debateId ?? null,
        templateKey: s.key,
      });
      out.created += 1;
      if (prior) out.seeded += 1;
      out.titles.push(title);
    } catch (e) {
      if (/duplicate key|markets_template_uniq/i.test(String(e))) out.existed += 1;
      else throw e;
    }
  }
  return out;
}

/** The §11 launch set, and only that: five busy markets beat thirty dead ones. */
const isDefault = (s: TemplateSpec) => s.defaultOn;
const always = () => true;

export async function generateForRound(opts: {
  tournament: Tournament;
  round: TabRound;
  debates: TabDebate[];
  teams: TabTeam[];
  /** false = the §11 launch set only; true = every template in scope. */
  everything?: boolean;
}): Promise<GenerateResult> {
  const keep = opts.everything ? always : isDefault;
  const byId = new Map(opts.teams.map((t) => [t.id, t]));
  let out = empty();

  out = merge(out, await createFromSpecs({
    tournament: opts.tournament,
    specs: roundTemplates(opts.round.name),
    scope: 'round',
    keep,
    roundId: opts.round.id,
    teamsById: byId,
  }));

  for (const d of opts.debates) {
    const ts = d.team_ids.map((id) => byId.get(id));
    // A room that is not a full four-team BP draw gets no room markets: the
    // quadrant and every room template assume four benches.
    if (ts.some((t) => !t)) continue;
    const names = ts.map((t) => t!.name);
    const speakers = ts.flatMap((t, i) =>
      (t!.speaker_names ?? []).map((s) => ({ name: s, position: BP_POSITIONS[i] })));

    out = merge(out, await createFromSpecs({
      tournament: opts.tournament,
      specs: roomTemplates(names, speakers, d.team_ids),
      scope: 'room',
      keep,
      titlePrefix: `${opts.round.name} · ${d.venue} — `,
      roundId: opts.round.id,
      debateId: d.id,
      teamsById: byId,
    }));
  }
  return out;
}

export async function generateForTournament(opts: {
  tournament: Tournament;
  teams: TabTeam[];
  everything?: boolean;
}): Promise<GenerateResult> {
  const live = opts.teams.filter((t) => !t.is_swing);
  if (live.length < 2) return empty();
  return createFromSpecs({
    tournament: opts.tournament,
    specs: tournamentTemplates(live.map((t) => ({
      id: t.id, name: t.name, speakers: t.speaker_names,
    }))),
    scope: 'tournament',
    keep: opts.everything ? always : isDefault,
    teamsById: new Map(opts.teams.map((t) => [t.id, t])),
  });
}

/** A one-line summary for the operator, in plain words. */
export function describe(r: GenerateResult): string {
  if (r.created === 0 && r.existed === 0) return 'Nothing to create.';
  const bits: string[] = [];
  if (r.created) bits.push(`${r.created} market${r.created === 1 ? '' : 's'} created`);
  if (r.existed) bits.push(`${r.existed} already existed`);
  if (r.seeded) bits.push(`${r.seeded} seeded from Elo`);
  return bits.join(', ') + '.';
}
