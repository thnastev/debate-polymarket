import { useState } from 'react';
import { updateMarket, settleMarket, voidMarket, deleteMarket } from '../lib/api';
import { prices, maxSubsidy } from '../lib/lmsr';
import { adminPercent, BISER } from '../lib/format';
import { subsidyWarning } from '../lib/templates';
import { friendlyError } from '../lib/errors';
import { useSession } from '../lib/session';
import type { Market, Outcome, MarketStatus } from '../lib/types';

/** Per-market game-maker controls: edit, close, settle, void, delete. */
export default function MarketAdmin({
  market, outcomes, onChanged,
}: { market: Market; outcomes: Outcome[]; onChanged: () => Promise<void> }) {
  const { tournament } = useSession();
  const [title, setTitle] = useState(market.title);
  const [rule, setRule] = useState(market.resolution_rule);
  const [resolver, setResolver] = useState(market.resolver_name);
  const [b, setB] = useState(String(market.b));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const p = prices(outcomes.map((o) => o.q), market.b);
  const n = outcomes.length;
  const warn = subsidyWarning(Number(b) || market.b, n, tournament?.starting_balance ?? 1000);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true); setErr(''); setMsg('');
    try { await fn(); await onChanged(); setMsg(done); }
    catch (e) { setErr(friendlyError(e)); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="fieldrow" style={{ marginTop: 0 }}>
        <div className="field" style={{ flex: 2 }}>
          <label>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field" style={{ flex: '0 0 110px' }}>
          <label>Liquidity b</label>
          <input type="number" step={10} value={b} onChange={(e) => setB(e.target.value)} />
        </div>
      </div>
      <div className="fieldrow">
        <div className="field">
          <label>Resolution rule — write it so it can&apos;t be argued with</label>
          <textarea value={rule} onChange={(e) => setRule(e.target.value)} />
        </div>
      </div>
      <div className="fieldrow">
        <div className="field" style={{ flex: '0 0 200px' }}>
          <label>Resolver</label>
          <input value={resolver} onChange={(e) => setResolver(e.target.value)} />
        </div>
      </div>

      {Number(b) !== market.b && (
        <div className="note">
          Changing b re-derives q so every current price is held exactly where it is.
          Changing b alone would silently move all of them.
        </div>
      )}
      {warn && <div className="note warn">{warn}</div>}

      <div className="btnrow">
        <button className="btn adm" disabled={busy} onClick={() => run(
          () => updateMarket(market.id, {
            title, rule, resolver, b: Number(b) || market.b,
          }), 'Saved.')}>Save changes</button>
        <button className="btn" disabled={busy} onClick={() => run(
          () => updateMarket(market.id, {
            status: (market.status === 'open' ? 'closed' : 'open') as MarketStatus,
          }), market.status === 'open' ? 'Betting closed.' : 'Betting reopened.')}>
          {market.status === 'open' ? 'Close betting' : 'Reopen betting'}
        </button>
      </div>

      <div className="admbox" style={{ marginTop: 13 }}>
        <h3>Settle this market</h3>
        <div className="resgrid">
          {outcomes.map((o, i) => (
            <button
              key={o.id} className="btn sm" style={{ borderColor: o.color }} disabled={busy}
              onClick={() => {
                if (!confirm(
                  `Settle "${market.title}" as ${o.label}?\n\n` +
                  `Every ${o.label} share pays 1 ${BISER}; everything else pays nothing. ` +
                  `This cannot be undone.`)) return;
                void run(() => settleMarket(market.id, i), `${o.label} settled.`);
              }}
            >{o.label}</button>
          ))}
        </div>
        <div className="note" style={{ marginBottom: 0 }}>
          Pays 1 {BISER} per share of the winner. Can&apos;t be undone.
        </div>
      </div>

      <div className="admbox" style={{ borderColor: 'var(--warn)' }}>
        <h3 style={{ color: 'var(--warn)' }}>Void or delete</h3>
        <div className="note" style={{ marginTop: 0 }}>
          <b>A void refunds each trader what they NET paid in.</b> Someone who bought
          for 40 and cashed out half for 25 gets 15 back. It is not a return to the
          starting balance and it is not a payout at current prices.
        </div>
        <div className="btnrow">
          <button className="btn dang" disabled={busy} onClick={() => {
            const reason = prompt('Why is this being voided? (shown to traders)');
            if (!reason) return;
            void run(() => voidMarket(market.id, reason), 'Voided and refunded.');
          }}>Void &amp; refund</button>
          <button className="btn dang" disabled={busy} onClick={() => {
            if (!confirm('Delete this market? Every bet on it is refunded first.')) return;
            void run(() => deleteMarket(market.id, 'deleted by game maker'), 'Deleted.');
          }}>Delete market</button>
        </div>
      </div>

      <div className="note">
        <b>Raw state.</b> q = [{outcomes.map((o) => o.q.toFixed(1)).join(', ')}]
        {' '}· prices {p.map((x) => adminPercent(x)).join(' / ')}
        {' '}· maker exposure cap {maxSubsidy(market.b, n).toFixed(0)} {BISER}
        {' '}· template {market.template_key ?? 'none'}
      </div>
      {err && <div className="err">{err}</div>}
      {msg && <div className="note" style={{ color: 'var(--good)' }}>{msg}</div>}
    </>
  );
}
