'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase as sharedClient } from '@/lib/supabaseClient';

const DAYS = ['Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek'] as const;
const SLOTS = [
  { id: 'AM', label: 'RANO (08:00–12:00)' },
  { id: 'PM', label: 'POPOŁUDNIE (12:00–15:35)' },
] as const;

const ABSENCE_REASONS = ['VACATION', 'TRAINING', 'POST_CALL', 'OTHER'] as const;
const ABSENCE_REASON_LABELS: Record<(typeof ABSENCE_REASONS)[number], string> = {
  VACATION: 'Urlop',
  TRAINING: 'Szkolenie',
  POST_CALL: 'Zejście po dyżurze',
  OTHER: 'Inne',
};

type AbsenceReason = (typeof ABSENCE_REASONS)[number];

type Profile = {
  role: string;
  can_approve: boolean;
};

type Doctor = {
  id: string;
  full_name: string;
  is_active: boolean;
};

type Week = {
  id: string;
  week_start: string;
  status: string;
  approved_at: string | null;
  approved_by: string | null;
};

type AssignmentRow = {
  date: string;
  slot: string;
  doctor_id: string;
  status: string;
};

type AbsenceRow = {
  date: string;
  slot: string;
  doctor_id: string;
  reason: string;
};

type SlotAssignment = {
  admissionsDoctorId: string | null;
  wardDoctorIds: string[];
  absencesByDoctorId: Record<string, AbsenceReason>;
};

const formatDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseDateString = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const parseDateStringSafe = (value: string) => {
  const parsed = parseDateString(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
};

const getMonday = (date: Date) => {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + diff);
  return monday;
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(date.getDate() + days);
  return next;
};

const getWeekStartString = (date: Date) => formatDate(getMonday(date));

const buildWeekDates = (weekStart: string) => {
  const monday = getMonday(parseDateString(weekStart));
  return Array.from({ length: 5 }, (_value, index) => addDays(monday, index));
};

