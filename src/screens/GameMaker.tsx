import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';
import { createTournament, updateTournament, fetchTournaments } from '../lib/api';
import Generator from '../components/admin/Generator';
import CustomBuilder from '../components/admin/CustomBuilder';
import Ledger from '../components/admin/Ledger';
import People from '../components/admin/People';
import TabImport from '../components/admin/TabImport';
import EloPanel from '../components/admin/EloPanel';
import { BISER, money } from '../lib/format';
import type { Tournament } from '../lib/types';

type Panel = 'markets' | 'tab' | 'elo' | 'people' | 'ledger' | 'setup';

export default function GameMaker() {
  const { isGameMaker, tournament, refreshProfile } = useSession();
  const nav = useNavigate();
  const [panel, setPanel] = useState<Panel>('markets');
  const [nonce, setNonce] = useState(0);
  const bump = () => setNonce((n) => n + 1);

  if (!isGameMaker) {
    return <div className="card"><div className="empty">Game maker only.</div></div>;
  }

  const panels: Array<[Panel, string]> = [
    ['markets', 'Markets'], ['tab', 'Tab import'], ['elo', 'Elo'],
    ['people', 'People'], ['ledger', 'Ledger'], ['setup', 'Tournament'],
  ];

  return (
    <>
      <button className="back" onClick={() => nav('/')}>← markets</button>
      <div className="card">
        <div className="tabs">
          {panels.map(([k, label]) => (
            <button key={k} className={'a' + (panel === k ? ' on' : '')} onClick={() => setPanel(k)}>
              {label}
            </button>
          ))}
        </div>
        {!tournament
          ? <NoTournament onCreated={() => { void refreshProfile(); bump(); }} />
          : (
            <div key={nonce}>
              {panel === 'markets' && (
                <>
                  <Generator tournament={tournament} onCreated={bump} />
                  <CustomBuilder tournament={tournament} onCreated={bump} resolverName="Game maker" />
                </>
              )}
              {panel === 'tab' && <TabImport tournament={tournament} onChanged={bump} />}
              {panel === 'elo' && <EloPanel tournament={tournament} onChanged={bump} />}
              {panel === 'people' && <People tournament={tournament} />}
              {panel === 'ledger' && <Ledger />}
              {panel === 'setup' && <Setup tournament={tournament} onChanged={bump} />}
            </div>
          )}
      </div>
    </>
  );
}

function NoTournament({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [existing, setExisting] = useState<Tournament[]>([]);
  useEffect(() => { void fetchTournaments().then(setExisting).catch(() => {}); }, []);

  return (
    <div className="admbox">
      <h3>No active tournament</h3>
      {existing.length > 0 && (
        <>
          <div className="note" style={{ marginTop: 0 }}>Activate one of these:</div>
          <div className="btnrow">
            {existing.map((t) => (
              <button key={t.id} className="btn" onClick={async () => {
                for (const o of existing) await updateTournament(o.id, { is_active: o.id === t.id });
                onCreated();
              }}>{t.name}</button>
            ))}
          </div>
        </>
      )}
      <div className="fieldrow">
        <div className="field"><label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sofia Open 2026" /></div>
        <div className="field" style={{ flex: '0 0 150px' }}><label>Slug</label>
          <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="sofia-open" /></div>
        <div className="field" style={{ flex: '0 0 auto' }}>
          <button className="btn adm" disabled={!name.trim() || !slug.trim()}
            onClick={async () => { await createTournament(name.trim(), slug.trim()); onCreated(); }}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

function Setup({ tournament, onChanged }: { tournament: Tournament; onChanged: () => void }) {
  return (
    <div className="admbox">
      <h3>{tournament.name}</h3>
      <div className="fieldrow" style={{ marginTop: 0 }}>
        <div className="field" style={{ flex: '0 0 170px' }}>
          <label>Starting bisers</label>
          <input type="number" step={50} defaultValue={tournament.starting_balance}
            onBlur={(e) => void updateTournament(tournament.id, {
              starting_balance: Number(e.target.value) || 1000,
            }).then(onChanged)} />
        </div>
      </div>
      <div className="note">
        New accounts open with {money(tournament.starting_balance)} {BISER}. Changing this
        does not touch anyone already signed up — use the People tab for that.
      </div>

      <div className="fieldrow">
        <div className="field" style={{ flex: '0 0 260px' }}>
          <label>If a debater bets on their own room</label>
          <select defaultValue={tournament.self_bet_policy}
            onChange={(e) => void updateTournament(tournament.id, {
              self_bet_policy: e.target.value,
            }).then(onChanged)}>
            <option value="block">Block it</option>
            <option value="tag">Allow it, marked publicly</option>
          </select>
        </div>
      </div>
      <div className="note">
        Judges are blocked from their own rooms either way, with no option to change it.
        That one is not insider trading, it is a bribe with extra steps.
      </div>
      <div className="note" style={{ color: 'var(--faint)' }}>
        Bisers are play money. There is no real money anywhere in this system and there
        must never be — real-money betting on events is a licensed activity in Bulgaria.
      </div>
    </div>
  );
}
