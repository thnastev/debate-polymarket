import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';
import { money, BISER } from '../lib/format';

export default function Header() {
  const { profile, tournament, isGameMaker, adminView, setAdminView, signOut } = useSession();
  const nav = useNavigate();

  // The gold stripe is how the operator knows, at a glance in a dark corridor,
  // that they are looking at privileged controls.
  useEffect(() => {
    document.body.classList.toggle('adm', adminView);
    return () => document.body.classList.remove('adm');
  }, [adminView]);

  return (
    <div className="top">
      <div>
        <button className="brand" onClick={() => nav('/')}>Biser <span>Market</span></button>
        <div className="tname">{tournament?.name ?? 'No active tournament'}</div>
      </div>
      <div className="spacer" />
      {profile && (
        <div className="pill" title="Your available balance">
          <b>{money(profile.balance)} {BISER}</b>
        </div>
      )}
      <Link className="pill" to="/leaderboard" style={{ textDecoration: 'none' }}>table</Link>
      {isGameMaker && (
        <>
          <button
            className={'admbtn' + (adminView ? ' on' : '')}
            onClick={() => setAdminView(!adminView)}
          >
            {adminView ? 'Game maker ✓' : 'Game maker'}
          </button>
          {adminView && <Link className="pill" to="/admin">panel</Link>}
        </>
      )}
      <button className="pill" onClick={signOut} style={{ background: 'none' }}>out</button>
    </div>
  );
}
