import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { friendlyError } from '../lib/errors';

/**
 * Magic link only — no passwords. One account per person, checked against the
 * registration list the game maker imports; an unmatched email gets an account
 * that can look but not bet (§10).
 */
export default function Auth({ needsName = false }: { needsName?: boolean }) {
  if (needsName) return <NamePrompt />;
  return <MagicLink />;
}

function MagicLink() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      setSent(true);
    } catch (e2) { setErr(friendlyError(e2)); }
    finally { setBusy(false); }
  };

  return (
    <div className="authwrap">
      <div className="brand">Biser <span>Market</span></div>
      <div className="tname" style={{ marginBottom: 16 }}>play money · no real stakes</div>
      <div className="card">
        {sent ? (
          <>
            <h2>Check your email</h2>
            <div className="note" style={{ marginTop: 0 }}>
              A sign-in link is on its way to <b>{email}</b>. Open it on this phone.
            </div>
            <div className="btnrow">
              <button className="btn" onClick={() => setSent(false)}>Use a different email</button>
            </div>
          </>
        ) : (
          <form onSubmit={send}>
            <h2>Sign in</h2>
            <input
              type="email" inputMode="email" autoComplete="email" required
              placeholder="you@example.com" value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button className="go" disabled={busy || !email.includes('@')}>
              {busy ? 'Sending…' : 'Email me a link'}
            </button>
            {err && <div className="err">{err}</div>}
            <div className="note">
              Use the address you registered for the tournament with. No password to forget.
            </div>
          </form>
        )}
      </div>
      <div className="note" style={{ textAlign: 'center', color: 'var(--faint)' }}>
        Bisers are play money. Nothing here is worth anything and nothing can be cashed out.
      </div>
    </div>
  );
}

function NamePrompt() {
  const { session, refreshProfile } = useSession();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const { error } = await supabase.from('profiles')
        .update({ display_name: name.trim() }).eq('id', session!.user.id);
      if (error) throw error;
      await refreshProfile();
    } catch (e2) { setErr(friendlyError(e2)); }
    finally { setBusy(false); }
  };

  return (
    <div className="authwrap">
      <div className="brand">Biser <span>Market</span></div>
      <div className="card">
        <form onSubmit={save}>
          <h2>What should we call you?</h2>
          <input
            value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Your name" maxLength={40} required autoFocus
          />
          <button className="go" disabled={busy || name.trim().length < 2}>Start trading</button>
          {err && <div className="err">{err}</div>}
          <div className="note">This is what shows on the leaderboard and in the trade log.</div>
        </form>
      </div>
    </div>
  );
}
