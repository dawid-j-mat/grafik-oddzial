'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase as sharedClient } from '@/lib/supabaseClient';

const DAYS = ['Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek'] as const;
const SLOTS = [
  { id: 'AM', label: 'RANO' },
  { id: 'PM', label: 'POPOŁUDNIE' },
] as const;

const SLOT_LABELS: Record<(typeof SLOTS)[number]['id'], string> = {
  AM: 'RANO',
  PM: 'POPOŁUDNIE',
};

const ABSENCE_REASON_LABELS: Record<string, string> = {
  VACATION: 'Urlop',
  TRAINING: 'Szkolenie',
  POST_CALL: 'Zejście po dyżurze',
  INTERNSHIP: 'Staż',
  OTHER: 'Inne',
};

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
};

type AssignmentRow = {
  week_id: string;
  date: string;
  slot: string;
  doctor_id: string;
  status: string;
};

type AbsenceRow = {
  week_id: string;
  date: string;
  slot: string;
  doctor_id: string;
  reason: string;
};

type SlotSummary = {
  admissionsDoctorId: string | null;
  wardDoctorIds: string[];
  absencesByDoctorId: Record<string, string>;
};

type MissingEntry =
  | { type: 'MISSING_WEEK'; week_start: string }
  | { type: 'MISSING_ADMISSIONS'; week_start: string; date: string; slot: 'AM' | 'PM' };

type MissingWeek = Extract<MissingEntry, { type: 'MISSING_WEEK' }>;
type MissingAdmissions = Extract<MissingEntry, { type: 'MISSING_ADMISSIONS' }>;

const formatDateLocal = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatMonthParam = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

const parseMonthParam = (value: string) => {
  const [year, month] = value.split('-').map(Number);
  if (!year || !month) {
    return null;
  }
  const parsed = new Date(year, month - 1, 1);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
};

