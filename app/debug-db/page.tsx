'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase as sharedClient } from '@/lib/supabaseClient';

const daySlots = ['AM', 'PM'] as const;

type Profile = {
  role: string;
  can_approve: boolean;
};

type Week = {
  id: string;
  week_start: string;
  status: string;
  approved_at: string | null;
};

const formatDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getUpcomingMonday = () => {
  const today = new Date();
  const day = today.getDay();
  const offset = day === 1 ? 0 : (8 - day) % 7;
  const monday = new Date(today);
  monday.setDate(today.getDate() + offset);
  return monday;
};

export default function DebugDbPage() {
  const router = useRouter();
  const supabase = useMemo(() => sharedClient, []);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(
    async (currentUser: User | null) => {
      if (!supabase) {
        return;
      }

      if (!currentUser) {
        setProfile(null);
        return;
      }

      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('role, can_approve')
        .eq('user_id', currentUser.id)
        .maybeSingle();

      if (profileError) {
        setError(profileError.message);
      }

      setProfile(profileData ?? null);
    },
    [supabase],
  );

  const loadWeeks = useCallback(async () => {
    if (!supabase) {
      setError('Brak konfiguracji Supabase (sprawdź env).');
      return;
    }

    const { data: weeksData, error: weeksError } = await supabase
      .from('weeks')
      .select('id, week_start, status, approved_at')
      .order('week_start', { ascending: false });

    if (weeksError) {
      setError(weeksError.message);
    }

    setWeeks(weeksData ?? []);
  }, [supabase]);

  const loadSession = useCallback(async () => {
    if (!supabase) {
      setError('Brak konfiguracji Supabase (sprawdź env).');
      return null;
    }

    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      setError(sessionError.message);
      return null;
    }

    const currentUser = data.session?.user ?? null;
    setUser(currentUser);
    await loadProfile(currentUser);
    return currentUser;
  }, [loadProfile, supabase]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const currentUser = await loadSession();
    if (currentUser) {
      await loadWeeks();
    } else {
      setWeeks([]);
    }
    setLoading(false);
  }, [loadSession, loadWeeks]);

  useEffect(() => {
    void loadData();
    if (!supabase) {
      return;
    }

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null;
      setUser(nextUser);
      void loadProfile(nextUser);
      void loadData();
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, [loadData, loadProfile, supabase]);

  const handleCreateWeek = async () => {
    if (!supabase) {
      return;
    }
    setError(null);

    if (!user) {
      setError('Brak zalogowanego użytkownika.');
      return;
    }
    if (!canCreateWeek) {
      setError('Brak uprawnień do tworzenia tygodni.');
      return;
    }

    const monday = getUpcomingMonday();
    const weekStart = formatDate(monday);

    const { error: insertError } = await supabase
      .from('weeks')
      .insert({ week_start: weekStart, status: 'draft' });

    if (insertError) {
      setError(insertError.message);
      return;
    }

    await loadData();
  };

  const handleApprove = async (weekId: string) => {
    if (!supabase) {
      return;
    }
    setError(null);

    const { error: rpcError } = await supabase.rpc('approve_week', {
      p_week_id: weekId,
    });

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    await loadData();
  };

  const handleRevert = async (weekId: string) => {
    if (!supabase) {
      return;
    }
    setError(null);

    const { error: rpcError } = await supabase.rpc('revert_week', {
      p_week_id: weekId,
    });

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    await loadData();
  };

  const handleSignOut = async () => {
    if (!supabase) {
      return;
    }
    setError(null);
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setError(signOutError.message);
      return;
    }
    router.push('/login');
  };

  const canCreateWeek = profile?.role === 'planner' || profile?.role === 'head';

  if (!supabase) {
    return (
      <main style={{ padding: '2rem' }}>
        <h1>Debug DB</h1>
        <p>Brak konfiguracji Supabase (NEXT_PUBLIC_SUPABASE_URL/ANON_KEY).</p>
      </main>
    );
  }

  if (!user && !loading) {
    return (
      <main style={{ padding: '2rem', display: 'grid', gap: '1.5rem' }}>
        <header>
          <h1>Debug DB</h1>
          <p>Zalogowany: nie</p>
          <Link href="/login">Przejdź do logowania</Link>
        </header>
        {error && (
          <div style={{ color: 'crimson' }}>
            <strong>Błąd:</strong> {error}
          </div>
        )}
      </main>
    );
  }

  return (
    <main style={{ padding: '2rem', display: 'grid', gap: '1.5rem' }}>
      <header>
        <h1>Debug DB</h1>
        <p>Zalogowany: {user ? 'tak' : 'nie'}</p>
        {user && (
          <>
            <p>User ID: {user.id}</p>
            <p>Email: {user.email ?? 'brak'}</p>
            <p>Rola: {profile?.role ?? 'brak (profil nie istnieje)'}</p>
            <p>Can approve: {profile?.can_approve ? 'tak' : 'nie'}</p>
          </>
        )}
      </header>

      <section style={{ display: 'grid', gap: '0.75rem' }}>
        {user && (
          <>
            <button type="button" onClick={handleSignOut}>
              Wyloguj
            </button>
            <button type="button" onClick={handleCreateWeek} disabled={!canCreateWeek}>
              Utwórz tydzień
            </button>
            {!canCreateWeek && (
              <p style={{ color: '#666' }}>
                Brak uprawnień (wymagane planner/head).
              </p>
            )}
          </>
        )}
        {error && (
          <div style={{ color: 'crimson' }}>
            <strong>Błąd:</strong> {error}
          </div>
        )}
        {loading && <p>Ładowanie…</p>}
      </section>

      <section>
        <h2>Weeks</h2>
        {weeks.length === 0 && <p>Brak tygodni.</p>}
        <ul style={{ display: 'grid', gap: '0.75rem', padding: 0, listStyle: 'none' }}>
          {weeks.map((week) => (
            <li
              key={week.id}
              style={{ border: '1px solid #ddd', borderRadius: 8, padding: '0.75rem' }}
            >
              <div style={{ display: 'grid', gap: '0.35rem' }}>
                <div>
                  <strong>Start:</strong> {week.week_start}
                </div>
                <div>
                  <strong>Status:</strong> {week.status}
                </div>
                <div>
                  <strong>Approved at:</strong> {week.approved_at ?? '—'}
                </div>
                {profile?.can_approve && (
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button type="button" onClick={() => handleApprove(week.id)}>
                      Approve
                    </button>
                    <button type="button" onClick={() => handleRevert(week.id)}>
                      Revert
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Wymagane sloty</h2>
        <p>
          Każdy dzień roboczy i slot ({daySlots.join(' / ')}) musi mieć dokładnie 1
          ADMISSIONS przed approve.
        </p>
      </section>
    </main>
  );
}
