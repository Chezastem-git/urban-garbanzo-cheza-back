// src/controllers/classSessionController.js
import User from "../models/User.js";
import Cohort from "../models/Cohort.js";
import ClassSession from "../models/ClassSession.js";
import Attendance from "../models/Attendance.js";
import ScheduleEvent from "../models/ScheduleEvent.js";
import RecordedSession from "../models/RecordedSession.js"

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
  if (start && end) return `${start} - ${end}`;
  return start || "—";
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

  // Normalize session date to local day bounds for comparison
  const d = new Date(sessionDate);
  d.setHours(12, 0, 0, 0); // midday avoids TZ edge cases

  if (d >= todayStart && d <= todayEnd) return "ongoing";
  if (d < todayStart) return "unmarked";
  return "upcoming";
}

/**
 * GET /api/instructor/sessions
 */
export const getInstructorSessions = async (req, res) => {
  try {
    const cohortIdStrs = await getInstructorCohortIds(req.userId);
    if (cohortIdStrs.length === 0) {
      return res.status(200).json({ sessions: [] });
    }

    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - 60);
    windowStart.setHours(0, 0, 0, 0);

    const windowEnd = new Date();
    windowEnd.setDate(windowEnd.getDate() + 14);
    windowEnd.setHours(23, 59, 59, 999);

    const cohorts = await Cohort.find({ _id: { $in: cohortIdStrs } })
      .select("name code courseTitle courseId startDate endDate scheduleSlots")
      .populate("courseId", "title")
      .lean();

    const bulkOps = [];

    for (const c of cohorts) {
      if (!c.scheduleSlots?.length) continue;

      try {
        const { expandScheduleSlots } =
          await import("../utils/scheduleHelpers.js");
        const expanded = expandScheduleSlots({
          startDate: c.startDate,
          endDate: c.endDate,
          scheduleSlots: c.scheduleSlots,
        });

        for (const slot of expanded || []) {
          const date = dayStart(slot.date);
          if (!date) continue;
          if (date < windowStart || date > windowEnd) continue;

          const startTime =
            slot.startTime ||
            (typeof slot.time === "string"
              ? slot.time.split("-")[0]?.trim()
              : "") ||
            "";
          const endTime =
            slot.endTime ||
            (typeof slot.time === "string"
              ? slot.time.split("-")[1]?.trim()
              : "") ||
            "";

          bulkOps.push({
            updateOne: {
              filter: { cohortId: c._id, date, startTime },
              update: {
                $setOnInsert: {
                  title: slot.title || "Class",
                  cohortId: c._id,
                  courseName:
                    c.courseTitle || c.courseId?.title || c.name || "Course",
                  courseId: c.courseId?._id || c.courseId || undefined,
                  date,
                  startTime,
                  endTime,
                  status: "scheduled",
                  attendanceMarked: false,
                  instructorId: req.userId,
                  generatedFromSchedule: true,
                },
              },
              upsert: true,
            },
          });
        }
      } catch (e) {
        console.error("[sessions] expand failed", c.name, e.message || e);
      }
    }

    try {
      const legacy = await ScheduleEvent.find({
        cohortId: { $in: cohortIdStrs },
        date: { $gte: windowStart, $lte: windowEnd },
      }).lean();

      for (const ev of legacy) {
        const date = dayStart(ev.date);
        if (!date) continue;
        const startTime =
          ev.startTime || (ev.time || "").split("-")[0]?.trim() || "";
        const endTime =
          ev.endTime || (ev.time || "").split("-")[1]?.trim() || "";

        bulkOps.push({
          updateOne: {
            filter: { cohortId: ev.cohortId, date, startTime },
            update: {
              $setOnInsert: {
                title: ev.title || "Class",
                cohortId: ev.cohortId,
                date,
                startTime,
                endTime,
                status: "scheduled",
                attendanceMarked: false,
                instructorId: req.userId,
                generatedFromSchedule: true,
              },
            },
            upsert: true,
          },
        });
      }
    } catch {
      /* optional */
    }

    if (bulkOps.length > 0) {
      await ClassSession.bulkWrite(bulkOps, { ordered: false });
    }

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
      deletedAt: null,
    })
      .select("_id fullName name avatar cohortId")
      .lean();

    const studentsByCohort = {};
    for (const s of allStudents) {
      const key = String(s.cohortId);
      if (!studentsByCohort[key]) studentsByCohort[key] = [];
      studentsByCohort[key].push(s);
    }

    const sessionIds = sessions.map((s) => s._id);
    const attendanceRecords =
      sessionIds.length === 0
        ? []
        : await Attendance.find({ sessionId: { $in: sessionIds } })
            .select("sessionId studentId status")
            .lean();

    const attendanceMap = {};
    for (const rec of attendanceRecords) {
      const sid = String(rec.sessionId);
      if (!attendanceMap[sid]) attendanceMap[sid] = {};
      attendanceMap[sid][String(rec.studentId)] = rec.status;
    }

    // ── HERE: displayStatus + cohortName ───────────────────────────────
    const result = sessions.map((session) => {
      const cid = String(session.cohortId);
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

      const presentCount = studentList.filter((s) => s.isPresent).length;
      const attendanceMarked =
        Boolean(session.attendanceMarked) || Object.keys(att).length > 0;

      return {
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
        presentCount,
        totalStudents: studentList.length,
        students: studentList,
      };
    });

    res.status(200).json({ sessions: result });
  } catch (err) {
    console.error("getInstructorSessions", err);
    res.status(500).json({ message: "Failed to fetch sessions." });
  }
};

/**
 * POST /api/instructor/sessions/:sessionId/attendance
 */
/**
 * POST /api/instructor/sessions/:sessionId/attendance
 */
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

    // Match schema: date is a string "YYYY-MM-DD"
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

    // Create RecordedSession only when a URL is provided
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