const parseDateLocal = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const startOfWeekMonday = (date: Date) => {
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

const buildWeekDates = (weekStart: string) => {
  const monday = startOfWeekMonday(parseDateLocal(weekStart));
  return Array.from({ length: 5 }, (_value, index) => addDays(monday, index));
};

const getMonthRange = (monthStart: Date) => {
  const monthStartDate = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
  const monthEndDate = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  const rangeStart = startOfWeekMonday(monthStartDate);
  const rangeEnd = addDays(startOfWeekMonday(monthEndDate), 4);
  return { rangeStart, rangeEnd };
};

const buildWeekStarts = (rangeStart: Date, rangeEnd: Date) => {
  const weekStarts: string[] = [];
  let current = new Date(rangeStart);
  while (current <= rangeEnd) {
    weekStarts.push(formatDateLocal(current));
    current = addDays(current, 7);
  }
  return weekStarts;
};

const createEmptySlot = (): SlotSummary => ({
  admissionsDoctorId: null,
  wardDoctorIds: [],
  absencesByDoctorId: {},
});

const buildEmptyWeekSlots = (weekStart: string) => {
  const slots: Record<string, SlotSummary> = {};
  const weekDates = buildWeekDates(weekStart);
  weekDates.forEach((date) => {
    const dateString = formatDateLocal(date);
    SLOTS.forEach((slot) => {
      slots[`${dateString}-${slot.id}`] = createEmptySlot();
    });
  });
  return slots;
};

export default function MonthPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => sharedClient, []);

  const monthStart = useMemo(() => {
    const raw = searchParams?.get('month');
    const parsed = raw ? parseMonthParam(raw) : null;
    const base = parsed ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  }, [searchParams]);

  const monthStartString = useMemo(() => formatDateLocal(monthStart), [monthStart]);
  const monthLabel = useMemo(() => {
    const formatter = new Intl.DateTimeFormat('pl-PL', {
      month: 'long',
      year: 'numeric',
    });
    return formatter.format(monthStart);
  }, [monthStart]);

  const { rangeStart, rangeEnd } = useMemo(() => getMonthRange(monthStart), [monthStart]);
  const weekStarts = useMemo(() => buildWeekStarts(rangeStart, rangeEnd), [rangeStart, rangeEnd]);

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [slotAssignmentsByWeek, setSlotAssignmentsByWeek] = useState<
    Record<string, Record<string, SlotSummary>>
  >({});
  const [loadingSession, setLoadingSession] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [missingReport, setMissingReport] = useState<MissingEntry[] | null>(null);

  const doctorsById = useMemo(
    () => new Map(doctors.map((doctor) => [doctor.id, doctor.full_name])),
    [doctors],
  );

  const weeksByStart = useMemo(() => new Map(weeks.map((week) => [week.week_start, week])), [weeks]);

  const loadSession = useCallback(async () => {
    setLoadingSession(true);
    setError(null);
    if (!supabase) {
      setError('Brak konfiguracji Supabase (sprawdź env).');
      setLoadingSession(false);
      return;
    }

    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      setError(sessionError.message);
      setUser(null);
      setLoadingSession(false);
      return;
    }

    setUser(data.session?.user ?? null);
    setLoadingSession(false);
  }, [supabase]);

  const loadMonthData = useCallback(async () => {
    if (!user) {
      return;
    }
    setLoadingData(true);
    setError(null);
    setMissingReport(null);

    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('role, can_approve')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileError) {
      setError(profileError.message);
    }

    const { data: doctorsData, error: doctorsError } = await supabase
      .from('doctors')
      .select('id, full_name, is_active')
      .order('full_name', { ascending: true });

    if (doctorsError) {
      setError(doctorsError.message);
    }

    const { data: weeksData, error: weeksError } = await supabase
      .from('weeks')
      .select('id, week_start, status')
      .in('week_start', weekStarts)
      .order('week_start', { ascending: true });

    if (weeksError) {
      setError(weeksError.message);
    }

    const weekIds = (weeksData ?? []).map((week) => week.id);
    let assignmentsData: AssignmentRow[] = [];
    let absencesData: AbsenceRow[] = [];

    if (weekIds.length > 0) {
      const { data: assignments, error: assignmentsError } = await supabase
        .from('assignments')
        .select('week_id, date, slot, doctor_id, status')
        .in('week_id', weekIds);

      if (assignmentsError) {
        setError(assignmentsError.message);
      }

      const { data: absences, error: absencesError } = await supabase
        .from('absences')
        .select('week_id, date, slot, doctor_id, reason')
        .in('week_id', weekIds);

      if (absencesError) {
        setError(absencesError.message);
      }

      assignmentsData = assignments ?? [];
      absencesData = absences ?? [];
    }

    const slotsByWeek: Record<string, Record<string, SlotSummary>> = {};
    weekStarts.forEach((weekStart) => {
      slotsByWeek[weekStart] = buildEmptyWeekSlots(weekStart);
    });

    const weekStartById = new Map((weeksData ?? []).map((week) => [week.id, week.week_start]));

    assignmentsData.forEach((assignment) => {
      const weekStart = weekStartById.get(assignment.week_id);
      if (!weekStart) {
        return;
      }
      const slotKey = `${assignment.date}-${assignment.slot}`;
      const slot = slotsByWeek[weekStart]?.[slotKey];
      if (!slot) {
        return;
      }
      if (assignment.status === 'ADMISSIONS') {
        slot.admissionsDoctorId = assignment.doctor_id;
      } else if (assignment.status === 'WARD') {
        slot.wardDoctorIds.push(assignment.doctor_id);
      }
    });

    absencesData.forEach((absence) => {
      const weekStart = weekStartById.get(absence.week_id);
      if (!weekStart) {
        return;
      }
      const slotKey = `${absence.date}-${absence.slot}`;
      const slot = slotsByWeek[weekStart]?.[slotKey];
      if (!slot) {
        return;
      }
      slot.absencesByDoctorId[absence.doctor_id] = absence.reason;
    });

    setProfile(profileData ?? null);
    setDoctors(doctorsData ?? []);
    setWeeks(weeksData ?? []);
    setSlotAssignmentsByWeek(slotsByWeek);
    setLoadingData(false);
  }, [supabase, user, weekStarts]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (!user) {
      return;
    }
    void loadMonthData();
  }, [loadMonthData, user]);

  const handleChangeMonth = (offset: number) => {
    const next = new Date(monthStart);
    next.setMonth(monthStart.getMonth() + offset);
    router.push(`/month?month=${formatMonthParam(next)}`);
  };

  const handleApproveMonth = async () => {
    if (!profile?.can_approve) {
      return;
    }
    setApproving(true);
    setError(null);
    setMissingReport(null);

    const { data, error: approveError } = await supabase.rpc('approve_month', {
      p_month_start: monthStartString,
    });

    if (approveError) {
      setError(approveError.message);
      setApproving(false);
      return;
    }

    const result = data as { ok?: boolean; missing?: MissingEntry[] } | null;
    if (result?.ok) {
      setMissingReport(null);
      await loadMonthData();
    } else {
      setMissingReport(result?.missing ?? []);
    }

    setApproving(false);
  };

  const formatDayLabel = (dateString: string) => {
    const formatter = new Intl.DateTimeFormat('pl-PL', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
    });
    return formatter.format(parseDateLocal(dateString));
  };

  if (loadingSession) {
    return (
      <main className="month-page">
        <h1>Grafik miesięczny</h1>
        <p>Ładowanie sesji...</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="month-page">
        <h1>Grafik miesięczny</h1>
        <p>Brak aktywnej sesji.</p>
        <Link href="/login" className="month-login-link">
          Zaloguj się
        </Link>
      </main>
    );
  }

  return (
    <main className="month-page">
      <header className="month-header">
        <div>
          <h1>Grafik miesięczny</h1>
          <p className="month-subtitle">
            Rola: {profile?.role ?? 'brak'} · can_approve: {profile?.can_approve ? 'tak' : 'nie'}
          </p>
        </div>
        <div className="month-nav">
          <button type="button" className="month-button" onClick={() => handleChangeMonth(-1)}>
            ← Poprzedni miesiąc
          </button>
          <div className="month-nav-label">
            <span className="month-nav-title">{monthLabel}</span>
            <span className="month-nav-range">
              Zakres: {formatDateLocal(rangeStart)} – {formatDateLocal(rangeEnd)}
            </span>
          </div>
          <button type="button" className="month-button" onClick={() => handleChangeMonth(1)}>
            Następny miesiąc →
          </button>
        </div>
      </header>

      <section className="month-toolbar">
        <div className="month-toolbar-left">
          <Link href={`/schedule?week_start=${weekStarts[0]}`} className="month-link">
            Przejdź do najbliższego tygodnia
          </Link>
        </div>
        {profile?.can_approve && (
          <button
            type="button"
            className="month-button month-button--primary"
            onClick={handleApproveMonth}
            disabled={approving}
          >
            {approving ? 'Zatwierdzanie...' : 'Zatwierdź miesiąc'}
          </button>
        )}
      </section>

      {error && <p className="month-error">{error}</p>}
      {loadingData && <p>Ładowanie danych miesiąca...</p>}

      {missingReport && missingReport.length > 0 && (
        <section className="month-missing">
          <h2>Braki w zatwierdzeniu miesiąca</h2>
          {missingReport.some((entry) => entry.type === 'MISSING_WEEK') && (
            <div className="month-missing-block">
              <h3>Brak utworzonych tygodni</h3>
              <ul>
                {missingReport
                  .filter((entry): entry is MissingWeek => entry.type === 'MISSING_WEEK')
                  .map((entry) => (
                    <li key={`missing-week-${entry.week_start}`}>
                      Brak utworzonego tygodnia: {entry.week_start}
                    </li>
                  ))}
              </ul>
            </div>
          )}
          {missingReport.some((entry) => entry.type === 'MISSING_ADMISSIONS') && (
            <div className="month-missing-block">
              <h3>Braki w obsadzie Izby</h3>
              {Array.from(
                missingReport
                  .filter(
                    (entry): entry is MissingAdmissions => entry.type === 'MISSING_ADMISSIONS',
                  )
                  .reduce((acc, entry) => {
                    const list = acc.get(entry.week_start) ?? [];
                    list.push(entry);
                    acc.set(entry.week_start, list);
                    return acc;
                  }, new Map<string, MissingAdmissions[]>()),
              ).map(([weekStart, items]) => (
                <div key={`missing-adm-${weekStart}`} className="month-missing-week">
                  <strong>Tydzień {weekStart}</strong>
                  <ul>
                    {items.map((item) => (
                      <li key={`${weekStart}-${item.date}-${item.slot}`}>
                        {formatDayLabel(item.date)} · {SLOT_LABELS[item.slot]}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="month-grid">
        {weekStarts.map((weekStart) => {
          const week = weeksByStart.get(weekStart);
          const weekDates = buildWeekDates(weekStart);
          const slotAssignments = slotAssignmentsByWeek[weekStart];
          const weekStatus = week?.status ?? 'missing';
          const weekStatusLabel =
            weekStatus === 'approved'
              ? 'zatwierdzony'
              : weekStatus === 'draft'
                ? 'roboczy'
                : 'brak tygodnia';

          return (
            <section key={weekStart} className="month-week">
              <header className="month-week-header">
                <Link href={`/schedule?week_start=${weekStart}`} className="month-week-link">
                  Tydzień od {weekStart}
                </Link>
                <span
                  className={`month-week-badge month-week-badge--${
                    weekStatus === 'approved'
                      ? 'approved'
                      : weekStatus === 'draft'
                        ? 'draft'
                        : 'missing'
                  }`}
                >
                  {weekStatusLabel}
                </span>
              </header>
              <div className="month-week-days">
                {weekDates.map((date, index) => {
                  const dateString = formatDateLocal(date);
                  const isOutsideMonth = date.getMonth() !== monthStart.getMonth();
                  return (
                    <Link
                      key={dateString}
                      href={`/schedule?week_start=${weekStart}`}
                      className={`month-day ${isOutsideMonth ? 'month-day--outside' : ''}`}
                    >
                      <div className="month-day-header">
                        <span className="month-day-name">{DAYS[index]}</span>
                        <span className="month-day-date">
                          {dateString.slice(8, 10)}.{dateString.slice(5, 7)}
                        </span>
                      </div>
                      <div className="month-day-slots">
                        {SLOTS.map((slot) => {
                          const slotKey = `${dateString}-${slot.id}`;
                          const slotData = slotAssignments?.[slotKey] ?? createEmptySlot();
                          const admissionsName = slotData.admissionsDoctorId
                            ? doctorsById.get(slotData.admissionsDoctorId) ?? 'Nieznany'
                            : 'BRAK';
                          const wardNames = slotData.wardDoctorIds
                            .map((id) => doctorsById.get(id) ?? 'Nieznany')
                            .filter(Boolean);
                          const wardLabel =
                            wardNames.length === 0
                              ? '—'
                              : wardNames.length <= 3
                                ? wardNames.join(', ')
                                : `${wardNames.length} osób`;
                          const absenceEntries = Object.entries(slotData.absencesByDoctorId).map(
                            ([doctorId, reason]) => ({
                              name: doctorsById.get(doctorId) ?? 'Nieznany',
                              reason: ABSENCE_REASON_LABELS[reason] ?? 'Inne',
                            }),
                          );

                          return (
                            <div key={slot.id} className="month-slot">
                              <div className="month-slot-title">{slot.label}</div>
                              <div className="month-slot-line">
                                <span>Izba:</span>
                                <strong>{admissionsName}</strong>
                              </div>
                              <div className="month-slot-line">
                                <span>Oddział:</span>
                                <span>{wardLabel}</span>
                              </div>
                              <div className="month-slot-line">
                                <span>Nieobecni:</span>
                                <span>{absenceEntries.length}</span>
                              </div>
                              {absenceEntries.length > 0 && (
                                <ul className="month-absence-list">
                                  {absenceEntries.map((entry) => (
                                    <li key={`${entry.name}-${entry.reason}`}>
                                      {entry.name} ({entry.reason})
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
