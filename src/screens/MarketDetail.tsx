import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  fetchMarket, fetchOutcomes, fetchMyPositions, fetchMyBets,
  fetchLeaderboard, fetchTrades, fetchPriceHistory,
} from '../lib/api';
import { supabase } from '../lib/supabase';
import { prices, maxSubsidy } from '../lib/lmsr';
import { money, BISER, timeAgo, adminPercent } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { useSession } from '../lib/session';
import BetPanel from '../components/BetPanel';
import OutcomeList from '../components/OutcomeList';
import Quadrant from '../components/Quadrant';
import OddsChart from '../components/OddsChart';
import MarketAdmin from '../components/MarketAdmin';
import type {
  Market, Outcome, Position, Bet, LeaderboardRow, PublicTrade, TradeResult,
} from '../lib/types';

type Tab = 'mine' | 'lead' | 'recent' | 'result' | 'admin';

export default function MarketDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { profile, tournament, adminView } = useSession();

  const [market, setMarket] = useState<Market | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [history, setHistory] = useState<number[][]>([]);
  const [sel, setSel] = useState(0);
  const [tab, setTab] = useState<Tab>('mine');
  const [flash, setFlash] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!id) return;
    const [m, o, pos, h] = await Promise.all([
      fetchMarket(id), fetchOutcomes(id), fetchMyPositions(), fetchPriceHistory(id),
    ]);
    setMarket(m); setOutcomes(o); setPositions(pos); setHistory(h);
  }, [id]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    reload()
      .catch((e) => { if (live) setErr(friendlyError(e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [reload]);

  // ---- realtime (§9): recompute prices client-side from the new q. ----
  useEffect(() => {
    if (!id) return;
    const ch = supabase
      .channel(`market:${id}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'market_outcomes', filter: `market_id=eq.${id}` },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          setOutcomes((prev) => {
            const next = prev.map((o) =>
              o.id === row.id ? { ...o, q: Number(row.q) } : o);
            const moved = next.findIndex((o) => o.id === row.id);
            if (moved >= 0) { setFlash(moved); setTimeout(() => setFlash(null), 520); }
            return next;
          });
        })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'markets', filter: `id=eq.${id}` },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          setMarket((m) => (m ? { ...m, ...(row as Partial<Market>), b: Number(row.b) } : m));
        })
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'bets', filter: `market_id=eq.${id}` },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (row.prices_after) {
            setHistory((h) => [...h, (row.prices_after as string[]).map(Number)]);
          }
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id]);

  const p = useMemo(
    () => (outcomes.length && market ? prices(outcomes.map((o) => o.q), market.b) : []),
    [outcomes, market],
  );

  const myShares = useMemo(() => {
    const byOutcome = new Map(positions.map((x) => [x.outcome_id, x.shares]));
    return outcomes.map((o) => byOutcome.get(o.id) ?? 0);
  }, [positions, outcomes]);

  const onTraded = useCallback((r: TradeResult) => {
    // Optimistic UI reconciled to the server's numbers — the server is always
    // right about prices, and the realtime event will follow anyway.
    if (r.prices?.length && market) {
      setHistory((h) => [...h, r.prices]);
    }
    void reload();
  }, [market, reload]);

  if (loading) return <div className="empty"><span className="spin" />Loading…</div>;
  if (err) return <div className="card"><div className="err">{err}</div></div>;
  if (!market) return <div className="card"><div className="empty">Market not found.</div></div>;

  const isRoomCall = market.layout === 'room' && outcomes.length === 4;
  const showPrior = Boolean(
    market.seeded_from_elo && market.prior &&
    (adminView || tournament?.show_prior_to_traders),
  );

  const tabs: Array<[Tab, string]> = [
    ['mine', 'My bets'], ['lead', 'Leaderboard'], ['recent', 'Recent bets'], ['result', 'Result'],
  ];
  if (adminView) tabs.push(['admin', 'Edit market']);

  return (
    <>
      <button className="back" onClick={() => nav('/')}>← all markets</button>
      <div className="grid">
        <div>
          <div className="card">
            <h2>
              <span>{market.title}</span>
              <span className={'st ' + market.status}>{market.status}</span>
            </h2>
            <div className="note" style={{ marginTop: -4, marginBottom: 11 }}>
              {market.resolution_rule}
              <span style={{ color: 'var(--faint)' }}>
                {' '}· resolved by {market.resolver_name}
                {market.seeded_from_elo ? ' · Elo-seeded' : ''}
              </span>
            </div>

            {isRoomCall
              ? <Quadrant outcomes={outcomes} p={p} selected={sel} onSelect={setSel} flash={flash} />
              : <OutcomeList outcomes={outcomes} p={p} selected={sel} onSelect={setSel} flash={flash} />}

            {!isRoomCall && (
              <div className="note">
                Odds are what 1 {BISER} pays back if that outcome lands.
                {adminView && ' — ' + p.map((x) => adminPercent(x)).join(' / ')}
              </div>
            )}
            {adminView && (
              <div className="note" style={{ color: 'var(--admin)' }}>
                b = {market.b} · maker exposure cap {maxSubsidy(market.b, outcomes.length).toFixed(0)} {BISER}
                {' '}· q = [{outcomes.map((o) => o.q.toFixed(1)).join(', ')}]
              </div>
            )}
          </div>

          <div className="card">
            <h2>How the odds have moved</h2>
            <OddsChart
              history={history} outcomes={outcomes} current={p}
              prior={market.prior} showPrior={showPrior}
            />
          </div>

          <div className="card">
            <div className="tabs">
              {tabs.map(([k, label]) => (
                <button key={k} className={(tab === k ? 'on ' : '') + (k === 'admin' ? 'a' : '')}
                  onClick={() => setTab(k)}>{label}</button>
              ))}
            </div>
            <TabBody
              tab={tab} market={market} outcomes={outcomes} p={p}
              myShares={myShares} profileId={profile?.id} onChanged={reload}
            />
          </div>
        </div>

        <div>
          <BetPanel
            market={market} outcomes={outcomes} selected={sel} onSelect={setSel}
            myShares={myShares} onTraded={onTraded}
          />
        </div>
      </div>
    </>
  );
}

function TabBody({
  tab, market, outcomes, p, myShares, profileId, onChanged,
}: {
  tab: Tab; market: Market; outcomes: Outcome[]; p: number[];
  myShares: number[]; profileId?: string; onChanged: () => Promise<void>;
}) {
  const [bets, setBets] = useState<Bet[]>([]);
  const [board, setBoard] = useState<LeaderboardRow[]>([]);
  const [trades, setTrades] = useState<PublicTrade[]>([]);

  useEffect(() => {
    if (tab === 'mine') void fetchMyBets(market.id).then(setBets).catch(() => {});
    if (tab === 'lead') void fetchLeaderboard().then(setBoard).catch(() => {});
    if (tab === 'recent') void fetchTrades(market.id).then(setTrades).catch(() => {});
  }, [tab, market.id]);

  if (tab === 'admin') return <MarketAdmin market={market} outcomes={outcomes} onChanged={onChanged} />;

  if (tab === 'mine') {
    const holding = outcomes
      .map((o, i) => ({ o, i, sh: myShares[i] }))
      .filter((x) => x.sh > 0.001);
    return (
      <>
        {holding.length === 0
          ? <div className="empty">You haven&apos;t backed anything here yet.</div>
          : (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Backing</th><th className="num">Returns if it lands</th>
                    <th className="num">Cash out now</th>
                  </tr>
                </thead>
                <tbody>
                  {holding.map(({ o, i, sh }) => (
                    <tr key={o.id}>
                      <td><i className="dot" style={{ background: o.color }} />{o.label}</td>
                      <td className="num pos-g">{money(sh)} {BISER}</td>
                      <td className="num">{money(sh * p[i])} {BISER}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {bets.length > 0 && (
          <div className="tablewrap" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr><th>When</th><th>Bet</th><th className="num">Stake</th><th className="num">Your odds</th></tr>
              </thead>
              <tbody>
                {bets.filter((b) => b.kind === 'back' || b.kind === 'cash_out').map((b) => {
                  const o = outcomes.find((x) => x.id === b.outcome_id);
                  return (
                    <tr key={b.id}>
                      <td>{timeAgo(b.created_at)} ago</td>
                      <td>
                        <i className="dot" style={{ background: o?.color ?? '#666' }} />
                        {b.kind === 'back' ? 'Back' : 'Cash out'} {o?.label ?? '—'}
                      </td>
                      <td className="num">{money(Math.abs(b.amount))}</td>
                      <td className="num">{b.effective_odds ? '×' + b.effective_odds.toFixed(2) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  }

  if (tab === 'lead') {
    return (
      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>#</th><th>Trader</th><th className="num">Cash</th>
              <th className="num">Open bets</th><th className="num">Total</th></tr>
          </thead>
          <tbody>
            {board.map((r, k) => (
              <tr key={r.id} style={r.id === profileId ? { color: 'var(--act)' } : undefined}>
                <td>{k + 1}</td><td>{r.display_name}</td>
                <td className="num">{money(r.balance)}</td>
                <td className="num">{money(r.open_value)}</td>
                <td className="num">{money(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="note">
          Open bets are valued at what you&apos;d get selling out right now, not what they pay if you&apos;re right.
        </div>
      </div>
    );
  }

  if (tab === 'recent') {
    if (!trades.length) return <div className="empty">No bets on this market yet.</div>;
    return (
      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>When</th><th>Who</th><th>Bet</th><th className="num">Stake</th><th className="num">Odds</th></tr>
          </thead>
          <tbody>
            {trades.map((t) => {
              const o = outcomes.find((x) => x.id === t.outcome_id);
              return (
                <tr key={t.id}>
                  <td>{timeAgo(t.created_at)}</td>
                  <td>
                    {t.display_name}
                    {t.self_bet && <span className="tag" title="Debating in this room">own room</span>}
                  </td>
                  <td>
                    <i className="dot" style={{ background: o?.color ?? '#666' }} />
                    {t.kind === 'back' ? 'Back' : 'Out'} {o?.label ?? '—'}
                  </td>
                  <td className="num">{money(t.stake)}</td>
                  <td className="num">{t.effective_odds ? '×' + t.effective_odds.toFixed(2) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // result
  if (market.status === 'resolved' && market.winner_index !== null) {
    const w = outcomes[market.winner_index];
    return (
      <>
        <div className="verdict">
          <b style={{ color: w?.color }}>{w?.label}</b> landed. Every share of it paid 1 {BISER};
          everything else paid nothing.
        </div>
        <Scoring market={market} />
      </>
    );
  }
  if (market.status === 'void') {
    return (
      <div className="verdict">
        This market was voided. Everyone was refunded what they net staked on it —
        not the starting balance, and not what the position was worth.
      </div>
    );
  }
  return <div className="empty">Not resolved yet.</div>;
}

/**
 * §7: did the room beat the ratings? A headline, not a footnote — it is how
 * the circuit finds out whether the Elo system is any good.
 */
function Scoring({ market }: { market: Market }) {
  if (!market.seeded_from_elo || !market.prior || !market.close_prices
      || market.winner_index === null) return null;
  const w = market.winner_index;
  const brier = (v: number[]) => v.reduce((a, c, i) => a + (c - (i === w ? 1 : 0)) ** 2, 0);
  const log = (v: number[]) => -Math.log(Math.max(v[w] ?? 1e-9, 1e-9));
  const bE = brier(market.prior), bM = brier(market.close_prices);
  const lE = log(market.prior), lM = log(market.close_prices);
  return (
    <>
      <div className="scorebox">
        <div className="sb"><div className="l">Elo · Brier</div><div className="v">{bE.toFixed(3)}</div></div>
        <div className="sb">
          <div className="l">Market · Brier</div>
          <div className="v" style={{ color: bM < bE ? 'var(--good)' : 'var(--warn)' }}>{bM.toFixed(3)}</div>
        </div>
        <div className="sb"><div className="l">Elo · log</div><div className="v">{lE.toFixed(3)}</div></div>
        <div className="sb">
          <div className="l">Market · log</div>
          <div className="v" style={{ color: lM < lE ? 'var(--good)' : 'var(--warn)' }}>{lM.toFixed(3)}</div>
        </div>
      </div>
      <div className="note">
        Lower is better for both. {bM < bE
          ? 'The room beat the ratings — the crowd knew something Elo did not.'
          : bM > bE ? 'The ratings beat the room. The crowd talked itself into the wrong side.'
          : 'Dead heat.'}
      </div>
    </>
  );
}
