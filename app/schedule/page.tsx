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

const ABSENCE_REASONS = ['VACATION', 'TRAINING', 'POST_CALL', 'INTERNSHIP', 'OTHER'] as const;
const ABSENCE_REASON_LABELS: Record<(typeof ABSENCE_REASONS)[number], string> = {
  VACATION: 'Urlop',
  TRAINING: 'Szkolenie',
  POST_CALL: 'Zejście po dyżurze',
  INTERNSHIP: 'Staż',
  OTHER: 'Inne',
};
const SLOT_LABELS = {
  AM: 'RANO',
  PM: 'POPOŁUDNIE',
} as const;

type AbsenceReason = (typeof ABSENCE_REASONS)[number];
type SlotId = (typeof SLOTS)[number]['id'];
type SlotLabel = (typeof SLOT_LABELS)[SlotId];

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

type DayAssignment = {
  admissionsDoctorIds: Record<SlotId, string | null>;
  dayWardDoctorIds: string[];
  dayAbsencesByDoctorId: Record<string, AbsenceReason>;
  wardDoctorIdsBySlot: Record<SlotId, string[]>;
  absencesByDoctorIdBySlot: Record<SlotId, Record<string, AbsenceReason>>;
  isDetailed: boolean;
  hasSlotDifferences: boolean;
};

