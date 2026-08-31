// src/utils/scheduleHelpers.js
import ClassSession from "../models/ClassSession.js";

export function toDisplayTime(hhmm) {
  if (!hhmm || typeof hhmm !== "string") return "";
  const parsed = parseTimeToMinutes(hhmm);
  if (parsed == null) return hhmm;

  let h = Math.floor(parsed / 60);
  const m = String(parsed % 60).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

export function parseTimeToMinutes(value) {
  if (!value || typeof value !== "string") return null;
  const raw = value.trim();

  const ampm = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (ampm) {
    let h = Number(ampm[1]);
    const m = Number(ampm[2]);
    const period = ampm[3].toUpperCase();
    if (period === "AM" && h === 12) h = 0;
    if (period === "PM" && h !== 12) h += 12;
    return h * 60 + m;
  }

  const hhmm = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (hhmm) return Number(hhmm[1]) * 60 + Number(hhmm[2]);
  return null;
}

export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  const as = parseTimeToMinutes(aStart);
  const ae = parseTimeToMinutes(aEnd ?? aStart);
  const bs = parseTimeToMinutes(bStart);
  const be = parseTimeToMinutes(bEnd ?? bStart);
  if ([as, ae, bs, be].some((n) => n == null)) return false;
  return as < be && bs < ae;
}

export function toDateKey(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function expandScheduleSlots({
  startDate,
  endDate,
  scheduleSlots = [],
}) {
  if (
    !startDate ||
    !Array.isArray(scheduleSlots) ||
    scheduleSlots.length === 0
  ) {
    return [];
  }

  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);

  const end = endDate ? new Date(endDate) : new Date(start);
  if (!endDate) end.setDate(end.getDate() + 12 * 7);
  end.setHours(23, 59, 59, 999);

  const out = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    const dow = cursor.getDay();

    for (const slot of scheduleSlots) {
      if (Number(slot.dayOfWeek) !== dow) continue;
      if (!slot.startTime || !slot.endTime) continue;

      const day = new Date(cursor);
      day.setHours(12, 0, 0, 0);

      out.push({
        date: day,
        dateKey: toDateKey(day),
        startTime: slot.startTime,
        endTime: slot.endTime,
        startTimeDisplay: toDisplayTime(slot.startTime),
        endTimeDisplay: toDisplayTime(slot.endTime),
        title: slot.label || "Live class",
      });
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return out;
}

export async function findInstructorConflict({
  instructorId,
  date,
  startTime,
  endTime,
  ignoreSessionId,
}) {
  if (!instructorId || !date || !startTime) return null;

  const day = toDateKey(date);
  if (!day) return null;

  const sessions = await ClassSession.find({
    instructorId,
    ...(ignoreSessionId ? { _id: { $ne: ignoreSessionId } } : {}),
  })
    .populate("cohortId", "name code")
    .lean();

  return (
    sessions.find((session) => {
      if (toDateKey(session.date) !== day) return false;
      return rangesOverlap(
        startTime,
        endTime || startTime,
        session.startTime,
        session.endTime || session.startTime,
      );
    }) || null
  );
}
