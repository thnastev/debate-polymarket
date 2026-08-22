import { useEffect, useState } from 'react';
import { fetchTabTeams, upsertTabTeams, updateTournament, type TabTeam } from '../../lib/api';
import { rosterFromLedger, proposeMatches, type RosterEntry, type Ledger } from '../../lib/elo';
import { friendlyError } from '../../lib/errors';
import type { Tournament } from '../../lib/types';

/**
 * Elo import and name matching (§7).
 *
 * Two rules this screen exists to enforce:
 *  - Ratings are replayed from the event history, never read from `seedElo`.
 *  - Name matching is fuzzy and MUST be confirmed by a human. Tabbycat gives
 *    strings, the ledger gives strings, and they will disagree. Unmatched
 *    teams get no prior and open at uniform odds. Never silently guess.
 */
export default function EloPanel({
  tournament, onChanged,
}: { tournament: Tournament; onChanged: () => void }) {
  const [teams, setTeams] = useState<TabTeam[]>([]);
  const [paste, setPaste] = useState('');
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [summary, setSummary] = useState('');
  const [proposals, setProposals] = useState<Array<{
    speaker: string; teamId: string; match: RosterEntry | null; score: number; confirmed: boolean;
  }>>([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => fetchTabTeams(tournament.id).then(setTeams).catch(() => {});
  useEffect(() => { void load(); }, [tournament.id]);

  function loadLedger() {
    setErr(''); setMsg(''); setProposals([]);
    let d: Ledger;
    try { d = JSON.parse(paste); }
    catch { setErr('That is not valid JSON. Export from the ledger and paste the whole file.'); return; }
    if (!d?.people || !d?.events) {
      setErr('No people/events found — that does not look like a ledger export.'); return;
    }
    const { roster: r, swingsExcluded, events, medianRounds } = rosterFromLedger(d);
    setRoster(r);
    setSummary(
      `Replayed ${events} rounds into ${r.length} debaters. ` +
      `Median rounds per debater: ${medianRounds}. ` +
      (swingsExcluded ? `Excluded ${swingsExcluded} swing entr${swingsExcluded === 1 ? 'y' : 'ies'} — they are not people and would poison every prior they touched. ` : '') +
      (medianRounds < 15
        ? 'At this many rounds per debater the ratings are still mostly their seeds, so keep noise-widening on.'
        : ''),
    );

    // Propose, do not apply.
    const live = teams.filter((t) => !t.is_swing);
    const pairs = live.flatMap((t) => t.speaker_names.map((s) => ({ speaker: s, teamId: t.id })));
    const props = proposeMatches(pairs.map((p) => p.speaker), r);
    setProposals(pairs.map((p, i) => ({
      ...p, match: props[i].match, score: props[i].score,
      // Only a strong match is pre-ticked; everything else needs a human eye.
      confirmed: props[i].score >= 0.85,
    })));
  }

  async function applyConfirmed() {
    setErr(''); setMsg('');
    try {
      const byTeam = new Map<string, RosterEntry[]>();
      for (const p of proposals) {
        if (!p.confirmed || !p.match) continue;
        byTeam.set(p.teamId, [...(byTeam.get(p.teamId) ?? []), p.match]);
      }
      const rows: Array<Partial<TabTeam>> = [];
      let rated = 0;
      for (const t of teams) {
        const hits = byTeam.get(t.id) ?? [];
        // A team is rated only when BOTH of its debaters were confirmed. One
        // matched speaker and one guess is not a team rating.
        if (t.is_swing || hits.length < t.speaker_names.length || hits.length === 0) continue;
        rows.push({
          id: t.id, tournament_id: t.tournament_id, tab_id: t.tab_id, name: t.name,
          speakers: t.speakers, speaker_names: t.speaker_names,
          elo: Math.round(hits.reduce((a, h) => a + h.elo, 0) / hits.length),
          elo_rounds: Math.round(hits.reduce((a, h) => a + h.rounds, 0) / hits.length),
        });
        rated += 1;
      }
      if (!rows.length) { setErr('Nothing confirmed yet.'); return; }
      await upsertTabTeams(rows);
      await load(); onChanged();
      setMsg(`${rated} of ${teams.filter((t) => !t.is_swing).length} teams now rated. ` +
        'Unmatched teams stay unrated and their markets open at uniform odds.');
    } catch (e) { setErr(friendlyError(e)); }
  }

  const ratedCount = teams.filter((t) => t.elo != null && !t.is_swing).length;
  const liveCount = teams.filter((t) => !t.is_swing).length;

  return (
    <>
      <div className="admbox">
        <h3>Elo settings</h3>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5 }}>
          <input type="checkbox" defaultChecked={tournament.use_elo} style={{ width: 'auto', marginTop: 3 }}
            onChange={(e) => void updateTournament(tournament.id, { use_elo: e.target.checked }).then(onChanged)} />
          <span>
            <b>Seed new markets from Elo.</b>
            <span style={{ color: 'var(--faint)' }}>
              {' '}Off is a first-class mode, not a degraded one: every market opens with
              every outcome at identical odds, which is a pure test of the room&apos;s judgement.
            </span>
          </span>
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, marginTop: 8 }}>
          <input type="checkbox" defaultChecked={tournament.elo_widen} style={{ width: 'auto', marginTop: 3 }}
            onChange={(e) => void updateTournament(tournament.id, { elo_widen: e.target.checked }).then(onChanged)} />
          <span>
            <b>Widen noise for low-round debaters.</b>
            <span style={{ color: 'var(--faint)' }}>
              {' '}Without this the Monte Carlo prints confident numbers like 8% that are not
              backed by 8%-worth of evidence. With it the same team prices near 15%.
            </span>
          </span>
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, marginTop: 8 }}>
          <input type="checkbox" defaultChecked={tournament.show_prior_to_traders} style={{ width: 'auto', marginTop: 3 }}
            onChange={(e) => void updateTournament(tournament.id, { show_prior_to_traders: e.target.checked }).then(onChanged)} />
          <span>
            <b>Show the Elo prior to traders</b>
            <span style={{ color: 'var(--faint)' }}> — the dotted line on the chart.</span>
          </span>
        </label>
        <div className="note">{ratedCount} of {liveCount} teams currently carry a rating.</div>
      </div>

      <div className="admbox">
        <h3>Import a BP Elo Ledger export</h3>
        <div className="fieldrow" style={{ marginTop: 0 }}>
          <div className="field">
            <label>Paste bp-elo-ledger-YYYY-MM-DD.json</label>
            <textarea value={paste} onChange={(e) => setPaste(e.target.value)} style={{ minHeight: 100 }} />
          </div>
        </div>
        <div className="btnrow">
          <button className="btn adm" disabled={!paste.trim()} onClick={loadLedger}>
            Replay ledger &amp; propose matches
          </button>
        </div>
        {summary && <div className="note">{summary}</div>}
      </div>

      {proposals.length > 0 && (
        <div className="admbox">
          <h3>Confirm the name matches · {proposals.filter((p) => p.confirmed).length} ticked</h3>
          <div className="note" style={{ marginTop: 0 }}>
            These are <b>proposals</b>. Tabbycat and the ledger spell people differently
            (&quot;Ivan Georgiev&quot; / &quot;Иван Георгиев&quot; / &quot;Ivan G.&quot;), so nothing is applied until
            you tick it. A team is only rated when both its debaters are confirmed;
            the rest open at uniform odds.
          </div>
          <div className="tablewrap scroll">
            <table>
              <thead>
                <tr><th></th><th>Tab name</th><th>Ledger match</th><th className="num">Elo</th>
                  <th className="num">Rounds</th><th className="num">Confidence</th></tr>
              </thead>
              <tbody>
                {proposals.map((p, i) => (
                  <tr key={i} style={p.match ? undefined : { opacity: .55 }}>
                    <td>
                      <input type="checkbox" checked={p.confirmed} disabled={!p.match}
                        onChange={() => setProposals((all) =>
                          all.map((x, k) => (k === i ? { ...x, confirmed: !x.confirmed } : x)))} />
                    </td>
                    <td>{p.speaker}</td>
                    <td>
                      {p.match
                        ? (
                          <select value={p.match.name} onChange={(e) => setProposals((all) =>
                            all.map((x, k) => (k === i
                              ? { ...x, match: roster.find((r) => r.name === e.target.value) ?? null }
                              : x)))}>
                            {roster.map((r) => <option key={r.name}>{r.name}</option>)}
                          </select>
                        )
                        : <span style={{ color: 'var(--warn)' }}>no match — stays unrated</span>}
                    </td>
                    <td className="num">{p.match?.elo ?? '—'}</td>
                    <td className="num">{p.match?.rounds ?? '—'}</td>
                    <td className="num" style={{ color: p.score >= 0.85 ? 'var(--good)' : 'var(--admin)' }}>
                      {(p.score * 100).toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="btnrow">
            <button className="btn adm" onClick={applyConfirmed}>Apply confirmed matches</button>
          </div>
        </div>
      )}

      {err && <div className="err">{err}</div>}
      {msg && <div className="note" style={{ color: 'var(--good)' }}>{msg}</div>}
    </>
  );
}
