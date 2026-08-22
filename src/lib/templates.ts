/**
 * Market templates (§11).
 *
 * THE RESOLUTION RULE TEXT IS THE PRODUCT. Every real dispute in a prediction
 * market is a wording dispute, so these are written to be argued with once, in
 * advance, rather than in a corridor after the ballot. All of them are
 * editable by the game maker before the market opens.
 */
export const PAL = [
  '#C8853A', '#3E7A9A', '#F0C48A', '#93BFD6', '#A78BFA', '#7FD4A8',
  '#E4707A', '#DCA054', '#6F8FC4', '#C9A0DC', '#8FBF9F', '#D98C6A',
];

export const BP_POSITIONS = ['OG', 'OO', 'CG', 'CO'] as const;
export const BP_COLORS: Record<string, string> = {
  OG: '#C8853A', OO: '#3E7A9A', CG: '#F0C48A', CO: '#93BFD6',
};

export const MOTION_CATEGORIES = [
  'Economics', 'International Relations', 'Politics', 'Social movements',
  'Morality & Principles', 'Art, Culture & Narratives', 'Psychology',
];

export interface OutcomeSpec {
  label: string; sublabel?: string; color: string; tab_team_id?: string;
}
export interface TemplateSpec {
  key: string;
  title: string;
  rule: string;
  outcomes: OutcomeSpec[];
  layout?: string;
  b?: number;
  /** §11: launch with five, let the operator add the rest. */
  defaultOn: boolean;
}

/** §3's calibrated defaults for a 1000-biser bankroll. */
export function defaultB(n: number): number {
  if (n <= 2) return 250;
  if (n <= 4) return 300;
  if (n <= 8) return 300;
  return 400;
}

/** §3: warn when b·ln(n) exceeds 2× the starting balance — wide markets are expensive. */
export function subsidyWarning(b: number, n: number, startingBalance: number): string | null {
  const cap = b * Math.log(n);
  if (cap <= 2 * startingBalance) return null;
  return `This market prints up to ${cap.toFixed(0)} ƀ — more than ${(cap / startingBalance).toFixed(1)}× a starting bankroll. Lower b or narrow the market.`;
}

// ------------------------------------------------------------------ room

export function roomTemplates(
  teamNames: string[], speakers: Array<{ name: string; position: string }>,
  teamIds: Array<string | undefined> = [],
): TemplateSpec[] {
  const bench = (i: number): OutcomeSpec => ({
    label: BP_POSITIONS[i],
    sublabel: teamNames[i],
    color: BP_COLORS[BP_POSITIONS[i]],
    tab_team_id: teamIds[i],
  });
  const benches = [0, 1, 2, 3].map(bench);

  return [
    {
      key: 'room.call', title: 'The call', layout: 'room', defaultOn: true, b: 300,
      rule: 'Which bench takes the 1st, per the call announced by the chair and recorded on the ballot.',
      outcomes: benches,
    },
    {
      key: 'room.fourth', title: 'Who takes the 4th', defaultOn: false, b: 300,
      rule: 'The bench placed 4th on the ballot.',
      outcomes: benches.map((o) => ({ ...o })),
    },
    {
      key: 'room.top_speaker', title: 'Top speaker in the room', defaultOn: true, b: 300,
      rule: 'Highest individual score on the ballot. A tie splits the payout equally.',
      outcomes: speakers.map((s, i) => ({
        label: s.name, sublabel: s.position, color: PAL[i % PAL.length],
      })),
    },
    {
      key: 'room.split', title: 'Split or unanimous', defaultOn: false, b: 250,
      rule: 'As announced by the panel. Voids if the room has a solo judge.',
      outcomes: [
        { label: 'Unanimous', color: '#7FD4A8' },
        { label: 'Split', color: '#E4707A' },
      ],
    },
    {
      key: 'room.gov_opp', title: 'Gov or Opp takes the 1st', defaultOn: false, b: 250,
      rule: 'Derived from the call.',
      outcomes: [
        { label: 'Government', sublabel: `${teamNames[0]} / ${teamNames[2]}`, color: '#DCA054' },
        { label: 'Opposition', sublabel: `${teamNames[1]} / ${teamNames[3]}`, color: '#5E96B4' },
      ],
    },
    {
      key: 'room.half', title: 'Opening or Closing takes the 1st', defaultOn: false, b: 250,
      rule: 'Derived from the call.',
      outcomes: [
        { label: 'Opening', sublabel: `${teamNames[0]} / ${teamNames[1]}`, color: '#9E8FC4' },
        { label: 'Closing', sublabel: `${teamNames[2]} / ${teamNames[3]}`, color: '#5B4F7D' },
      ],
    },
  ];
}

