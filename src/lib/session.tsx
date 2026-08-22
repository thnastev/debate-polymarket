import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { fetchProfile, fetchActiveTournament } from './api';
import type { Profile, Tournament } from './types';

interface Ctx {
  session: Session | null;
  profile: Profile | null;
  tournament: Tournament | null;
  loading: boolean;
  isGameMaker: boolean;
  /** The game maker can drop into the plain trader view to check what people see. */
  adminView: boolean;
  setAdminView: (v: boolean) => void;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

/** Exported so the preview harness in preview/ can supply a fixture session
 *  without standing up Supabase. Application code should use useSession(). */
export const SessionCtx = createContext<Ctx | null>(null);
export type SessionValue = Ctx;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [loading, setLoading] = useState(true);
  const [adminView, setAdminView] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!session?.user) { setProfile(null); setLoading(false); return; }
    (async () => {
      try {
        const [p, t] = await Promise.all([fetchProfile(session.user.id), fetchActiveTournament()]);
        if (cancelled) return;
        setProfile(p);
        setTournament(t);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  // Keep the balance live: it changes on every trade, settlement and void, and
  // a stale balance in the corner is how a trader ends up staking money they
  // no longer have.
  useEffect(() => {
    if (!session?.user) return;
    const ch = supabase
      .channel(`profile:${session.user.id}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${session.user.id}` },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          setProfile((p) => (p ? { ...p, ...row, balance: Number(row.balance) } : p));
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [session?.user?.id]);

  const refreshProfile = async () => {
    if (!session?.user) return;
    setProfile(await fetchProfile(session.user.id));
  };

  const value: Ctx = {
    session, profile, tournament, loading,
    isGameMaker: profile?.role === 'game_maker',
    adminView: profile?.role === 'game_maker' && adminView,
    setAdminView,
    refreshProfile,
    signOut: async () => { await supabase.auth.signOut(); setProfile(null); },
  };
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession(): Ctx {
  const c = useContext(SessionCtx);
  if (!c) throw new Error('useSession outside SessionProvider');
  return c;
}
