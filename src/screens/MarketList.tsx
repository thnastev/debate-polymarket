import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchMarkets } from '../lib/api';
import { prices } from '../lib/lmsr';
import { oddsText } from '../lib/format';
import { useSession } from '../lib/session';
import { friendlyError } from '../lib/errors';
import type { Market, MarketScope } from '../lib/types';

const GROUPS: Array<[MarketScope, string]> = [
  ['room', 'Room by room'],
  ['round', 'Round by round'],
  ['tournament', 'Whole tournament'],
  ['custom', 'Custom'],
];

/** The home screen on mobile. Grouped by scope, favourite and odds on each row. */
export default function MarketList() {
  const { tournament } = useSession();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();

  useEffect(() => {
    let live = true;
    fetchMarkets(tournament?.id)
      .then((m) => { if (live) setMarkets(m); })
      .catch((e) => { if (live) setErr(friendlyError(e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [tournament?.id]);

  if (loading) return <div className="empty"><span className="spin" />Loading markets…</div>;
  if (err) return <div className="card"><div className="err">{err}</div></div>;
  if (!markets.length) {
    return (
      <div className="card">
        <div className="empty">
          No markets are open yet.<br />They appear here as the game maker creates them.
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Markets<span className="mini">{markets.length}</span></h2>
      {GROUPS.map(([scope, label]) => {
        const rows = markets.filter((m) => m.scope === scope);
        if (!rows.length) return null;
        return (
          <div key={scope}>
            <div className="scope">{label} · {rows.length}</div>
            {rows.map((m) => <Row key={m.id} m={m} onOpen={() => nav(`/m/${m.id}`)} />)}
          </div>
        );
      })}
    </div>
  );
}

function Row({ m, onOpen }: { m: Market; onOpen: () => void }) {
  const outcomes = m.market_outcomes ?? [];
  const p = outcomes.length ? prices(outcomes.map((o) => o.q), m.b) : [];
  const top = p.length ? p.indexOf(Math.max(...p)) : -1;
  return (
    <button className="mrow" onClick={onOpen}>
      <div className="t">{m.title}</div>
      <div className="m">
        <span className={'st ' + m.status}>{m.status}</span>
        <span>{outcomes.length} ways</span>
        {top >= 0 && m.status === 'open' && (
          <span>fav {outcomes[top].label} {oddsText(p[top])}</span>
        )}
        {m.status === 'resolved' && m.winner_index !== null && outcomes[m.winner_index] && (
          <span style={{ color: 'var(--good)' }}>{outcomes[m.winner_index].label} won</span>
        )}
      </div>
    </button>
  );
}
