// src/utils/scheduleHelpers.js
/** "09:00" (from <input type="time">) → "9:00 AM" */
export function toDisplayTime(hhmm) {
  if (!hhmm || typeof hhmm !== "string") return "";
  const [hStr, mStr = "00"] = hhmm.split(":");
  let h = Number(hStr);
  if (Number.isNaN(h)) return hhmm;
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${mStr.padStart(2, "0")} ${ampm}`;
}

/**
 * Expand weekly slots into concrete class days.
 * dayOfWeek: 0 = Sunday … 6 = Saturday (same as Date#getDay()).
 * Returns objects matching your ClassSession fields: date, startTime, endTime, title
 */
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
  if (!endDate) {
    end.setDate(end.getDate() + 12 * 7); // default 12 weeks
  }
  end.setHours(23, 59, 59, 999);

  const out = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    const dow = cursor.getDay();

    for (const slot of scheduleSlots) {
      if (Number(slot.dayOfWeek) !== dow) continue;
      if (!slot.startTime || !slot.endTime) continue;

      const day = new Date(cursor);
      day.setHours(12, 0, 0, 0); // stable calendar day

      out.push({
        date: day,
        startTime: toDisplayTime(slot.startTime),
        endTime: toDisplayTime(slot.endTime),
        title: slot.label || "Live class",
      });
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return out;
}
