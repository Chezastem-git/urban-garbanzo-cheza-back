// src/controllers/classSessionController.js
import User from "../models/User.js";
import Cohort from "../models/Cohort.js";
import ClassSession from "../models/ClassSession.js";
import Attendance from "../models/Attendance.js";
import ScheduleEvent from "../models/ScheduleEvent.js";
import RecordedSession from "../models/RecordedSession.js";

async function getInstructorCohortIds(instructorId) {
  const instructor = await User.findById(instructorId)
    .select("cohortId cohortIds")
    .lean();
  if (!instructor) return [];

  const idSet = new Set();
  if (Array.isArray(instructor.cohortIds)) {
    instructor.cohortIds.forEach((id) => {
      if (id) idSet.add(String(id));
    });
  }
  if (instructor.cohortId) idSet.add(String(instructor.cohortId));

  const byField = await Cohort.find({ instructorId }).select("_id").lean();
  byField.forEach((c) => idSet.add(String(c._id)));

  return Array.from(idSet);
}

function dayStart(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function formatDate(d) {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(start, end) {
  const label = (t) => {
    if (!t) return "";
    const raw = String(t).trim();
    if (/AM|PM/i.test(raw)) return raw;
    const m = raw.match(/^(\d{1,2}):(\d{2})/);
    if (!m) return raw;
    let h = Number(m[1]);
    const min = m[2];
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${min} ${ampm}`;
  };

  const a = label(start);
  const b = label(end);
  if (a && b) return `${a} - ${b}`;
  return a || "—";
}

function toDateKey(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function normalizeTime(value = "") {
  return String(value).trim().replace(/\s+/g, " ").toLowerCase();
}

function sessionDedupeKey(session) {
  const cohortId = String(session.cohortId?._id || session.cohortId || "");
  const dateKey = toDateKey(session.date);
  const start = normalizeTime(
    session.startTime || (session.time || "").split("-")[0] || "",
  );
  return `${cohortId}|${dateKey}|${start}`;
}

function scoreSession(session, attendanceCount = 0) {
  let score = 0;
  if (session.attendanceMarked) score += 8;
  if (session.status === "completed" || session.completedAt) score += 6;
  if (!session.generatedFromSchedule) score += 4;
  score += Math.min(attendanceCount, 5);
  return score;
}

function dedupeSessions(sessions, attendanceMap) {
  const best = new Map();

  for (const session of sessions) {
    const key = sessionDedupeKey(session);
    const current = best.get(key);
    const attendanceCount = Object.keys(
      attendanceMap[String(session._id)] || {},
    ).length;

    if (!current) {
      best.set(key, session);
      continue;
    }

    const currentCount = Object.keys(
      attendanceMap[String(current._id)] || {},
    ).length;

    if (
      scoreSession(session, attendanceCount) >
      scoreSession(current, currentCount)
    ) {
      best.set(key, session);
    }
  }

  return Array.from(best.values());
}

/**
 * completed | ongoing | unmarked | upcoming
 */
function displayStatusFor(session, attendanceMarked) {
  if (attendanceMarked || session.status === "completed") {
    return "completed";
  }

  const sessionDate = session.date ? new Date(session.date) : null;
  if (!sessionDate || Number.isNaN(sessionDate.getTime())) {
    return "scheduled";
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const d = new Date(sessionDate);
  d.setHours(12, 0, 0, 0);

  if (d >= todayStart && d <= todayEnd) return "ongoing";
  if (d < todayStart) return "unmarked";
  return "upcoming";
}

export const getInstructorSessions = async (req, res) => {
  try {
    const cohortIdStrs = await getInstructorCohortIds(req.userId);
    if (!cohortIdStrs.length) {
      return res.status(200).json({ sessions: [] });
    }

    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - 60);
    windowStart.setHours(0, 0, 0, 0);

    const windowEnd = new Date();
    windowEnd.setDate(windowEnd.getDate() + 14);
    windowEnd.setHours(23, 59, 59, 999);

    const cohorts = await Cohort.find({ _id: { $in: cohortIdStrs } })
      .select("name code courseTitle courseId")
      .populate("courseId", "title")
      .lean();

    const sessions = await ClassSession.find({
      cohortId: { $in: cohortIdStrs },
      date: { $gte: windowStart, $lte: windowEnd },
    })
      .sort({ date: -1 })
      .lean();

    const cohortMap = Object.fromEntries(
      cohorts.map((c) => [String(c._id), c]),
    );

    const allStudents = await User.find({
      role: "student",
      cohortId: { $in: cohortIdStrs },
    })
      .select("_id fullName name avatar cohortId")
      .lean();

    const studentsByCohort = {};
    for (const s of allStudents) {
      const key = String(s.cohortId || "");
      if (!key) continue;
      if (!studentsByCohort[key]) studentsByCohort[key] = [];
      studentsByCohort[key].push(s);
    }

    const sessionIds = sessions.map((s) => s._id);
    let attendanceRecords = [];
    if (sessionIds.length) {
      try {
        attendanceRecords = await Attendance.find({
          $or: [
            { sessionId: { $in: sessionIds } },
            { classSessionId: { $in: sessionIds } },
          ],
        })
          .select("sessionId classSessionId studentId status")
          .lean();
      } catch (e) {
        console.error("attendance lookup", e.message);
      }
    }

    const attendanceMap = {};
    for (const rec of attendanceRecords) {
      const sid = String(rec.sessionId || rec.classSessionId || "");
      if (!sid) continue;
      if (!attendanceMap[sid]) attendanceMap[sid] = {};
      attendanceMap[sid][String(rec.studentId)] = rec.status;
    }

    const seen = new Set();
    const result = [];

    for (const session of sessions) {
      const cid = String(session.cohortId || "");
      const dateKey =
        session.date instanceof Date
          ? session.date.toISOString().slice(0, 10)
          : String(session.date || "").slice(0, 10);
      const start = String(session.startTime || "")
        .trim()
        .toLowerCase();
      const dedupeKey = `${cid}|${dateKey}|${start}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const cohort = cohortMap[cid];
      const students = studentsByCohort[cid] || [];
      const att = attendanceMap[String(session._id)] || {};

      const studentList = students.map((s) => {
        const status = att[String(s._id)];
        const name = s.fullName || s.name || "Student";
        return {
          id: String(s._id),
          name,
          avatar: s.avatar || null,
          avatarInitials: name
            .split(" ")
            .map((w) => w[0])
            .join("")
            .slice(0, 2)
            .toUpperCase(),
          isPresent: status === "present" || status === "late",
          status: status || undefined,
        };
      });

      const attendanceMarked =
        Boolean(session.attendanceMarked) || Object.keys(att).length > 0;

      result.push({
        id: String(session._id),
        title: session.title || "Class session",
        courseName:
          session.courseName ||
          cohort?.courseTitle ||
          cohort?.courseId?.title ||
          cohort?.name ||
          "Course",
        cohortName: cohort?.name || "Cohort",
        cohortId: cid,
        date: formatDate(session.date),
        time: formatTime(session.startTime, session.endTime),
        rawDate: session.date,
        status: displayStatusFor(session, attendanceMarked),
        attendanceMarked,
        presentCount: studentList.filter((s) => s.isPresent).length,
        totalStudents: studentList.length,
        students: studentList,
      });
    }

    res.status(200).json({ sessions: result });
  } catch (err) {
    console.error("getInstructorSessions", err);
    res.status(500).json({
      message: "Failed to fetch sessions.",
      error: err.message,
    });
  }
};

export const markSessionAttendance = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const {
      attendance = [],
      completeSession = true,
      videoUrl,
      meetUrl,
      embedUrl,
      thumbnail,
      duration,
      topics,
      milestoneTitle,
    } = req.body || {};

    const session = await ClassSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({ message: "Session not found." });
    }

    const allowed = await getInstructorCohortIds(req.userId);
    if (!allowed.includes(String(session.cohortId))) {
      return res.status(403).json({ message: "Not your cohort." });
    }

    const d = session.date ? new Date(session.date) : new Date();
    const dateStr = Number.isNaN(d.getTime())
      ? new Date().toISOString().slice(0, 10)
      : d.toISOString().slice(0, 10);

    for (const entry of attendance) {
      if (!entry.studentId) continue;

      await Attendance.findOneAndUpdate(
        {
          sessionId: session._id,
          studentId: entry.studentId,
        },
        {
          sessionId: session._id,
          studentId: entry.studentId,
          cohortId: session.cohortId,
          date: dateStr,
          status: entry.isPresent ? "present" : "absent",
          markedBy: req.userId,
          markedAt: new Date(),
        },
        { upsert: true, returnDocument: "after" },
      );
    }

    session.attendanceMarked = true;
    if (completeSession) {
      session.status = "completed";
      session.completedAt = new Date();
    }
    await session.save();

    let recorded = null;
    if (completeSession && videoUrl?.trim()) {
      const instructor = await User.findById(req.userId)
        .select("fullName name avatar")
        .lean();

      recorded = await RecordedSession.create({
        title: session.title || "Class Recording",
        description: `Recording for ${session.title || "class"} on ${formatDate(session.date)}`,
        videoUrl: videoUrl.trim(),
        meetUrl: meetUrl?.trim() || videoUrl.trim(),
        embedUrl: embedUrl?.trim() || undefined,
        thumbnail: thumbnail?.trim() || undefined,
        duration: duration?.trim() || undefined,
        topics: Array.isArray(topics) ? topics.filter(Boolean) : [],
        milestoneTitle: milestoneTitle?.trim() || undefined,
        instructorName:
          instructor?.fullName || instructor?.name || "Instructor",
        instructorAvatar: instructor?.avatar || "/default.jpg",
        cohortId: session.cohortId,
        date: session.date || new Date(),
        uploadedBy: req.userId,
      });
    }

    res.status(200).json({
      message: completeSession
        ? "Attendance saved. Session completed."
        : "Attendance saved.",
      attendanceMarked: true,
      status: session.status,
      sessionId: session._id,
      recordedSessionId: recorded?._id || null,
    });
  } catch (err) {
    console.error("markSessionAttendance", err);
    res.status(500).json({ message: "Failed to save attendance." });
  }
};
