import { useEffect, useState } from 'react';
import {
  upsertTabTeams, upsertTabRound, upsertTabDebates, fetchTabTeams, fetchTabRounds,
  fetchFlags, resolveFlag, updateTournament, type TabRound,
} from '../../lib/api';
import { parsePairings, parseTeams, looksSwing } from '../../lib/tab';
import { generateForRound, generateForTournament, describe } from '../../lib/generate';
import { friendlyError } from '../../lib/errors';
import type { Tournament } from '../../lib/types';

/**
 * The manual fallback (§8) — built before the poller, and kept after it.
 *
 * There is deliberately no "fetch from Calicotab" button here. A browser
 * cannot make that request: Calicotab sends no permissive CORS headers, and a
 * proxy workaround is worse than the fix. The live path is the `sync-tab` Edge
 * Function; this paste box is what works when the tab is closed, the network
 * is bad, or the tournament is not on Tabbycat at all.
 */
export default function TabImport({
  tournament, onChanged,
}: { tournament: Tournament; onChanged: () => void }) {
  const [rounds, setRounds] = useState<TabRound[]>([]);
  const [seq, setSeq] = useState('1');
  const [roundName, setRoundName] = useState('Round 1');
  const [paste, setPaste] = useState('');
  const [report, setReport] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [flags, setFlags] = useState<Array<Record<string, unknown>>>([]);
  const [teamCount, setTeamCount] = useState(0);

  const reload = () => {
    void fetchTabRounds(tournament.id).then(setRounds).catch(() => {});
    void fetchTabTeams(tournament.id).then((t) => setTeamCount(t.length)).catch(() => {});
    void fetchFlags(tournament.id)
      .then((f) => setFlags(f as unknown as Array<Record<string, unknown>>)).catch(() => {});
  };
  useEffect(reload, [tournament.id]);

  /**
   * Paste the draw, get markets. One press.
   *
   * `alsoGenerate` is the difference between this and the two-step path: with
   * it, the draw is mirrored AND the §11 launch set of markets is created for
   * the round and every full BP room in it. Without it you get the draw only,
   * and choose templates yourself in the Markets tab.
   *
   * Safe to press twice: the unique index on the template key means a re-import
   * of a redrawn round adds the new rooms and leaves the existing markets alone.
   */
  async function importPairings(alsoGenerate: boolean) {
    setBusy(true); setErr(''); setReport([]);
    try {
      const parsed = parsePairings(JSON.parse(paste));
      if (!parsed.debates.length) { setErr(parsed.warnings.join(' ')); return; }

      const teamRows = parsed.teams.map((t) => ({
        tournament_id: tournament.id, tab_id: t.tabId, name: t.name,
        speakers: t.speakerIds, speaker_names: t.speakerNames,
        is_swing: looksSwing(t.name),
      }));
      const savedTeams = await upsertTabTeams(teamRows);
      const idOf = new Map(savedTeams.map((t) => [t.tab_id, t.id]));

      const round = await upsertTabRound({
        tournament_id: tournament.id, seq: Number(seq) || 1,
        name: roundName || `Round ${seq}`, draw_released: true,
      });

      const debateRows = parsed.debates
        .filter((d) => d.teamTabIds.every((x) => x && idOf.has(x)))
        .map((d) => ({
          round_id: round.id, tab_id: d.tabId, venue: d.venue,
          team_ids: d.teamTabIds.map((x) => idOf.get(x as string) as string),
          adjudicator_ids: d.adjudicatorIds,
        }));
      const saved = await upsertTabDebates(debateRows);

      const swings = teamRows.filter((t) => t.is_swing).length;
      const lines = [
        `${savedTeams.length} teams saved${swings ? `, ${swings} marked as swings and excluded from every prior` : ''}.`,
        `${saved.length} rooms saved into ${round.name}.`,
        ...(parsed.debates.length - saved.length > 0
          ? [`${parsed.debates.length - saved.length} room(s) skipped — not a full four-team BP room.`] : []),
      ];

      if (alsoGenerate) {
        const all = await fetchTabTeams(tournament.id);
        const r = await generateForRound({
          tournament, round, debates: saved, teams: all,
        });
        lines.push(describe(r));
        if (r.created === 0 && r.existed > 0) {
          lines.push('Those markets were already there — nothing was duplicated.');
        }
        // Tournament-wide markets only make sense once the field is known, and
        // only need making once.
        const t = await generateForTournament({ tournament, teams: all });
        if (t.created > 0) lines.push(`Plus ${t.created} tournament-wide market(s).`);
      } else {
        lines.push('Draw imported. Create markets from the Markets tab when you are ready.');
      }

      setReport([...lines, ...parsed.warnings]);
      reload();
      onChanged();
    } catch (e) {
      setErr(e instanceof SyntaxError ? 'That is not valid JSON.' : friendlyError(e));
    } finally { setBusy(false); }
  }

  async function importTeamsOnly() {
    setBusy(true); setErr(''); setReport([]);
    try {
      const parsed = parseTeams(JSON.parse(paste));
      if (!parsed.teams.length) { setErr(parsed.warnings.join(' ')); return; }
      const saved = await upsertTabTeams(parsed.teams.map((t) => ({
        tournament_id: tournament.id, tab_id: t.tabId, name: t.name,
        speakers: t.speakerIds, speaker_names: t.speakerNames,
        is_swing: looksSwing(t.name),
      })));
      setReport([`${saved.length} teams saved.`, ...parsed.warnings]);
      reload(); onChanged();
    } catch (e) {
      setErr(e instanceof SyntaxError ? 'That is not valid JSON.' : friendlyError(e));
    } finally { setBusy(false); }
  }

  const base = tournament.tab_base_url ?? 'https://yourtournament.calicotab.com';
  const slug = tournament.tab_slug ?? 'open';

  return (
    <>
      <div className="admbox">
        <h3>Tab connection</h3>
        <div className="fieldrow" style={{ marginTop: 0 }}>
          <div className="field">
            <label>Tab base URL</label>
            <input defaultValue={tournament.tab_base_url ?? ''} placeholder="https://sofiaopen.calicotab.com"
              onBlur={(e) => void updateTournament(tournament.id, { tab_base_url: e.target.value.trim() || null })} />
          </div>
          <div className="field" style={{ flex: '0 0 140px' }}>
            <label>Tab slug</label>
            <input defaultValue={tournament.tab_slug ?? ''} placeholder="open"
              onBlur={(e) => void updateTournament(tournament.id, { tab_slug: e.target.value.trim() || null })} />
          </div>
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, fontSize: 12.5 }}>
          <input type="checkbox" defaultChecked={tournament.auto_settle_enabled} style={{ width: 'auto' }}
            onChange={(e) => void updateTournament(tournament.id, { auto_settle_enabled: e.target.checked })} />
          <span>
            Let the poller settle machine-resolvable markets on its own
            <span style={{ color: 'var(--faint)' }}> — off for a first tournament. Custom markets are never auto-settled, and anything ambiguous is flagged instead.</span>
          </span>
        </label>
      </div>

      <div className="admbox">
        <h3>Paste import · {teamCount} teams, {rounds.length} rounds so far</h3>
        <div className="note" style={{ marginTop: 0 }}>
          Open one of these in a browser tab, copy the JSON, and paste it below.
          A page cannot fetch it for you — Calicotab does not allow cross-site
          requests, which is a browser rule and not something to work around.
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, marginTop: 6, wordBreak: 'break-all' }}>
            {base}/api/v1/tournaments/{slug}/teams<br />
            {base}/api/v1/tournaments/{slug}/rounds/{seq}/pairings
          </div>
        </div>
        <div className="fieldrow">
          <div className="field" style={{ flex: '0 0 90px' }}>
            <label>Round seq</label>
            <input type="number" min={1} value={seq} onChange={(e) => setSeq(e.target.value)} />
          </div>
          <div className="field" style={{ flex: '0 0 160px' }}>
            <label>Round name</label>
            <input value={roundName} onChange={(e) => setRoundName(e.target.value)} />
          </div>
        </div>
        <div className="fieldrow">
          <div className="field">
            <label>Paste the JSON</label>
            <textarea value={paste} onChange={(e) => setPaste(e.target.value)} style={{ minHeight: 120 }} />
          </div>
        </div>
        <div className="btnrow">
          <button className="btn adm" disabled={busy || !paste.trim()}
            onClick={() => importPairings(true)}>
            Import draw &amp; make the markets
          </button>
          <button className="btn" disabled={busy || !paste.trim()}
            onClick={() => importPairings(false)}>
            Import draw only
          </button>
          <button className="btn" disabled={busy || !paste.trim()} onClick={importTeamsOnly}>
            Teams only
          </button>
        </div>
        <div className="note">
          <b>Import draw &amp; make the markets</b> does the lot: teams, rooms, and the
          launch set of markets — the call and the top speaker for every room, the
          motion category for the round, plus the tournament winner and top speaker.
          Everything else is a tick-box in the Markets tab. Pressing it twice is safe:
          a re-import after a redraw adds the new rooms and leaves existing markets alone.
        </div>
        {busy && <div className="note"><span className="spin" />Importing…</div>}
        {report.map((r, i) => <div className="note" key={i} style={{ color: 'var(--good)' }}>{r}</div>)}
        {err && <div className="err">{err}</div>}
      </div>

      <div className="admbox">
        <h3>Flag queue · {flags.length} open</h3>
        {flags.length === 0
          ? <div className="note" style={{ marginTop: 0 }}>Nothing flagged. The poller raises a flag here rather than guessing at a settlement.</div>
          : (
            <div className="tablewrap">
              <table>
                <tbody>
                  {flags.map((f) => (
                    <tr key={String(f.id)}>
                      <td>
                        <b>{String(f.kind)}</b>
                        {' '}{String((f.markets as Record<string, unknown> | null)?.title ?? '')}
                        <div style={{ color: 'var(--faint)', fontSize: 10 }}>
                          {JSON.stringify(f.detail)}
                        </div>
                      </td>
                      <td className="num">
                        <button className="btn sm" onClick={async () => {
                          await resolveFlag(Number(f.id)); reload();
                        }}>dismiss</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </>
  );
}