// ----------------------------------------------------------------- round

export function roundTemplates(roundName: string): TemplateSpec[] {
  return [
    {
      key: 'round.motion_category', title: `${roundName} — motion category`, defaultOn: true, b: 300,
      rule: 'The category the CA team assigns on release. Ambiguity voids.',
      outcomes: MOTION_CATEGORIES.map((c, i) => ({ label: c, color: PAL[i % PAL.length] })),
    },
    {
      key: 'round.motion_type', title: `${roundName} — motion type`, defaultOn: false, b: 300,
      rule: "The released wording's opening construction.",
      outcomes: ['THW', 'THBT', 'THR', 'THP', 'Other']
        .map((c, i) => ({ label: c, color: PAL[i % PAL.length] })),
    },
    {
      key: 'round.infoslide', title: `${roundName} — info slide?`, defaultOn: false, b: 250,
      rule: 'Whether the released motion carries an info slide.',
      outcomes: [
        { label: 'Yes', color: '#7FD4A8' },
        { label: 'No', color: '#E4707A' },
      ],
    },
    {
      key: 'round.gov_vs_opp', title: `${roundName} — more 1sts: Gov or Opp`, defaultOn: false, b: 250,
      rule: 'Count of firsts across every room in the round. A tie voids.',
      outcomes: [
        { label: 'Government', color: '#DCA054' },
        { label: 'Opposition', color: '#5E96B4' },
      ],
    },
  ];
}

// ------------------------------------------------------------ tournament

export function tournamentTemplates(
  teams: Array<{ id?: string; name: string; speakers: string[] }>,
): TemplateSpec[] {
  const speakers = teams.flatMap((t) => t.speakers.map((s) => ({ s, team: t.name })));
  return [
    {
      key: 'tournament.winner', title: 'Tournament winner', defaultOn: true,
      b: defaultB(teams.length),
      rule: 'The team taking the 1st in the Grand Final.',
      outcomes: teams.map((t, i) => ({
        label: t.name, sublabel: t.speakers.join(' & '),
        color: PAL[i % PAL.length], tab_team_id: t.id,
      })),
    },
    {
      key: 'tournament.top_speaker', title: 'Top speaker', defaultOn: true,
      b: defaultB(speakers.length),
      rule: 'Top of the published speaker tab. Ties split.',
      outcomes: speakers.map((x, i) => ({
        label: x.s, sublabel: x.team, color: PAL[i % PAL.length],
      })),
    },
    {
      key: 'tournament.opening_final', title: 'Opening half wins the final?', defaultOn: false, b: 250,
      rule: 'Whether OG or OO takes the 1st in the Grand Final.',
      outcomes: [
        { label: 'Yes — opening half', color: '#DCA054' },
        { label: 'No — closing half', color: '#5E96B4' },
      ],
    },
    {
      key: 'tournament.esl_winner', title: 'ESL winner', defaultOn: false,
      b: defaultB(teams.length),
      rule: 'The ESL Final call.',
      outcomes: teams.map((t, i) => ({
        label: t.name, sublabel: t.speakers.join(' & '),
        color: PAL[i % PAL.length], tab_team_id: t.id,
      })),
    },
  ];
}

/** One market per team: "Does {team} break?" */
export function breakTemplates(
  teams: Array<{ id?: string; name: string }>,
): TemplateSpec[] {
  return teams.map((t) => ({
    key: `tournament.breaks:${t.id ?? t.name}`,
    title: `Does ${t.name} break?`,
    defaultOn: false,
    b: 250,
    rule: 'Presence on the published open break.',
    outcomes: [
      { label: 'Yes', color: '#7FD4A8' },
      { label: 'No', color: '#E4707A' },
    ],
  }));
}

/**
 * Templates a machine may resolve on its own (§8). Everything else — and every
 * custom market, always — waits for a human.
 */
export const AUTO_SETTLEABLE = new Set([
  'room.call', 'room.fourth', 'round.gov_vs_opp', 'tournament.winner',
]);