const formatDateLocal = (date: Date) => {
  // Avoid toISOString to keep dates in local time (no timezone shifts).
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

const getWeekStartString = (date: Date) => formatDateLocal(startOfWeekMonday(date));

const buildWeekDates = (weekStart: string) => {
  const monday = startOfWeekMonday(parseDateLocal(weekStart));
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

const createEmptyDay = (): DayAssignment => ({
  admissionsDoctorIds: { AM: null, PM: null },
  dayWardDoctorIds: [],
  dayAbsencesByDoctorId: {},
  wardDoctorIdsBySlot: { AM: [], PM: [] },
  absencesByDoctorIdBySlot: { AM: {}, PM: {} },
  isDetailed: false,
  hasSlotDifferences: false,
});

const buildEmptyAssignments = (weekStart: string) => {
  const empty: Record<string, DayAssignment> = {};
  const weekDates = buildWeekDates(weekStart);
  weekDates.forEach((date) => {
    const dateString = formatDateLocal(date);
    empty[dateString] = createEmptyDay();
  });
  return empty;
};

const normalizeAbsenceReason = (reason: string): AbsenceReason => {
  if (ABSENCE_REASONS.includes(reason as AbsenceReason)) {
    return reason as AbsenceReason;
  }
  return 'OTHER';
};

const areSameDoctorSets = (left: string[], right: string[]) => {
  if (left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every((doctorId) => rightSet.has(doctorId));
};

const areSameAbsenceMaps = (
  left: Record<string, AbsenceReason>,
  right: Record<string, AbsenceReason>,
) => {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  return leftEntries.every(([doctorId, reason]) => right[doctorId] === reason);
};

const collectAbsentDoctorIds = (data: DayAssignment, useSlotDetails: boolean) => {
  const ids = new Set<string>();
  if (useSlotDetails) {
    Object.keys(data.absencesByDoctorIdBySlot.AM).forEach((doctorId) => ids.add(doctorId));
    Object.keys(data.absencesByDoctorIdBySlot.PM).forEach((doctorId) => ids.add(doctorId));
  } else {
    Object.keys(data.dayAbsencesByDoctorId).forEach((doctorId) => ids.add(doctorId));
  }
  return ids;
};

const isDoctorAbsentAnySlot = (data: DayAssignment, useSlotDetails: boolean, doctorId: string) => {
  if (useSlotDetails) {
    return !!data.absencesByDoctorIdBySlot.AM[doctorId] || !!data.absencesByDoctorIdBySlot.PM[doctorId];
  }
  return !!data.dayAbsencesByDoctorId[doctorId];
};

const buildWardForSlot = (
  data: DayAssignment,
  useSlotDetails: boolean,
  slot: SlotId,
  absences: Set<string>,
) => {
  const baseWard = useSlotDetails ? data.wardDoctorIdsBySlot[slot] : data.dayWardDoctorIds;
  const oppositeSlot = slot === 'AM' ? 'PM' : 'AM';
  const impliedAdmission = data.admissionsDoctorIds[oppositeSlot];
  const excludedAdmission = data.admissionsDoctorIds[slot];
  const wardSet = new Set<string>(baseWard);
  if (impliedAdmission) {
    wardSet.add(impliedAdmission);
  }
  if (excludedAdmission) {
    wardSet.delete(excludedAdmission);
  }
  absences.forEach((doctorId) => wardSet.delete(doctorId));
  return Array.from(wardSet);
};

export default function SchedulePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => sharedClient, []);
  const initialWeekStart = useMemo(() => {
    const rawWeekStart = searchParams?.get('week_start');
    const parsed = rawWeekStart ? parseDateLocalSafe(rawWeekStart) : null;
    const baseDate = parsed ?? new Date();
    return getWeekStartString(baseDate);
  }, [searchParams]);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [weekStart, setWeekStart] = useState(() => initialWeekStart);
  const [week, setWeek] = useState<Week | null>(null);
  const [dayAssignments, setDayAssignments] = useState<Record<string, DayAssignment>>(() =>
    buildEmptyAssignments(initialWeekStart),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [copying, setCopying] = useState(false);
  const [approvalWarning, setApprovalWarning] = useState<string | null>(null);
  const [approvalSuccess, setApprovalSuccess] = useState<string | null>(null);
  const [missingAdmissions, setMissingAdmissions] = useState<string[]>([]);

  const canCreateWeek = profile?.role === 'planner' || profile?.role === 'head';
  const isReadOnly = week?.status === 'approved';
  const weekDates = useMemo(() => buildWeekDates(weekStart), [weekStart]);
  const doctorsById = useMemo(
    () => new Map(doctors.map((doctor) => [doctor.id, doctor.full_name])),
    [doctors],
  );

  const updateDayAssignment = useCallback(
    (dateKey: string, updater: (data: DayAssignment) => DayAssignment) => {
      if (isReadOnly || !week) {
        return;
      }
      setDirty(true);
      setSaveMessage(null);
      setApprovalWarning(null);
      setApprovalSuccess(null);
      setMissingAdmissions([]);
      setDayAssignments((prev) => ({
        ...prev,
        [dateKey]: updater(prev[dateKey] ?? createEmptyDay()),
      }));
    },
    [isReadOnly, week],
  );

  const handleAdmissionsChange = (dateKey: string, slot: SlotId, doctorId: string) => {
    updateDayAssignment(dateKey, (data) => {
      const useSlotDetails = data.isDetailed || data.hasSlotDifferences;
      const isAbsent = doctorId ? isDoctorAbsentAnySlot(data, useSlotDetails, doctorId) : false;
      if (doctorId && isAbsent) {
        return data;
      }
      return {
        ...data,
        admissionsDoctorIds: {
          ...data.admissionsDoctorIds,
          [slot]: doctorId || null,
        },
      };
    });
  };

  const confirmDayUnify = (data: DayAssignment) => {
    if (!data.hasSlotDifferences || data.isDetailed) {
      return true;
    }
    return window.confirm('Ujednolicisz AM i PM.');
  };

  const applyDayValuesToSlots = (data: DayAssignment) => ({
    ...data,
    wardDoctorIdsBySlot: {
      AM: [...data.dayWardDoctorIds],
      PM: [...data.dayWardDoctorIds],
    },
    absencesByDoctorIdBySlot: {
      AM: { ...data.dayAbsencesByDoctorId },
      PM: { ...data.dayAbsencesByDoctorId },
    },
    hasSlotDifferences: false,
  });

  const reconcileDayAbsences = (data: DayAssignment) => {
    const nextWard = data.dayWardDoctorIds.filter((doctorId) => !data.dayAbsencesByDoctorId[doctorId]);
    const nextAdmissions = { ...data.admissionsDoctorIds };
    (['AM', 'PM'] as SlotId[]).forEach((slot) => {
      const admissionsDoctorId = nextAdmissions[slot];
      if (admissionsDoctorId && data.dayAbsencesByDoctorId[admissionsDoctorId]) {
        nextAdmissions[slot] = null;
      }
    });
    return {
      ...data,
      dayWardDoctorIds: nextWard,
      admissionsDoctorIds: nextAdmissions,
    };
  };

  const toggleDayWard = (dateKey: string, doctorId: string) => {
    updateDayAssignment(dateKey, (data) => {
      const useSlotDetails = data.isDetailed || data.hasSlotDifferences;
      if (isDoctorAbsentAnySlot(data, useSlotDetails, doctorId)) {
        return data;
      }
      if (!confirmDayUnify(data)) {
        return data;
      }
      const isSelected = data.dayWardDoctorIds.includes(doctorId);
      const nextWard = isSelected
        ? data.dayWardDoctorIds.filter((id) => id !== doctorId)
        : [...data.dayWardDoctorIds, doctorId];
      const nextData = applyDayValuesToSlots({
        ...data,
        dayWardDoctorIds: nextWard,
      });
      return nextData;
    });
  };

  const toggleDayAbsence = (dateKey: string, doctorId: string) => {
    updateDayAssignment(dateKey, (data) => {
      if (!confirmDayUnify(data)) {
        return data;
      }
      const nextAbsence = { ...data.dayAbsencesByDoctorId };
      if (nextAbsence[doctorId]) {
        delete nextAbsence[doctorId];
      } else {
        nextAbsence[doctorId] = 'VACATION';
      }
      const nextData = reconcileDayAbsences({
        ...data,
        dayAbsencesByDoctorId: nextAbsence,
      });
      return applyDayValuesToSlots(nextData);
    });
  };

  const updateDayAbsenceReason = (dateKey: string, doctorId: string, reason: AbsenceReason) => {
    updateDayAssignment(dateKey, (data) => {
      if (!confirmDayUnify(data)) {
        return data;
      }
      const nextData = reconcileDayAbsences({
        ...data,
        dayAbsencesByDoctorId: { ...data.dayAbsencesByDoctorId, [doctorId]: reason },
      });
      return applyDayValuesToSlots(nextData);
    });
  };

  const updateDetailedDifferences = (data: DayAssignment) => {
    const wardSame = areSameDoctorSets(data.wardDoctorIdsBySlot.AM, data.wardDoctorIdsBySlot.PM);
    const absSame = areSameAbsenceMaps(
      data.absencesByDoctorIdBySlot.AM,
      data.absencesByDoctorIdBySlot.PM,
    );
    return { ...data, hasSlotDifferences: !(wardSame && absSame) };
  };

  const toggleWardBySlot = (dateKey: string, slot: SlotId, doctorId: string) => {
    updateDayAssignment(dateKey, (data) => {
      if (isDoctorAbsentAnySlot(data, true, doctorId)) {
        return data;
      }
      const wardList = data.wardDoctorIdsBySlot[slot];
      const isSelected = wardList.includes(doctorId);
      const nextWard = isSelected ? wardList.filter((id) => id !== doctorId) : [...wardList, doctorId];
      return updateDetailedDifferences({
        ...data,
        wardDoctorIdsBySlot: { ...data.wardDoctorIdsBySlot, [slot]: nextWard },
      });
    });
  };

  const toggleAbsenceBySlot = (dateKey: string, slot: SlotId, doctorId: string) => {
    updateDayAssignment(dateKey, (data) => {
      const nextAbsence = { ...data.absencesByDoctorIdBySlot[slot] };
      if (nextAbsence[doctorId]) {
        delete nextAbsence[doctorId];
      } else {
        nextAbsence[doctorId] = 'VACATION';
      }
      const isNowAbsent = !!nextAbsence[doctorId];
      const nextWard = isNowAbsent
        ? {
            AM: data.wardDoctorIdsBySlot.AM.filter((id) => id !== doctorId),
            PM: data.wardDoctorIdsBySlot.PM.filter((id) => id !== doctorId),
          }
        : data.wardDoctorIdsBySlot;
      const nextAdmissions = isNowAbsent
        ? {
            AM: doctorId === data.admissionsDoctorIds.AM ? null : data.admissionsDoctorIds.AM,
            PM: doctorId === data.admissionsDoctorIds.PM ? null : data.admissionsDoctorIds.PM,
          }
        : data.admissionsDoctorIds;
      return updateDetailedDifferences({
        ...data,
        admissionsDoctorIds: nextAdmissions,
        wardDoctorIdsBySlot: nextWard,
        absencesByDoctorIdBySlot: { ...data.absencesByDoctorIdBySlot, [slot]: nextAbsence },
      });
    });
  };

  const updateAbsenceReasonBySlot = (
    dateKey: string,
    slot: SlotId,
    doctorId: string,
    reason: AbsenceReason,
  ) => {
    updateDayAssignment(dateKey, (data) =>
      updateDetailedDifferences({
        ...data,
        absencesByDoctorIdBySlot: {
          ...data.absencesByDoctorIdBySlot,
          [slot]: { ...data.absencesByDoctorIdBySlot[slot], [doctorId]: reason },
        },
      }),
    );
  };

  const toggleDetailedMode = (dateKey: string) => {
    updateDayAssignment(dateKey, (data) => {
      if (!data.isDetailed) {
        return { ...data, isDetailed: true };
      }
      if (data.hasSlotDifferences && !window.confirm('Ujednolicisz AM i PM.')) {
        return data;
      }
      const dayWard = [...data.wardDoctorIdsBySlot.AM];
      const dayAbsences = { ...data.absencesByDoctorIdBySlot.AM };
      const nextData = reconcileDayAbsences({
        ...data,
        isDetailed: false,
        dayWardDoctorIds: dayWard,
        dayAbsencesByDoctorId: dayAbsences,
      });
      return applyDayValuesToSlots(nextData);
    });
  };

  const clearDay = (dateKey: string) => {
    updateDayAssignment(dateKey, () => createEmptyDay());
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
        setDayAssignments(buildEmptyAssignments(weekStart));
        setDirty(false);
        setSaveMessage(null);
        setApprovalWarning(null);
        setApprovalSuccess(null);
        setMissingAdmissions([]);
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
        const dayData = emptyAssignments[row.date];
        if (!dayData) {
          return;
        }
        const slot = row.slot as SlotId;
        if (row.status === 'ADMISSIONS') {
          dayData.admissionsDoctorIds[slot] = row.doctor_id;
          dayData.wardDoctorIdsBySlot[slot] = dayData.wardDoctorIdsBySlot[slot].filter(
            (id) => id !== row.doctor_id,
          );
          delete dayData.absencesByDoctorIdBySlot[slot][row.doctor_id];
        } else if (row.status === 'WARD') {
          if (!dayData.wardDoctorIdsBySlot[slot].includes(row.doctor_id)) {
            dayData.wardDoctorIdsBySlot[slot].push(row.doctor_id);
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
        const dayData = emptyAssignments[row.date];
        if (!dayData) {
          return;
        }
        const slot = row.slot as SlotId;
        dayData.absencesByDoctorIdBySlot[slot][row.doctor_id] = normalizeAbsenceReason(row.reason);
        dayData.wardDoctorIdsBySlot.AM = dayData.wardDoctorIdsBySlot.AM.filter(
          (id) => id !== row.doctor_id,
        );
        dayData.wardDoctorIdsBySlot.PM = dayData.wardDoctorIdsBySlot.PM.filter(
          (id) => id !== row.doctor_id,
        );
        if (dayData.admissionsDoctorIds.AM === row.doctor_id) {
          dayData.admissionsDoctorIds.AM = null;
        }
        if (dayData.admissionsDoctorIds.PM === row.doctor_id) {
          dayData.admissionsDoctorIds.PM = null;
        }
      });

      Object.values(emptyAssignments).forEach((dayData) => {
        const wardSame = areSameDoctorSets(dayData.wardDoctorIdsBySlot.AM, dayData.wardDoctorIdsBySlot.PM);
        const absSame = areSameAbsenceMaps(
          dayData.absencesByDoctorIdBySlot.AM,
          dayData.absencesByDoctorIdBySlot.PM,
        );
        dayData.hasSlotDifferences = !(wardSame && absSame);
        if (!dayData.hasSlotDifferences) {
          dayData.dayWardDoctorIds = [...dayData.wardDoctorIdsBySlot.AM];
          dayData.dayAbsencesByDoctorId = { ...dayData.absencesByDoctorIdBySlot.AM };
        } else {
          dayData.dayWardDoctorIds = [...dayData.wardDoctorIdsBySlot.AM];
          dayData.dayAbsencesByDoctorId = { ...dayData.absencesByDoctorIdBySlot.AM };
        }
      });

      setDayAssignments(emptyAssignments);
      setDirty(false);
      setSaveMessage(null);
      setApprovalWarning(null);
      setApprovalSuccess(null);
      setMissingAdmissions([]);
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
    setApprovalWarning(null);
    setApprovalSuccess(null);
    setMissingAdmissions([]);
    const currentUser = await loadSession();
    if (!currentUser) {
      setProfile(null);
      setDoctors([]);
      setWeek(null);
      setDayAssignments(buildEmptyAssignments(weekStart));
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
        setDayAssignments(buildEmptyAssignments(weekStart));
      }
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, [loadData, supabase, weekStart]);

  const updateUrlWeekStart = useCallback(
    (nextWeekStart: string) => {
      // Update the URL only in explicit user actions to avoid state<->URL loops.
      const params = new URLSearchParams(searchParams?.toString());
      params.set('week_start', nextWeekStart);
      router.replace(`/schedule?${params.toString()}`);
    },
    [router, searchParams],
  );

  useEffect(() => {
    const rawWeekStart = searchParams?.get('week_start');
    if (!rawWeekStart) {
      return;
    }
    const parsed = parseDateLocalSafe(rawWeekStart);
    if (!parsed) {
      return;
    }
    const normalized = getWeekStartString(parsed);
    setWeekStart((prev) => (prev === normalized ? prev : normalized));
  }, [searchParams]);

  const handleWeekChange = (value: string) => {
    if (!value) {
      return;
    }
    const normalized = getWeekStartString(parseDateLocal(value));
    setWeekStart(normalized);
    updateUrlWeekStart(normalized);
  };

  const handlePrevWeek = () => {
    const monday = parseDateLocal(weekStart);
    const nextWeekStart = formatDateLocal(addDays(monday, -7));
    setWeekStart(nextWeekStart);
    updateUrlWeekStart(nextWeekStart);
  };

  const handleNextWeek = () => {
    const monday = parseDateLocal(weekStart);
    const nextWeekStart = formatDateLocal(addDays(monday, 7));
    setWeekStart(nextWeekStart);
    updateUrlWeekStart(nextWeekStart);
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

  const handleSaveWeek = async () => {
    if (!supabase) {
      return;
    }
    const weekId = week?.id;
    if (!weekId) {
      setError('Brak identyfikatora tygodnia do zapisu.');
      return;
    }
    setError(null);
    setSaveMessage(null);
    setApprovalWarning(null);
    setApprovalSuccess(null);
    setSaving(true);

    const assignmentsPayload: AssignmentRow[] = [];
    const absencesPayload: Array<AbsenceRow & { note: null }> = [];

    Object.entries(dayAssignments).forEach(([date, data]) => {
      const useSlotDetails = data.isDetailed || data.hasSlotDifferences;
      const absenceIds = collectAbsentDoctorIds(data, useSlotDetails);
      const wardIdsBySlot = {
        AM: buildWardForSlot(data, useSlotDetails, 'AM', absenceIds),
        PM: buildWardForSlot(data, useSlotDetails, 'PM', absenceIds),
      };
      SLOTS.forEach((slot) => {
        const slotId = slot.id as SlotId;
        const admissionsDoctorId = data.admissionsDoctorIds[slotId];
        if (admissionsDoctorId && !absenceIds.has(admissionsDoctorId)) {
          assignmentsPayload.push({
            date,
            slot: slotId,
            doctor_id: admissionsDoctorId,
            status: 'ADMISSIONS',
          });
        }
        const absencesForSlot = useSlotDetails
          ? data.absencesByDoctorIdBySlot[slotId]
          : data.dayAbsencesByDoctorId;
        const wardForSlot = wardIdsBySlot[slotId];
        wardForSlot
          .filter((doctorId) => doctorId !== admissionsDoctorId && !absenceIds.has(doctorId))
          .forEach((doctorId) => {
            assignmentsPayload.push({
              date,
              slot: slotId,
              doctor_id: doctorId,
              status: 'WARD',
            });
          });
        Object.entries(absencesForSlot).forEach(([doctorId, reason]) => {
          absencesPayload.push({
            date,
            slot: slotId,
            doctor_id: doctorId,
            reason,
            note: null,
          });
        });
      });
    });

    const { error: saveError } = await supabase.rpc('save_week_schedule', {
      p_week_id: weekId,
      p_assignments: assignmentsPayload ?? [],
      p_absences: absencesPayload ?? [],
    });

    if (saveError) {
      setError(saveError.message);
      setSaving(false);
      return;
    }

    await loadAssignments(weekId);
    setSaveMessage('Zapisano');
    setSaving(false);
  };

  const refreshWeek = async (weekId: string) => {
    if (!supabase) {
      return null;
    }

    const { data: refreshedWeek, error: refreshError } = await supabase
      .from('weeks')
      .select('id, week_start, status, approved_at, approved_by')
      .eq('id', weekId)
      .maybeSingle();

    if (refreshError) {
      setError(refreshError.message);
    }

    setWeek(refreshedWeek ?? null);
    return refreshedWeek ?? null;
  };

  const collectMissingAdmissions = useCallback(() => {
    const missing: string[] = [];
    weekDates.forEach((date, dayIndex) => {
      const dateString = formatDateLocal(date);
      SLOTS.forEach((slot) => {
        const dayData = dayAssignments[dateString];
        if (!dayData?.admissionsDoctorIds[slot.id as SlotId]) {
          const slotLabel = SLOT_LABELS[slot.id as SlotId] as SlotLabel;
          missing.push(`${DAYS[dayIndex]} ${slotLabel}`);
        }
      });
    });
    return missing;
  }, [dayAssignments, weekDates]);

  const handleApproveWeek = async () => {
    if (!supabase || !week) {
      return;
    }

    if (week.status !== 'draft') {
      return;
    }

    setError(null);
    setApprovalWarning(null);
    setApprovalSuccess(null);

    const missing = collectMissingAdmissions();
    setMissingAdmissions(missing);

    if (dirty) {
      setApprovalWarning('Masz niezapisane zmiany — najpierw zapisz.');
      return;
    }

    if (missing.length > 0) {
      setApprovalWarning('Uzupełnij obsadę izby przyjęć przed zatwierdzeniem.');
      return;
    }

    setApproving(true);
    const { error: approveError } = await supabase.rpc('approve_week', {
      p_week_id: week.id,
    });

    if (approveError) {
      setError(approveError.message);
      setApproving(false);
      return;
    }

    await refreshWeek(week.id);
    await loadAssignments(week.id);
    setDirty(false);
    setApprovalSuccess('Tydzień zatwierdzony.');
    setApproving(false);
  };

  const handleRevertWeek = async () => {
    if (!supabase || !week) {
      return;
    }

    setError(null);
    setApprovalWarning(null);
    setApprovalSuccess(null);
    setReverting(true);
    const { error: revertError } = await supabase.rpc('revert_week', {
      p_week_id: week.id,
    });

    if (revertError) {
      setError(revertError.message);
      setReverting(false);
      return;
    }

    await refreshWeek(week.id);
    await loadAssignments(week.id);
    setApprovalSuccess('Cofnięto do draft.');
    setReverting(false);
  };

  const handleCopyWeek = async () => {
    if (!supabase || !week) {
      return;
    }

    if (!canCreateWeek) {
      setError('Brak uprawnień do kopiowania.');
      return;
    }

    if (week.status !== 'draft') {
      setError('Tydzień zatwierdzony — brak kopiowania.');
      return;
    }

    if (
      !window.confirm(
        'Skopiujesz oddział i nieobecności z poprzedniego tygodnia. Nadpiszesz dane dla bieżącego tygodnia.',
      )
    ) {
      return;
    }

    setError(null);
    setSaveMessage(null);
    setApprovalWarning(null);
    setApprovalSuccess(null);
    setCopying(true);

    const { data: copyResult, error: copyError } = await supabase.rpc('copy_week_ward_absences', {
      p_target_week_id: week.id,
    });

    if (copyError) {
      setError(copyError.message);
      setCopying(false);
      return;
    }

    if (!copyResult || copyResult.ok === false) {
      setError(copyResult?.error ?? 'Nie udało się skopiować danych.');
      setCopying(false);
      return;
    }

    await loadAssignments(week.id);
    setSaveMessage(
      `Skopiowano: oddział ${copyResult.inserted_ward ?? 0}, nieobecności ${copyResult.inserted_absences ?? 0}, pominięto ${copyResult.skipped_due_to_admissions ?? 0} (kolizja z izbą).`,
    );
    setCopying(false);
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
        {isReadOnly && <p style={{ color: '#475569' }}>Tydzień zatwierdzony — tylko podgląd.</p>}
        {!isReadOnly && <p style={{ color: '#475569' }}>Wprowadź zmiany i kliknij „Zapisz zmiany”.</p>}
        {loading && <p>Ładowanie tygodnia...</p>}
        {error && (
          <div style={{ color: 'crimson' }}>
            <strong>Błąd:</strong> {error}
          </div>
        )}
        {dirty && <p style={{ color: '#b45309' }}>Niezapisane zmiany</p>}
        {saveMessage && <p style={{ color: '#15803d' }}>{saveMessage}</p>}
      </section>

      {!loading && !week && (
        <section style={{ marginTop: '1.5rem', display: 'grid', gap: '0.75rem' }}>
          <p>Brak grafiku dla wybranego tygodnia.</p>
          <p style={{ color: '#64748b' }}>Najpierw utwórz tydzień.</p>
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
            <button type="button" onClick={handleRevertWeek} disabled={reverting}>
              {reverting ? 'Cofanie...' : 'Cofnij do draft'}
            </button>
          )}
          {week.status === 'draft' && profile?.can_approve && (
            <button type="button" onClick={handleApproveWeek} disabled={approving || dirty}>
              {approving ? 'Zatwierdzanie...' : 'Zatwierdź tydzień'}
            </button>
          )}
          {profile && !profile.can_approve && (
            <p style={{ color: '#64748b' }}>Brak uprawnień do zatwierdzania.</p>
          )}
          {dirty && week.status === 'draft' && profile?.can_approve && (
            <p style={{ color: '#b45309' }}>Masz niezapisane zmiany — najpierw zapisz.</p>
          )}
          {approvalWarning && <p style={{ color: '#b45309' }}>{approvalWarning}</p>}
          {approvalSuccess && <p style={{ color: '#15803d' }}>{approvalSuccess}</p>}
          {missingAdmissions.length > 0 && (
            <div style={{ color: '#b45309' }}>
              <strong>Braki w obsadzie izby przyjęć:</strong>
              <ul>
                {missingAdmissions.map((label) => (
                  <li key={`missing-${label}`}>{label}</li>
                ))}
              </ul>
            </div>
          )}
          {user && canCreateWeek && week.status === 'draft' && (
            <button type="button" onClick={handleSaveWeek} disabled={!dirty || saving}>
              {saving ? 'Zapisywanie...' : 'Zapisz zmiany'}
            </button>
          )}
          {user && canCreateWeek && week.status === 'draft' && (
            <button type="button" onClick={handleCopyWeek} disabled={copying}>
              {copying ? 'Kopiowanie...' : 'Skopiuj oddział i nieobecności z poprzedniego tygodnia'}
            </button>
          )}
        </section>
      )}

      <section className="schedule-grid">
        {weekDates.map((date, dayIndex) => {
          const dateString = formatDateLocal(date);
          const data = dayAssignments[dateString] ?? createEmptyDay();
          const activeDoctorIds = doctors.map((doctor) => doctor.id);
          const admissionsIds = Object.values(data.admissionsDoctorIds).filter(Boolean) as string[];
          const useSlotDetails = data.isDetailed || data.hasSlotDifferences;
          const absenceIds = collectAbsentDoctorIds(data, useSlotDetails);
          const wardIdsAM = buildWardForSlot(data, useSlotDetails, 'AM', absenceIds);
          const wardIdsPM = buildWardForSlot(data, useSlotDetails, 'PM', absenceIds);
          const usedIds = new Set([...admissionsIds, ...wardIdsAM, ...wardIdsPM, ...absenceIds]);
          const offDoctorIds = activeDoctorIds.filter((doctorId) => !usedIds.has(doctorId));
          const showDetailedToggle = data.hasSlotDifferences || data.isDetailed || admissionsIds.length > 0;

          return (
            <article key={dateString} className="schedule-card">
              <div className="schedule-card__header">
                <h3>{DAYS[dayIndex]}</h3>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  {data.hasSlotDifferences && !data.isDetailed && (
                    <span style={{ color: '#b45309' }}>Różni się AM/PM</span>
                  )}
                  {showDetailedToggle && (
                    <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={data.isDetailed}
                        onChange={() => toggleDetailedMode(dateString)}
                        disabled={isReadOnly || !week}
                      />
                      Tryb szczegółowy
                    </label>
                  )}
                  <button
                    type="button"
                    className="schedule-clear"
                    onClick={() => clearDay(dateString)}
                    disabled={isReadOnly || !week}
                  >
                    Wyczyść dzień
                  </button>
                </div>
              </div>

              <div className="schedule-section">
                <strong>Izba RANO (1 osoba)</strong>
                <select
                  value={data.admissionsDoctorIds.AM ?? ''}
                  onChange={(event) => handleAdmissionsChange(dateString, 'AM', event.target.value)}
                  disabled={isReadOnly || !week}
                >
                  <option value="">— wybierz —</option>
                  {doctors.map((doctor) => {
                    const isAbsent = isDoctorAbsentAnySlot(data, useSlotDetails, doctor.id);
                    return (
                      <option key={`${dateString}-adm-am-${doctor.id}`} value={doctor.id} disabled={isAbsent}>
                        {doctor.full_name}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="schedule-section">
                <strong>Izba POPOŁUDNIE (1 osoba)</strong>
                <select
                  value={data.admissionsDoctorIds.PM ?? ''}
                  onChange={(event) => handleAdmissionsChange(dateString, 'PM', event.target.value)}
                  disabled={isReadOnly || !week}
                >
                  <option value="">— wybierz —</option>
                  {doctors.map((doctor) => {
                    const isAbsent = isDoctorAbsentAnySlot(data, useSlotDetails, doctor.id);
                    return (
                      <option key={`${dateString}-adm-pm-${doctor.id}`} value={doctor.id} disabled={isAbsent}>
                        {doctor.full_name}
                      </option>
                    );
                  })}
                </select>
              </div>

              {!data.isDetailed && (
                <div className="schedule-section">
                  <strong>Oddział (cały dzień)</strong>
                  {data.hasSlotDifferences && (
                    <p style={{ color: '#b45309' }}>Edycja ujednolici AM i PM.</p>
                  )}
                  <div className="schedule-list">
                    {doctors.map((doctor) => {
                      const checked = data.dayWardDoctorIds.includes(doctor.id);
                      const disabled =
                        isReadOnly || !week || isDoctorAbsentAnySlot(data, useSlotDetails, doctor.id);
                      return (
                        <label key={`${dateString}-ward-day-${doctor.id}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleDayWard(dateString, doctor.id)}
                            disabled={disabled}
                          />
                          {doctor.full_name}
                        </label>
                      );
                    })}
                  </div>
                  <p style={{ color: '#64748b' }}>
                    Lekarz w Izbie nie może być w Oddziale w tym samym slocie.
                  </p>
                </div>
              )}

              {data.isDetailed && (
                <div className="schedule-section">
                  <strong>Oddział RANO</strong>
                  <div className="schedule-list">
                    {doctors.map((doctor) => {
                      const checked = wardIdsAM.includes(doctor.id);
                      const disabled =
                        isReadOnly || !week || isDoctorAbsentAnySlot(data, useSlotDetails, doctor.id);
                      return (
                        <label key={`${dateString}-ward-am-${doctor.id}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleWardBySlot(dateString, 'AM', doctor.id)}
                            disabled={disabled}
                          />
                          {doctor.full_name}
                        </label>
                      );
                    })}
                  </div>
                  <strong>Oddział POPOŁUDNIE</strong>
                  <div className="schedule-list">
                    {doctors.map((doctor) => {
                      const checked = wardIdsPM.includes(doctor.id);
                      const disabled =
                        isReadOnly || !week || isDoctorAbsentAnySlot(data, useSlotDetails, doctor.id);
                      return (
                        <label key={`${dateString}-ward-pm-${doctor.id}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleWardBySlot(dateString, 'PM', doctor.id)}
                            disabled={disabled}
                          />
                          {doctor.full_name}
                        </label>
                      );
                    })}
                  </div>
                  <p style={{ color: '#64748b' }}>
                    Lekarz w Izbie nie może być w Oddziale w tym samym slocie.
                  </p>
                </div>
              )}

              {!data.isDetailed && (
                <div className="schedule-section">
                  <strong>Nieobecności (cały dzień)</strong>
                  {data.hasSlotDifferences && (
                    <p style={{ color: '#b45309' }}>Edycja ujednolici AM i PM.</p>
                  )}
                  <div className="schedule-list">
                    {doctors.map((doctor) => {
                      const checked = !!data.dayAbsencesByDoctorId[doctor.id];
                      const disabled = isReadOnly || !week;
                      return (
                        <label key={`${dateString}-absence-day-${doctor.id}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleDayAbsence(dateString, doctor.id)}
                            disabled={disabled}
                          />
                          {doctor.full_name}
                          {checked && (
                            <select
                              value={data.dayAbsencesByDoctorId[doctor.id]}
                              onChange={(event) =>
                                updateDayAbsenceReason(
                                  dateString,
                                  doctor.id,
                                  event.target.value as AbsenceReason,
                                )
                              }
                              disabled={isReadOnly || !week}
                            >
                              {ABSENCE_REASONS.map((reason) => (
                                <option key={`${dateString}-reason-day-${doctor.id}-${reason}`} value={reason}>
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
              )}

              {data.isDetailed && (
                <div className="schedule-section">
                  <strong>Nieobecności RANO</strong>
                  <div className="schedule-list">
                    {doctors.map((doctor) => {
                      const checked = !!data.absencesByDoctorIdBySlot.AM[doctor.id];
                      const disabled = isReadOnly || !week;
                      return (
                        <label key={`${dateString}-absence-am-${doctor.id}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleAbsenceBySlot(dateString, 'AM', doctor.id)}
                            disabled={disabled}
                          />
                          {doctor.full_name}
                          {checked && (
                            <select
                              value={data.absencesByDoctorIdBySlot.AM[doctor.id]}
                              onChange={(event) =>
                                updateAbsenceReasonBySlot(
                                  dateString,
                                  'AM',
                                  doctor.id,
                                  event.target.value as AbsenceReason,
                                )
                              }
                              disabled={isReadOnly || !week}
                            >
                              {ABSENCE_REASONS.map((reason) => (
                                <option key={`${dateString}-reason-am-${doctor.id}-${reason}`} value={reason}>
                                  {ABSENCE_REASON_LABELS[reason]}
                                </option>
                              ))}
                            </select>
                          )}
                        </label>
                      );
                    })}
                  </div>
                  <strong>Nieobecności POPOŁUDNIE</strong>
                  <div className="schedule-list">
                    {doctors.map((doctor) => {
                      const checked = !!data.absencesByDoctorIdBySlot.PM[doctor.id];
                      const disabled = isReadOnly || !week;
                      return (
                        <label key={`${dateString}-absence-pm-${doctor.id}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleAbsenceBySlot(dateString, 'PM', doctor.id)}
                            disabled={disabled}
                          />
                          {doctor.full_name}
                          {checked && (
                            <select
                              value={data.absencesByDoctorIdBySlot.PM[doctor.id]}
                              onChange={(event) =>
                                updateAbsenceReasonBySlot(
                                  dateString,
                                  'PM',
                                  doctor.id,
                                  event.target.value as AbsenceReason,
                                )
                              }
                              disabled={isReadOnly || !week}
                            >
                              {ABSENCE_REASONS.map((reason) => (
                                <option key={`${dateString}-reason-pm-${doctor.id}-${reason}`} value={reason}>
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
              )}

              <div className="schedule-section">
                <strong>Wolne (automatycznie)</strong>
                <div className="off-list">
                  {offDoctorIds.length === 0 && <span>Brak</span>}
                  {offDoctorIds.map((doctorId) => (
                    <span key={`${dateString}-off-${doctorId}`} className="off-pill">
                      {doctorsById.get(doctorId) ?? 'Nieznany lekarz'}
                    </span>
                  ))}
                </div>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
