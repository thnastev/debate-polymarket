/**
 * Interactive preview of Biser Market. NOT part of the shipped app.
 *
 * Runs the real components and the real LMSR against an in-memory market, so
 * every price you move here moves exactly as it would against Supabase. What
 * is faked is only the database: no auth, no RLS, no persistence.
 */
import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SessionCtx, type SessionValue } from '../src/lib/session';
import Quadrant from '../src/components/Quadrant';
import OutcomeList from '../src/components/OutcomeList';
import OddsChart from '../src/components/OddsChart';
import BetPanel from '../src/components/BetPanel';
import { prices } from '../src/lib/lmsr';
import { money, BISER, oddsText } from '../src/lib/format';
import { store, seedMarket, subscribe } from './mockApi';
import type { Market, Outcome } from '../src/lib/types';
import '../src/styles.css';

// ---------------------------------------------------------------- fixtures

const ROOM = {
  id: 'room', b: 300,
  labels: ['OG', 'OO', 'CG', 'CO'],
  prior: [0.34, 0.26, 0.18, 0.22],
  teams: ['Bogdanova & Petrinin', 'Mihaylov & Peeva', 'Denchev & Ivanova', 'Katzarov & Pashkunova'],
  colors: ['#C8853A', '#3E7A9A', '#F0C48A', '#93BFD6'],
};
const CATS = {
  id: 'cats', b: 400,
  labels: ['Economics', 'International Relations', 'Politics', 'Social movements',
           'Morality & Principles', 'Art, Culture & Narratives', 'Psychology'],
  prior: [0.2, 0.17, 0.16, 0.15, 0.12, 0.1, 0.1],
  colors: ['#C8853A', '#3E7A9A', '#F0C48A', '#93BFD6', '#A78BFA', '#7FD4A8', '#E4707A'],
};
seedMarket({ id: ROOM.id, b: ROOM.b, q: [], labels: ROOM.labels, prior: ROOM.prior });
seedMarket({ id: CATS.id, b: CATS.b, q: [], labels: CATS.labels, prior: CATS.prior });

const outcomesFor = (spec: typeof ROOM | typeof CATS, subs?: string[]): Outcome[] =>
  spec.labels.map((label, i) => ({
    id: `${spec.id}-${i}`, market_id: spec.id, idx: i, label,
    sublabel: subs?.[i] ?? null, color: spec.colors[i],
    q: store.markets[spec.id].q[i], tab_team_id: null,
  }));

const marketFor = (spec: typeof ROOM | typeof CATS, over: Partial<Market>): Market => ({
  id: spec.id, tournament_id: 't', scope: 'room', title: '', resolution_rule: '',
  resolver_name: 'Thomas', layout: 'list', b: spec.b, status: 'open',
  opens_at: null, closes_at: null, winner_index: null, close_prices: null,
  seeded_from_elo: true, prior: spec.prior, round_id: null, debate_id: null,
  template_key: null, created_at: new Date().toISOString(), ...over,
});

// ---------------------------------------------------------------- app

