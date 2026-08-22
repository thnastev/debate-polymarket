import { Routes, Route, Navigate } from 'react-router-dom';
import { useSession } from './lib/session';
import { configured } from './lib/supabase';
import Auth from './screens/Auth';
import MarketList from './screens/MarketList';
import MarketDetail from './screens/MarketDetail';
import GameMaker from './screens/GameMaker';
import Leaderboard from './screens/Leaderboard';
import Header from './components/Header';
import OfflineBar from './components/OfflineBar';

export default function App() {
  const { session, profile, loading } = useSession();

  if (!configured) {
    return (
      <div className="authwrap">
        <div className="brand">Biser <span>Market</span></div>
        <div className="card">
          <div className="note">
            Supabase is not configured. Copy <b>.env.example</b> to <b>.env</b> and fill in
            <b> VITE_SUPABASE_URL</b> and <b>VITE_SUPABASE_ANON_KEY</b>.
          </div>
        </div>
      </div>
    );
  }

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
