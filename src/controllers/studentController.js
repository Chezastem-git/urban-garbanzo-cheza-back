// src/controllers/studentController.js
import Milestone from "../models/Milestone.js";
import Solo from "../models/Solo.js";
import Assessment from "../models/Assessment.js";
import RecordedSession from "../models/RecordedSession.js";
import ClassSession from "../models/ClassSession.js";
import User from "../models/User.js";

import Notification from "../models/Notification.js";
import ScheduleEvent from "../models/ScheduleEvent.js";
import Challenge from "../models/Challenge.js";
import { BadgeDefinition, StudentBadge } from "../models/Badge.js";
import Attendance from "../models/Attendance.js";
import Segment from "../models/Segment.js";

function toDateKey(value) {
  if (!value) return null;
  if (typeof value === "string") {
    return value.slice(0, 10);
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
const CLASS_THEME = {
  primary: "#1ACC7A",
  accent: "#34D399",
  bgLight: "rgba(16, 185, 129, 0.12)",
  border: "rgba(16, 185, 129, 0.28)",
  text: "#047857",
  badgeBg: "rgba(16, 185, 129, 0.18)",
};
// Fetch Student Milestones & Segments
async function getStudentContext(userId) {
  const user = await User.findById(userId).populate({
    path: "cohortId",
    populate: {
      path: "courseId",
      select: "title category slug description icon isActive",
    },
  });

  if (!user) return { error: { status: 404, message: "User not found." } };

  const cohort = user.cohortId;
  if (!cohort) {
    return {
      user,
      cohort: null,
      course: null,
      cohortId: null,
      courseId: null,
      error: { status: 404, message: "No cohort assigned." },
    };
  }

  const course = cohort.courseId || null;
  const cohortId = cohort._id;
  const courseId = course?._id || course || null;

  return { user, cohort, course, cohortId, courseId, error: null };
}

export const clearStudentNotifications = async (req, res) => {
  try {
    await Notification.updateMany(
      { studentId: req.userId, isRead: false },
      { $set: { isRead: true } },
    );
    res.status(200).json({ message: "Notifications cleared." });
  } catch {
    res.status(500).json({ message: "Failed to clear notifications." });
  }
};

// Fetch Student Solos & Submissions
export const getStudentSolos = async (req, res) => {
  try {
    const ctx = await getStudentContext(req.userId);
    if (ctx.error) {
      return res.status(ctx.error.status).json({ message: ctx.error.message });
    }
    if (!ctx.courseId) {
      return res
        .status(404)
        .json({ message: "Cohort has no course assigned." });
    }

    const solos = await Solo.find({ courseId: ctx.courseId }).sort({
      order: 1,
    });

    const formattedSolos = await Promise.all(
      solos.map(async (solo) => {
        const submission = solo.submissions?.find(
          (s) => s.studentId.toString() === req.userId,
        );

        let isLocked = true;

        if (solo.milestoneId) {
          const segments = await Segment.find({
            milestoneId: solo.milestoneId,
          });
          // Unlock when there is at least one segment and all are complete
          if (segments.length > 0 && segments.every((s) => s.isCompleted)) {
            isLocked = false;
          }
        } else {
          // Legacy solos with no milestone — fall back to stored flag
          isLocked = Boolean(solo.isLocked);
        }

        return {
          _id: solo._id,
          title: solo.title,
          description: solo.description,
          dueDate: solo.dueDate,
          order: solo.order,
          milestoneId: solo.milestoneId || null,
          isLocked,
          mySubmission: submission || null,
        };
      }),
    );

    res.status(200).json({ solos: formattedSolos });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching solos." });
  }
};

// Submit Solo Project
export const submitSolo = async (req, res) => {
  try {
    const { soloId } = req.params;
    const { repositoryUrl, liveDemoUrl, notes } = req.body;

    const solo = await Solo.findById(soloId);
    if (!solo) {
      return res.status(404).json({ message: "Solo project not found." });
    }

    // Must be unlocked (all segments done)
    if (solo.isLocked) {
      return res.status(403).json({
        message: "Solo is still locked. Complete all segments first.",
      });
    }

    const existingIndex = solo.submissions.findIndex(
      (s) => s.studentId.toString() === req.userId,
    );
    if (existingIndex > -1) {
      solo.submissions[existingIndex].repositoryUrl = repositoryUrl;
      solo.submissions[existingIndex].liveDemoUrl = liveDemoUrl;
      solo.submissions[existingIndex].notes = notes;
      solo.submissions[existingIndex].status = "pending";
    } else {
      solo.submissions.push({
        studentId: req.userId,
        repositoryUrl,
        liveDemoUrl,
        notes,
        status: "pending",
      });
    }
    await solo.save();

    // Unlock NEXT milestone after solo is submitted
    if (solo.milestoneId) {
      const current = await Milestone.findById(solo.milestoneId);
      if (current) {
        const next = await Milestone.findOne({
          courseId: current.courseId,
          order: { $gt: current.order ?? 0 },
        }).sort({ order: 1 });

        if (next) {
          next.isUnlocked = true;
          await next.save();
        }
      }
    }

    res.status(200).json({
      message: "Solo submitted. Next milestone unlocked (if any).",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to submit solo project." });
  }
};

export const getPendingAlerts = async (req, res) => {
  try {
    const studentId = req.userId; // Change req.user.id to req.userId

    const overdueAssignments = await Milestone.find({
      dueDate: { $lt: new Date() },
      "submissions.studentId": { $ne: studentId },
    });

    const pendingCount = overdueAssignments.length;

    return res.json({
      pendingCount,
      message:
        pendingCount > 0
          ? `You have ${pendingCount} overdue assignment${pendingCount > 1 ? "s" : ""} to catch up on!`
          : "You are completely on schedule.",
    });
  } catch (err) {
    console.error("Error fetching pending alerts:", err);
    return res
      .status(500)
      .json({ error: "Failed to evaluate student progress alerts" });
  }
};
// Fetch Recorded Sessions
export const getRecordedSessions = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user?.cohortId) {
      return res.status(404).json({ message: "No cohort assigned." });
    }

    const sessions = await RecordedSession.find({
      cohortId: user.cohortId,
    }).sort({ date: -1 });

    res.status(200).json({ sessions });
  } catch {
    res.status(500).json({ message: "Error fetching recorded sessions." });
  }
};
// List assessments for the student's cohort + their attempt status
export const getStudentAssessments = async (req, res) => {
  try {
    const ctx = await getStudentContext(req.userId);
    if (ctx.error) {
      return res.status(ctx.error.status).json({ message: ctx.error.message });
    }
    if (!ctx.courseId) {
      return res
        .status(404)
        .json({ message: "Cohort has no course assigned." });
    }

    const assessments = await Assessment.find({ courseId: ctx.courseId }).sort({
      order: 1,
    });

    const formatted = assessments.map((a) => {
      const attempt = a.attempts?.find(
        (att) => att.studentId.toString() === req.userId,
      );

      let status = "locked";
      if (!a.isLocked) {
        status = attempt?.status === "completed" ? "completed" : "unlocked";
      } else if (attempt?.status === "completed") {
        status = "completed";
      }

      return {
        _id: a._id,
        title: a.title,
        description: a.description,
        durationMinutes: a.durationMinutes,
        questionsCount: a.questions?.length || 0,
        isLocked: a.isLocked,
        status,
        completionPercentage:
          attempt?.status === "completed" ? attempt.scorePercentage : undefined,
      };
    });

    res.status(200).json({ assessments: formatted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching assessments." });
  }
};

// Get one assessment with questions (for taking it)
export const getStudentAssessmentById = async (req, res) => {
  try {
    const { assessmentId } = req.params;
    const assessment = await Assessment.findById(assessmentId);
    if (!assessment) {
      return res.status(404).json({ message: "Assessment not found." });
    }

    const ctx = await getStudentContext(req.userId);
    if (ctx.error) {
      return res.status(ctx.error.status).json({ message: ctx.error.message });
    }
    if (
      !ctx.courseId ||
      assessment.courseId?.toString() !== ctx.courseId.toString()
    ) {
      return res.status(403).json({ message: "Not allowed." });
    }

    const attempt = assessment.attempts?.find(
      (att) => att.studentId.toString() === req.userId,
    );

    const rawQuestions = assessment.questions || [];

    const questions = rawQuestions.map((q, idx) => {
      // Normalise type from schema: "mcq" | "short" | "long"
      const type =
        q.type ||
        (Array.isArray(q.options) && q.options.length > 0 ? "mcq" : "short");

      const options = Array.isArray(q.options) ? q.options.map(String) : [];

      const correctIdx =
        typeof q.correctOptionIndex === "number"
          ? q.correctOptionIndex
          : typeof q.correctIdx === "number"
            ? q.correctIdx
            : null;

      const questionText =
        q.prompt ||
        q.questionText ||
        q.question ||
        q.title ||
        q.text ||
        q.body ||
        `Question ${idx + 1}`;

      return {
        id: q._id ?? q.id ?? idx,
        type, // "mcq" | "short" | "long"
        question: questionText,
        options, // only meaningful for mcq
        correctIdx, // only for mcq (frontend can ignore it)
        points: q.points ?? 1,
        // never send expectedAnswer to the student
      };
    });

    res.status(200).json({
      _id: assessment._id,
      id: assessment._id,
      title: assessment.title,
      description: assessment.description,
      durationMinutes: assessment.durationMinutes,
      isLocked: assessment.isLocked,
      questions,
      myAttempt: attempt || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching assessment." });
  }
};

// Submit answers and store score
export const submitAssessment = async (req, res) => {
  try {
    const { assessmentId } = req.params;
    const { answers, scorePercentage } = req.body;
    // answers can still arrive as a flat array from the current frontend:
    // [0, "some text", 2, …]  OR already as objects

    const assessment = await Assessment.findById(assessmentId);
    if (!assessment) {
      return res.status(404).json({ message: "Assessment not found." });
    }

    const questions = assessment.questions || [];
    let earnedPoints = 0;
    let totalPoints = 0;

    // Build proper attemptAnswer documents
    const structuredAnswers = questions.map((q, idx) => {
      const raw = Array.isArray(answers) ? answers[idx] : null;
      const points = typeof q.points === "number" ? q.points : 1;
      totalPoints += points;

      let selectedOptionIndex = null;
      let textAnswer = "";
      let pointsAwarded = 0;
      let similarity = null;

      // ── MCQ ──────────────────────────────────────────
      if (q.type === "mcq") {
        selectedOptionIndex =
          typeof raw === "number"
            ? raw
            : typeof raw?.selectedOptionIndex === "number"
              ? raw.selectedOptionIndex
              : null;

        if (
          selectedOptionIndex !== null &&
          selectedOptionIndex === q.correctOptionIndex
        ) {
          pointsAwarded = points;
        }
      }
      // ── Short / Long (written) ───────────────────────
      else {
        textAnswer =
          typeof raw === "string"
            ? raw.trim()
            : typeof raw?.textAnswer === "string"
              ? raw.textAnswer.trim()
              : "";

        const expected = (q.expectedAnswer || "").trim();
        if (expected && textAnswer) {
          // simple case-insensitive exact match
          // (you can later swap this for a real similarity score)
          const match = textAnswer.toLowerCase() === expected.toLowerCase();
          if (match) {
            pointsAwarded = points;
            similarity = 1;
          } else {
            similarity = 0;
          }
        }
        // if admin left expectedAnswer empty → leave pointsAwarded = 0
        // (instructor can grade manually later)
      }

      earnedPoints += pointsAwarded;

      return {
        questionIndex: idx,
        selectedOptionIndex,
        textAnswer,
        pointsAwarded,
        similarity,
      };
    });

    const finalScore =
      totalPoints > 0
        ? Math.round((earnedPoints / totalPoints) * 100)
        : typeof scorePercentage === "number"
          ? scorePercentage
          : 0;

    const attemptPayload = {
      studentId: req.userId,
      answers: structuredAnswers,
      scorePercentage: finalScore,
      totalPoints,
      earnedPoints,
      status: "completed",
      completedAt: new Date(),
    };

    const existingIndex = assessment.attempts.findIndex(
      (att) => att.studentId.toString() === req.userId,
    );

    if (existingIndex > -1) {
      assessment.attempts[existingIndex] = {
        ...(assessment.attempts[existingIndex].toObject?.() ??
          assessment.attempts[existingIndex]),
        ...attemptPayload,
      };
    } else {
      assessment.attempts.push(attemptPayload);
    }

    await assessment.save();

    res.status(200).json({
      message: "Assessment submitted successfully.",
      scorePercentage: finalScore,
      earnedPoints,
      totalPoints,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to submit assessment." });
  }
};

export const getStudentAttendance = async (req, res) => {
  try {
    const ctx = await getStudentContext(req.userId);
    if (ctx.error) {
      return res.status(ctx.error.status).json({ message: ctx.error.message });
    }

    const records = await Attendance.find({
      studentId: req.userId,
      cohortId: ctx.cohortId,
    });

    const total = records.length;
    const present = records.filter(
      (r) => r.status === "present" || r.status === "late",
    ).length;
    const missed = records.filter((r) => r.status === "absent").length;
    const percentage = total > 0 ? Math.round((present / total) * 100) : null;

    res.status(200).json({
      percentage,
      totalSessions: total,
      presentCount: present,
      missedCount: missed,
      message:
        percentage === null
          ? "No attendance recorded yet"
          : percentage >= 80
            ? "Great attendance — keep it up"
            : `You have missed ${missed} classes check on that`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching attendance." });
  }
};

export const getStudentBadges = async (req, res) => {
  try {
    const definitions = await BadgeDefinition.find().sort({ order: 1 });
    const earned = await StudentBadge.find({ studentId: req.userId });
    const earnedKeys = earned.map((e) => e.badgeKey);

    const ctx = await getStudentContext(req.userId);
    let activityScore = 0;
    let parts = 0;

    if (ctx.cohortId) {
      const records = await Attendance.find({
        studentId: req.userId,
        cohortId: ctx.cohortId,
      });
      if (records.length > 0) {
        const present = records.filter(
          (r) => r.status === "present" || r.status === "late",
        ).length;
        activityScore += Math.round((present / records.length) * 100);
        parts += 1;
      }
    }

    if (ctx.courseId) {
      const solos = await Solo.find({ courseId: ctx.courseId });
      const graded = solos
        .map((s) =>
          s.submissions?.find((sub) => sub.studentId.toString() === req.userId),
        )
        .filter(
          (sub) =>
            sub?.status === "graded" &&
            (typeof sub.score === "number" ||
              typeof sub.scorePercentage === "number" ||
              typeof sub.totalScore === "number"),
        );
      if (graded.length > 0) {
        activityScore += Math.round(
          graded.reduce(
            (a, s) => a + (s.scorePercentage ?? s.score ?? s.totalScore ?? 0),
            0,
          ) / graded.length,
        );
        parts += 1;
      }

      const assessments = await Assessment.find({ courseId: ctx.courseId });
      const scores = [];
      for (const a of assessments) {
        const att = a.attempts?.find(
          (x) =>
            x.studentId.toString() === req.userId && x.status === "completed",
        );
        if (att && typeof att.scorePercentage === "number") {
          scores.push(att.scorePercentage);
        }
      }
      if (scores.length > 0) {
        activityScore += Math.round(
          scores.reduce((a, n) => a + n, 0) / scores.length,
        );
        parts += 1;
      }
    }

    const progressPercent = parts > 0 ? Math.round(activityScore / parts) : 0;

    const badges = definitions.map((d) => ({
      id: d.key,
      name: d.name,
      imageUrl: d.imageUrl,
      color: d.color,
      accentHex: d.accentHex,
      description: d.description,
    }));

    res.status(200).json({
      badges,
      earnedBadgeIds: earnedKeys,
      progressPercent,
      medalScore: `${earnedKeys.length} / ${Math.max(definitions.length, 1)}`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching badges." });
  }
};

export const getStudentChallenges = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user?.cohortId) {
      return res.status(404).json({ message: "No cohort assigned." });
    }

    const challenges = await Challenge.find({
      cohortId: user.cohortId,
      isActive: true,
    }).sort({ createdAt: -1 });

    const formatted = challenges.map((c) => ({
      id: c._id,
      avatar: c.avatar,
      sender: c.title,
      message: c.description,
      time: `${c.xpReward} XP`,
      bgColor: c.bgColor,
      challengeId: c._id,
      completed: c.completions?.some(
        (x) => x.studentId.toString() === req.userId,
      ),
    }));

    res.status(200).json({ challenges: formatted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching challenges." });
  }
};

export const getStudentDashboard = async (req, res) => {
  try {
    const ctx = await getStudentContext(req.userId);
    if (ctx.error && !ctx.user) {
      return res.status(ctx.error.status).json({ message: ctx.error.message });
    }

    const { user, cohort, course, courseId } = ctx;

    let courseProgress = 0;
    if (courseId) {
      const milestones = await Milestone.find({ courseId }).sort({ order: 1 });
      const unlocked = milestones.filter((m) => m.isUnlocked).length;
      courseProgress =
        milestones.length > 0
          ? Math.round((unlocked / milestones.length) * 100)
          : 0;
    }

    res.status(200).json({
      student: {
        id: user._id,
        name: user.fullName || user.name || "Student",
        avatar: user.avatar || "/temp-student-asset/joan.jpg",
        cohortName: cohort?.name || "—",
      },
      course: {
        category: course?.category || "—",
        title: course?.title || "—",
        progressPercentage: courseProgress,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error loading dashboard." });
  }
};
export const getStudentNotifications = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: "User not found." });

    const notifications = await Notification.find({
      $or: [
        { studentId: req.userId },
        ...(user.cohortId ? [{ cohortId: user.cohortId }] : []),
      ],
    })
      .sort({ createdAt: -1 })
      .limit(50);

    res.status(200).json({ notifications });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching notifications." });
  }
};

export const getStudentSchedule = async (req, res) => {
  try {
    const ctx = await getStudentContext(req.userId);
    if (ctx.error) {
      return res.status(ctx.error.status).json({ message: ctx.error.message });
    }

    // 1) Prefer concrete ClassSession rows (from admin "generate sessions")
    let sessions = await ClassSession.find({ cohortId: ctx.cohortId })
      .sort({ date: 1 })
      .lean();

    // 2) Fallback: expand recurring scheduleSlots if nothing was generated yet
    if (!sessions.length && ctx.cohort?.scheduleSlots?.length) {
      try {
        const { expandScheduleSlots } =
          await import("../utils/scheduleHelpers.js");
        const expanded = expandScheduleSlots({
          startDate: ctx.cohort.startDate,
          endDate: ctx.cohort.endDate,
          scheduleSlots: ctx.cohort.scheduleSlots,
        });

        sessions = expanded.map((s, i) => ({
          _id: `slot-${i}-${toDateKey(s.date) || i}`,
          title: s.title || "Class",
          courseName: ctx.course?.title,
          date: s.date,
          startTime: s.startTime,
          endTime: s.endTime,
          location: s.location,
        }));
      } catch (expandErr) {
        console.error("expandScheduleSlots failed:", expandErr);
        // continue with empty sessions rather than 500
      }
    }

    // 3) Optional: also merge any legacy ScheduleEvent docs
    try {
      const legacyEvents = await ScheduleEvent.find({
        cohortId: ctx.cohortId,
      })
        .sort({ date: 1 })
        .lean();

      for (const ev of legacyEvents) {
        sessions.push({
          _id: ev._id,
          title: ev.title,
          courseName: ctx.course?.title,
          date: ev.date,
          startTime: ev.startTime || (ev.time || "").split("-")[0]?.trim(),
          endTime: ev.endTime || (ev.time || "").split("-")[1]?.trim(),
          location: ev.location,
          type: ev.type || "event",
        });
      }
    } catch {
      // ScheduleEvent model may be empty / unused — ignore
    }

    const schedule = {};
    for (const s of sessions) {
      const key = toDateKey(s.date);
      if (!key) continue;

      if (!schedule[key]) schedule[key] = [];

      const start = s.startTime || "";
      const end = s.endTime || "";
      const time =
        start && end ? `${start} - ${end}` : start || end || s.time || "";

      schedule[key].push({
        id: String(s._id),
        title: s.title || s.courseName || "Class",
        type: s.type === "demo" || s.type === "event" ? s.type : "class",
        time,
        location: s.location,
        theme: CLASS_THEME,
      });
    }

    // Sort events within each day by time string
    for (const key of Object.keys(schedule)) {
      schedule[key].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    }

    const end = ctx.cohort?.endDate ? new Date(ctx.cohort.endDate) : null;
    const daysLeft = end
      ? Math.max(
          0,
          Math.ceil((end.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
        )
      : null;

    res.status(200).json({
      schedule,
      daysLeftToCompletion: daysLeft,
      courseStartDate: ctx.cohort?.startDate,
      courseEndDate: ctx.cohort?.endDate,
      cohortName: ctx.cohort?.name,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching schedule." });
  }
};

export const getStudentMilestones = async (req, res) => {
  try {
    const ctx = await getStudentContext(req.userId);
    if (ctx.error) {
      return res.status(ctx.error.status).json({ message: ctx.error.message });
    }
    if (!ctx.courseId) {
      return res
        .status(404)
        .json({ message: "Cohort has no course assigned." });
    }

    const milestones = await Milestone.find({ courseId: ctx.courseId }).sort({
      order: 1,
    });

    const milestoneIds = milestones.map((m) => m._id);

    const segments = await Segment.find({
      milestoneId: { $in: milestoneIds },
    }).select("milestoneId isCompleted");

    const segmentsByMilestone = {};
    for (const s of segments) {
      const key = s.milestoneId.toString();
      if (!segmentsByMilestone[key]) segmentsByMilestone[key] = [];
      segmentsByMilestone[key].push(s);
    }

    let previousFullyDone = true;

    const result = milestones.map((m) => {
      const obj = m.toObject();
      const segs = segmentsByMilestone[m._id.toString()] || [];
      const segmentsCount = segs.length;

      const allSegmentsComplete =
        segmentsCount > 0 && segs.every((s) => Boolean(s.isCompleted));

      const isUnlocked =
        Boolean(m.isUnlocked) || allSegmentsComplete || previousFullyDone;

      // Prepare for the next milestone
      previousFullyDone = allSegmentsComplete;

      return {
        ...obj,
        id: m._id,
        isUnlocked, // stays true after completion
        isCompleted: allSegmentsComplete,
        segmentsCount,
        // keep frontend compatibility (m.segments?.length)
        segments: Array.from({ length: segmentsCount }),
      };
    });

    res.status(200).json({
      milestones: result,
      courseStartDate: ctx.cohort?.startDate,
      courseEndDate: ctx.cohort?.endDate,
      cohortName: ctx.cohort?.name,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching milestones." });
  }
};

export const getStudentMilestoneById = async (req, res) => {
  try {
    const { milestoneId } = req.params;

    const ctx = await getStudentContext(req.userId);
    if (ctx.error) {
      return res.status(ctx.error.status).json({ message: ctx.error.message });
    }
    if (!ctx.courseId) {
      return res
        .status(404)
        .json({ message: "Cohort has no course assigned." });
    }

    const milestone = await Milestone.findById(milestoneId).populate(
      "soloId",
      "title dueDate isLocked",
    );
    if (!milestone) {
      return res.status(404).json({ message: "Milestone not found." });
    }
    if (milestone.courseId?.toString() !== ctx.courseId.toString()) {
      return res.status(403).json({ message: "Not allowed." });
    }

    const segments = await Segment.find({ milestoneId: milestone._id }).sort({
      order: 1,
    });

    const all = await Milestone.find({ courseId: ctx.courseId })
      .sort({ order: 1 })
      .select("title order isUnlocked");

    const idx = all.findIndex(
      (m) => m._id.toString() === milestone._id.toString(),
    );
    const next = idx >= 0 && idx < all.length - 1 ? all[idx + 1] : null;

    const allSegmentsComplete =
      segments.length > 0 && segments.every((s) => Boolean(s.isCompleted));

    // ── Unlock logic: once reached or completed → stay unlocked forever ──
    let isUnlocked = Boolean(milestone.isUnlocked) || allSegmentsComplete;

    if (!isUnlocked) {
      const currentOrder = milestone.order ?? 0;
      const previous = all.filter((m) => (m.order ?? 0) < currentOrder);

      if (previous.length === 0) {
        // First milestone is always open
        isUnlocked = true;
      } else {
        // Unlock if the immediate previous milestone is fully completed
        const prev = previous[previous.length - 1];
        const prevSegments = await Segment.find({ milestoneId: prev._id });
        const prevDone =
          prevSegments.length > 0 &&
          prevSegments.every((s) => Boolean(s.isCompleted));
        if (prevDone) isUnlocked = true;
      }
    }

    // Solo payload
    let soloPayload = null;
    if (milestone.soloId) {
      const soloDoc =
        typeof milestone.soloId === "object" && milestone.soloId._id
          ? milestone.soloId
          : await Solo.findById(milestone.soloId).select(
              "title dueDate isLocked",
            );

      if (soloDoc) {
        soloPayload = {
          id: soloDoc._id || soloDoc.id || milestone.soloId,
          title: soloDoc.title,
          dueDate: soloDoc.dueDate,
          isLocked: !allSegmentsComplete, // locked until all segments done
        };
      }
    }

    const completedCount = segments.filter((s) => s.isCompleted).length;
    const clearanceText =
      segments.length === 0
        ? "No segments yet for this milestone"
        : completedCount >= segments.length
          ? "All segments complete — solos unlocked"
          : `Complete ${segments.length - completedCount} more segment${
              segments.length - completedCount === 1 ? "" : "s"
            } to unlock solos`;

    res.status(200).json({
      _id: milestone._id,
      id: milestone._id,
      title: milestone.title,
      description: milestone.description,
      order: milestone.order,
      isUnlocked, // ← stays true after completion
      isCompleted: allSegmentsComplete,
      clearanceText,
      nextMilestoneTitle: next?.title || null,
      nextMilestone: next
        ? { id: next._id, title: next.title, isUnlocked: next.isUnlocked }
        : null,
      segments: segments.map((s) => ({
        _id: s._id,
        id: s._id,
        title: s.title,
        order: s.order,
        isCompleted: Boolean(s.isCompleted),
        pagesCount: Array.isArray(s.pages) ? s.pages.length : 0,
      })),
      solo: soloPayload,
      milestone,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching milestone." });
  }
};

export const getStudentSegmentById = async (req, res) => {
  try {
    const { milestoneId, segmentId } = req.params;

    const ctx = await getStudentContext(req.userId);
    if (ctx.error) {
      return res.status(ctx.error.status).json({ message: ctx.error.message });
    }
    if (!ctx.courseId) {
      return res
        .status(404)
        .json({ message: "Cohort has no course assigned." });
    }

    const milestone = await Milestone.findById(milestoneId);
    if (!milestone) {
      return res.status(404).json({ message: "Milestone not found." });
    }
    if (milestone.courseId?.toString() !== ctx.courseId.toString()) {
      return res.status(403).json({ message: "Not allowed." });
    }

    const segment = await Segment.findOne({
      _id: segmentId,
      milestoneId: milestone._id,
    }).lean();

    if (!segment) {
      return res.status(404).json({ message: "Segment not found." });
    }

    const pages = Array.isArray(segment.pages) ? segment.pages : [];

    const firstPage = pages[0];
    const introFromBlocks =
      firstPage?.blocks
        ?.filter((b) => b?.type === "text" || b?.type === "TEXT")
        ?.map((b) => b.content || b.text || "")
        ?.filter(Boolean)
        ?.join("\n\n") ||
      firstPage?.content ||
      firstPage?.introduction ||
      segment.introduction ||
      "";

    const siblings = await Segment.find({ milestoneId: milestone._id })
      .sort({ order: 1 })
      .select("_id title order isCompleted")
      .lean();

    const idx = siblings.findIndex(
      (s) => s._id.toString() === segment._id.toString(),
    );

    res.status(200).json({
      _id: segment._id,
      id: segment._id,
      title: segment.title,
      order: segment.order,
      isCompleted: Boolean(segment.isCompleted),
      introduction: introFromBlocks || null,
      pages,

      segment: {
        _id: segment._id,
        id: segment._id,
        title: segment.title,
        order: segment.order,
        isCompleted: Boolean(segment.isCompleted),
        introduction: introFromBlocks || null,
        pages,
      },
      milestone: {
        _id: milestone._id,
        id: milestone._id,
        title: milestone.title,
        isUnlocked: Boolean(milestone.isUnlocked),
      },
      prevSegment:
        idx > 0
          ? { id: siblings[idx - 1]._id, title: siblings[idx - 1].title }
          : null,
      nextSegment:
        idx >= 0 && idx < siblings.length - 1
          ? { id: siblings[idx + 1]._id, title: siblings[idx + 1].title }
          : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching segment." });
  }
};

export const completeStudentSegment = async (req, res) => {
  try {
    const { milestoneId, segmentId } = req.params;

    const ctx = await getStudentContext(req.userId);
    if (ctx.error) {
      return res.status(ctx.error.status).json({ message: ctx.error.message });
    }
    if (!ctx.courseId) {
      return res
        .status(404)
        .json({ message: "Cohort has no course assigned." });
    }

    const milestone = await Milestone.findById(milestoneId);
    if (!milestone) {
      return res.status(404).json({ message: "Milestone not found." });
    }
    if (milestone.courseId?.toString() !== ctx.courseId.toString()) {
      return res.status(403).json({ message: "Not allowed." });
    }

    // Load segment and force-complete it
    const segment = await Segment.findOne({
      _id: segmentId,
      milestoneId: milestone._id,
    });
    if (!segment) {
      return res.status(404).json({ message: "Segment not found." });
    }

    segment.isCompleted = true;
    segment.markModified("isCompleted"); // ensure Mongoose persists the change
    await segment.save();

    // Re-fetch ALL segments for this milestone (fresh from DB)
    const allSegments = await Segment.find({ milestoneId: milestone._id });
    const allDone =
      allSegments.length > 0 &&
      allSegments.every((s) => Boolean(s.isCompleted));

    let soloUnlocked = false;
    const soloId = milestone.soloId
      ? (milestone.soloId._id || milestone.soloId).toString()
      : null;

    if (allDone && soloId) {
      await Solo.findByIdAndUpdate(soloId, { isLocked: false });
      soloUnlocked = true;
    }

    // Debug-friendly response so you can verify in Network tab
    res.status(200).json({
      message: allDone
        ? "Segment complete. All segments done — solo unlocked."
        : "Segment marked complete.",
      segmentId: segment._id,
      segmentIsCompleted: segment.isCompleted,
      allSegmentsComplete: allDone,
      segmentsSnapshot: allSegments.map((s) => ({
        id: s._id,
        title: s.title,
        isCompleted: s.isCompleted,
      })),
      soloUnlocked,
      soloId,
    });
  } catch (err) {
    console.error("completeStudentSegment error:", err);
    res.status(500).json({ message: "Failed to complete segment." });
  }
};
export const getStudentSoloById = async (req, res) => {
  try {
    const { soloId } = req.params;

    const ctx = await getStudentContext(req.userId);
    if (ctx.error) {
      return res.status(ctx.error.status).json({ message: ctx.error.message });
    }
    if (!ctx.courseId) {
      return res
        .status(404)
        .json({ message: "Cohort has no course assigned." });
    }

    const solo = await Solo.findById(soloId).lean();
    if (!solo) {
      return res.status(404).json({ message: "Solo not found." });
    }
    if (solo.courseId?.toString() !== ctx.courseId.toString()) {
      return res.status(403).json({ message: "Not allowed." });
    }

    // Derive lock from segments if linked to a milestone
    let isLocked = Boolean(solo.isLocked);
    if (solo.milestoneId) {
      const segments = await Segment.find({ milestoneId: solo.milestoneId });
      if (segments.length > 0) {
        isLocked = !segments.every((s) => Boolean(s.isCompleted));
      }
    }

    const submission =
      (solo.submissions || []).find(
        (s) => s.studentId?.toString() === req.userId,
      ) || null;

    res.status(200).json({
      _id: solo._id,
      id: solo._id,
      title: solo.title,
      description: solo.description || "",
      overview: solo.overview || "",
      goal: solo.goal || "",
      timeToComplete: solo.timeToComplete || "",
      dueDate: solo.dueDate || null,
      order: solo.order ?? 0,
      techStack: solo.techStack || [],
      architecture: solo.architecture || [],
      milestoneId: solo.milestoneId || null,
      isLocked,
      mySubmission: submission,
    });
  } catch (err) {
    console.error("getStudentSoloById", err);
    res.status(500).json({ message: "Error fetching solo." });
  }
};
