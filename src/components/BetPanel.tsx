import { useEffect, useMemo, useRef, useState } from 'react';
import { prices, sharesForStake, tradeCost } from '../lib/lmsr';
import {
  money, shares as shf, BISER, oddsText, effectiveOddsText, adminPercent,
} from '../lib/format';
import { friendlyError } from '../lib/errors';
import { submitTrade, newIdempotencyKey } from '../lib/tradeQueue';
import { useSession } from '../lib/session';
import type { Market, Outcome, TradeResult } from '../lib/types';

interface Props {
  market: Market;
  outcomes: Outcome[];
  selected: number;
  onSelect: (i: number) => void;
  myShares: number[];
  onTraded: (r: TradeResult) => void;
}

/**
 * One-handed by design: big targets, a slider, quick-amount chips, one primary
 * button. Everything above the button is a preview; nothing here computes a
 * cost the server will trust.
 */
export default function BetPanel({ market, outcomes, selected, onSelect, myShares, onTraded }: Props) {
  const { profile, adminView } = useSession();
  const [mode, setMode] = useState<'back' | 'cash_out'>('back');
  const [stake, setStake] = useState('25');
  const [sellQty, setSellQty] = useState('0');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pending, setPending] = useState(false);

  // The key is minted on the FIRST press and reused until that trade resolves.
  // This is what makes a double-tap one bet instead of two (§13).
  const inflightKey = useRef<string | null>(null);

  const q = useMemo(() => outcomes.map((o) => o.q), [outcomes]);
  const p = useMemo(() => prices(q, market.b), [q, market.b]);
  const held = myShares[selected] ?? 0;
  const balance = profile?.balance ?? 0;
  const open = market.status === 'open';

  useEffect(() => { setErr(''); }, [selected, mode]);
  // Cashing out an outcome you no longer hold makes no sense; snap back.
  useEffect(() => { if (mode === 'cash_out' && held <= 0) setMode('back'); }, [held, mode]);

  const stakeNum = Math.max(0, Number(stake) || 0);
  const sellNum = Math.max(0, Number(sellQty) || 0);

  type Preview =
    | { kind: 'back'; received: number; after: number[] }
    | { kind: 'cash_out'; proceeds: number; after: number[] };

  const preview = useMemo<Preview | null>(() => {
    if (mode === 'back') {
      if (!(stakeNum > 0)) return null;
      let received = 0;
      try { received = sharesForStake(q, market.b, selected, stakeNum); } catch { return null; }
      const after = q.slice();
      after[selected] += received;
      return { kind: 'back', received, after: prices(after, market.b) };
    }
    if (!(sellNum > 0)) return null;
    const proceeds = -tradeCost(q, market.b, selected, -sellNum);
    const after = q.slice();
    after[selected] -= sellNum;
    return { kind: 'cash_out', proceeds, after: prices(after, market.b) };
  }, [mode, stakeNum, sellNum, q, market.b, selected]);

  const canBack = open && stakeNum > 0 && stakeNum <= balance + 1e-9 && profile?.is_approved;
  const canSell = open && sellNum > 0 && sellNum <= held + 1e-9;
  const canGo = mode === 'back' ? canBack : canSell;

  async function go() {
    if (busy || !canGo) return;
    if (!inflightKey.current) inflightKey.current = newIdempotencyKey();
    setBusy(true); setErr(''); setPending(false);
    try {
      const res = await submitTrade({
        id: inflightKey.current,
        marketId: market.id,
        outcomeIdx: selected,
        stake: mode === 'back' ? stakeNum : undefined,
        shares: mode === 'cash_out' ? sellNum : undefined,
      });
      inflightKey.current = null;
      onTraded(res);
      if (mode === 'cash_out') setSellQty('0');
    } catch (e) {
      const msg = friendlyError(e);
      // A queued trade is not a failure — it is a trade that has not landed
      // yet, and the key it holds means it can only ever land once.
      if (/queued|connection/i.test(msg)) setPending(true);
      else { inflightKey.current = null; setErr(msg); }
    } finally { setBusy(false); }
  }

  const sel = outcomes[selected];
  if (!sel) return null;

  return (
    <div className="card">
      <h2>Place a bet</h2>

      <div className="bal">
        {money(balance)} {BISER}<small>available balance</small>
      </div>

      <div className="seg">
        <button className={mode === 'back' ? 'on' : ''} onClick={() => setMode('back')}>Back</button>
        <button
          className={mode === 'cash_out' ? 'on' : ''}
          onClick={() => setMode('cash_out')}
          disabled={held <= 0}
        >Cash out</button>
      </div>

      <div className="selrow">
        <span className="l">
          <i className="dot" style={{ background: sel.color }} />{sel.label}
        </span>
        <span className="o">{oddsText(p[selected])}</span>
      </div>

      {outcomes.length > 1 && (
        <div className="quick" style={{ marginBottom: 12 }}>
          {outcomes.map((o, i) => (
            <button
              key={o.id}
              onClick={() => onSelect(i)}
              style={i === selected
                ? { borderColor: o.color, color: 'var(--paper)' }
                : undefined}
            >{o.label}</button>
          ))}
        </div>
      )}

      {mode === 'back' ? (
        <>
          <div className="amt">
            <input
              type="number" inputMode="decimal" min={0} step={1} value={stake}
              onChange={(e) => setStake(e.target.value)} aria-label="Stake in bisers"
            />
            <span className="unit">{BISER}</span>
          </div>
          <input
            type="range" min={0} max={Math.max(Math.ceil(balance), 1)} step={1}
            value={Math.min(stakeNum, Math.max(Math.ceil(balance), 1))}
            onChange={(e) => setStake(e.target.value)} aria-label="Stake slider"
          />
          <div className="quick">
            {[5, 10, 25, 50, 100].map((v) => (
              <button key={v} onClick={() => setStake(String(Math.min(v, Math.floor(balance))))}>
                {v} {BISER}
              </button>
            ))}
            <button onClick={() => setStake(String(Math.floor(balance)))}>all in</button>
          </div>
        </>
      ) : (
        <>
          <div className="amt">
            <input
              type="number" inputMode="decimal" min={0} step={0.1} value={sellQty}
              onChange={(e) => setSellQty(e.target.value)} aria-label="Shares to sell"
            />
            <span className="unit">shares</span>
          </div>
          <input
            type="range" min={0} max={Math.max(Math.ceil(held), 1)} step={0.1}
            value={Math.min(sellNum, Math.max(Math.ceil(held), 1))}
            onChange={(e) => setSellQty(e.target.value)} aria-label="Shares slider"
          />
          <div className="quick">
            {[25, 50, 100].map((v) => (
              <button key={v} onClick={() => setSellQty((held * v / 100).toFixed(1))}>{v}%</button>
            ))}
            <span className="pill" style={{ border: 0 }}>holding {shf(held)}</span>
          </div>
        </>
      )}

      <div className="prev">
        {!open ? (
          <div className="r">
            <span>Market {market.status}</span>
            <span>betting is shut</span>
          </div>
        ) : mode === 'back' ? (
          preview?.kind === 'back' ? (
            <>
              <div className="r"><span>Stake</span><span>{money(stakeNum)} {BISER}</span></div>
              {/* The honest number: their own stake moves the price, so this is
                  usually worse than the headline above. Showing the headline
                  here would be a lie by omission. */}
              <div className="r">
                <span>Your odds</span>
                <span>{effectiveOddsText(preview.received, stakeNum)}</span>
              </div>
              <div className="r hi">
                <span>Returns if {sel.label} lands</span>
                <span className="big pos-g">{money(preview.received)} {BISER}</span>
              </div>
              <div className="r">
                <span>Profit</span>
                <span className="pos-g">+{money(preview.received - stakeNum)} {BISER}</span>
              </div>
              <div className="r">
                <span>If it doesn&apos;t</span>
                <span className="neg">−{money(stakeNum)} {BISER}</span>
              </div>
              <div className="r">
                <span>Odds shift</span>
                <span>{oddsText(p[selected])} → {oddsText(preview.after[selected])}</span>
              </div>
              {adminView && (
                <div className="r" style={{ color: 'var(--admin)' }}>
                  <span>probability</span>
                  <span>{adminPercent(p[selected])} → {adminPercent(preview.after[selected])}</span>
                </div>
              )}
            </>
          ) : <div className="r"><span>Enter a stake</span><span>—</span></div>
        ) : (
          preview?.kind === 'cash_out' ? (
            <>
              <div className="r">
                <span>Selling</span><span>{shf(sellNum)} of {shf(held)} shares</span>
              </div>
              <div className="r hi">
                <span>You get now</span>
                <span className="big">{money(preview.proceeds)} {BISER}</span>
              </div>
              <div className="r">
                <span>Giving up a return of</span><span>{money(sellNum)} {BISER}</span>
              </div>
            </>
          ) : <div className="r"><span>Enter a share count</span><span>—</span></div>
        )}
      </div>

      <button className="go" onClick={go} disabled={!canGo || busy}>
        {busy ? <><span className="spin" />Sending…</>
          : !open ? 'Betting closed'
          : mode === 'back' ? `Back ${sel.label}` : `Cash out ${sel.label}`}
      </button>

      {pending && (
        <div className="pending">
          Queued. It will send when you are back on — and only once.
        </div>
      )}
      {err && <div className="err">{err}</div>}
      {!profile?.is_approved && (
        <div className="note">Your account is not approved to bet yet.</div>
      )}
    </div>
  );
}
