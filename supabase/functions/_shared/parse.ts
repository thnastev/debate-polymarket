/**
 * Tabbycat response parsers, shared by the browser paste box and the poller.
 *
 * MIRRORED FROM src/lib/tab.ts — a Deno Edge Function cannot import out of the
 * Vite app's src/, so this is a copy. It is covered by src/lib/tab.test.ts and
 * checked for drift by scripts/check-shared.mjs; change one and change both.
 *
 * Pure parsing over JSON, no fetch: fetching lives in tabbycat.ts so that the
 * parsing stays testable and cannot be blamed on a network.
 */

export interface ParsedTeam {
  tabId: string; name: string;
  speakerIds: string[]; speakerNames: string[];
}
export interface ParsedDebate {
  tabId: string; venue: string;
  /** Team tab ids in fixed BP order [OG, OO, CG, CO]. */
  teamTabIds: Array<string | null>;
  adjudicatorIds: string[];
}
export interface ParsedPairings {
  teams: ParsedTeam[];
  debates: ParsedDebate[];
  warnings: string[];
}

const SIDE_ORDER = ['og', 'oo', 'cg', 'co'];

/** Tabbycat identifies things by API URL; the trailing id is the stable key. */
function idOf(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') {
    const m = v.match(/(\d+)\/?$/);
    return m ? m[1] : v;
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return idOf(o.id ?? o.url ?? null);
  }
  return null;
}

function nameOf(t: Record<string, unknown>): string {
  return String(
    t.short_name ?? t.long_name ?? t.reference ?? t.name ?? 'Team',
  );
}

function sideIndex(raw: unknown, fallback: number): number {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    const i = SIDE_ORDER.indexOf(raw.toLowerCase());
    if (i >= 0) return i;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/**
 * Parse a `/rounds/{seq}/pairings` response. Tabbycat's shape varies a little
 * across versions, so this reads defensively and reports what it could not
 * understand rather than inventing a room.
 */
export function parsePairings(input: unknown): ParsedPairings {
  const warnings: string[] = [];
  const rows: unknown[] = Array.isArray(input)
    ? input
    : Array.isArray((input as Record<string, unknown>)?.results)
      ? ((input as Record<string, unknown>).results as unknown[])
      : [];
  if (!rows.length) {
    return { teams: [], debates: [], warnings: ['No pairings found in that JSON.'] };
  }

  const teams = new Map<string, ParsedTeam>();
  const debates: ParsedDebate[] = [];

  rows.forEach((raw, k) => {
    const d = raw as Record<string, unknown>;
    const entries = (d.teams as unknown[]) ?? [];
    if (!Array.isArray(entries) || entries.length === 0) {
      warnings.push(`Room ${k + 1} has no teams; skipped.`);
      return;
    }

    const slots: Array<string | null> = [null, null, null, null];
    entries.forEach((e, j) => {
      const ent = e as Record<string, unknown>;
      const teamObj = (ent.team ?? ent) as Record<string, unknown>;
      const tabId = idOf(ent.team ?? ent.id ?? ent.url ?? teamObj);
      if (!tabId) { warnings.push(`Room ${k + 1} has a team with no id; skipped.`); return; }

      if (!teams.has(tabId)) {
        const speakers = (teamObj.speakers as unknown[]) ?? [];
        teams.set(tabId, {
          tabId,
          name: nameOf(teamObj),
          speakerIds: speakers.map((s) => idOf(s) ?? '').filter(Boolean),
          speakerNames: speakers.map((s) =>
            typeof s === 'string' ? s : String((s as Record<string, unknown>).name ?? '')),
        });
      }
      const idx = sideIndex(ent.side, j);
      if (idx >= 0 && idx < 4) slots[idx] = tabId;
      else warnings.push(`Room ${k + 1} has an unrecognised side "${String(ent.side)}".`);
    });

    if (slots.some((s) => s === null)) {
      warnings.push(
        `Room ${k + 1} (${String((d.venue as Record<string, unknown>)?.name ?? d.venue ?? '?')})` +
        ' is not a full four-team BP room; it will not get room markets.');
    }

    const adjRaw = d.adjudicators as Record<string, unknown> | unknown[] | undefined;
    const adjudicatorIds: string[] = [];
    if (Array.isArray(adjRaw)) {
      adjRaw.forEach((a) => { const i = idOf(a); if (i) adjudicatorIds.push(i); });
    } else if (adjRaw && typeof adjRaw === 'object') {
      // { chair: url, panellists: [...], trainees: [...] }
      const chair = idOf(adjRaw.chair);
      if (chair) adjudicatorIds.push(chair);
      for (const key of ['panellists', 'trainees']) {
        const list = adjRaw[key];
        if (Array.isArray(list)) list.forEach((a) => { const i = idOf(a); if (i) adjudicatorIds.push(i); });
      }
    }

    debates.push({
      tabId: idOf(d.id ?? d.url) ?? `room-${k + 1}`,
      venue: String(
        (d.venue as Record<string, unknown>)?.name ?? d.venue ?? `Room ${k + 1}`),
      teamTabIds: slots,
      adjudicatorIds,
    });
  });

  return { teams: [...teams.values()], debates, warnings };
}

/** Parse a `/teams` response, for seeding the roster before a draw exists. */
export function parseTeams(input: unknown): { teams: ParsedTeam[]; warnings: string[] } {
  const rows: unknown[] = Array.isArray(input)
    ? input
    : Array.isArray((input as Record<string, unknown>)?.results)
      ? ((input as Record<string, unknown>).results as unknown[])
      : [];
  if (!rows.length) return { teams: [], warnings: ['No teams found in that JSON.'] };

  const teams: ParsedTeam[] = [];
  const warnings: string[] = [];
  rows.forEach((raw, k) => {
    const t = raw as Record<string, unknown>;
    const tabId = idOf(t.id ?? t.url);
    if (!tabId) { warnings.push(`Team ${k + 1} has no id; skipped.`); return; }
    const speakers = (t.speakers as unknown[]) ?? [];
    teams.push({
      tabId, name: nameOf(t),
      speakerIds: speakers.map((s) => idOf(s) ?? '').filter(Boolean),
      speakerNames: speakers.map((s) =>
        typeof s === 'string' ? s : String((s as Record<string, unknown>).name ?? '')),
    });
  });
  return { teams, warnings };
}

/** Swings are not people; mark them at import so nothing downstream rates them. */
export const looksSwing = (name: string) => /swing/i.test(name);
