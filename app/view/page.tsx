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
  approved_at: string | null;
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

type SlotId = (typeof SLOTS)[number]['id'];

type DaySummary = {
  admissionsBySlot: Record<SlotId, string | null>;
  wardBySlot: Record<SlotId, string[]>;
  absencesBySlot: Record<SlotId, Record<string, string>>;
};

type WeekData = {
  week: Week | null;
  summaries: Record<string, DaySummary>;
};

type MonthData = {
  weeks: Week[];
  summariesByWeekStart: Record<string, Record<string, DaySummary>>;
};

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

const parseDateLocal = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const parseDateLocalSafe = (value: string) => {
  const parsed = parseDateLocal(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
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

const createEmptyDaySummary = (): DaySummary => ({
  admissionsBySlot: { AM: null, PM: null },
  wardBySlot: { AM: [], PM: [] },
  absencesBySlot: { AM: {}, PM: {} },
});

const buildEmptyWeekSummaries = (weekStart: string) => {
  const days: Record<string, DaySummary> = {};
  buildWeekDates(weekStart).forEach((date) => {
    days[formatDateLocal(date)] = createEmptyDaySummary();
  });
  return days;
};

const areSameDoctorSets = (left: string[], right: string[]) => {
  if (left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every((doctorId) => rightSet.has(doctorId));
};

const areSameAbsenceMaps = (left: Record<string, string>, right: Record<string, string>) => {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  return leftEntries.every(([doctorId, reason]) => right[doctorId] === reason);
};

const buildWeekSummaries = (weekStart: string, assignments: AssignmentRow[], absences: AbsenceRow[]) => {
  const summaries = buildEmptyWeekSummaries(weekStart);
  assignments.forEach((assignment) => {
    const day = summaries[assignment.date];
    const slot = assignment.slot as SlotId;
    if (!day || !SLOTS.some((item) => item.id === slot)) {
      return;
    }
    if (assignment.status === 'ADMISSIONS') {
      day.admissionsBySlot[slot] = assignment.doctor_id;
    }
    if (assignment.status === 'WARD') {
      day.wardBySlot[slot].push(assignment.doctor_id);
    }
  });

  absences.forEach((absence) => {
    const day = summaries[absence.date];
    const slot = absence.slot as SlotId;
    if (!day || !SLOTS.some((item) => item.id === slot)) {
      return;
    }
    day.absencesBySlot[slot][absence.doctor_id] = absence.reason;
  });

  return summaries;
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

const buildAbsenceEntries = (
  absencesByDoctorId: Record<string, string>,
  doctorsById: Map<string, string>,
) =>
  Object.entries(absencesByDoctorId).map(([doctorId, reason]) => ({
    name: doctorsById.get(doctorId) ?? 'Nieznany',
    reason: ABSENCE_REASON_LABELS[reason] ?? 'Inne',
  }));

const buildNameList = (ids: string[], doctorsById: Map<string, string>) =>
  ids.map((doctorId) => doctorsById.get(doctorId) ?? 'Nieznany');

export default function ViewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => sharedClient, []);

  const viewMode = useMemo(() => (searchParams?.get('month') ? 'month' : 'week'), [searchParams]);

  const weekStart = useMemo(() => {
    const rawWeekStart = searchParams?.get('week_start');
    const parsed = rawWeekStart ? parseDateLocalSafe(rawWeekStart) : null;
    const base = parsed ?? new Date();
    return formatDateLocal(startOfWeekMonday(base));
  }, [searchParams]);

  const monthStart = useMemo(() => {
    const rawMonth = searchParams?.get('month');
    const parsed = rawMonth ? parseMonthParam(rawMonth) : null;
    const base = parsed ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  }, [searchParams]);

  const monthParam = useMemo(() => formatMonthParam(monthStart), [monthStart]);
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
  const [weekData, setWeekData] = useState<WeekData | null>(null);
  const [monthData, setMonthData] = useState<MonthData | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doctorsById = useMemo(
    () => new Map(doctors.map((doctor) => [doctor.id, doctor.full_name])),
    [doctors],
  );

  const canEdit = profile?.role === 'planner' || profile?.role === 'head';

  useEffect(() => {
    if (!searchParams) {
      return;
    }
    if (viewMode === 'week') {
      const needsReplace =
        searchParams.get('week_start') !== weekStart || searchParams.get('month') !== null;
      if (needsReplace) {
        router.replace(`/view?week_start=${weekStart}`);
      }
    } else {
      const needsReplace =
        searchParams.get('month') !== monthParam || searchParams.get('week_start') !== null;
      if (needsReplace) {
        router.replace(`/view?month=${monthParam}`);
      }
    }
  }, [monthParam, router, searchParams, viewMode, weekStart]);

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

  const loadProfileAndDoctors = useCallback(async () => {
    if (!user) {
      return;
    }

    setLoadingData(true);
    setError(null);

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

    setProfile(profileData ?? null);
    setDoctors(doctorsData ?? []);
    setLoadingData(false);
  }, [supabase, user]);

  const loadWeekData = useCallback(async () => {
    if (!user) {
      return;
    }
    setLoadingData(true);
    setError(null);

    const { data: week, error: weekError } = await supabase
      .from('weeks')
      .select('id, week_start, status, approved_at')
      .eq('week_start', weekStart)
      .maybeSingle();

    if (weekError) {
      setError(weekError.message);
    }

    if (!week) {
      setWeekData({ week: null, summaries: buildEmptyWeekSummaries(weekStart) });
      setLoadingData(false);
      return;
    }

    const { data: assignments, error: assignmentsError } = await supabase
      .from('assignments')
      .select('week_id, date, slot, doctor_id, status')
      .eq('week_id', week.id);

    if (assignmentsError) {
      setError(assignmentsError.message);
    }

    const { data: absences, error: absencesError } = await supabase
      .from('absences')
      .select('week_id, date, slot, doctor_id, reason')
      .eq('week_id', week.id);

    if (absencesError) {
      setError(absencesError.message);
    }

    const summaries = buildWeekSummaries(weekStart, assignments ?? [], absences ?? []);

    setWeekData({ week, summaries });
    setLoadingData(false);
  }, [supabase, user, weekStart]);

  const loadMonthData = useCallback(async () => {
    if (!user) {
      return;
    }
    setLoadingData(true);
    setError(null);

    const { data: weeks, error: weeksError } = await supabase
      .from('weeks')
      .select('id, week_start, status, approved_at')
      .in('week_start', weekStarts)
      .order('week_start', { ascending: true });

    if (weeksError) {
      setError(weeksError.message);
    }

    const weekIds = (weeks ?? []).map((item) => item.id);
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

    const summariesByWeekStart: Record<string, Record<string, DaySummary>> = {};
    weekStarts.forEach((start) => {
      summariesByWeekStart[start] = buildEmptyWeekSummaries(start);
    });

    const weekStartById = new Map((weeks ?? []).map((week) => [week.id, week.week_start]));

    assignmentsData.forEach((assignment) => {
      const weekStartValue = weekStartById.get(assignment.week_id);
      const slot = assignment.slot as SlotId;
      if (!weekStartValue || !SLOTS.some((item) => item.id === slot)) {
        return;
      }
      const day = summariesByWeekStart[weekStartValue]?.[assignment.date];
      if (!day) {
        return;
      }
      if (assignment.status === 'ADMISSIONS') {
        day.admissionsBySlot[slot] = assignment.doctor_id;
      }
      if (assignment.status === 'WARD') {
        day.wardBySlot[slot].push(assignment.doctor_id);
      }
    });

    absencesData.forEach((absence) => {
      const weekStartValue = weekStartById.get(absence.week_id);
      const slot = absence.slot as SlotId;
      if (!weekStartValue || !SLOTS.some((item) => item.id === slot)) {
        return;
      }
      const day = summariesByWeekStart[weekStartValue]?.[absence.date];
      if (!day) {
        return;
      }
      day.absencesBySlot[slot][absence.doctor_id] = absence.reason;
    });

    setMonthData({ weeks: weeks ?? [], summariesByWeekStart });
    setLoadingData(false);
  }, [supabase, user, weekStarts]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (!user) {
      return;
    }
    void loadProfileAndDoctors();
  }, [loadProfileAndDoctors, user]);

  useEffect(() => {
    if (!user) {
      return;
    }
    if (viewMode === 'week') {
      void loadWeekData();
    } else {
      void loadMonthData();
    }
  }, [loadMonthData, loadWeekData, user, viewMode]);

  const handleChangeWeek = (offset: number) => {
    const base = parseDateLocal(weekStart);
    const next = addDays(base, offset * 7);
    router.replace(`/view?week_start=${formatDateLocal(next)}`);
  };

  const handleChangeMonth = (offset: number) => {
    const next = new Date(monthStart);
    next.setMonth(monthStart.getMonth() + offset);
    router.replace(`/view?month=${formatMonthParam(next)}`);
  };

  if (loadingSession) {
    return (
      <main className="view-page">
        <h1>Grafik — podgląd</h1>
        <p>Ładowanie sesji...</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="view-page">
        <h1>Grafik — podgląd</h1>
        <p>Brak aktywnej sesji.</p>
        <Link href="/login" className="view-login-link no-print">
          Zaloguj się
        </Link>
      </main>
    );
  }

  const renderDayCard = (dateString: string, dayData: DaySummary, dayIndex: number) => {
    const admissionsName = (slot: SlotId) =>
      dayData.admissionsBySlot[slot]
        ? doctorsById.get(dayData.admissionsBySlot[slot] ?? '') ?? 'Nieznany'
        : 'BRAK';

    const wardSame = areSameDoctorSets(dayData.wardBySlot.AM, dayData.wardBySlot.PM);
    const absencesSame = areSameAbsenceMaps(
      dayData.absencesBySlot.AM,
      dayData.absencesBySlot.PM,
    );

    const wardNamesAM = buildNameList(dayData.wardBySlot.AM, doctorsById);
    const wardNamesPM = buildNameList(dayData.wardBySlot.PM, doctorsById);

    const absencesAM = buildAbsenceEntries(dayData.absencesBySlot.AM, doctorsById);
    const absencesPM = buildAbsenceEntries(dayData.absencesBySlot.PM, doctorsById);

    return (
      <article key={dateString} className="view-day-card">
        <header className="view-day-header">
          <span className="view-day-name">{DAYS[dayIndex]}</span>
          <span className="view-day-date">
            {dateString.slice(8, 10)}.{dateString.slice(5, 7)}
          </span>
        </header>
        <div className="view-section view-section--admissions">
          <div className="view-section-title">Izba</div>
          <div className="view-admissions-row">
            <span className="view-slot-label">RANO</span>
            <span className="view-admissions-name">{admissionsName('AM')}</span>
          </div>
          <div className="view-admissions-row">
            <span className="view-slot-label">POPOŁUDNIE</span>
            <span className="view-admissions-name">{admissionsName('PM')}</span>
          </div>
        </div>
        <div className="view-section">
          <div className="view-section-title">Oddział</div>
          {wardSame ? (
            <p className="view-list-text">
              {wardNamesAM.length > 0 ? wardNamesAM.join(', ') : '—'}
            </p>
          ) : (
            <div className="view-variant">
              <span className="view-diff-badge">AM/PM różni się</span>
              <p className="view-list-text">
                <strong>RANO:</strong> {wardNamesAM.length > 0 ? wardNamesAM.join(', ') : '—'}
              </p>
              <p className="view-list-text">
                <strong>POPOŁUDNIE:</strong>{' '}
                {wardNamesPM.length > 0 ? wardNamesPM.join(', ') : '—'}
              </p>
            </div>
          )}
        </div>
        <div className="view-section">
          <div className="view-section-title">Nieobecności</div>
          {absencesSame ? (
            absencesAM.length > 0 ? (
              <ul className="view-list">
                {absencesAM.map((entry) => (
                  <li key={`${entry.name}-${entry.reason}`}>{`${entry.name} — ${entry.reason}`}</li>
                ))}
              </ul>
            ) : (
              <p className="view-list-text">—</p>
            )
          ) : (
            <div className="view-variant">
              <span className="view-diff-badge">AM/PM różni się</span>
              <div>
                <p className="view-list-text">
                  <strong>RANO:</strong>
                </p>
                {absencesAM.length > 0 ? (
                  <ul className="view-list">
                    {absencesAM.map((entry) => (
                      <li key={`am-${entry.name}-${entry.reason}`}>{
                        `${entry.name} — ${entry.reason}`
                      }</li>
                    ))}
                  </ul>
                ) : (
                  <p className="view-list-text">—</p>
                )}
              </div>
              <div>
                <p className="view-list-text">
                  <strong>POPOŁUDNIE:</strong>
                </p>
                {absencesPM.length > 0 ? (
                  <ul className="view-list">
                    {absencesPM.map((entry) => (
                      <li key={`pm-${entry.name}-${entry.reason}`}>{
                        `${entry.name} — ${entry.reason}`
                      }</li>
                    ))}
                  </ul>
                ) : (
                  <p className="view-list-text">—</p>
                )}
              </div>
            </div>
          )}
        </div>
      </article>
    );
  };

  const weekStatus = weekData?.week?.status ?? 'missing';
  const weekStatusLabel =
    weekStatus === 'approved' ? 'Zatwierdzony' : weekStatus === 'draft' ? 'Draft' : 'Brak tygodnia';

  return (
    <main className={`view-page ${viewMode === 'month' ? 'view-page--month' : 'view-page--week'}`}>
      <header className="view-header">
        <div>
          <h1>Grafik — podgląd</h1>
          <p className="view-subtitle">
            {viewMode === 'week'
              ? `Tydzień ${formatRangeLabel(weekStart)}`
              : `Miesiąc ${monthLabel}`}
          </p>
        </div>
        <div className="view-actions no-print">
          <button
            type="button"
            className="view-button no-print"
            onClick={() => window.print()}
          >
            Drukuj
          </button>
          {canEdit && viewMode === 'week' && (
            <Link href={`/schedule?week_start=${weekStart}`} className="view-link no-print">
              Edytuj tydzień
            </Link>
          )}
          {canEdit && viewMode === 'month' && (
            <Link href={`/month?month=${monthParam}`} className="view-link no-print">
              Edytuj miesiąc
            </Link>
          )}
        </div>
      </header>

      <section className="view-controls no-print">
        <div className="view-toggle no-print">
          <button
            type="button"
            className={`view-toggle-button no-print ${viewMode === 'week' ? 'is-active' : ''}`}
            onClick={() => router.replace(`/view?week_start=${weekStart}`)}
          >
            Tydzień
          </button>
          <button
            type="button"
            className={`view-toggle-button no-print ${viewMode === 'month' ? 'is-active' : ''}`}
            onClick={() => router.replace(`/view?month=${monthParam}`)}
          >
            Miesiąc
          </button>
        </div>
        {viewMode === 'week' ? (
          <div className="view-nav no-print">
            <button
              type="button"
              className="view-button no-print"
              onClick={() => handleChangeWeek(-1)}
            >
              ← Poprzedni tydzień
            </button>
            <div className="view-nav-label no-print">
              <span className="view-nav-title">Tydzień {weekStart}</span>
              <span className="view-nav-range">{formatRangeLabel(weekStart)}</span>
            </div>
            <button
              type="button"
              className="view-button no-print"
              onClick={() => handleChangeWeek(1)}
            >
              Następny tydzień →
            </button>
          </div>
        ) : (
          <div className="view-nav no-print">
            <button
              type="button"
              className="view-button no-print"
              onClick={() => handleChangeMonth(-1)}
            >
              ← Poprzedni miesiąc
            </button>
            <div className="view-nav-label no-print">
              <span className="view-nav-title">{monthLabel}</span>
              <span className="view-nav-range">
                Zakres: {formatDateLocal(rangeStart)} – {formatDateLocal(rangeEnd)}
              </span>
            </div>
            <button
              type="button"
              className="view-button no-print"
              onClick={() => handleChangeMonth(1)}
            >
              Następny miesiąc →
            </button>
          </div>
        )}
      </section>

      {error && <p className="view-error">{error}</p>}
      {loadingData && <p>Ładowanie danych grafiku...</p>}

      {viewMode === 'week' && (
        <section className="view-week">
          <header className="view-week-header">
            <div>
              <h2>Tydzień od {weekStart}</h2>
              <p className="view-week-range">{formatRangeLabel(weekStart)}</p>
            </div>
            <span
              className={`view-status-badge view-status-badge--${
                weekStatus === 'approved' ? 'approved' : weekStatus === 'draft' ? 'draft' : 'missing'
              }`}
            >
              {weekStatusLabel}
            </span>
          </header>

          {!loadingData && !weekData?.week && (
            <div className="view-empty">
              <p>Brak tygodnia dla wybranego terminu.</p>
              {canEdit ? (
                <Link href={`/schedule?week_start=${weekStart}`} className="view-link no-print">
                  Utwórz w /schedule
                </Link>
              ) : (
                <p className="view-muted">Skontaktuj się z planner/head.</p>
              )}
            </div>
          )}

          {weekData?.week && (
            <div className="view-week-days">
              {buildWeekDates(weekStart).map((date, index) => {
                const dateString = formatDateLocal(date);
                const dayData = weekData.summaries[dateString] ?? createEmptyDaySummary();
                return renderDayCard(dateString, dayData, index);
              })}
            </div>
          )}
        </section>
      )}

      {viewMode === 'month' && (
        <div className="view-month-grid">
          {weekStarts.map((start) => {
            const week = monthData?.weeks.find((item) => item.week_start === start);
            const weekStatusValue = week?.status ?? 'missing';
            const weekStatusText =
              weekStatusValue === 'approved'
                ? 'Zatwierdzony'
                : weekStatusValue === 'draft'
                  ? 'Draft'
                  : 'Brak tygodnia';
            return (
              <section key={start} className="view-week-block">
                <header className="view-week-header">
                  <div>
                    <h2>Tydzień od {start}</h2>
                    <p className="view-week-range">{formatRangeLabel(start)}</p>
                  </div>
                  <span
                    className={`view-status-badge view-status-badge--${
                      weekStatusValue === 'approved'
                        ? 'approved'
                        : weekStatusValue === 'draft'
                          ? 'draft'
                          : 'missing'
                    }`}
                  >
                    {weekStatusText}
                  </span>
                </header>
                <div className="view-week-days view-week-days--month">
                  {buildWeekDates(start).map((date, index) => {
                    const dateString = formatDateLocal(date);
                    const dayData =
                      monthData?.summariesByWeekStart[start]?.[dateString] ??
                      createEmptyDaySummary();
                    return renderDayCard(dateString, dayData, index);
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
