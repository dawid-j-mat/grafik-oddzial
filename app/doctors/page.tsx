'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase as sharedClient } from '@/lib/supabaseClient';

type Profile = {
  role: string;
};

type Doctor = {
  id: string;
  full_name: string;
  is_active: boolean;
};

const allowedRoles = new Set(['planner', 'head']);

export default function DoctorsPage() {
  const supabase = useMemo(() => sharedClient, []);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addName, setAddName] = useState('');
  const [loadingAdd, setLoadingAdd] = useState(false);
  const [loadingDoctorId, setLoadingDoctorId] = useState<string | null>(null);
  const [editingDoctorId, setEditingDoctorId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const canManage = profile?.role ? allowedRoles.has(profile.role) : false;

  const loadProfile = useCallback(
    async (currentUser: User) => {
      if (!supabase) {
        return null;
      }

      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('user_id', currentUser.id)
        .maybeSingle();

      if (profileError) {
        setError(profileError.message);
      }

      setProfile(profileData ?? null);
      return profileData ?? null;
    },
    [supabase],
  );

  const loadDoctors = useCallback(async () => {
    if (!supabase) {
      return;
    }

    const query = supabase
      .from('doctors')
      .select('id, full_name, is_active')
      .order('full_name', { ascending: true });

    const { data, error: doctorsError } = showArchived
      ? await query
      : await query.eq('is_active', true);

    if (doctorsError) {
      setError(doctorsError.message);
    }

    setDoctors(data ?? []);
  }, [showArchived, supabase]);

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
    return currentUser;
  }, [supabase]);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const currentUser = await loadSession();
    if (!currentUser) {
      setProfile(null);
      setDoctors([]);
      setLoading(false);
      return;
    }

    const profileData = await loadProfile(currentUser);
    if (profileData && allowedRoles.has(profileData.role)) {
      await loadDoctors();
    } else {
      setDoctors([]);
    }
    setLoading(false);
  }, [loadDoctors, loadProfile, loadSession]);

  useEffect(() => {
    void loadInitialData();
    if (!supabase) {
      return undefined;
    }

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null;
      setUser(nextUser);
      if (nextUser) {
        void loadProfile(nextUser);
      } else {
        setProfile(null);
        setDoctors([]);
      }
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, [loadInitialData, loadProfile, supabase]);

  useEffect(() => {
    if (user && canManage) {
      void loadDoctors();
    }
  }, [canManage, loadDoctors, showArchived, user]);

  const resetEditing = () => {
    setEditingDoctorId(null);
    setEditingName('');
  };

  const handleAddDoctor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) {
      return;
    }

    const trimmedName = addName.trim();
    if (!trimmedName) {
      setError('Podaj imię i nazwisko lekarza.');
      return;
    }

    setLoadingAdd(true);
    setError(null);
    const { error: insertError } = await supabase
      .from('doctors')
      .insert({ full_name: trimmedName, is_active: true });
    setLoadingAdd(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setAddName('');
    await loadDoctors();
  };

  const handleStartEdit = (doctor: Doctor) => {
    setEditingDoctorId(doctor.id);
    setEditingName(doctor.full_name);
  };

  const handleSaveEdit = async (doctorId: string) => {
    if (!supabase) {
      return;
    }

    const trimmedName = editingName.trim();
    if (!trimmedName) {
      setError('Nazwa lekarza nie może być pusta.');
      return;
    }

    setLoadingDoctorId(doctorId);
    setError(null);
    const { error: updateError } = await supabase
      .from('doctors')
      .update({ full_name: trimmedName })
      .eq('id', doctorId);
    setLoadingDoctorId(null);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    resetEditing();
    await loadDoctors();
  };

  const handleToggleArchive = async (doctor: Doctor) => {
    if (!supabase) {
      return;
    }

    setLoadingDoctorId(doctor.id);
    setError(null);
    const { error: updateError } = await supabase
      .from('doctors')
      .update({ is_active: !doctor.is_active })
      .eq('id', doctor.id);
    setLoadingDoctorId(null);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    await loadDoctors();
  };

  const handleDeleteDoctor = async (doctor: Doctor) => {
    if (!supabase) {
      return;
    }

    const confirmed = window.confirm(
      `Czy na pewno chcesz usunąć ${doctor.full_name}? Tej operacji nie można cofnąć.`,
    );
    if (!confirmed) {
      return;
    }

    setLoadingDoctorId(doctor.id);
    setError(null);
    const { error: deleteError } = await supabase.rpc('delete_doctor_safe', {
      p_doctor_id: doctor.id,
    });
    setLoadingDoctorId(null);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    await loadDoctors();
  };

  if (!supabase) {
    return (
      <main style={{ padding: '2rem' }}>
        <h1>Lekarze</h1>
        <p>Brak konfiguracji Supabase (NEXT_PUBLIC_SUPABASE_URL/ANON_KEY).</p>
      </main>
    );
  }

  if (!user && loading) {
    return (
      <main style={{ padding: '2rem' }}>
        <h1>Lekarze</h1>
        <p>Ładowanie…</p>
      </main>
    );
  }

  if (!user && !loading) {
    return (
      <main style={{ padding: '2rem', display: 'grid', gap: '1rem' }}>
        <h1>Lekarze</h1>
        <p>Aby zarządzać lekarzami, musisz się zalogować.</p>
        <Link href="/login">Przejdź do logowania</Link>
      </main>
    );
  }

  if (user && !loading && !canManage) {
    return (
      <main style={{ padding: '2rem', display: 'grid', gap: '1rem' }}>
        <h1>Lekarze</h1>
        <p>Brak uprawnień do zarządzania lekarzami.</p>
      </main>
    );
  }

  return (
    <main style={{ padding: '2rem', display: 'grid', gap: '1.5rem' }}>
      <header style={{ display: 'grid', gap: '0.5rem' }}>
        <h1>Lekarze</h1>
        <nav style={{ display: 'flex', gap: '1rem' }}>
          <Link href="/">Strona główna</Link>
          <Link href="/schedule">Grafik</Link>
        </nav>
      </header>

      {loading && <p>Ładowanie…</p>}
      {error && (
        <div style={{ color: 'crimson' }}>
          <strong>Błąd:</strong> {error}
        </div>
      )}

      <section style={{ display: 'grid', gap: '1rem' }}>
        <form onSubmit={handleAddDoctor} style={{ display: 'grid', gap: '0.5rem' }}>
          <label style={{ display: 'grid', gap: '0.35rem', maxWidth: 320 }}>
            Dodaj lekarza
            <input
              type="text"
              value={addName}
              onChange={(event) => setAddName(event.target.value)}
              placeholder="Imię i nazwisko"
              required
            />
          </label>
          <button type="submit" disabled={loadingAdd || !!loadingDoctorId}>
            {loadingAdd ? 'Dodawanie…' : 'Dodaj'}
          </button>
        </form>

        <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
          />
          Pokaż archiwalnych
        </label>
      </section>

      <section style={{ display: 'grid', gap: '0.75rem' }}>
        <h2>Lista lekarzy</h2>
        {doctors.length === 0 && <p>Brak lekarzy do wyświetlenia.</p>}
        <ul style={{ display: 'grid', gap: '0.75rem', listStyle: 'none', padding: 0 }}>
          {doctors.map((doctor) => {
            const isEditing = editingDoctorId === doctor.id;
            const isBusy = loadingDoctorId === doctor.id || loadingAdd;

            return (
              <li
                key={doctor.id}
                style={{ border: '1px solid #ddd', borderRadius: 8, padding: '0.75rem' }}
              >
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  {isEditing ? (
                    <label style={{ display: 'grid', gap: '0.35rem', maxWidth: 320 }}>
                      Nazwa
                      <input
                        type="text"
                        value={editingName}
                        onChange={(event) => setEditingName(event.target.value)}
                        required
                      />
                    </label>
                  ) : (
                    <div>
                      <strong>{doctor.full_name}</strong>{' '}
                      {!doctor.is_active && <span>(archiwalny)</span>}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(doctor.id)}
                          disabled={isBusy}
                        >
                          Zapisz
                        </button>
                        <button type="button" onClick={resetEditing} disabled={isBusy}>
                          Anuluj
                        </button>
                      </>
                    ) : (
                      <button type="button" onClick={() => handleStartEdit(doctor)} disabled={isBusy}>
                        Edytuj nazwę
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleToggleArchive(doctor)}
                      disabled={isBusy}
                    >
                      {doctor.is_active ? 'Archiwizuj' : 'Przywróć'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteDoctor(doctor)}
                      disabled={isBusy}
                    >
                      Usuń trwale
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