function Preview() {
  const [tick, setTick] = useState(0);
  const [adminView, setAdminView] = useState(false);
  const [which, setWhich] = useState<'room' | 'cats'>('room');
  const [sel, setSel] = useState(0);

  useEffect(() => subscribe(() => setTick((t) => t + 1)), []);

  const spec = which === 'room' ? ROOM : CATS;
  const outcomes = useMemo(() => outcomesFor(spec, which === 'room' ? ROOM.teams : undefined),
    [which, tick]);
  const p = prices(outcomes.map((o) => o.q), spec.b);
  const market = marketFor(spec, which === 'room'
    ? { title: 'R1 · Aula 1 — the call', layout: 'room', scope: 'room',
        resolution_rule: 'Which bench takes the 1st, per the call announced by the chair and recorded on the ballot.' }
    : { title: 'R2 — motion category', layout: 'list', scope: 'round',
        resolution_rule: 'The category the CA team assigns on release. Ambiguity voids.' });

  const session: SessionValue = {
    session: null,
    profile: {
      id: 'p1', display_name: 'You', role: adminView ? 'game_maker' : 'trader',
      balance: store.balance, tab_speaker_id: null, tab_adj_id: null,
      is_active: true, is_approved: true,
    },
    tournament: null, loading: false,
    isGameMaker: true, adminView,
    setAdminView, refreshProfile: async () => {}, signOut: async () => {},
  };

  const myShares = store.shares[spec.id];
  const history = store.history[spec.id];

  return (
    <SessionCtx.Provider value={session}>
      <div className="wrap" data-view={adminView ? 'admin' : 'trader'}>
        <div className="top">
          <div>
            <div className="brand">Biser <span>Market</span></div>
            <div className="tname">Sofia Open 2026 · preview</div>
          </div>
          <div className="spacer" />
          <div className="pill"><b>{money(store.balance)} {BISER}</b></div>
          <button className={'admbtn' + (adminView ? ' on' : '')}
            onClick={() => setAdminView(!adminView)}>
            {adminView ? 'Game maker ✓' : 'Game maker'}
          </button>
        </div>

        <div className="note" style={{ marginTop: 0, marginBottom: 12 }}>
          A live preview — bet with the panel below and the odds move for real,
          using the same market maker the server runs. Nothing is saved.
          Toggle <b>Game maker</b> to see what the operator sees (probabilities);
          traders only ever see odds.
        </div>

        <div className="tabs">
          <button className={which === 'room' ? 'on' : ''} onClick={() => { setWhich('room'); setSel(0); }}>
            The call (quadrant)
          </button>
          <button className={which === 'cats' ? 'on' : ''} onClick={() => { setWhich('cats'); setSel(0); }}>
            Motion category (list)
          </button>
        </div>

        <div className="grid">
          <div>
            <div className="card">
              <h2><span>{market.title}</span><span className="st open">open</span></h2>
              <div className="note" style={{ marginTop: -4, marginBottom: 11 }}>
                {market.resolution_rule}
                <span style={{ color: 'var(--faint)' }}> · resolved by Thomas</span>
              </div>
              {which === 'room'
                ? <Quadrant outcomes={outcomes} p={p} selected={sel} onSelect={setSel} />
                : <OutcomeList outcomes={outcomes} p={p} selected={sel} onSelect={setSel} />}
            </div>

            <div className="card">
              <h2>How the odds have moved</h2>
              <OddsChart history={history} outcomes={outcomes} current={p}
                prior={spec.prior} showPrior />
            </div>

            <div className="card">
              <h2>Recent bets<span className="mini">{store.trades.length}</span></h2>
              {store.trades.length === 0
                ? <div className="empty">No bets yet. Back something on the right.</div>
                : (
                  <div className="tablewrap">
                    <table>
                      <thead>
                        <tr><th>Who</th><th>Bet</th><th className="num">Stake</th><th className="num">Odds</th></tr>
                      </thead>
                      <tbody>
                        {store.trades.slice(0, 12).map((t, i) => (
                          <tr key={i}>
                            <td>You</td>
                            <td>{t.outcome}</td>
                            <td className="num">{money(t.stake)} {BISER}</td>
                            <td className="num">{t.odds ? '×' + t.odds.toFixed(2) : 'cash out'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
            </div>
          </div>

          <div>
            <BetPanel
              key={spec.id}
              market={market} outcomes={outcomes} selected={sel} onSelect={setSel}
              myShares={myShares} onTraded={() => setTick((t) => t + 1)}
            />
            <div className="card">
              <h2>Your position</h2>
              {myShares.every((s) => s < 0.01)
                ? <div className="empty">Nothing held here yet.</div>
                : (
                  <div className="tablewrap">
                    <table>
                      <thead>
                        <tr><th>Backing</th><th className="num">Returns</th><th className="num">Now worth</th></tr>
                      </thead>
                      <tbody>
                        {outcomes.map((o, i) => myShares[i] > 0.01 && (
                          <tr key={o.id}>
                            <td><i className="dot" style={{ background: o.color }} />{o.label}</td>
                            <td className="num pos-g">{money(myShares[i])} {BISER}</td>
                            <td className="num">{money(myShares[i] * p[i])} {BISER}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              <div className="note">
                Favourite right now: <b>{outcomes[p.indexOf(Math.max(...p))].label}</b> at{' '}
                {oddsText(Math.max(...p))}.
              </div>
            </div>
          </div>
        </div>

        <div className="note" style={{ textAlign: 'center', margin: '18px 0 30px', color: 'var(--faint)' }}>
          Preview · play money · LMSR market maker · nothing is saved
        </div>
      </div>
    </SessionCtx.Provider>
  );
}

createRoot(document.getElementById('root')!).render(<Preview />);
