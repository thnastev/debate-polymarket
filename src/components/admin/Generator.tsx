import { useEffect, useState } from 'react';
import {
  fetchTabTeams, fetchTabRounds, fetchTabDebates, createMarket,
  type TabTeam, type TabRound, type TabDebate,
} from '../../lib/api';
import {
  roomTemplates, roundTemplates, tournamentTemplates, breakTemplates,
  defaultB, subsidyWarning, BP_POSITIONS, type TemplateSpec,
} from '../../lib/templates';
import { priorForTeams } from '../../lib/elo';
import { friendlyError } from '../../lib/errors';
import type { Tournament } from '../../lib/types';

/**
 * Market generation by scope (§11).
 *
 * Not everything at once: thirty markets nobody trades looks worse than five
 * that are busy, so only the five §11 names are ticked by default and the rest
 * are one checkbox away.
 */
export default function Generator({
  tournament, onCreated,
}: { tournament: Tournament; onCreated: () => void }) {
  const [teams, setTeams] = useState<TabTeam[]>([]);
  const [rounds, setRounds] = useState<TabRound[]>([]);
  const [roundId, setRoundId] = useState('');
  const [debates, setDebates] = useState<TabDebate[]>([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    void fetchTabTeams(tournament.id).then(setTeams).catch(() => {});
    void fetchTabRounds(tournament.id).then((r) => {
      setRounds(r);
      if (r.length && !roundId) setRoundId(r[0].id);
    }).catch(() => {});
  }, [tournament.id]);

  useEffect(() => {
    if (!roundId) { setDebates([]); return; }
    void fetchTabDebates(roundId).then(setDebates).catch(() => {});
  }, [roundId]);

  const round = rounds.find((r) => r.id === roundId);
  const byId = new Map(teams.map((t) => [t.id, t]));
  const liveTeams = teams.filter((t) => !t.is_swing);

  // Build the full candidate list for whichever scope has data.
  const roomSpecs: Array<{ debate: TabDebate; specs: TemplateSpec[] }> = debates.map((d) => {
    const ts = d.team_ids.map((id) => byId.get(id));
    const names = ts.map((t) => t?.name ?? '—');
    const speakers = ts.flatMap((t, i) =>
      (t?.speaker_names ?? []).map((s) => ({ name: s, position: BP_POSITIONS[i] })));
    return { debate: d, specs: roomTemplates(names, speakers, d.team_ids) };
  });
  const roundSpecs = round ? roundTemplates(round.name) : [];
  const tourSpecs = [
    ...tournamentTemplates(liveTeams.map((t) => ({
      id: t.id, name: t.name, speakers: t.speaker_names,
    }))),
    ...breakTemplates(liveTeams.map((t) => ({ id: t.id, name: t.name }))),
  ];

  const on = (key: string, spec: TemplateSpec) => picked[key] ?? spec.defaultOn;
  const toggle = (key: string, spec: TemplateSpec) =>
    setPicked((p) => ({ ...p, [key]: !on(key, spec) }));

  async function generate(
    specs: TemplateSpec[], scope: 'room' | 'round' | 'tournament',
    ids: { roundId?: string; debateId?: string } = {},
    prefix = '',
  ) {
    setBusy(true); setErr(''); setMsg('');
    let made = 0, skipped = 0;
    try {
      for (const s of specs) {
        if (!on(prefix + s.key, s)) continue;
        const n = s.outcomes.length;
        const b = s.b ?? defaultB(n);
        // Elo seeding only when the tournament says so AND every outcome maps
        // to a rated, non-swing team. Anything else opens uniform (§7).
        const prior = tournament.use_elo
          ? priorForTeams(s.outcomes.map((o) => o.tab_team_id ? byId.get(o.tab_team_id) ?? null : null),
                          tournament.elo_widen)
          : null;
        try {
          await createMarket({
            tournamentId: tournament.id,
            scope, title: prefix ? `${prefix}${s.title}` : s.title,
            rule: s.rule, outcomes: s.outcomes, b, layout: s.layout ?? 'list',
            resolver: 'Game maker', prior, seeded: Boolean(prior),
            roundId: ids.roundId ?? null, debateId: ids.debateId ?? null,
            templateKey: s.key,
          });
          made += 1;
        } catch (e) {
          // The unique index on (tournament, template_key, debate/round) means
          // running this twice creates nothing twice. That is a feature.
          if (/duplicate key|markets_template_uniq/i.test(String(e))) skipped += 1;
          else throw e;
        }
      }
      setMsg(`${made} market${made === 1 ? '' : 's'} created${skipped ? `, ${skipped} already existed` : ''}.`);
      onCreated();
    } catch (e) { setErr(friendlyError(e)); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div className="admbox">
        <h3>Whole tournament · {liveTeams.length} teams</h3>
        {liveTeams.length === 0
          ? <div className="note" style={{ marginTop: 0 }}>No teams imported yet — use the Tab import tab.</div>
          : (
            <>
              <Picks specs={tourSpecs} on={on} toggle={toggle}
                startingBalance={tournament.starting_balance} />
              <div className="btnrow">
                <button className="btn adm" disabled={busy}
                  onClick={() => generate(tourSpecs, 'tournament')}>
                  Generate tournament markets
                </button>
              </div>
            </>
          )}
      </div>

      <div className="admbox">
        <h3>Round scope</h3>
        {rounds.length === 0
          ? <div className="note" style={{ marginTop: 0 }}>No rounds yet.</div>
          : (
            <>
              <div className="fieldrow" style={{ marginTop: 0 }}>
                <div className="field">
                  <label>Round</label>
                  <select value={roundId} onChange={(e) => setRoundId(e.target.value)}>
                    {rounds.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}{r.draw_released ? ' — draw out' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <Picks specs={roundSpecs} on={on} toggle={toggle}
                startingBalance={tournament.starting_balance} />
              <div className="btnrow">
                <button className="btn adm" disabled={busy || !round}
                  onClick={() => generate(roundSpecs, 'round', { roundId })}>
                  Generate round markets
                </button>
              </div>
            </>
          )}
      </div>

      <div className="admbox">
        <h3>Room by room · {debates.length} rooms in {round?.name ?? '—'}</h3>
        {debates.length === 0
          ? (
            <div className="note" style={{ marginTop: 0 }}>
              No draw for this round yet. Room markets read the draw — pull it in
              from the Tab import tab once it is released.
            </div>
          )
          : (
            <>
              {roomSpecs[0] && (
                <Picks specs={roomSpecs[0].specs} on={on} toggle={toggle}
                  startingBalance={tournament.starting_balance} />
              )}
              <div className="note">
                The ticked templates are created for <b>every</b> room in the round.
              </div>
              <div className="btnrow">
                <button className="btn adm" disabled={busy} onClick={async () => {
                  for (const r of roomSpecs) {
                    await generate(r.specs, 'room',
                      { roundId, debateId: r.debate.id },
                      `${round?.name} · ${r.debate.venue} — `);
                  }
                }}>
                  Generate for all {debates.length} rooms
                </button>
              </div>
            </>
          )}
      </div>

      {busy && <div className="note"><span className="spin" />Working…</div>}
      {msg && <div className="note" style={{ color: 'var(--good)' }}>{msg}</div>}
      {err && <div className="err">{err}</div>}
    </>
  );
}

function Picks({
  specs, on, toggle, startingBalance,
}: {
  specs: TemplateSpec[]; on: (k: string, s: TemplateSpec) => boolean;
  toggle: (k: string, s: TemplateSpec) => void; startingBalance: number;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
      {specs.map((s) => {
        const n = s.outcomes.length;
        const b = s.b ?? defaultB(n);
        const warn = subsidyWarning(b, n, startingBalance);
        return (
          <label key={s.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5 }}>
            <input type="checkbox" checked={on(s.key, s)} onChange={() => toggle(s.key, s)}
              style={{ width: 'auto', marginTop: 3 }} />
            <span>
              {s.title}
              <span style={{ color: 'var(--faint)', fontFamily: 'var(--mono)', fontSize: 10 }}>
                {' '}· {n} ways · b={b} · caps {(b * Math.log(n)).toFixed(0)} ƀ
              </span>
              {warn && <span style={{ color: 'var(--warn)', display: 'block', fontSize: 11 }}>{warn}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}
