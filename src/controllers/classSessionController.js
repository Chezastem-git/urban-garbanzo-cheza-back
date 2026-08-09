import User from "../models/User.js";
import Cohort from "../models/Cohort.js";
import ScheduleEvent from "../models/ScheduleEvent.js";  // or whatever the real path/name is
import Attendance from "../models/Attendance.js";       // note the spelling of your file

import ClassSession from "../models/ClassSession.js";
// Attendance is already imported in your controller

/**
 * GET /api/instructor/sessions
 * List class sessions for the instructor’s cohorts.
 */
export const getInstructorSessions = async (req, res) => {
  try {
    const instructor = await User.findById(req.userId);
    if (!instructor) {
      return res.status(404).json({ message: "User not found." });
    }

    const cohortFilter = instructor.cohortIds?.length
      ? { _id: { $in: instructor.cohortIds } }
      : instructor.cohortId
        ? { _id: instructor.cohortId }
        : {};

    const cohorts = await Cohort.find(cohortFilter).select(
      "_id name code courseTitle",
    );
    const cohortIds = cohorts.map((c) => c._id);
    const cohortMap = Object.fromEntries(
      cohorts.map((c) => [c._id.toString(), c]),
    );

    if (cohortIds.length === 0) {
      return res.status(200).json({ sessions: [] });
    }

    const sessions = await ClassSession.find({
      cohortId: { $in: cohortIds },
    }).sort({ date: -1 });

    // Pre-load students per cohort (for roster size / present count)
    const studentsByCohort = {};
    for (const cid of cohortIds) {
      studentsByCohort[cid.toString()] = await User.find({
        cohortId: cid,
        role: "student",
      }).select("_id fullName name avatar");
    }

    // Pre-load attendance records for these sessions
    const sessionIds = sessions.map((s) => s._id);
    const attendanceRecords = await Attendance.find({
      sessionId: { $in: sessionIds },
    });

    const attendanceMap = {}; // sessionId -> { studentId -> status }
    for (const rec of attendanceRecords) {
      const sid = rec.sessionId.toString();
      if (!attendanceMap[sid]) attendanceMap[sid] = {};
      attendanceMap[sid][rec.studentId.toString()] = rec.status;
    }

    const result = sessions.map((session) => {
      const cohort = cohortMap[session.cohortId.toString()];
      const students = studentsByCohort[session.cohortId.toString()] || [];
      const att = attendanceMap[session._id.toString()] || {};

      const studentList = students.map((s) => {
        const status = att[s._id.toString()];
        return {
          id: s._id.toString(),
          name: s.fullName || s.name || "Student",
          avatar: s.avatar || null,
          avatarInitials: (s.fullName || s.name || "S")
            .split(" ")
            .map((w) => w[0])
            .join("")
            .slice(0, 2)
            .toUpperCase(),
          isPresent: status === "present" || status === "late",
          status: status || "absent", // present | late | absent
        };
      });

      const presentCount = studentList.filter((s) => s.isPresent).length;

      // Format date / time for the UI
      const dateStr = session.date
        ? new Date(session.date).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : "—";
      const timeStr =
        session.startTime && session.endTime
          ? `${session.startTime} - ${session.endTime}`
          : session.startTime || "—";

      return {
        id: session._id.toString(),
        title: session.title,
        courseName:
          session.courseName ||
          cohort?.courseTitle ||
          cohort?.name ||
          "Software Development",
        date: dateStr,
        time: timeStr,
        rawDate: session.date,
        status: session.status, // scheduled | ongoing | completed
        attendanceMarked: session.attendanceMarked,
        presentCount,
        totalStudents: studentList.length,
        students: studentList,
      };
    });

    res.status(200).json({ sessions: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch sessions." });
  }
};

/**
 * POST /api/instructor/sessions/:sessionId/attendance
 * Body: {
 *   attendance: [{ studentId: string, isPresent: boolean }],
 *   completeSession?: boolean   // if true → mark session completed
 * }
 */
export const markSessionAttendance = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { attendance = [], completeSession = true } = req.body;

    const session = await ClassSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({ message: "Session not found." });
    }

    // Upsert attendance records
    for (const entry of attendance) {
      const status = entry.isPresent ? "present" : "absent";

      await Attendance.findOneAndUpdate(
        {
          sessionId: session._id,
          studentId: entry.studentId,
        },
        {
          sessionId: session._id,
          studentId: entry.studentId,
          cohortId: session.cohortId,
          status,
          markedBy: req.userId,
        },
        { upsert: true, new: true },
      );
    }

    session.attendanceMarked = true;
    if (completeSession) {
      session.status = "completed";
    }
    await session.save();

    res.status(200).json({
      message: "Attendance saved.",
      attendanceMarked: true,
      status: session.status,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to save attendance." });
  }
};

