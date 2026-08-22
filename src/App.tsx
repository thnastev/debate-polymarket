import { Routes, Route, Navigate } from 'react-router-dom';
import { useSession } from './lib/session';
import { configured } from './lib/supabase';
import { configHint } from './lib/config';
import Auth from './screens/Auth';
import MarketList from './screens/MarketList';
import MarketDetail from './screens/MarketDetail';
import GameMaker from './screens/GameMaker';
import Leaderboard from './screens/Leaderboard';
import Header from './components/Header';
import OfflineBar from './components/OfflineBar';

export default function App() {
  const { session, profile, loading } = useSession();

  // Shown when config.js still has its placeholders in it. A tournament is a
  // bad place to meet a white screen, so say exactly what to do.
  if (!configured) return <Setup />;

  if (loading) {
    return <div className="authwrap"><div className="empty"><span className="spin" />Loading…</div></div>;
  }

  if (!session) return <Auth />;

  // First login: we have an account but no name to show on the leaderboard.
  if (profile && !profile.display_name) return <Auth needsName />;

  return (
    <>
      <OfflineBar />
      <div className="wrap">
        <Header />
        {profile && !profile.is_approved && (
          <div className="card" style={{ borderColor: 'var(--admin)' }}>
            <div className="note" style={{ marginTop: 0 }}>
              <b>Waiting for approval.</b> Your email is not on the registration list yet,
              so you can look but not bet. Find the game maker.
            </div>
          </div>
        )}
        <Routes>
          <Route path="/" element={<MarketList />} />
          <Route path="/m/:id" element={<MarketDetail />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/admin" element={<GameMaker />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </>
  );
}

function Setup() {
  return (
    <div className="authwrap" style={{ maxWidth: 560 }}>
      <div className="brand">Biser <span>Market</span></div>
      <div className="tname" style={{ marginBottom: 16 }}>one step left</div>
      <div className="card">
        <h2>Point this site at your database</h2>
        <div className="note" style={{ marginTop: 0 }}>
          {configHint} Open <b>config.js</b> in the folder you uploaded and replace the
          two placeholder values, then upload the folder again.
        </div>
        <ol className="note" style={{ paddingLeft: 18, lineHeight: 1.8 }}>
          <li>Go to your Supabase dashboard.</li>
          <li><b>Project Settings → API</b>.</li>
          <li>
            Copy <b>Project URL</b> into <code>supabaseUrl</code>, and the
            <b> anon public</b> key into <code>supabaseAnonKey</code>.
          </li>
          <li>Save <b>config.js</b> and re-upload the folder.</li>
        </ol>
        <div className="note" style={{ color: 'var(--warn)' }}>
          Use the <b>anon public</b> key. Never the <b>service_role</b> one — that key
          bypasses every rule that protects the market.
        </div>
      </div>
      <div className="note" style={{ textAlign: 'center', color: 'var(--faint)' }}>
        Play money only. Nothing here is worth anything and nothing can be cashed out.
      </div>
    </div>
  );
}
