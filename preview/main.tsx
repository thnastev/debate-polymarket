/**
 * Component preview harness. NOT part of the shipped app.
 *
 * Renders the real board components against fixture data so the layout can be
 * checked at 380px without standing up Supabase. `npm run preview:design`.
 */
import { createRoot } from 'react-dom/client';
import { SessionCtx, type SessionValue } from '../src/lib/session';
import Quadrant from '../src/components/Quadrant';
import BetPanel from '../src/components/BetPanel';
import OutcomeList from '../src/components/OutcomeList';
import OddsChart from '../src/components/OddsChart';
import { prices, qFromPrior } from '../src/lib/lmsr';
import type { Outcome } from '../src/lib/types';
import '../src/styles.css';

const mk = (i: number, label: string, sub: string, color: string, q: number): Outcome => ({
  id: `o${i}`, market_id: 'm', idx: i, label, sublabel: sub, color, q, tab_team_id: null,
});

const roomOutcomes = [
  mk(0, 'OG', 'Bogdanova & Petrinin', '#C8853A', 120),
  mk(1, 'OO', 'Mihaylov & Peeva', '#3E7A9A', 40),
  mk(2, 'CG', 'Denchev & Ivanova', '#F0C48A', -60),
  mk(3, 'CO', 'Katzarov & Pashkunova', '#93BFD6', 10),
];
const listOutcomes = [
  'Economics', 'International Relations', 'Politics', 'Social movements',
  'Morality & Principles', 'Art, Culture & Narratives', 'Psychology',
].map((l, i) => mk(i, l, '', ['#C8853A', '#3E7A9A', '#F0C48A', '#93BFD6', '#A78BFA', '#7FD4A8', '#E4707A'][i],
  [90, 40, 10, -20, -40, -60, -80][i]));

const profile = {
  id: 'p1', display_name: 'Ivan', role: 'trader' as const, balance: 1000,
  tab_speaker_id: null, tab_adj_id: null, is_active: true, is_approved: true,
};

const session = (adminView: boolean): SessionValue => ({
  session: null, profile, tournament: null, loading: false,
  isGameMaker: adminView, adminView,
  setAdminView: () => {}, refreshProfile: async () => {}, signOut: async () => {},
});

const market = {
  id: 'm', tournament_id: 't', scope: 'room' as const, title: 'R1 · Aula 1 — the call',
  resolution_rule: 'Which bench takes the 1st.', resolver_name: 'CA team',
  layout: 'room', b: 300, status: 'open' as const, opens_at: null, closes_at: null,
  winner_index: null, close_prices: null, seeded_from_elo: true,
  prior: [0.4, 0.25, 0.2, 0.15], round_id: null, debate_id: null,
  template_key: 'room.call', created_at: new Date().toISOString(),
};

const roomP = prices(roomOutcomes.map((o) => o.q), 300);
const listP = prices(listOutcomes.map((o) => o.q), 400);
const prior = prices(qFromPrior([0.4, 0.25, 0.2, 0.15], 300), 300);
const history = [
  prices([0, 0, 0, 0], 300), prices([40, 0, 0, 0], 300),
  prices([40, 30, 0, 0], 300), prices([90, 30, -20, 0], 300),
];

function Panel({ admin }: { admin: boolean }) {
  return (
    <SessionCtx.Provider value={session(admin)}>
      <div className="wrap" data-view={admin ? 'admin' : 'trader'}>
        <div className="top">
          <div>
            <div className="brand">Biser <span>Market</span></div>
            <div className="tname">Sofia Open 2026 · {admin ? 'game maker view' : 'trader view'}</div>
          </div>
          <div className="spacer" />
          <div className="pill"><b>1,000.00 ƀ</b></div>
        </div>
        <div className="card">
          <h2><span>R1 · Aula 1 — the call</span><span className="st open">open</span></h2>
          <div className="note" style={{ marginTop: -4, marginBottom: 11 }}>
            Which bench takes the 1st, per the call announced by the chair and recorded on the ballot.
          </div>
          <Quadrant outcomes={roomOutcomes} p={roomP} selected={0} onSelect={() => {}} />
        </div>
        <div className="card">
          <h2>R2 — motion category</h2>
          <OutcomeList outcomes={listOutcomes} p={listP} selected={2} onSelect={() => {}} />
          <div className="note">Odds are what 1 ƀ pays back if that outcome lands.</div>
        </div>
        <BetPanel
          market={market} outcomes={roomOutcomes} selected={0}
          onSelect={() => {}} myShares={[0, 0, 0, 0]} onTraded={() => {}}
        />
        <div className="card">
          <h2>How the odds have moved</h2>
          <OddsChart history={history} outcomes={roomOutcomes} current={roomP}
            prior={prior} showPrior />
        </div>
      </div>
    </SessionCtx.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <>
    <Panel admin={false} />
    <hr style={{ border: 0, borderTop: '2px dashed #3A3252', margin: '24px 0' }} />
    <Panel admin />
  </>,
);
