import { useState } from 'react';
import { createMarket } from '../../lib/api';
import { PAL, defaultB, subsidyWarning } from '../../lib/templates';
import { friendlyError } from '../../lib/errors';
import { BISER } from '../../lib/format';
import type { Tournament } from '../../lib/types';

/**
 * Custom markets — the most fun and the most training-relevant kind, and the
 * ones that are NEVER auto-settled (§8, §11).
 */
export default function CustomBuilder({
  tournament, onCreated, resolverName,
}: { tournament: Tournament; onCreated: () => void; resolverName: string }) {
  const [title, setTitle] = useState('');
  const [rule, setRule] = useState('');
  const [labels, setLabels] = useState('Yes\nNo');
  const [b, setB] = useState('250');
  const [resolver, setResolver] = useState(resolverName);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const outcomes = labels.split('\n').map((s) => s.trim()).filter(Boolean);
  const n = outcomes.length;
  const bNum = Number(b) || defaultB(n);
  const warn = subsidyWarning(bNum, Math.max(n, 2), tournament.starting_balance);
  const valid = title.trim().length > 2 && rule.trim().length > 5 && n >= 2 && n <= 12;

  async function create() {
    setBusy(true); setErr(''); setMsg('');
    try {
      await createMarket({
        tournamentId: tournament.id, scope: 'custom',
        title: title.trim(), rule: rule.trim(),
        outcomes: outcomes.map((l, i) => ({ label: l, color: PAL[i % PAL.length] })),
        b: bNum, resolver: resolver.trim() || 'Game maker',
      });
      setTitle(''); setRule(''); setLabels('Yes\nNo');
      setMsg('Market created.');
      onCreated();
    } catch (e) { setErr(friendlyError(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="admbox">
      <h3>Custom market</h3>
      <div className="fieldrow" style={{ marginTop: 0 }}>
        <div className="field">
          <label>Question</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Will CG's extension be a counter-model?" />
        </div>
      </div>
      <div className="fieldrow">
        <div className="field">
          <label>Resolution rule — every real dispute is a wording dispute</label>
          <textarea value={rule} onChange={(e) => setRule(e.target.value)}
            placeholder="Resolves Yes if the CG whip or member introduces a distinct counter-model, as judged by the resolver from the recording." />
        </div>
      </div>
      <div className="fieldrow">
        <div className="field">
          <label>Outcomes, one per line (2–12)</label>
          <textarea value={labels} onChange={(e) => setLabels(e.target.value)} />
        </div>
      </div>
      <div className="fieldrow">
        <div className="field" style={{ flex: '0 0 100px' }}>
          <label>b</label>
          <input type="number" step={10} value={b} onChange={(e) => setB(e.target.value)} />
        </div>
        <div className="field" style={{ flex: '0 0 180px' }}>
          <label>Resolver</label>
          <input value={resolver} onChange={(e) => setResolver(e.target.value)} />
        </div>
        <div className="field" style={{ flex: '0 0 auto' }}>
          <button className="btn adm" disabled={busy || !valid} onClick={create}>Create market</button>
        </div>
      </div>
      <div className="note" style={{ marginTop: 4 }}>
        {n >= 2
          ? <>{n} outcomes at b={bNum} — this market prints at most {(bNum * Math.log(n)).toFixed(0)} {BISER}.</>
          : 'Give it at least two outcomes.'}
      </div>
      {warn && <div className="note warn">{warn}</div>}
      <div className="note">
        Custom markets are <b>never</b> settled automatically. You resolve this one by hand.
      </div>
      {err && <div className="err">{err}</div>}
      {msg && <div className="note" style={{ color: 'var(--good)' }}>{msg}</div>}
    </div>
  );
}
