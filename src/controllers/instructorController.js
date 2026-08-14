// src/controllers/InstructorController.js
import User from "../models/User.js";
import Cohort from "../models/Cohort.js";
import Milestone from "../models/Milestone.js";
import Solo from "../models/Solo.js";
import Assessment from "../models/Assessment.js";
import Attendance from "../models/Attendance.js";
import { BadgeDefinition, StudentBadge } from "../models/Badge.js";
import Notification from "../models/Notification.js";
import StudentProgress from "../models/StudentProgress.js";
import Segment from "../models/Segment.js";
import ClassSession from "../models/ClassSession.js";
import ScheduleEvent from "../models/ScheduleEvent.js";
import Challenge from "../models/Challenge.js";

/** Resolve cohort by code or ObjectId */
async function findCohortBySlug(slug) {
  if (!slug) return null;
  let cohort = await Cohort.findOne({ code: slug.toLowerCase() });
  if (!cohort) {
    cohort = await Cohort.findOne({
      name: new RegExp(`^${slug.replace(/-/g, " ")}$`, "i"),
    });
  }
  if (!cohort && slug.match(/^[a-f\d]{24}$/i)) {
    cohort = await Cohort.findById(slug);
  }
  return cohort;
}

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
  if (instructor.cohortId) {
    idSet.add(String(instructor.cohortId));
  }

  const byInstructorField = await Cohort.find({ instructorId })
    .select("_id")
    .lean();
  byInstructorField.forEach((c) => idSet.add(String(c._id)));

  return Array.from(idSet);
}

