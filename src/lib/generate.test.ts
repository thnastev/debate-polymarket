import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * What "Import draw & make the markets" actually creates. The §11 rule is that
 * a launch set beats a wall of dead markets, so the default must be five kinds
 * and not everything the templates can produce.
 */
const createMarket = vi.fn();
vi.mock('./api', () => ({ createMarket: (...a: unknown[]) => createMarket(...a) }));

let gen: typeof import('./generate');
beforeEach(async () => {
  vi.resetModules();
  createMarket.mockReset().mockResolvedValue('new-id');
  gen = await import('./generate');
});

const team = (id: string, name: string, over = {}) => ({
  id, tournament_id: 't', tab_id: id, name,
  speakers: [`${id}a`, `${id}b`], speaker_names: [`${name} One`, `${name} Two`],
  elo: null as number | null, elo_rounds: 0, is_swing: false, ...over,
});
const teams = [team('1', 'Sofia A'), team('2', 'Sofia B'), team('3', 'NBU 1'), team('4', 'Varna 1')];
const round = { id: 'r1', tournament_id: 't', seq: 1, name: 'Round 1',
  draw_released: true, results_in: false, motion: null, motion_category: null };
const debate = (id: string, venue: string, ids: string[]) => ({
  id, round_id: 'r1', tab_id: id, venue, team_ids: ids, adjudicator_ids: [], result_json: null });

const tournament = {
  id: 't', name: 'Gen Open', slug: 'gen', tab_base_url: null, tab_slug: null,
  starting_balance: 1000, use_elo: false, is_active: true,
  self_bet_policy: 'block' as const, elo_widen: true,
  show_prior_to_traders: true, auto_settle_enabled: false,
};

const keysCreated = () =>
  createMarket.mock.calls.map((c) => (c[0] as { templateKey: string }).templateKey);

