import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { fetchProfile } from './api';
import { supabase } from './supabase';
import type { Profile } from '../types';

interface AuthState {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
}

const AuthContext = createContext<AuthState>({ user: null, profile: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, profile: null, loading: true });

  useEffect(() => {
    const apply = async (session: Session | null) => {
      if (!session?.user) {
        setState({ user: null, profile: null, loading: false });
        return;
      }
      const profile = await fetchProfile(session.user.id);
      if (!profile) {
        // аккаунт есть, а роли нет — в базу такого пускать нельзя
        await supabase.auth.signOut();
        setState({ user: null, profile: null, loading: false });
        return;
      }
      setState({ user: session.user, profile, loading: false });
    };

    void supabase.auth.getSession().then(({ data }) => void apply(data.session));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      void apply(session);
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
