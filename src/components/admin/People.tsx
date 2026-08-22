import { useEffect, useState } from 'react';
import { fetchAllProfiles, adjustBalance, setProfileFlags, importRegistrations } from '../../lib/api';
import { money, BISER } from '../../lib/format';
import { friendlyError } from '../../lib/errors';
import type { Profile, Tournament } from '../../lib/types';

/** Approvals, balances, roles, and the registration list that gates them. */
export default function People({ tournament }: { tournament: Tournament }) {
  const [rows, setRows] = useState<Profile[]>([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [paste, setPaste] = useState('');

  const load = () => fetchAllProfiles().then(setRows).catch((e) => setErr(friendlyError(e)));
  useEffect(() => { void load(); }, []);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setErr(''); setMsg('');
    try { await fn(); await load(); setMsg(done); }
    catch (e) { setErr(friendlyError(e)); }
  };

  async function importList() {
    // One row per person: email, name, speaker id, adj id — comma or tab separated.
    const rowsIn = paste.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [email, display_name, tab_speaker_id, tab_adj_id] = l.split(/[,\t]/).map((s) => s?.trim());
      return { email, display_name, tab_speaker_id, tab_adj_id };
    }).filter((r) => r.email?.includes('@'));
    if (!rowsIn.length) { setErr('No rows with an email address in that paste.'); return; }
    await act(() => importRegistrations(tournament.id, rowsIn),
      `${rowsIn.length} registrations imported. Matching accounts are approved as they sign in.`);
    setPaste('');
  }

  const pending = rows.filter((r) => !r.is_approved);

  return (
    <>
      <div className="admbox">
        <h3>Registration list · one account per person</h3>
        <div className="note" style={{ marginTop: 0 }}>
          Paste one person per line: <b>email, name, tab speaker id, tab adjudicator id</b>.
          An account whose email is not on this list can look but not bet, and the
          speaker/adjudicator ids are what stop people betting on their own rooms.
        </div>
        <div className="fieldrow">
          <div className="field">
            <textarea value={paste} onChange={(e) => setPaste(e.target.value)}
              placeholder={'ivan@example.com, Ivan Georgiev, 101,\nmaria@example.com, Maria Petrova, , adj-7'} />
          </div>
        </div>
        <div className="btnrow">
          <button className="btn adm" onClick={importList} disabled={!paste.trim()}>Import registrations</button>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="admbox">
          <h3>{pending.length} waiting for approval</h3>
          <div className="tablewrap">
            <table>
              <tbody>
                {pending.map((p) => (
                  <tr key={p.id}>
                    <td>{p.display_name}</td>
                    <td className="num">
                      <button className="btn sm adm"
                        onClick={() => act(() => setProfileFlags(p.id, { approved: true }), 'Approved.')}>
                        approve
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <h2>Traders<span className="mini">{rows.length}</span></h2>
        <div className="tablewrap scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Role</th><th className="num">Balance</th>
                <th>Tab ids</th><th className="num">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} style={p.is_active ? undefined : { opacity: .5 }}>
                  <td>
                    {p.display_name}
                    {!p.is_approved && <span className="tag">pending</span>}
                    {!p.is_active && <span className="tag">suspended</span>}
                  </td>
                  <td>{p.role === 'game_maker' ? 'game maker' : 'trader'}</td>
                  <td className="num">{money(p.balance)} {BISER}</td>
                  <td style={{ color: 'var(--faint)' }}>
                    {p.tab_speaker_id ? `sp ${p.tab_speaker_id}` : ''}
                    {p.tab_adj_id ? ` adj ${p.tab_adj_id}` : ''}
                  </td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn sm" onClick={() => {
                      const v = prompt(`Adjust ${p.display_name}'s balance by how much? (negative to take away)`);
                      const d = Number(v);
                      if (!v || !Number.isFinite(d) || d === 0) return;
                      const note = prompt('Why? (goes in the ledger)') ?? 'game maker adjustment';
                      void act(() => adjustBalance(p.id, d, note), 'Balance adjusted.');
                    }}>±</button>
                    {' '}
                    <button className="btn sm" onClick={() =>
                      act(() => setProfileFlags(p.id, { active: !p.is_active }),
                        p.is_active ? 'Suspended.' : 'Reinstated.')}>
                      {p.is_active ? 'suspend' : 'restore'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="note">
          Every adjustment is booked into the append-only ledger, so
          <b> verify ledger</b> keeps passing after one.
        </div>
        {err && <div className="err">{err}</div>}
        {msg && <div className="note" style={{ color: 'var(--good)' }}>{msg}</div>}
      </div>
    </>
  );
}