function formatDate(d) {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return String(d).slice(0, 10);
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatTime(start, end) {
  if (start && end) return `${start} - ${end}`;
  return start || end || "";
}

function deriveStatus(session, attendanceMarked) {
  if (
    session.status === "completed" ||
    session.completedAt ||
    attendanceMarked
  ) {
    return "completed";
  }
  if (session.status === "ongoing") return "ongoing";

  const day = session.date ? new Date(session.date) : null;
  if (day && !Number.isNaN(day.getTime())) {
    const start = new Date(day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(day);
    end.setHours(23, 59, 59, 999);
    const now = Date.now();
    if (now >= start.getTime() && now <= end.getTime()) return "ongoing";
  }
  return session.status || "scheduled";
}

export const getInstructorSessions = async (req, res) => {
  try {
    if (req.role && req.role !== "instructor") {
      return res.status(403).json({ message: "Instructor access only." });
    }

    // SAME path as dashboard
    const cohorts = await loadInstructorCohorts(req.userId);
    if (!cohorts.length) {
      return res.status(200).json({ sessions: [] });
    }

    const cohortOids = cohorts.map((c) => c._id);
    const cohortIdStrs = cohortOids.map((id) => String(id));

    console.log(
      "[sessions] cohorts",
      cohorts.map((c) => ({
        id: String(c._id),
        name: c.name,
        slots: c.scheduleSlots?.length ?? 0,
        start: c.startDate,
        end: c.endDate,
      })),
    );

    // ── Build ClassSession rows from scheduleSlots (all dates in range) ──
    for (const c of cohorts) {
      const lean = c.toObject ? c.toObject() : c;
      if (!lean.scheduleSlots?.length) continue;

      try {
        const { expandScheduleSlots } =
          await import("../utils/scheduleHelpers.js");
        const expanded = expandScheduleSlots({
          startDate: lean.startDate,
          endDate: lean.endDate,
          scheduleSlots: lean.scheduleSlots,
        });

        console.log(
          "[sessions] expanded",
          lean.name,
          "→",
          expanded?.length ?? 0,
        );

        for (const slot of expanded || []) {
          const raw = slot.date;
          const slotDate = raw instanceof Date ? raw : new Date(raw);
          if (Number.isNaN(slotDate.getTime())) continue;

          const dayStart = new Date(
            Date.UTC(
              slotDate.getFullYear(),
              slotDate.getMonth(),
              slotDate.getDate(),
              0,
              0,
              0,
              0,
            ),
          );

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

          await ClassSession.findOneAndUpdate(
            {
              cohortId: lean._id,
              date: dayStart,
              startTime,
            },
            {
              $setOnInsert: {
                cohortId: lean._id,
                title: slot.title || "Class",
                date: dayStart,
                startTime,
                endTime,
                location: slot.location || "",
                status: "scheduled",
                attendanceMarked: false,
              },
            },
            { upsert: true, new: true },
          );
        }
      } catch (e) {
        console.error("[sessions] expand/upsert", lean.name, e);
      }
    }

    // ── Optional: ScheduleEvent → ClassSession ──
    try {
      const legacy = await ScheduleEvent.find({
        cohortId: { $in: cohortOids },
      }).lean();

      for (const ev of legacy) {
        const slotDate = new Date(ev.date);
        if (Number.isNaN(slotDate.getTime())) continue;
        const dayStart = new Date(
          Date.UTC(
            slotDate.getFullYear(),
            slotDate.getMonth(),
            slotDate.getDate(),
            0,
            0,
            0,
            0,
          ),
        );
        const startTime =
          ev.startTime || (ev.time || "").split("-")[0]?.trim() || "";
        const endTime =
          ev.endTime || (ev.time || "").split("-")[1]?.trim() || "";

        await ClassSession.findOneAndUpdate(
          { cohortId: ev.cohortId, date: dayStart, startTime },
          {
            $setOnInsert: {
              cohortId: ev.cohortId,
              title: ev.title || "Class",
              date: dayStart,
              startTime,
              endTime,
              location: ev.location || "",
              status: "scheduled",
              attendanceMarked: false,
            },
          },
          { upsert: true, new: true },
        );
      }
    } catch {
      /* optional */
    }

    // ── Load EVERY ClassSession for these 2 cohorts (past + future) ──
    const sessions = await ClassSession.find({
      cohortId: { $in: cohortOids },
    })
      .populate({
        path: "cohortId",
        select: "name code courseId courseTitle",
        populate: { path: "courseId", select: "title" },
      })
      .sort({ date: -1 })
      .lean();

    console.log("[sessions] ClassSession count", sessions.length);

    const students = await User.find({
      role: "student",
      cohortId: { $in: cohortOids },
      deletedAt: null,
    })
      .select("fullName name avatar cohortId")
      .lean();

    const byCohort = new Map();
    for (const st of students) {
      const key = String(st.cohortId);
      if (!byCohort.has(key)) byCohort.set(key, []);
      byCohort.get(key).push(st);
    }

    const sessionIds = sessions.map((s) => s._id);
    const attendanceRows =
      sessionIds.length === 0
        ? []
        : await Attendance.find({ sessionId: { $in: sessionIds } }).lean();

    const attBySession = new Map();
    for (const row of attendanceRows) {
      const sid = String(row.sessionId);
      if (!attBySession.has(sid)) attBySession.set(sid, new Map());
      attBySession.get(sid).set(String(row.studentId), row.status);
    }

    const payload = sessions.map((session) => {
      const cohortDoc = session.cohortId;
      const cohortIdStr = String(cohortDoc?._id || session.cohortId);
      const roster = byCohort.get(cohortIdStr) || [];
      const marks = attBySession.get(String(session._id)) || new Map();

      const studentList = roster.map((st) => {
        const status = marks.get(String(st._id));
        const isPresent = status === "present" || status === "late";
        const name = st.fullName || st.name || "Student";
        const initials = name
          .split(/\s+/)
          .map((p) => p[0])
          .join("")
          .slice(0, 2)
          .toUpperCase();
        return {
          id: String(st._id),
          name,
          avatar: st.avatar || null,
          avatarInitials: initials || "ST",
          isPresent,
          status: status || undefined,
        };
      });

      const presentCount = studentList.filter((s) => s.isPresent).length;
      const attendanceMarked =
        marks.size > 0 || Boolean(session.attendanceMarked);

      return {
        id: String(session._id),
        title: session.title || "Class session",
        courseName:
          cohortDoc?.courseId?.title ||
          cohortDoc?.courseTitle ||
          cohortDoc?.name ||
          "Course",
        date: formatDate(session.date),
        time: formatTime(session.startTime, session.endTime),
        status: deriveStatus(session, attendanceMarked),
        students: studentList,
        attendanceMarked,
        presentCount,
        totalStudents: studentList.length,
        cohortId: cohortIdStr,
      };
    });

    res.status(200).json({ sessions: payload });
  } catch (err) {
    console.error("getInstructorSessions", err);
    res.status(500).json({ message: "Failed to load sessions." });
  }
};

export const markSessionAttendance = async (req, res) => {
  try {
    if (req.role && req.role !== "instructor") {
      return res.status(403).json({ message: "Instructor access only." });
    }

    const { sessionId } = req.params;
    const { attendance, completeSession } = req.body || {};

    if (!Array.isArray(attendance)) {
      return res.status(400).json({ message: "attendance array is required." });
    }

    const cohortIds = await getInstructorCohortIds(req.userId);
    const session = await ClassSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({ message: "Session not found." });
    }

    if (!cohortIds.includes(String(session.cohortId))) {
      return res.status(403).json({ message: "Not your cohort." });
    }

    const allowedStudents = await User.find({
      role: "student",
      cohortId: session.cohortId,
      deletedAt: null,
    })
      .select("_id")
      .lean();
    const allowedSet = new Set(allowedStudents.map((u) => String(u._id)));

    for (const row of attendance) {
      const studentId = String(row.studentId || "");
      if (!allowedSet.has(studentId)) continue;

      const status = row.isPresent ? "present" : "absent";

      await Attendance.findOneAndUpdate(
        { sessionId: session._id, studentId },
        {
          sessionId: session._id,
          studentId,
          cohortId: session.cohortId,
          status,
          markedBy: req.userId,
          markedAt: new Date(),
        },
        { upsert: true, new: true },
      );
    }

    session.attendanceMarked = true;
    if (completeSession) {
      session.status = "completed";
      session.completedAt = new Date();
    }
    await session.save();

    res.status(200).json({
      message: completeSession
        ? "Attendance saved. Session completed."
        : "Attendance saved.",
      sessionId: session._id,
      status: session.status,
    });
  } catch (err) {
    console.error("markSessionAttendance", err);
    res.status(500).json({ message: "Failed to save attendance." });
  }
};

/** Convenience: load the actual Cohort docs for an instructor */
async function loadInstructorCohorts(instructorId) {
  const cohortIds = await getInstructorCohortIds(instructorId);
  if (cohortIds.length === 0) return [];
  return Cohort.find({ _id: { $in: cohortIds } })
    .select(
      "name code icon startDate endDate scheduleSlots courseId courseTitle courseCategory instructorId",
    )
    .populate("courseId", "title icon")
    .sort({ startDate: -1 });
}

export const getInstructorCohorts = async (req, res) => {
  try {
    const instructor = await User.findById(req.userId);
    if (!instructor) {
      return res.status(404).json({ message: "User not found." });
    }

    const cohorts = await loadInstructorCohorts(req.userId);

    const result = await Promise.all(
      cohorts.map(async (c) => {
        const students = await User.find({
          cohortId: c._id,
          role: "student",
          deletedAt: null,
        }).select("fullName email avatar status");

        const active = students.filter((s) =>
          ["enrolled", "active"].includes(s.status),
        ).length;

        return {
          id: c._id.toString(),
          slug: c.code,
          title: c.name,
          code: c.code,
          description: c.description,
          startDate: c.startDate,
          totalStudents: students.length,
          activeStudents: active,
          inactiveStudents: students.length - active,
          icon: c.icon || c.courseId?.icon || "/badges/skyboss.png",
        };
      }),
    );

    res.status(200).json({ cohorts: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch cohorts." });
  }
};

export const getInstructorCohortBySlug = async (req, res) => {
  try {
    const cohort = await findCohortBySlug(req.params.slug);
    if (!cohort) {
      return res.status(404).json({ message: "Cohort not found." });
    }

    const allowedIds = await getInstructorCohortIds(req.userId);
    if (!allowedIds.includes(String(cohort._id))) {
      return res
        .status(403)
        .json({ message: "Not authorized for this cohort." });
    }

    const students = await User.find({
      cohortId: cohort._id,
      role: "student",
      deletedAt: null,
    }).select("fullName email avatar status");

    const badgeDefs = await BadgeDefinition.find();
    const totalBadges = Math.max(badgeDefs.length, 1);

    const milestones = await Milestone.find({ cohortId: cohort._id }).sort({
      order: 1,
    });

    const studentCards = await Promise.all(
      students.map(async (s) => {
        const earned = await StudentBadge.countDocuments({ studentId: s._id });

        const unlocked = milestones.filter((m) => m.isUnlocked).length;
        const progress =
          milestones.length > 0
            ? Math.round((unlocked / milestones.length) * 100)
            : 0;

        return {
          id: s._id.toString(),
          name: s.fullName || s.name || "Student",
          email: s.email,
          avatar: s.avatar || "/default.jpg",
          coverImage: s.avatar || "/default.jpg",
          course: cohort.courseTitle || cohort.name || "Software development",
          progress,
          badgesCount: totalBadges,
          unlockedBadges: earned,
        };
      }),
    );

    const active = students.filter((s) =>
      ["enrolled", "active"].includes(s.status),
    ).length;

    res.status(200).json({
      id: cohort._id.toString(),
      slug: cohort.code,
      title: cohort.name,
      icon: cohort.icon || "/badges/skyboss.png",
      totalStudents: students.length,
      activeStudents: active,
      inactiveStudents: students.length - active,
      students: studentCards,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch cohort." });
  }
};

/**
 * GET /api/instructor/cohorts/:slug/students/:studentId
 */
export const getInstructorStudentDetail = async (req, res) => {
  try {
    const { slug, studentId } = req.params;
    const cohort = await findCohortBySlug(slug);
    if (!cohort) {
      return res.status(404).json({ message: "Cohort not found." });
    }

    const allowedIds = await getInstructorCohortIds(req.userId);
    if (!allowedIds.includes(String(cohort._id))) {
      return res
        .status(403)
        .json({ message: "Not authorized for this cohort." });
    }

    // Only non-deleted students in THIS cohort
    const student = await User.findOne({
      _id: studentId,
      cohortId: cohort._id,
      role: "student",
      deletedAt: null,
    });
    if (!student) {
      return res.status(404).json({ message: "Student not found in cohort." });
    }

    const courseId = cohort.courseId?._id || cohort.courseId || null;

    // ── Attendance (this student + this cohort only) ─────────────────────
    const records = await Attendance.find({
      studentId: student._id,
      cohortId: cohort._id,
    });
    const present = records.filter(
      (r) => r.status === "present" || r.status === "late",
    ).length;
    const attendancePct =
      records.length > 0
        ? `${Math.round((present / records.length) * 100)}%`
        : "—";

    // ── Solos (prefer cohortId, fall back to courseId) ───────────────────
    let solos = await Solo.find({ cohortId: cohort._id });
    if (solos.length === 0 && courseId) {
      solos = await Solo.find({ courseId });
    }
    const studentIdStr = String(student._id);
    const completedSolos = solos.filter((solo) =>
      solo.submissions?.some(
        (sub) =>
          String(sub.studentId?._id || sub.studentId) === studentIdStr &&
          (sub.status === "graded" || sub.status === "pending"),
      ),
    ).length;

    // ── Assessments (prefer cohortId, fall back to courseId) ─────────────
    let assessments = await Assessment.find({ cohortId: cohort._id });
    if (assessments.length === 0 && courseId) {
      assessments = await Assessment.find({ courseId });
    }
    const completedAssessments = assessments.filter((a) =>
      a.attempts?.some(
        (att) =>
          String(att.studentId) === studentIdStr && att.status === "completed",
      ),
    ).length;

    // ── Milestone progress (per-student via StudentProgress) ─────────────
    // Do NOT use Milestone.isUnlocked — that is global and leaks across students.
    let milestones = await Milestone.find({ cohortId: cohort._id }).sort({
      order: 1,
    });
    if (milestones.length === 0 && courseId) {
      milestones = await Milestone.find({ courseId }).sort({ order: 1 });
    }

    let progress = 0;
    let currentMilestone = milestones[0]?.title || "—";
    let expectedMilestone = currentMilestone;

    if (courseId && milestones.length > 0) {
      const progressDoc = await StudentProgress.findOne({
        studentId: student._id,
        courseId,
      });
      const completedSet = new Set(
        (progressDoc?.completedSegmentIds || []).map((id) => String(id)),
      );

      const segments = await Segment.find({
        milestoneId: { $in: milestones.map((m) => m._id) },
      }).select("milestoneId _id");

      let completedCount = 0;
      let lastCompletedTitle = null;

      for (const m of milestones) {
        const segs = segments.filter(
          (s) => String(s.milestoneId) === String(m._id),
        );
        const allDone =
          segs.length > 0 && segs.every((s) => completedSet.has(String(s._id)));
        if (allDone) {
          completedCount += 1;
          lastCompletedTitle = m.title;
        }
      }

      progress = Math.round((completedCount / milestones.length) * 100);
      currentMilestone =
        lastCompletedTitle ||
        milestones[Math.min(completedCount, milestones.length - 1)]?.title ||
        milestones[0]?.title ||
        "—";
      expectedMilestone =
        milestones[Math.min(completedCount, milestones.length - 1)]?.title ||
        currentMilestone;
    }

    const isBehind = progress < 30;

    // ── Badges (this student only) ───────────────────────────────────────
    const badgeDefs = await BadgeDefinition.find();
    const earned = await StudentBadge.countDocuments({
      studentId: student._id,
    });

    res.status(200).json({
      id: student._id.toString(),
      name: student.fullName || student.name || "Student",
      email: student.email,
      avatar: student.avatar || "/default.jpg",
      coverImage: student.avatar || "/default.jpg",
      track: cohort.courseCategory || "Software development",
      subTrack: cohort.courseTitle || cohort.name || "MERN",
      progress,
      unlockedBadges: earned,
      totalBadges: Math.max(badgeDefs.length, 1),
      attendance: attendancePct,
      completedSolos,
      totalSolos: solos.length,
      completedAssessments,
      totalAssessments: assessments.length,
      currentMilestone,
      isBehind,
      expectedMilestone,
      cohortName: cohort.name,
      cohortSlug: cohort.code,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch student detail." });
  }
};

export const sendStudentNotification = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { message } = req.body;
    if (!message?.trim()) {
      return res.status(400).json({ message: "Message is required." });
    }

    const student = await User.findOne({
      _id: studentId,
      role: "student",
      deletedAt: null,
    });
    if (!student) {
      return res.status(404).json({ message: "Student not found." });
    }

    // Only students in one of this instructor’s cohorts
    const allowedIds = await getInstructorCohortIds(req.userId);
    if (!student.cohortId || !allowedIds.includes(String(student.cohortId))) {
      return res
        .status(403)
        .json({ message: "Not authorized to notify this student." });
    }

    const instructor = await User.findById(req.userId).select(
      "fullName name avatar",
    );

    const notification = await Notification.create({
      studentId: student._id,
      cohortId: student.cohortId,
      sender: instructor?.fullName || instructor?.name || "Instructor",
      message: message.trim(),
      avatar: instructor?.avatar || "/default.jpg",
      bgColor: "bg-[#CB96EC]",
      type: "instructor",
      isRead: false,
    });

    res.status(201).json({
      message: "Notification sent.",
      notification: {
        id: notification._id,
        sender: notification.sender,
        message: notification.message,
        createdAt: notification.createdAt,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to send notification." });
  }
};

export const getInstructorAssessments = async (req, res) => {
  try {
    const cohortIds = await getInstructorCohortIds(req.userId);
    if (cohortIds.length === 0) {
      return res.status(200).json({ assessments: [] });
    }

    const cohorts = await Cohort.find({ _id: { $in: cohortIds } })
      .select("_id courseId")
      .lean();

    const courseIds = cohorts
      .map((c) => c.courseId)
      .filter(Boolean)
      .map((id) => String(id));

    // cohort-scoped OR course-scoped (many assessments only have courseId)
    const or = [{ cohortId: { $in: cohortIds } }];
    if (courseIds.length > 0) {
      or.push({ courseId: { $in: courseIds } });
    }

    const assessments = await Assessment.find({ $or: or }).sort({
      order: 1,
      createdAt: -1,
    });

    const seen = new Set();
    const result = [];

    for (const a of assessments) {
      const id = a._id.toString();
      if (seen.has(id)) continue;
      seen.add(id);

      const attempts = a.attempts || [];

      // Prefer attempts from students in this instructor's cohorts only
      let scopedAttempts = attempts;
      if (attempts.length > 0) {
        const studentIds = attempts.map((att) => att.studentId).filter(Boolean);
        if (studentIds.length > 0) {
          const allowedStudents = await User.find({
            _id: { $in: studentIds },
            cohortId: { $in: cohortIds },
            role: "student",
            deletedAt: null,
          })
            .select("_id")
            .lean();
          const allowedSet = new Set(allowedStudents.map((s) => String(s._id)));
          scopedAttempts = attempts.filter((att) =>
            allowedSet.has(String(att.studentId)),
          );
        }
      }

      const completedAttempts = scopedAttempts.filter(
        (att) => att.status === "completed",
      );
      const avgScore =
        completedAttempts.length > 0
          ? Math.round(
              completedAttempts.reduce(
                (sum, att) => sum + (att.scorePercentage || 0),
                0,
              ) / completedAttempts.length,
            )
          : null;

      result.push({
        id,
        title: a.title,
        description: a.description || "",
        status: a.isLocked ? "locked" : "unlocked",
        questionsCount: a.questions?.length ?? 0,
        durationMinutes: a.durationMinutes ?? a.duration ?? 15,
        attemptsCount: scopedAttempts.length,
        completionPercentage: avgScore,
      });
    }

    res.status(200).json({ assessments: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch assessments." });
  }
};

export const getInstructorAssessmentById = async (req, res) => {
  try {
    const { assessmentId } = req.params;

    const assessment = await Assessment.findById(assessmentId);
    if (!assessment) {
      return res.status(404).json({ message: "Assessment not found." });
    }

    const allowedIds = await getInstructorCohortIds(req.userId);
    if (allowedIds.length === 0) {
      return res.status(403).json({ message: "Not authorized." });
    }

    // Authorize via cohortId OR via courseId of an owned cohort
    let authorized = false;

    if (
      assessment.cohortId &&
      allowedIds.includes(String(assessment.cohortId))
    ) {
      authorized = true;
    } else if (assessment.courseId) {
      const match = await Cohort.findOne({
        _id: { $in: allowedIds },
        courseId: assessment.courseId,
      })
        .select("_id")
        .lean();
      if (match) authorized = true;
    }

    if (!authorized) {
      return res
        .status(403)
        .json({ message: "Not authorized for this assessment." });
    }

    const questions = (assessment.questions || []).map((q, idx) => {
      const options = Array.isArray(q.options) ? q.options.map(String) : [];

      const correctIdx =
        typeof q.correctOptionIndex === "number"
          ? q.correctOptionIndex
          : typeof q.correctIdx === "number"
            ? q.correctIdx
            : typeof q.correctAnswer === "number"
              ? q.correctAnswer
              : 0;

      const questionText =
        q.prompt ||
        q.questionText ||
        q.question ||
        q.title ||
        q.text ||
        q.body ||
        `Question ${idx + 1}`;

      return {
        id: q._id?.toString() || idx,
        question: questionText,
        options,
        correctIdx,
        explanation: q.explanation || q.rationale || "",
        type: q.type || (options.length > 0 ? "mcq" : "short"),
        expectedAnswer: q.expectedAnswer || "",
      };
    });

    res.status(200).json({
      id: assessment._id.toString(),
      title: assessment.title,
      description: assessment.description || "",
      durationMinutes: assessment.durationMinutes ?? assessment.duration ?? 15,
      isLocked: Boolean(assessment.isLocked),
      questions,
      attemptsCount: (assessment.attempts || []).length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch assessment." });
  }
};

export const getInstructorDashboard = async (req, res) => {
  try {
    const instructor = await User.findById(req.userId).select(
      "fullName name email avatar role status createdAt cohortId cohortIds",
    );
    if (!instructor) {
      return res.status(404).json({ message: "User not found." });
    }
    if (instructor.role !== "instructor") {
      return res.status(403).json({ message: "Not an instructor." });
    }

    const cohorts = await loadInstructorCohorts(req.userId);

    const cohortCards = await Promise.all(
      cohorts.map(async (c) => {
        const students = await User.find({
          cohortId: c._id,
          role: "student",
          deletedAt: null,
        }).select("status");

        const active = students.filter((s) =>
          ["enrolled", "active"].includes(s.status),
        ).length;

        return {
          id: c._id.toString(),
          slug: c.code || c._id.toString(),
          title: c.name,
          totalStudents: students.length,
          activeStudents: active,
          inactiveStudents: students.length - active,
          icon: c.icon || c.courseId?.icon || "/badges/skyboss.png",
        };
      }),
    );

    const totalStudents = cohortCards.reduce(
      (sum, c) => sum + c.totalStudents,
      0,
    );

    // Pending solos – scoped to instructor’s cohorts / students
    const cohortIds = cohorts.map((c) => String(c._id));
    const allowedCohortSet = new Set(cohortIds);
    const pendingSolos = [];

    if (cohortIds.length > 0) {
      // Prefer cohortId on Solo
      let solos = await Solo.find({
        cohortId: { $in: cohortIds },
      }).populate(
        "submissions.studentId",
        "fullName name avatar cohortId deletedAt",
      );

      // Fallback: course-based solos, still filtered by student.cohortId
      if (solos.length === 0) {
        const courseIds = cohorts
          .map((c) => c.courseId?._id || c.courseId)
          .filter(Boolean);
        if (courseIds.length > 0) {
          solos = await Solo.find({
            courseId: { $in: courseIds },
          }).populate(
            "submissions.studentId",
            "fullName name avatar cohortId deletedAt",
          );
        }
      }

      for (const solo of solos) {
        for (const sub of solo.submissions || []) {
          if (sub.status !== "pending") continue;
          const student = sub.studentId;
          if (!student) continue;
          if (student.deletedAt) continue;

          // Critical isolation: only students in the instructor’s cohorts
          if (
            student.cohortId &&
            !allowedCohortSet.has(String(student.cohortId))
          ) {
            continue;
          }

          pendingSolos.push({
            id: `${solo._id}-${sub._id || student?._id}`,
            soloId: solo._id.toString(),
            submissionId: sub._id?.toString(),
            title: solo.title || "Untitled Solo",
            studentName: student?.fullName || student?.name || "Student",
            studentAvatar: student?.avatar || "/default.jpg",
            submittedAt: sub.submittedAt || sub.createdAt || null,
          });
        }
      }

      pendingSolos.sort((a, b) => {
        if (!a.submittedAt) return 1;
        if (!b.submittedAt) return -1;
        return new Date(b.submittedAt) - new Date(a.submittedAt);
      });
    }

    res.status(200).json({
      profile: {
        id: instructor._id.toString(),
        name: instructor.fullName || instructor.name || "Instructor",
        email: instructor.email,
        avatar: instructor.avatar || "/default.jpg",
        title: "Gold star Facilitator",
        joinedAt: instructor.createdAt,
      },
      stats: {
        cohortsCount: cohortCards.length,
        studentsCount: totalStudents,
        hoursThisMonth: 0,
        hoursOverall: 0,
      },
      cohorts: cohortCards,
      pendingSolos: pendingSolos.slice(0, 10),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to load dashboard." });
  }
};

/**
 * GET /api/instructor/solo-submissions
 */
export const getInstructorSoloSubmissions = async (req, res) => {
  try {
    const cohortIds = await getInstructorCohortIds(req.userId);
    if (cohortIds.length === 0) {
      return res.status(200).json({ submissions: [] });
    }

    const allowedCohortSet = new Set(cohortIds.map(String));

    // Prefer cohortId
    let solos = await Solo.find({
      cohortId: { $in: cohortIds },
    })
      .populate(
        "submissions.studentId",
        "fullName name avatar email cohortId deletedAt",
      )
      .sort({ updatedAt: -1 });

    // Fallback via courseId, still filter by student.cohortId
    if (solos.length === 0) {
      const cohorts = await Cohort.find({ _id: { $in: cohortIds } })
        .select("courseId")
        .lean();
      const courseIds = cohorts
        .map((c) => c.courseId)
        .filter(Boolean)
        .map((id) => String(id));

      if (courseIds.length > 0) {
        solos = await Solo.find({
          courseId: { $in: courseIds },
        })
          .populate(
            "submissions.studentId",
            "fullName name avatar email cohortId deletedAt",
          )
          .sort({ updatedAt: -1 });
      }
    }

    const submissions = [];

    for (const solo of solos) {
      for (const sub of solo.submissions || []) {
        const student = sub.studentId;
        if (!student) continue;
        if (student.deletedAt) continue;

        // Isolation gate
        if (
          student.cohortId &&
          !allowedCohortSet.has(String(student.cohortId))
        ) {
          continue;
        }

        submissions.push({
          id: sub._id?.toString() || `${solo._id}-${student._id}`,
          soloId: solo._id.toString(),
          submissionId: sub._id?.toString(),
          studentName: student.fullName || student.name || "Student",
          studentAvatar: student.avatar || "/default.jpg",
          studentEmail: student.email,
          projectTitle: solo.title || "Untitled Solo",
          repoLink: sub.repositoryUrl || sub.repoLink || "#",
          liveDemoLink: sub.liveDemoUrl || sub.liveDemoLink || "#",
          notes: sub.notes || "",
          status: sub.status === "graded" ? "graded" : "pending",
          totalScore: sub.scorePercentage ?? sub.totalScore ?? null,
          submittedAt: sub.submittedAt || sub.createdAt || null,
          gradedAt: sub.gradedAt || null,
          generalFeedback: sub.generalFeedback || "",
          rubricScores: sub.rubricScores || {},
          rubricRemarks: sub.rubricRemarks || {},
        });
      }
    }

    submissions.sort((a, b) => {
      const da = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
      const db = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
      return db - da;
    });

    res.status(200).json({ submissions });
  } catch (err) {
    console.error("getInstructorSoloSubmissions", err);
    res.status(500).json({ message: "Failed to fetch solo submissions." });
  }
};

/**
 * POST /api/instructor/solos/:soloId/submissions/:submissionId/grade
 */
export const gradeSoloSubmission = async (req, res) => {
  try {
    const { soloId, submissionId } = req.params;
    const { scores, remarks, generalFeedback, totalScore } = req.body;

    if (totalScore === undefined || totalScore === null) {
      return res.status(400).json({ message: "totalScore is required." });
    }

    const solo = await Solo.findById(soloId).populate(
      "submissions.studentId",
      "cohortId deletedAt",
    );
    if (!solo) {
      return res.status(404).json({ message: "Solo not found." });
    }

    const submission = solo.submissions?.id(submissionId);
    if (!submission) {
      return res.status(404).json({ message: "Submission not found." });
    }

    if (submission.studentId?.deletedAt) {
      return res
        .status(400)
        .json({ message: "Cannot grade a deleted student's submission." });
    }

    const allowedIds = await getInstructorCohortIds(req.userId);

    // Ownership: either the solo itself is in an allowed cohort,
    // or the student who submitted belongs to an allowed cohort.
    let authorized = false;
    if (solo.cohortId && allowedIds.includes(String(solo.cohortId))) {
      authorized = true;
    } else {
      const studentCohortId =
        submission.studentId?.cohortId || submission.studentId;
      if (studentCohortId && allowedIds.includes(String(studentCohortId))) {
        authorized = true;
      } else if (submission.studentId?._id) {
        const student = await User.findById(submission.studentId._id)
          .select("cohortId deletedAt")
          .lean();
        if (student?.deletedAt) {
          return res
            .status(400)
            .json({ message: "Cannot grade a deleted student's submission." });
        }
        if (
          student?.cohortId &&
          allowedIds.includes(String(student.cohortId))
        ) {
          authorized = true;
        }
      }
    }

    if (!authorized) {
      return res
        .status(403)
        .json({ message: "Not authorized to grade this submission." });
    }

    const result = await Solo.findOneAndUpdate(
      { _id: soloId, "submissions._id": submissionId },
      {
        $set: {
          "submissions.$.status": "graded",
          "submissions.$.scorePercentage": Number(totalScore),
          "submissions.$.totalScore": Number(totalScore),
          "submissions.$.generalFeedback": generalFeedback || "",
          "submissions.$.rubricScores": scores || {},
          "submissions.$.rubricRemarks": remarks || {},
          "submissions.$.gradedAt": new Date(),
          "submissions.$.gradedBy": req.userId,
        },
      },
      { new: true },
    );

    if (!result) {
      return res.status(404).json({ message: "Solo or submission not found." });
    }

    const updated = result.submissions.id(submissionId);

    res.status(200).json({
      message: "Grade submitted successfully.",
      totalScore: Number(totalScore),
      status: updated?.status || "graded",
    });
  } catch (err) {
    console.error("gradeSoloSubmission", err);
    res.status(500).json({ message: "Failed to submit grade." });
  }
};

export const getInstructorCourses = async (req, res) => {
  try {
    const cohorts = await loadInstructorCohorts(req.userId);
    if (cohorts.length === 0) {
      return res.status(200).json({ courses: [] });
    }

    const courses = await Promise.all(
      cohorts.map(async (c) => {
        const courseId = c.courseId?._id || c.courseId || null;
        const title = c.courseId?.title || c.courseTitle || c.name || "Course";
        const category =
          c.courseId?.category || c.courseCategory || "Software development";

        // Students in THIS cohort only (no deleted)
        const students = await User.find({
          cohortId: c._id,
          role: "student",
          deletedAt: null,
        }).select("_id");

        if (!courseId || students.length === 0) {
          return {
            id: c.code || c._id.toString(),
            category,
            title,
            progress: 0,
            cohortId: c._id.toString(),
            cohortName: c.name,
            studentCount: students.length,
          };
        }

        const milestones = await Milestone.find({ courseId })
          .sort({ order: 1 })
          .select("_id");

        if (milestones.length === 0) {
          return {
            id: c.code || c._id.toString(),
            category,
            title,
            progress: 0,
            cohortId: c._id.toString(),
            cohortName: c.name,
            studentCount: students.length,
          };
        }

        const milestoneIds = milestones.map((m) => m._id);
        const segments = await Segment.find({
          milestoneId: { $in: milestoneIds },
        }).select("milestoneId _id");

        const progressDocs = await StudentProgress.find({
          studentId: { $in: students.map((s) => s._id) },
          courseId,
        }).select("studentId completedSegmentIds");

        const progressByStudent = new Map(
          progressDocs.map((p) => [String(p.studentId), p]),
        );

        let sum = 0;
        for (const s of students) {
          const doc = progressByStudent.get(String(s._id));
          const completedSet = new Set(
            (doc?.completedSegmentIds || []).map((id) => String(id)),
          );

          let completedMilestones = 0;
          for (const m of milestones) {
            const segs = segments.filter(
              (seg) => String(seg.milestoneId) === String(m._id),
            );
            if (
              segs.length > 0 &&
              segs.every((seg) => completedSet.has(String(seg._id)))
            ) {
              completedMilestones += 1;
            }
          }

          sum +=
            milestones.length > 0
              ? Math.round((completedMilestones / milestones.length) * 100)
              : 0;
        }

        const progress = Math.round(sum / students.length);

        return {
          id: c.code || c._id.toString(),
          category,
          title,
          progress,
          cohortId: c._id.toString(),
          cohortName: c.name,
          studentCount: students.length,
        };
      }),
    );

    res.status(200).json({ courses });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch courses." });
  }
};

/**
 * GET /api/instructor/courses/:courseId
 * courseId = cohort code (or ObjectId)
 * Full course tree for instructor — all milestones/segments unlocked.
 */
export const getInstructorCourseById = async (req, res) => {
  try {
    const { courseId } = req.params;

    let cohort = await Cohort.findOne({ code: courseId.toLowerCase() });
    if (!cohort) {
      cohort = await Cohort.findOne({
        name: new RegExp(`^${courseId.replace(/-/g, " ")}$`, "i"),
      });
    }
    if (!cohort && courseId.match(/^[a-f\d]{24}$/i)) {
      cohort = await Cohort.findById(courseId);
    }
    if (!cohort) {
      return res.status(404).json({ message: "Course not found." });
    }

    const allowedIds = await getInstructorCohortIds(req.userId);
    if (!allowedIds.includes(String(cohort._id))) {
      return res
        .status(403)
        .json({ message: "Not authorized for this course." });
    }

    const resolvedCourseId = cohort.courseId?._id || cohort.courseId;
    if (!resolvedCourseId) {
      return res.status(200).json({
        id: cohort.code || cohort._id.toString(),
        title: cohort.courseTitle || cohort.name,
        category: cohort.courseCategory || "Software development",
        milestones: [],
      });
    }

    const milestones = await Milestone.find({ courseId: resolvedCourseId })
      .sort({ order: 1 })
      .lean();

    const milestoneIds = milestones.map((m) => m._id);
    const allSegments = await Segment.find({
      milestoneId: { $in: milestoneIds },
    })
      .sort({ order: 1 })
      .lean();

    const segmentsByMilestone = {};
    for (const s of allSegments) {
      const key = String(s.milestoneId);
      if (!segmentsByMilestone[key]) segmentsByMilestone[key] = [];
      segmentsByMilestone[key].push(s);
    }

    const milestonesPayload = milestones.map((m) => {
      const segs = segmentsByMilestone[String(m._id)] || [];

      return {
        id: m._id.toString(),
        title: m.title,
        description: m.description || "",
        isUnlocked: true,
        duration: m.duration || "—",
        topics: m.topics || [],
        segments: segs.map((s) => {
          const rawPages = Array.isArray(s.pages) ? s.pages : [];

          const pages =
            rawPages.length > 0
              ? rawPages.map((p, idx) => {
                  const blocks = Array.isArray(p?.blocks) ? p.blocks : [];

                  const textFromBlocks = blocks
                    .filter((b) => {
                      const t = String(b?.type || "").toLowerCase();
                      return (
                        t === "text" ||
                        t === "paragraph" ||
                        t === "body" ||
                        t === "overview" ||
                        t === "content"
                      );
                    })
                    .map((b) => b.content || b.text || b.body || "")
                    .filter(Boolean)
                    .join("\n\n");

                  const headingBlocks = blocks.filter((b) => {
                    const t = String(b?.type || "").toLowerCase();
                    return (
                      t === "heading" ||
                      t === "title" ||
                      t === "h1" ||
                      t === "h2"
                    );
                  });

                  const listBlocks = blocks.filter((b) => {
                    const t = String(b?.type || "").toLowerCase();
                    return t === "list" || t === "bullets" || t === "bullet";
                  });

                  let sections = Array.isArray(p.sections)
                    ? [...p.sections]
                    : [];

                  if (
                    sections.length === 0 &&
                    (headingBlocks.length || listBlocks.length)
                  ) {
                    sections = headingBlocks.map((h, i) => {
                      const list = listBlocks[i];
                      const items = Array.isArray(list?.items)
                        ? list.items
                        : Array.isArray(list?.bullets)
                          ? list.bullets
                          : [];
                      return {
                        heading:
                          h.content ||
                          h.text ||
                          h.heading ||
                          `Section ${i + 1}`,
                        subtext: h.subtext || "",
                        bullets: items.map((item) =>
                          typeof item === "string"
                            ? { label: "", text: item }
                            : {
                                label: item.label || "",
                                text: item.text || item.content || String(item),
                              },
                        ),
                        analogy: "",
                      };
                    });
                  }

                  const intro =
                    p.intro ||
                    p.introduction ||
                    p.overview ||
                    p.content ||
                    p.description ||
                    textFromBlocks ||
                    "";

                  return {
                    title: p.title || s.title || `Page ${idx + 1}`,
                    intro,
                    overview: p.overview || "",
                    sections,
                    blocks: blocks.map((b) => ({
                      type: b.type || "text",
                      content: b.content || b.text || b.body || "",
                      heading: b.heading || "",
                      items: b.items || b.bullets || [],
                      label: b.label || "",
                    })),
                  };
                })
              : [
                  {
                    title: s.title || "Segment",
                    intro:
                      s.introduction ||
                      s.overview ||
                      s.description ||
                      "No content pages for this segment yet.",
                    overview: s.overview || "",
                    sections: [],
                    blocks: [],
                  },
                ];

          return {
            id: s._id.toString(),
            title: s.title,
            duration: s.duration || "—",
            isCompleted: false,
            pages,
          };
        }),
      };
    });

    res.status(200).json({
      id: cohort.code || cohort._id.toString(),
      title: cohort.courseTitle || cohort.name,
      category: cohort.courseCategory || "Software development",
      milestones: milestonesPayload,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch course." });
  }
};

export const getInstructorSolos = async (req, res) => {
  try {
    const cohortIds = await getInstructorCohortIds(req.userId);
    if (cohortIds.length === 0) {
      return res.status(200).json({ solos: [] });
    }

    // Prefer cohortId; fall back to courseId of those cohorts
    let solos = await Solo.find({ cohortId: { $in: cohortIds } })
      .sort({ order: 1, createdAt: -1 })
      .select("title description dueDate order isLocked timeToComplete");

    if (solos.length === 0) {
      const cohorts = await Cohort.find({ _id: { $in: cohortIds } })
        .select("courseId")
        .lean();
      const courseIds = cohorts.map((c) => c.courseId).filter(Boolean);
      if (courseIds.length > 0) {
        solos = await Solo.find({ courseId: { $in: courseIds } })
          .sort({ order: 1, createdAt: -1 })
          .select("title description dueDate order isLocked timeToComplete");
      }
    }

    const result = solos.map((s) => ({
      id: s._id.toString(),
      title: s.title,
      description: s.description,
      dueDate: s.dueDate,
      isLocked: s.isLocked,
      timeToComplete: s.timeToComplete,
    }));

    res.status(200).json({ solos: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch solos." });
  }
};

export const getInstructorSoloById = async (req, res) => {
  try {
    const { soloId } = req.params;
    const { studentId } = req.query;

    // lean() — avoid populate crashes if gradedByInstructorId path is wrong
    const solo = await Solo.findById(soloId).lean();
    if (!solo) {
      return res.status(404).json({ message: "Solo not found." });
    }

    const allowedIds = await getInstructorCohortIds(req.userId);
    if (allowedIds.length === 0) {
      return res.status(403).json({ message: "Not authorized." });
    }

    let authorized = false;
    if (solo.cohortId && allowedIds.includes(String(solo.cohortId))) {
      authorized = true;
    } else if (solo.courseId) {
      const match = await Cohort.findOne({
        _id: { $in: allowedIds },
        courseId: solo.courseId,
      })
        .select("_id")
        .lean();
      if (match) authorized = true;
    }

    if (!authorized) {
      return res.status(403).json({ message: "Not authorized for this solo." });
    }

    // Normalize techStack for the UI
    const rawStack = Array.isArray(solo.techStack) ? solo.techStack : [];
    const techStack = rawStack.map((item) => {
      if (item && typeof item === "object") {
        return {
          layer: item.layer || item.name || "Stack",
          technology:
            item.technology || item.tech || item.value || String(item),
        };
      }
      return { layer: "Stack", technology: String(item) };
    });

    const architecture = Array.isArray(solo.architecture)
      ? solo.architecture.map(String)
      : [];

    let gradedView = {
      isGraded: false,
      score: null,
      feedback: "",
      instructorName: null,
      instructorAvatar: null,
    };

    if (studentId) {
      const student = await User.findOne({
        _id: studentId,
        role: "student",
        deletedAt: null,
      })
        .select("cohortId")
        .lean();

      if (student?.cohortId && allowedIds.includes(String(student.cohortId))) {
        const sub = (solo.submissions || []).find((s) => {
          const sid = String(s.studentId?._id || s.studentId || "");
          return sid === String(studentId);
        });

        if (sub && sub.status === "graded") {
          let graderName = "Instructor";
          let graderAvatar = "/default.jpg";

          const graderId = sub.gradedBy || sub.gradedByInstructorId || null;
          if (graderId) {
            const grader = await User.findById(graderId)
              .select("fullName name avatar")
              .lean();
            if (grader) {
              graderName = grader.fullName || grader.name || graderName;
              graderAvatar = grader.avatar || graderAvatar;
            }
          }

          gradedView = {
            isGraded: true,
            score: sub.scorePercentage ?? sub.totalScore ?? sub.score ?? null,
            feedback: sub.generalFeedback || sub.feedback || "",
            instructorName: graderName,
            instructorAvatar: graderAvatar,
          };
        }
      }
    }

    res.status(200).json({
      id: String(solo._id),
      title: solo.title || "Solo",
      description: solo.description || "",
      dueDate: solo.dueDate || null,
      timeToComplete: solo.timeToComplete || "—",
      overview: solo.overview || solo.description || "",
      goal: solo.goal || "",
      techStack,
      architecture,
      isLocked: Boolean(solo.isLocked),
      ...gradedView,
    });
  } catch (err) {
    console.error("getInstructorSoloById", err);
    res.status(500).json({ message: "Failed to fetch solo." });
  }
};

export const getStudentNotificationsForInstructor = async (req, res) => {
  try {
    const { studentId } = req.params;

    const student = await User.findOne({
      _id: studentId,
      role: "student",
      deletedAt: null,
    }).select("cohortId fullName");

    if (!student) {
      return res.status(404).json({ message: "Student not found." });
    }

    const allowedIds = await getInstructorCohortIds(req.userId);
    if (!student.cohortId || !allowedIds.includes(String(student.cohortId))) {
      return res
        .status(403)
        .json({ message: "Not authorized for this student." });
    }

    const notifications = await Notification.find({
      studentId: student._id,
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.status(200).json({
      notifications: notifications.map((n) => ({
        id: n._id.toString(),
        sender: n.sender || "Instructor",
        message: n.message,
        avatar: n.avatar || "/default.jpg",
        type: n.type || "instructor",
        isRead: Boolean(n.isRead),
        createdAt: n.createdAt,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch notifications." });
  }
};
/**
 * GET /api/instructor/schedule
 * Merged calendar for ALL cohorts this instructor owns. No other cohorts.
 */
export const getInstructorSchedule = async (req, res) => {
  try {
    const cohortIds = await getInstructorCohortIds(req.userId);
    if (cohortIds.length === 0) {
      return res.status(200).json({ schedule: {} });
    }

    const cohorts = await Cohort.find({ _id: { $in: cohortIds } })
      .select("name code startDate endDate scheduleSlots")
      .lean();

    const theme = {
      primary: "#1ACC7A",
      accent: "#34D399",
      bgLight: "rgba(16, 185, 129, 0.12)",
      border: "rgba(16, 185, 129, 0.28)",
      text: "#047857",
      badgeBg: "rgba(16, 185, 129, 0.18)",
    };

    const toDateKey = (value) => {
      if (!value) return null;
      if (typeof value === "string") return value.slice(0, 10);
      const d = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(d.getTime())) return null;
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };

    const schedule = {}; // dateKey -> EventItem[]

    const pushEvent = (key, evt) => {
      if (!key) return;
      if (!schedule[key]) schedule[key] = [];
      schedule[key].push(evt);
    };

    const sessions = await ClassSession.find({
      cohortId: { $in: cohortIds },
    })
      .sort({ date: 1 })
      .lean();

    for (const s of sessions) {
      const key = toDateKey(s.date);
      const cohort = cohorts.find((c) => String(c._id) === String(s.cohortId));
      const cohortLabel = cohort?.name || cohort?.code || "Cohort";
      const start = s.startTime || "";
      const end = s.endTime || "";
      const time =
        start && end ? `${start} - ${end}` : start || end || s.time || "";

      pushEvent(key, {
        id: String(s._id),
        title: `${s.title || "Class"} · ${cohortLabel}`,
        type: s.type === "demo" || s.type === "event" ? s.type : "class",
        time,
        location: s.location || "",
        cohortId: String(s.cohortId),
        cohortName: cohortLabel,
        theme,
      });
    }

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
        expanded.forEach((s, i) => {
          const key = toDateKey(s.date);
          const start = s.startTime || "";
          const end = s.endTime || "";
          const time = start && end ? `${start} - ${end}` : start || end || "";
          pushEvent(key, {
            id: `slot-${c._id}-${i}-${key}`,
            title: `${s.title || "Class"} · ${c.name || c.code}`,
            type: "class",
            time,
            location: s.location || "",
            cohortId: String(c._id),
            cohortName: c.name || c.code,
            theme,
          });
        });
      } catch (e) {
        console.error("expandScheduleSlots instructor", e);
      }
    }

    try {
      const legacy = await ScheduleEvent.find({
        cohortId: { $in: cohortIds },
      })
        .sort({ date: 1 })
        .lean();

      for (const ev of legacy) {
        const key = toDateKey(ev.date);
        const cohort = cohorts.find(
          (c) => String(c._id) === String(ev.cohortId),
        );
        const cohortLabel = cohort?.name || cohort?.code || "Cohort";
        const start =
          ev.startTime || (ev.time || "").split("-")[0]?.trim() || "";
        const end = ev.endTime || (ev.time || "").split("-")[1]?.trim() || "";
        const time =
          start && end ? `${start} - ${end}` : start || end || ev.time || "";

        pushEvent(key, {
          id: String(ev._id),
          title: `${ev.title || "Event"} · ${cohortLabel}`,
          type: ev.type === "demo" || ev.type === "event" ? ev.type : "class",
          time,
          location: ev.location || "",
          cohortId: String(ev.cohortId),
          cohortName: cohortLabel,
          theme,
        });
      }
    } catch {
      // ScheduleEvent model optional
    }

    for (const key of Object.keys(schedule)) {
      schedule[key].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    }

    res.status(200).json({ schedule });
  } catch (err) {
    console.error("getInstructorSchedule", err);
    res.status(500).json({ message: "Failed to fetch schedule." });
  }
};

export const createStudentChallenge = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { title, description, xpReward } = req.body;

    if (!title?.trim() || !description?.trim()) {
      return res
        .status(400)
        .json({ message: "Title and description are required." });
    }

    const student = await User.findOne({
      _id: studentId,
      role: "student",
      deletedAt: null,
    }).select("cohortId");

    if (!student || !student.cohortId) {
      return res.status(404).json({ message: "Student not found." });
    }

    const allowedIds = await getInstructorCohortIds(req.userId);
    if (!allowedIds.includes(String(student.cohortId))) {
      return res
        .status(403)
        .json({ message: "Not authorized for this student." });
    }

    const cohort = await Cohort.findById(student.cohortId)
      .select("courseId")
      .lean();

    const instructor = await User.findById(req.userId).select("avatar").lean();

    const challenge = await Challenge.create({
      title: title.trim(),
      description: description.trim(),
      xpReward: typeof xpReward === "number" && xpReward > 0 ? xpReward : 100,
      avatar: instructor?.avatar || "/default.jpg",
      cohortId: student.cohortId,
      courseId: cohort?.courseId || undefined,
      studentId: student._id, // targeted to this student only
      instructorId: req.userId,
      isActive: true,
    });

    res.status(201).json({
      id: challenge._id.toString(),
      title: challenge.title,
      description: challenge.description,
      xpReward: challenge.xpReward,
      createdAt: challenge.createdAt,
    });
  } catch (err) {
    console.error("createStudentChallenge", err);
    res.status(500).json({ message: "Failed to create challenge." });
  }
};

/**
 * GET /api/instructor/students/:studentId/challenges
 * Challenges dropped for this student only (instructor’s cohorts).
 */
export const getStudentChallengesForInstructor = async (req, res) => {
  try {
    const { studentId } = req.params;

    const student = await User.findOne({
      _id: studentId,
      role: "student",
      deletedAt: null,
    }).select("cohortId");

    if (!student || !student.cohortId) {
      return res.status(404).json({ message: "Student not found." });
    }

    const allowedIds = await getInstructorCohortIds(req.userId);
    if (!allowedIds.includes(String(student.cohortId))) {
      return res
        .status(403)
        .json({ message: "Not authorized for this student." });
    }

    const list = await Challenge.find({
      studentId: student._id,
      isActive: true,
    })
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      challenges: list.map((c) => ({
        id: c._id.toString(),
        title: c.title,
        description: c.description,
        xpReward: c.xpReward,
        avatar: c.avatar || "/default.jpg",
        createdAt: c.createdAt,
        status: "open",
      })),
    });
  } catch (err) {
    console.error("getStudentChallengesForInstructor", err);
    res.status(500).json({ message: "Failed to load challenges." });
  }
};