const formatRangeLabel = (weekStart: string) => {
  const weekDates = buildWeekDates(weekStart);
  const start = weekDates[0];
  const end = weekDates[weekDates.length - 1];
  const formatter = new Intl.DateTimeFormat('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  return `${formatter.format(start)} – ${formatter.format(end)}`;
};

const createEmptySlot = (): SlotAssignment => ({
  admissionsDoctorId: null,
  wardDoctorIds: [],
  absencesByDoctorId: {},
});

const buildEmptyAssignments = (weekStart: string) => {
  const empty: Record<string, SlotAssignment> = {};
  const weekDates = buildWeekDates(weekStart);
  weekDates.forEach((date) => {
    const dateString = formatDate(date);
    SLOTS.forEach((slot) => {
      empty[`${dateString}-${slot.id}`] = createEmptySlot();
    });
  });
  return empty;
};

const normalizeAbsenceReason = (reason: string): AbsenceReason => {
  if (ABSENCE_REASONS.includes(reason as AbsenceReason)) {
    return reason as AbsenceReason;
  }
  return 'OTHER';
};

export default function SchedulePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => sharedClient, []);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [weekStart, setWeekStart] = useState(() => getWeekStartString(new Date()));
  const [week, setWeek] = useState<Week | null>(null);
  const [slotAssignments, setSlotAssignments] = useState<Record<string, SlotAssignment>>(() =>
    buildEmptyAssignments(getWeekStartString(new Date())),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canCreateWeek = profile?.role === 'planner' || profile?.role === 'head';
  const isReadOnly = week?.status === 'approved';
  const weekDates = useMemo(() => buildWeekDates(weekStart), [weekStart]);
  const doctorsById = useMemo(
    () => new Map(doctors.map((doctor) => [doctor.id, doctor.full_name])),
    [doctors],
  );

  const updateAssignment = useCallback(
    (slotKey: string, updater: (data: SlotAssignment) => SlotAssignment) => {
      if (isReadOnly || !week) {
        return;
      }
      setSlotAssignments((prev) => ({
        ...prev,
        [slotKey]: updater(prev[slotKey] ?? createEmptySlot()),
      }));
    },
    [isReadOnly, week],
  );

  const handleAdmissionsChange = (slotKey: string, doctorId: string) => {
    updateAssignment(slotKey, (data) => {
      if (!doctorId) {
        return { ...data, admissionsDoctorId: null };
      }
      const nextWard = data.wardDoctorIds.filter((id) => id !== doctorId);
      const nextAbsence = { ...data.absencesByDoctorId };
      delete nextAbsence[doctorId];
      return {
        ...data,
        admissionsDoctorId: doctorId,
        wardDoctorIds: nextWard,
        absencesByDoctorId: nextAbsence,
      };
    });
  };

  const toggleWard = (slotKey: string, doctorId: string) => {
    updateAssignment(slotKey, (data) => {
      if (data.admissionsDoctorId === doctorId || data.absencesByDoctorId[doctorId]) {
        return data;
      }
      const isSelected = data.wardDoctorIds.includes(doctorId);
      const nextWard = isSelected
        ? data.wardDoctorIds.filter((id) => id !== doctorId)
        : [...data.wardDoctorIds, doctorId];
      return { ...data, wardDoctorIds: nextWard };
    });
  };

  const toggleAbsence = (slotKey: string, doctorId: string) => {
    updateAssignment(slotKey, (data) => {
      if (data.admissionsDoctorId === doctorId || data.wardDoctorIds.includes(doctorId)) {
        return data;
      }
      const nextAbsence = { ...data.absencesByDoctorId };
      if (nextAbsence[doctorId]) {
        delete nextAbsence[doctorId];
      } else {
        nextAbsence[doctorId] = 'VACATION';
      }
      return { ...data, absencesByDoctorId: nextAbsence };
    });
  };

  const updateAbsenceReason = (slotKey: string, doctorId: string, reason: AbsenceReason) => {
    updateAssignment(slotKey, (data) => ({
      ...data,
      absencesByDoctorId: { ...data.absencesByDoctorId, [doctorId]: reason },
    }));
  };

  const clearSlot = (slotKey: string) => {
    updateAssignment(slotKey, () => createEmptySlot());
  };

  const loadProfile = useCallback(
    async (currentUser: User) => {
      if (!supabase) {
        return null;
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
      return profileData ?? null;
    },
    [supabase],
  );

  const loadDoctors = useCallback(async () => {
    if (!supabase) {
      return;
    }

    const { data: doctorsData, error: doctorsError } = await supabase
      .from('doctors')
      .select('id, full_name, is_active')
      .eq('is_active', true)
      .order('full_name', { ascending: true });

    if (doctorsError) {
      setError(doctorsError.message);
    }

    setDoctors(doctorsData ?? []);
  }, [supabase]);

  const loadWeek = useCallback(async () => {
    if (!supabase) {
      return null;
    }

    const { data: weekData, error: weekError } = await supabase
      .from('weeks')
      .select('id, week_start, status, approved_at, approved_by')
      .eq('week_start', weekStart)
      .maybeSingle();

    if (weekError) {
      setError(weekError.message);
    }

    setWeek(weekData ?? null);
    return weekData ?? null;
  }, [supabase, weekStart]);

  const loadAssignments = useCallback(
    async (weekId: string | null) => {
      if (!supabase || !weekId) {
        setSlotAssignments(buildEmptyAssignments(weekStart));
        return;
      }

      const emptyAssignments = buildEmptyAssignments(weekStart);

      const { data: assignmentsData, error: assignmentsError } = await supabase
        .from('assignments')
        .select('date, slot, doctor_id, status')
        .eq('week_id', weekId);

      if (assignmentsError) {
        setError(assignmentsError.message);
      }

      (assignmentsData ?? []).forEach((row: AssignmentRow) => {
        const slotKey = `${row.date}-${row.slot}`;
        const slotData = emptyAssignments[slotKey];
        if (!slotData) {
          return;
        }
        if (row.status === 'ADMISSIONS') {
          slotData.admissionsDoctorId = row.doctor_id;
          slotData.wardDoctorIds = slotData.wardDoctorIds.filter((id) => id !== row.doctor_id);
          delete slotData.absencesByDoctorId[row.doctor_id];
        } else if (row.status === 'WARD') {
          if (!slotData.wardDoctorIds.includes(row.doctor_id)) {
            slotData.wardDoctorIds.push(row.doctor_id);
          }
        }
      });

      const { data: absencesData, error: absencesError } = await supabase
        .from('absences')
        .select('date, slot, doctor_id, reason')
        .eq('week_id', weekId);

      if (absencesError) {
        setError(absencesError.message);
      }

      (absencesData ?? []).forEach((row: AbsenceRow) => {
        const slotKey = `${row.date}-${row.slot}`;
        const slotData = emptyAssignments[slotKey];
        if (!slotData) {
          return;
        }
        slotData.absencesByDoctorId[row.doctor_id] = normalizeAbsenceReason(row.reason);
        slotData.wardDoctorIds = slotData.wardDoctorIds.filter((id) => id !== row.doctor_id);
        if (slotData.admissionsDoctorId === row.doctor_id) {
          slotData.admissionsDoctorId = null;
        }
      });

      setSlotAssignments(emptyAssignments);
    },
    [supabase, weekStart],
  );

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

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const currentUser = await loadSession();
    if (!currentUser) {
      setProfile(null);
      setDoctors([]);
      setWeek(null);
      setSlotAssignments(buildEmptyAssignments(weekStart));
      setLoading(false);
      return;
    }

    await loadProfile(currentUser);
    await loadDoctors();
    const weekData = await loadWeek();
    await loadAssignments(weekData?.id ?? null);
    setLoading(false);
  }, [loadAssignments, loadDoctors, loadProfile, loadSession, loadWeek, weekStart]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!supabase) {
      return undefined;
    }

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null;
      setUser(nextUser);
      if (nextUser) {
        void loadData();
      } else {
        setProfile(null);
        setDoctors([]);
        setWeek(null);
        setSlotAssignments(buildEmptyAssignments(weekStart));
      }
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, [loadData, supabase, weekStart]);

  const updateUrlWeekStart = useCallback(
    (nextWeekStart: string) => {
      const params = new URLSearchParams(searchParams?.toString());
      params.set('week_start', nextWeekStart);
      router.replace(`/schedule?${params.toString()}`);
    },
    [router, searchParams],
  );

  useEffect(() => {
    const rawWeekStart = searchParams?.get('week_start');
    const normalized = rawWeekStart
      ? getWeekStartString(parseDateStringSafe(rawWeekStart) ?? new Date())
      : getWeekStartString(new Date());

    if (normalized !== weekStart) {
      setWeekStart(normalized);
    }

    if (rawWeekStart !== normalized) {
      updateUrlWeekStart(normalized);
    }
  }, [searchParams, updateUrlWeekStart, weekStart]);

  useEffect(() => {
    const rawWeekStart = searchParams?.get('week_start');
    if (rawWeekStart !== weekStart) {
      updateUrlWeekStart(weekStart);
    }
  }, [searchParams, updateUrlWeekStart, weekStart]);

  const handleWeekChange = (value: string) => {
    if (!value) {
      return;
    }
    setWeekStart(getWeekStartString(parseDateString(value)));
  };

  const handlePrevWeek = () => {
    const monday = parseDateString(weekStart);
    setWeekStart(formatDate(addDays(monday, -7)));
  };

  const handleNextWeek = () => {
    const monday = parseDateString(weekStart);
    setWeekStart(formatDate(addDays(monday, 7)));
  };

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

    const { data: createdWeek, error: insertError } = await supabase
      .from('weeks')
      .insert({ week_start: weekStart, status: 'draft' })
      .select('id, week_start, status')
      .single();

    if (insertError) {
      if (insertError.code !== '23505') {
        setError(insertError.message);
        return;
      }

      const { data: existingWeek, error: selectError } = await supabase
        .from('weeks')
        .select('id, week_start, status, approved_at, approved_by')
        .eq('week_start', weekStart)
        .maybeSingle();

      if (selectError) {
        setError(selectError.message);
        return;
      }

      setWeek(existingWeek ?? null);
      await loadAssignments(existingWeek?.id ?? null);
      return;
    }

    setWeek({
      ...createdWeek,
      approved_at: null,
      approved_by: null,
    });
    await loadAssignments(createdWeek?.id ?? null);
  };

  const handleRevertWeek = async () => {
    if (!supabase || !week) {
      return;
    }

    setError(null);
    const { error: revertError } = await supabase.rpc('revert_week', {
      p_week_id: week.id,
    });

    if (revertError) {
      setError(revertError.message);
      return;
    }

    await loadData();
  };

  if (!supabase) {
    return (
      <main style={{ padding: '2rem' }}>
        <h1>Grafik tygodniowy</h1>
        <p>Brak konfiguracji Supabase (NEXT_PUBLIC_SUPABASE_URL/ANON_KEY).</p>
      </main>
    );
  }

  if (!user && !loading) {
    return (
      <main className="schedule-page">
        <header style={{ display: 'grid', gap: '0.5rem' }}>
          <h1>Grafik tygodniowy</h1>
          <nav style={{ display: 'flex', gap: '1rem' }}>
            <Link href="/">Strona główna</Link>
            <Link href="/doctors">Lekarze</Link>
          </nav>
        </header>
        <p>Aby zobaczyć grafik, musisz się zalogować.</p>
        <Link href="/login">Przejdź do logowania</Link>
        {error && (
          <div style={{ color: 'crimson', marginTop: '1rem' }}>
            <strong>Błąd:</strong> {error}
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="schedule-page">
      <header style={{ display: 'grid', gap: '0.5rem' }}>
        <h1>Grafik tygodniowy</h1>
        <nav style={{ display: 'flex', gap: '1rem' }}>
          <Link href="/">Strona główna</Link>
          <Link href="/doctors">Lekarze</Link>
        </nav>
      </header>

      <section style={{ display: 'grid', gap: '0.75rem', marginTop: '1rem' }}>
        <div style={{ display: 'grid', gap: '0.35rem' }}>
          <strong>Debug:</strong>
          <span>week_start: {weekStart}</span>
          <span>weekId: {week?.id ?? 'brak'}</span>
          <span>status: {week?.status ?? 'brak'}</span>
          <span>
            rola: {profile?.role ?? 'brak'} · can_approve: {profile?.can_approve ? 'tak' : 'nie'}
          </span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
          <button type="button" onClick={handlePrevWeek}>
            Poprzedni tydzień
          </button>
          <button type="button" onClick={handleNextWeek}>
            Następny tydzień
          </button>
          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            Wybierz datę
            <input type="date" value={weekStart} onChange={(event) => handleWeekChange(event.target.value)} />
          </label>
        </div>
        <p>Tydzień Pon–Pt ({formatRangeLabel(weekStart)})</p>
        <p style={{ color: '#475569' }}>Tryb podglądu / bez zapisu.</p>
        {loading && <p>Ładowanie tygodnia...</p>}
        {error && (
          <div style={{ color: 'crimson' }}>
            <strong>Błąd:</strong> {error}
          </div>
        )}
      </section>

      {!loading && !week && (
        <section style={{ marginTop: '1.5rem', display: 'grid', gap: '0.75rem' }}>
          <p>Brak grafiku dla wybranego tygodnia.</p>
          {canCreateWeek && (
            <button type="button" onClick={handleCreateWeek}>
              Utwórz tydzień (draft)
            </button>
          )}
          {!canCreateWeek && (
            <p style={{ color: '#64748b' }}>
              Tylko rola planner/head może utworzyć tydzień.
            </p>
          )}
        </section>
      )}

      {week && (
        <section style={{ marginTop: '1.5rem', display: 'grid', gap: '0.75rem' }}>
          <div>
            Status tygodnia: <strong>{week.status}</strong>
          </div>
          {week.status === 'approved' && <p>Tydzień zatwierdzony.</p>}
          {week.status === 'approved' && profile?.can_approve && (
            <button type="button" onClick={handleRevertWeek}>
              Cofnij do draft
            </button>
          )}
        </section>
      )}

      <section className="schedule-grid">
        {weekDates.flatMap((date, dayIndex) =>
          SLOTS.map((slot) => {
            const dateString = formatDate(date);
            const slotKey = `${dateString}-${slot.id}`;
            const data = slotAssignments[slotKey] ?? createEmptySlot();
            const activeDoctorIds = doctors.map((doctor) => doctor.id);
            const offDoctorIds = activeDoctorIds.filter(
              (doctorId) =>
                doctorId !== data.admissionsDoctorId &&
                !data.wardDoctorIds.includes(doctorId) &&
                !data.absencesByDoctorId[doctorId],
            );

            return (
              <article key={slotKey} className="schedule-card">
                <div className="schedule-card__header">
                  <h3>
                    {DAYS[dayIndex]} · {slot.label}
                  </h3>
                  <button
                    type="button"
                    className="schedule-clear"
                    onClick={() => clearSlot(slotKey)}
                    disabled={isReadOnly || !week}
                  >
                    Wyczyść slot
                  </button>
                </div>
                <div className="schedule-section">
                  <strong>Izba przyjęć (1 osoba)</strong>
                  <select
                    value={data.admissionsDoctorId ?? ''}
                    onChange={(event) => handleAdmissionsChange(slotKey, event.target.value)}
                    disabled={isReadOnly || !week}
                  >
                    <option value="">— wybierz —</option>
                    {doctors.map((doctor) => (
                      <option key={`${slotKey}-adm-${doctor.id}`} value={doctor.id}>
                        {doctor.full_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="schedule-section">
                  <strong>Oddział</strong>
                  <div className="schedule-list">
                    {doctors.map((doctor) => {
                      const checked = data.wardDoctorIds.includes(doctor.id);
                      const disabled =
                        isReadOnly ||
                        !week ||
                        data.admissionsDoctorId === doctor.id ||
                        !!data.absencesByDoctorId[doctor.id];
                      return (
                        <label key={`${slotKey}-ward-${doctor.id}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleWard(slotKey, doctor.id)}
                            disabled={disabled}
                          />
                          {doctor.full_name}
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div className="schedule-section">
                  <strong>Nieobecności</strong>
                  <div className="schedule-list">
                    {doctors.map((doctor) => {
                      const checked = !!data.absencesByDoctorId[doctor.id];
                      const disabled =
                        isReadOnly ||
                        !week ||
                        data.admissionsDoctorId === doctor.id ||
                        data.wardDoctorIds.includes(doctor.id);
                      return (
                        <label key={`${slotKey}-absence-${doctor.id}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleAbsence(slotKey, doctor.id)}
                            disabled={disabled}
                          />
                          {doctor.full_name}
                          {checked && (
                            <select
                              value={data.absencesByDoctorId[doctor.id]}
                              onChange={(event) =>
                                updateAbsenceReason(
                                  slotKey,
                                  doctor.id,
                                  event.target.value as AbsenceReason,
                                )
                              }
                              disabled={isReadOnly || !week}
                            >
                              {ABSENCE_REASONS.map((reason) => (
                                <option key={`${slotKey}-reason-${doctor.id}-${reason}`} value={reason}>
                                  {ABSENCE_REASON_LABELS[reason]}
                                </option>
                              ))}
                            </select>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div className="schedule-section">
                  <strong>Wolne (automatycznie)</strong>
                  <div className="off-list">
                    {offDoctorIds.length === 0 && <span>Brak</span>}
                    {offDoctorIds.map((doctorId) => (
                      <span key={`${slotKey}-off-${doctorId}`} className="off-pill">
                        {doctorsById.get(doctorId) ?? 'Nieznany lekarz'}
                      </span>
                    ))}
                  </div>
                </div>
              </article>
            );
          }),
        )}
      </section>
    </main>
  );
}
