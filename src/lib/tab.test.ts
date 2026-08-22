import { describe, it, expect } from 'vitest';
import { parsePairings, parseTeams, looksSwing } from './tab';

/** Shaped after a real Tabbycat /rounds/{seq}/pairings response. */
const PAIRINGS = [
  {
    id: 41,
    url: 'https://x.calicotab.com/api/v1/tournaments/open/rounds/1/pairings/41/',
    venue: { id: 3, name: 'Aula 1' },
    teams: [
      { team: 'https://x.calicotab.com/api/v1/tournaments/open/teams/7/', side: 'og' },
      { team: 'https://x.calicotab.com/api/v1/tournaments/open/teams/8/', side: 'oo' },
      { team: 'https://x.calicotab.com/api/v1/tournaments/open/teams/9/', side: 'cg' },
      { team: 'https://x.calicotab.com/api/v1/tournaments/open/teams/10/', side: 'co' },
    ],
    adjudicators: {
      chair: 'https://x.calicotab.com/api/v1/tournaments/open/adjudicators/5/',
      panellists: ['https://x.calicotab.com/api/v1/tournaments/open/adjudicators/6/'],
      trainees: [],
    },
  },
  {
    id: 42,
    venue: 'Aula 2',
    teams: [
      { team: { id: 11, short_name: 'NBU 1', speakers: [{ id: 21, name: 'Nikola Denchev' }, { id: 22, name: 'Stefani Ivanova' }] }, side: 0 },
      { team: { id: 12, short_name: 'Varna 1', speakers: [{ id: 23, name: 'Sava Popov' }, { id: 24, name: 'Kosta B' }] }, side: 1 },
      { team: { id: 13, short_name: 'AUBG A', speakers: [] }, side: 2 },
      { team: { id: 14, short_name: 'Swing 1', speakers: [] }, side: 3 },
    ],
    adjudicators: [{ id: 9 }],
  },
];

describe('Tabbycat pairings parser (§8 manual fallback)', () => {
  it('reads rooms, venues and BP seating order', () => {
    const r = parsePairings(PAIRINGS);
    expect(r.debates).toHaveLength(2);
    expect(r.debates[0].venue).toBe('Aula 1');
    expect(r.debates[0].teamTabIds).toEqual(['7', '8', '9', '10']);
    expect(r.debates[1].venue).toBe('Aula 2');
    expect(r.debates[1].teamTabIds).toEqual(['11', '12', '13', '14']);
  });

  it('extracts ids from API urls and from inline objects alike', () => {
    const r = parsePairings(PAIRINGS);
    expect(r.teams.map((t) => t.tabId).sort()).toEqual(
      ['10', '11', '12', '13', '14', '7', '8', '9']);
  });

  it('reads chair, panellists and trainees into one adjudicator list', () => {
    const r = parsePairings(PAIRINGS);
    // This list is what blocks a judge from betting on their own room.
    expect(r.debates[0].adjudicatorIds).toEqual(['5', '6']);
    expect(r.debates[1].adjudicatorIds).toEqual(['9']);
  });

  it('keeps speaker names and ids when the response inlines them', () => {
    const r = parsePairings(PAIRINGS);
    const nbu = r.teams.find((t) => t.tabId === '11')!;
    expect(nbu.name).toBe('NBU 1');
    expect(nbu.speakerNames).toEqual(['Nikola Denchev', 'Stefani Ivanova']);
    expect(nbu.speakerIds).toEqual(['21', '22']);
  });

  it('accepts a paginated { results: [...] } envelope', () => {
    expect(parsePairings({ results: PAIRINGS }).debates).toHaveLength(2);
  });

  it('warns rather than inventing a room when a bench is missing', () => {
    const partial = [{ id: 1, venue: 'X', teams: [{ team: { id: 1 }, side: 'og' }] }];
    const r = parsePairings(partial);
    expect(r.debates[0].teamTabIds).toEqual(['1', null, null, null]);
    expect(r.warnings.join(' ')).toMatch(/not a full four-team BP room/);
  });

  it('reports an empty or unrecognised payload instead of throwing', () => {
    expect(parsePairings([]).warnings[0]).toMatch(/No pairings/);
    expect(parsePairings({ nonsense: true }).warnings[0]).toMatch(/No pairings/);
  });

  it('parses a plain /teams response too', () => {
    const r = parseTeams([{ id: 7, short_name: 'Sofia A', speakers: [{ id: 1, name: 'A B' }] }]);
    expect(r.teams[0]).toMatchObject({ tabId: '7', name: 'Sofia A', speakerNames: ['A B'] });
  });

  it('spots swings by name so they can be excluded from every prior', () => {
    expect(looksSwing('Swing 1')).toBe(true);
    expect(looksSwing('SWING TEAM')).toBe(true);
    expect(looksSwing('Sofia A')).toBe(false);
  });
});
