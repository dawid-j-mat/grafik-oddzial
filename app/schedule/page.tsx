"use client";

import { useState } from "react";

const DOCTORS = [
  "Dr Kowalski",
  "Dr Nowak",
  "Dr Wiśniewski",
  "Dr Wójcik",
  "Dr Lewandowski",
  "Dr Kamińska",
  "Dr Zielińska",
  "Dr Szymański",
  "Dr Woźniak",
  "Dr Dąbrowski",
];

const DAYS = ["Poniedziałek", "Wtorek", "Środa", "Czwartek", "Piątek"];
const SLOTS = [
  { id: "AM", label: "AM 08:00–12:00" },
  { id: "PM", label: "PM 12:00–15:35" },
];

const ABSENCE_REASONS = ["VACATION", "TRAINING", "POST_CALL", "OTHER"] as const;

type AbsenceReason = (typeof ABSENCE_REASONS)[number];

type SlotKey = `${(typeof DAYS)[number]}-${(typeof SLOTS)[number]["id"]}`;

type SlotAssignment = {
  admissions: string | null;
  ward: string[];
  absence: Record<string, AbsenceReason>;
};

const initialAssignments = DAYS.flatMap((day) =>
  SLOTS.map((slot) => ({
    key: `${day}-${slot.id}` as SlotKey,
    day,
    slot,
    data: {
      admissions: null,
      ward: [],
      absence: {},
    } as SlotAssignment,
  })),
);

export default function SchedulePage() {
  const [assignments, setAssignments] = useState(() =>
    initialAssignments.map((item) => ({ ...item, data: { ...item.data } })),
  );

  const updateAssignment = (slotKey: SlotKey, updater: (data: SlotAssignment) => SlotAssignment) => {
    setAssignments((prev) =>
      prev.map((item) =>
        item.key === slotKey ? { ...item, data: updater(item.data) } : item,
      ),
    );
  };

  const handleAdmissionsChange = (slotKey: SlotKey, doctor: string) => {
    updateAssignment(slotKey, (data) => {
      if (!doctor) {
        return { ...data, admissions: null };
      }
      const nextWard = data.ward.filter((name) => name !== doctor);
      const nextAbsence = { ...data.absence };
      delete nextAbsence[doctor];
      return { ...data, admissions: doctor, ward: nextWard, absence: nextAbsence };
    });
  };

  const toggleWard = (slotKey: SlotKey, doctor: string) => {
    updateAssignment(slotKey, (data) => {
      if (data.admissions === doctor || data.absence[doctor]) {
        return data;
      }
      const isSelected = data.ward.includes(doctor);
      const nextWard = isSelected
        ? data.ward.filter((name) => name !== doctor)
        : [...data.ward, doctor];
      return { ...data, ward: nextWard };
    });
  };

  const toggleAbsence = (slotKey: SlotKey, doctor: string) => {
    updateAssignment(slotKey, (data) => {
      if (data.admissions === doctor || data.ward.includes(doctor)) {
        return data;
      }
      const nextAbsence = { ...data.absence };
      if (nextAbsence[doctor]) {
        delete nextAbsence[doctor];
      } else {
        nextAbsence[doctor] = "VACATION";
      }
      return { ...data, absence: nextAbsence };
    });
  };

  const updateAbsenceReason = (slotKey: SlotKey, doctor: string, reason: AbsenceReason) => {
    updateAssignment(slotKey, (data) => ({
      ...data,
      absence: { ...data.absence, [doctor]: reason },
    }));
  };

  return (
    <main className="schedule-page">
      <h1>Grafik tygodniowy</h1>
      <p>Wybierz obsadę dla każdego slotu. OFF jest wyliczany automatycznie.</p>
      <section className="schedule-grid">
        {assignments.map((item) => {
          const offList = DOCTORS.filter(
            (doctor) =>
              doctor !== item.data.admissions &&
              !item.data.ward.includes(doctor) &&
              !item.data.absence[doctor],
          );

          return (
            <article key={item.key} className="schedule-card">
              <h3>
                {item.day} · {item.slot.label}
              </h3>
              <div className="schedule-section">
                <strong>ADMISSIONS (1 osoba)</strong>
                <select
                  value={item.data.admissions ?? ""}
                  onChange={(event) => handleAdmissionsChange(item.key, event.target.value)}
                >
                  <option value="">— wybierz —</option>
                  {DOCTORS.map((doctor) => (
                    <option key={`${item.key}-adm-${doctor}`} value={doctor}>
                      {doctor}
                    </option>
                  ))}
                </select>
              </div>
              <div className="schedule-section">
                <strong>WARD</strong>
                <div className="schedule-list">
                  {DOCTORS.map((doctor) => {
                    const checked = item.data.ward.includes(doctor);
                    const disabled = item.data.admissions === doctor || !!item.data.absence[doctor];
                    return (
                      <label key={`${item.key}-ward-${doctor}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleWard(item.key, doctor)}
                          disabled={disabled}
                        />
                        {doctor}
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="schedule-section">
                <strong>ABSENCE</strong>
                <div className="schedule-list">
                  {DOCTORS.map((doctor) => {
                    const checked = !!item.data.absence[doctor];
                    const disabled = item.data.admissions === doctor || item.data.ward.includes(doctor);
                    return (
                      <label key={`${item.key}-absence-${doctor}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleAbsence(item.key, doctor)}
                          disabled={disabled}
                        />
                        {doctor}
                        {checked && (
                          <select
                            value={item.data.absence[doctor]}
                            onChange={(event) =>
                              updateAbsenceReason(
                                item.key,
                                doctor,
                                event.target.value as AbsenceReason,
                              )
                            }
                          >
                            {ABSENCE_REASONS.map((reason) => (
                              <option key={`${item.key}-reason-${doctor}-${reason}`} value={reason}>
                                {reason}
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
                <strong>OFF (implicit)</strong>
                <div className="off-list">
                  {offList.map((doctor) => (
                    <span key={`${item.key}-off-${doctor}`} className="off-pill">
                      {doctor}
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