describe('one-press generation', () => {
  it('creates the §11 launch set for a round, not every template', async () => {
    const r = await gen.generateForRound({
      tournament, round, teams,
      debates: [debate('d1', 'Aula 1', ['1', '2', '3', '4'])],
    });
    const keys = keysCreated();
    expect(keys).toContain('room.call');
    expect(keys).toContain('room.top_speaker');
    expect(keys).toContain('round.motion_category');
    // Off by default — one checkbox away in the Markets tab.
    expect(keys).not.toContain('room.fourth');
    expect(keys).not.toContain('room.split');
    expect(keys).not.toContain('round.infoslide');
    expect(r.created).toBe(keys.length);
  });

  it('makes one set of room markets per room', async () => {
    await gen.generateForRound({
      tournament, round, teams,
      debates: [
        debate('d1', 'Aula 1', ['1', '2', '3', '4']),
        debate('d2', 'Aula 2', ['4', '3', '2', '1']),
      ],
    });
    expect(keysCreated().filter((k) => k === 'room.call')).toHaveLength(2);
    // …but only one round-scope market for the round itself.
    expect(keysCreated().filter((k) => k === 'round.motion_category')).toHaveLength(1);
  });

  it('titles room markets with the round and venue', async () => {
    await gen.generateForRound({
      tournament, round, teams, debates: [debate('d1', 'Aula 1', ['1', '2', '3', '4'])],
    });
    const call = createMarket.mock.calls
      .map((c) => c[0] as { templateKey: string; title: string })
      .find((a) => a.templateKey === 'room.call');
    expect(call!.title).toBe('Round 1 · Aula 1 — The call');
  });

  it('skips a room that is not a full four-team BP draw', async () => {
    await gen.generateForRound({
      tournament, round, teams,
      debates: [
        debate('d1', 'Aula 1', ['1', '2', '3', '4']),
        debate('d2', 'Aula 2', ['1', '2', 'missing', '4']),
      ],
    });
    // The quadrant and every room template assume four benches.
    expect(keysCreated().filter((k) => k === 'room.call')).toHaveLength(1);
  });

  it('counts an existing market as existed, not created, and does not throw', async () => {
    createMarket
      .mockRejectedValueOnce(new Error('duplicate key value violates unique constraint "markets_template_uniq"'))
      .mockResolvedValue('id');
    const r = await gen.generateForRound({
      tournament, round, teams, debates: [debate('d1', 'Aula 1', ['1', '2', '3', '4'])],
    });
    expect(r.existed).toBe(1);
    expect(r.created).toBeGreaterThan(0);
  });

  it('lets a real failure through rather than silently swallowing it', async () => {
    createMarket.mockRejectedValue(new Error('forbidden_not_game_maker'));
    await expect(gen.generateForRound({
      tournament, round, teams, debates: [debate('d1', 'Aula 1', ['1', '2', '3', '4'])],
    })).rejects.toThrow(/forbidden/);
  });

  it('opens everything uniform when Elo is off', async () => {
    await gen.generateForRound({
      tournament, round, teams, debates: [debate('d1', 'Aula 1', ['1', '2', '3', '4'])],
    });
    for (const c of createMarket.mock.calls) {
      expect((c[0] as { prior: unknown; seeded: boolean }).prior).toBeNull();
      expect((c[0] as { seeded: boolean }).seeded).toBe(false);
    }
  });

  it('seeds from Elo only when every team in the market is rated', async () => {
    const rated = teams.map((t) => ({ ...t, elo: 1700 + Number(t.id) * 40, elo_rounds: 12 }));
    await gen.generateForRound({
      tournament: { ...tournament, use_elo: true }, round, teams: rated,
      debates: [debate('d1', 'Aula 1', ['1', '2', '3', '4'])],
    });
    const call = createMarket.mock.calls
      .map((c) => c[0] as { templateKey: string; prior: number[] | null; seeded: boolean })
      .find((a) => a.templateKey === 'room.call');
    expect(call!.seeded).toBe(true);
    expect(call!.prior).toHaveLength(4);
    expect(call!.prior!.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);

    // room.top_speaker's outcomes are speakers, not teams, so it has no prior.
    const top = createMarket.mock.calls
      .map((c) => c[0] as { templateKey: string; prior: unknown })
      .find((a) => a.templateKey === 'room.top_speaker');
    expect(top!.prior).toBeNull();
  });

  it('never seeds a market containing a swing team', async () => {
    const withSwing = [
      { ...teams[0], elo: 1800, elo_rounds: 10 },
      { ...teams[1], elo: 1750, elo_rounds: 10 },
      { ...teams[2], elo: 1700, elo_rounds: 10 },
      { ...teams[3], elo: 1650, elo_rounds: 10, is_swing: true },
    ];
    await gen.generateForRound({
      tournament: { ...tournament, use_elo: true }, round, teams: withSwing,
      debates: [debate('d1', 'Aula 1', ['1', '2', '3', '4'])],
    });
    const call = createMarket.mock.calls
      .map((c) => c[0] as { templateKey: string; prior: unknown })
      .find((a) => a.templateKey === 'room.call');
    expect(call!.prior).toBeNull();
  });

  it('generates the tournament launch set, and nothing when the field is too small', async () => {
    const r = await gen.generateForTournament({ tournament, teams });
    const keys = keysCreated();
    expect(keys).toContain('tournament.winner');
    expect(keys).toContain('tournament.top_speaker');
    expect(keys).not.toContain('tournament.esl_winner');
    expect(r.created).toBe(keys.length);

    createMarket.mockClear();
    const none = await gen.generateForTournament({ tournament, teams: [teams[0]] });
    expect(none.created).toBe(0);
    expect(createMarket).not.toHaveBeenCalled();
  });

  it('describes the result in plain words', async () => {
    expect(gen.describe({ created: 9, existed: 0, seeded: 0, titles: [] }))
      .toBe('9 markets created.');
    expect(gen.describe({ created: 1, existed: 8, seeded: 1, titles: [] }))
      .toBe('1 market created, 8 already existed, 1 seeded from Elo.');
    expect(gen.describe({ created: 0, existed: 0, seeded: 0, titles: [] }))
      .toBe('Nothing to create.');
  });
});
