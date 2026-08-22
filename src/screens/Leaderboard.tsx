import { useEffect, useState } from 'react';
import { fetchLeaderboard } from '../lib/api';
import { money, BISER } from '../lib/format';
import { useSession } from '../lib/session';

/**
 * Totals only. Never which markets someone is in — that would leak positions,
 * and the whole point of the leaderboard view is to publish standings without
 * loosening RLS on positions or profiles (§6).
 */
export default function Leaderboard() {
  const { profile, tournament } = useSession();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchLeaderboard>>>([]);
  const start = tournament?.starting_balance ?? 1000;

  useEffect(() => { void fetchLeaderboard().then(setRows).catch(() => {}); }, []);

  return (
    <div className="card">
      <h2>Leaderboard<span className="mini">{rows.length} traders</span></h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>#</th><th>Trader</th><th className="num">Cash</th>
              <th className="num">Open bets</th><th className="num">Total</th><th className="num">P&amp;L</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, k) => {
              const pl = r.total - start;
              return (
                <tr key={r.id} style={r.id === profile?.id ? { color: 'var(--act)' } : undefined}>
                  <td>{k + 1}</td>
                  <td>{r.display_name}</td>
                  <td className="num">{money(r.balance)}</td>
                  <td className="num">{money(r.open_value)}</td>
                  <td className="num">{money(r.total)} {BISER}</td>
                  <td className={'num ' + (pl > 0.005 ? 'pos-g' : pl < -0.005 ? 'neg' : '')}>
                    {pl > 0 ? '+' : ''}{money(pl)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="note">
        Open bets are valued at what you&apos;d get cashing out now. Everyone started with
        {' '}{money(start)} {BISER}.
      </div>
    </div>
  );
}
