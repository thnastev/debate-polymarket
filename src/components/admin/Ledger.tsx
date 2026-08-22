import { useEffect, useState } from 'react';
import { fetchAllBets, verifyLedger } from '../../lib/api';
import { money, BISER, timeAgo } from '../../lib/format';
import { friendlyError } from '../../lib/errors';

/** Every bet by every person, across every market. Game maker only. */
export default function Ledger() {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [check, setCheck] = useState<string>('');
  const [err, setErr] = useState('');

  useEffect(() => {
    void fetchAllBets()
      .then((r) => setRows(r as unknown as Array<Record<string, unknown>>))
      .catch((e) => setErr(friendlyError(e)));
  }, []);

  async function runCheck() {
    setCheck('checking…');
    try {
      const bad = await verifyLedger();
      setCheck(bad.length === 0
        ? 'Ledger balances. Every profile matches the sum of its bets exactly.'
        : `${bad.length} profile(s) disagree: ${bad.map((b) => b.display_name).join(', ')}`);
    } catch (e) { setCheck(friendlyError(e)); }
  }

  return (
    <div className="card">
      <h2>
        <span>Every bet, newest first</span>
        <button className="mini" onClick={runCheck}>verify ledger</button>
      </h2>
      {check && (
        <div className="note" style={{ marginTop: 0, color: check.includes('balances') ? 'var(--good)' : 'var(--warn)' }}>
          {check}
        </div>
      )}
      {err && <div className="err">{err}</div>}
      <div className="tablewrap scroll">
        <table>
          <thead>
            <tr>
              <th>#</th><th>When</th><th>Trader</th><th>Market</th><th>Kind</th>
              <th className="num">Amount</th><th className="num">Shares</th>
              <th className="num">Odds</th><th className="num">Balance after</th><th>Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={String(b.id)}>
                <td>{String(b.id)}</td>
                <td>{timeAgo(String(b.created_at))}</td>
                <td>{String(b.display_name)}</td>
                <td>{String(b.market_title ?? '—')}</td>
                <td>{String(b.kind)}</td>
                <td className={'num ' + (Number(b.amount) < 0 ? 'neg' : 'pos-g')}>
                  {Number(b.amount) > 0 ? '+' : ''}{money(Number(b.amount))}
                </td>
                <td className="num">{Number(b.shares).toFixed(1)}</td>
                <td className="num">{b.effective_odds ? '×' + Number(b.effective_odds).toFixed(2) : '—'}</td>
                <td className="num">{money(Number(b.balance_after))} {BISER}</td>
                <td style={{ color: 'var(--admin)' }}>{String(b.note ?? '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="note">
        Append-only. Nothing here is ever updated or deleted — a correction is a new row.
      </div>
    </div>
  );
}
