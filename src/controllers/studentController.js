// src/controllers/studentController.js
import Milestone from "../models/Milestone.js";
import Solo from "../models/Solo.js";
import Assessment from "../models/Assessment.js";
import RecordedSession from "../models/RecordedSession.js";
import ClassSession from "../models/ClassSession.js";
import User from "../models/User.js";
import StudentProgress from "../models/StudentProgress.js";
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

async function getStudentContext(userId) {
  const user = await User.findById(userId).populate({
    path: "cohortId",
    populate: {
      path: "courseId",
      select: "title category slug description icon isActive",
    },
  });

  if (!user) {
    return { error: { status: 404, message: "User not found." } };
  }

  if (user.role && user.role !== "student") {
    return { error: { status: 403, message: "Not a student account." } };
  }

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

async function getOrCreateProgress(studentId, courseId) {
  let progress = await StudentProgress.findOne({ studentId, courseId });
  if (!progress) {
    progress = await StudentProgress.create({
      studentId,
      courseId,
      completedSegmentIds: [],
      unlockedMilestoneIds: [],
    });
  }
  return progress;
}

function idSet(ids = []) {
  return new Set(ids.map((id) => String(id)));
}


function assertSameCourse(resourceCourseId, studentCourseId) {
  if (!resourceCourseId || !studentCourseId) return false;
  return String(resourceCourseId) === String(studentCourseId);
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

export const getStudentNotifications = async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("cohortId");
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const studentId = user._id; // always ObjectId from the doc

    const or = [{ studentId }];

    if (user.cohortId) {
      or.push(
        { cohortId: user.cohortId, studentId: null },
        { cohortId: user.cohortId, studentId: { $exists: false } },
      );
    }

    const notifications = await Notification.find({ $or: or })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.status(200).json({ notifications });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching notifications." });
  }
};

// ── Solos ────────────────────────────────────────────────────────────────────

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

    const progress = await getOrCreateProgress(req.userId, ctx.courseId);
    const completedSet = idSet(progress.completedSegmentIds);

    const solos = await Solo.find({ courseId: ctx.courseId }).sort({
      order: 1,
    });

    const studentIdStr = String(req.userId);

    const formattedSolos = await Promise.all(
      solos.map(async (solo) => {
        // Only this student's submission
        const submission =
          solo.submissions?.find(
            (s) => String(s.studentId?._id || s.studentId) === studentIdStr,
          ) || null;

        let isLocked = true;

        if (solo.milestoneId) {
          const segments = await Segment.find({
            milestoneId: solo.milestoneId,
          }).select("_id");
          if (
            segments.length > 0 &&
            segments.every((s) => completedSet.has(String(s._id)))
          ) {
            isLocked = false;
          }
        } else {
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
          mySubmission: submission,
        };
      }),
    );

    res.status(200).json({ solos: formattedSolos });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching solos." });
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

    // Isolation: solo must belong to the student's course
    if (!assertSameCourse(solo.courseId, ctx.courseId)) {
      return res.status(403).json({ message: "Not allowed." });
    }

    const progress = await getOrCreateProgress(req.userId, ctx.courseId);
    const completedSet = idSet(progress.completedSegmentIds);

    let isLocked = true;
    if (solo.milestoneId) {
      const segments = await Segment.find({
        milestoneId: solo.milestoneId,
      }).select("_id");
      if (
        segments.length > 0 &&
        segments.every((s) => completedSet.has(String(s._id)))
      ) {
        isLocked = false;
      }
    } else {
      isLocked = Boolean(solo.isLocked);
    }

    const studentIdStr = String(req.userId);
    const raw =
      (solo.submissions || []).find((s) => {
        const sid = String(s.studentId?._id || s.studentId || "");
        return sid === studentIdStr;
      }) || null;

    // Never expose other students' submissions
    const mySubmission = raw
      ? {
          _id: raw._id,
          status: raw.status,
          repositoryUrl: raw.repositoryUrl || raw.repoLink || "",
          liveDemoUrl: raw.liveDemoUrl || raw.liveDemoLink || "",
          notes: raw.notes || "",
          scorePercentage:
            raw.scorePercentage ?? raw.totalScore ?? raw.score ?? null,
          score: raw.score ?? null,
          totalScore: raw.totalScore ?? null,
          feedback: raw.generalFeedback || raw.feedback || "",
          generalFeedback: raw.generalFeedback || raw.feedback || "",
          submittedAt: raw.submittedAt || raw.createdAt || null,
          gradedAt: raw.gradedAt || null,
        }
      : null;

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
      mySubmission,
    });
  } catch (err) {
    console.error("getStudentSoloById", err);
    res.status(500).json({ message: "Error fetching solo." });
  }
};

export const submitSolo = async (req, res) => {
  try {
    const { soloId } = req.params;
    const { repositoryUrl, liveDemoUrl, notes } = req.body;

    const ctx = await getStudentContext(req.userId);
    if (ctx.error) {
      return res.status(ctx.error.status).json({ message: ctx.error.message });
    }
    if (!ctx.courseId) {
      return res
        .status(404)
        .json({ message: "Cohort has no course assigned." });
    }

    const solo = await Solo.findById(soloId);
    if (!solo) {
      return res.status(404).json({ message: "Solo project not found." });
    }

    // Isolation: cannot submit to a solo from another course
    if (!assertSameCourse(solo.courseId, ctx.courseId)) {
      return res.status(403).json({ message: "Not allowed." });
    }

    const progress = await getOrCreateProgress(req.userId, ctx.courseId);
    const completedSet = idSet(progress.completedSegmentIds);

    if (solo.milestoneId) {
      const segments = await Segment.find({
        milestoneId: solo.milestoneId,
      }).select("_id");
      const allDone =
        segments.length > 0 &&
        segments.every((s) => completedSet.has(String(s._id)));
      if (!allDone) {
        return res.status(403).json({
          message: "Solo is still locked. Complete all segments first.",
        });
      }
    } else if (solo.isLocked) {
      return res.status(403).json({
        message: "Solo is still locked. Complete all segments first.",
      });
    }

    const studentIdStr = String(req.userId);
    const existingIndex = (solo.submissions || []).findIndex(
      (s) => String(s.studentId?._id || s.studentId) === studentIdStr,
    );

    if (existingIndex > -1) {
      solo.submissions[existingIndex].repositoryUrl = repositoryUrl;
      solo.submissions[existingIndex].liveDemoUrl = liveDemoUrl;
      solo.submissions[existingIndex].notes = notes;
      solo.submissions[existingIndex].status = "pending";
      solo.submissions[existingIndex].submittedAt = new Date();
    } else {
      solo.submissions.push({
        studentId: req.userId,
        repositoryUrl,
        liveDemoUrl,
        notes,
        status: "pending",
        submittedAt: new Date(),
      });
    }

    solo.markModified("submissions");
    await solo.save();

    // Unlock NEXT milestone for THIS student only
    if (solo.milestoneId) {
      const current = await Milestone.findById(solo.milestoneId);
      if (current && assertSameCourse(current.courseId, ctx.courseId)) {
        const next = await Milestone.findOne({
          courseId: current.courseId,
          order: { $gt: current.order ?? 0 },
        }).sort({ order: 1 });

        if (next) {
          if (
            !progress.unlockedMilestoneIds.some(
              (id) => String(id) === String(next._id),
            )
          ) {
            progress.unlockedMilestoneIds.push(next._id);
            await progress.save();
          }
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

// ── Alerts (fixed — no global leak) ──────────────────────────────────────────

export const getPendingAlerts = async (req, res) => {
  try {
    const ctx = await getStudentContext(req.userId);
    if (ctx.error) {
      return res.status(ctx.error.status).json({ message: ctx.error.message });
    }
    if (!ctx.courseId) {
      return res.json({
        pendingCount: 0,
        message: "You are completely on schedule.",
      });
    }

    const studentIdStr = String(req.userId);
    const now = new Date();

    // Only solos that belong to this student's course and are overdue
    // for THIS student (no submission or still pending past due)
    const solos = await Solo.find({
      courseId: ctx.courseId,
      dueDate: { $lt: now },
    }).select("title dueDate submissions");

    let pendingCount = 0;
    for (const solo of solos) {
      const mine = (solo.submissions || []).find(
        (s) => String(s.studentId?._id || s.studentId) === studentIdStr,
      );
      // Count as pending/overdue if never submitted or still pending
      if (!mine || mine.status === "pending") {
        pendingCount += 1;
      }
    }

    return res.json({
      pendingCount,
      message:
        pendingCount > 0
          ? `You have ${pendingCount} overdue assignment${
              pendingCount > 1 ? "s" : ""
            } to catch up on!`
          : "You are completely on schedule.",
    });
  } catch (err) {
    console.error("Error fetching pending alerts:", err);
    return res
      .status(500)
      .json({ error: "Failed to evaluate student progress alerts" });
  }
};

// ── Recorded sessions ────────────────────────────────────────────────────────

export const getRecordedSessions = async (req, res) => {
  try {
    const ctx = await getStudentContext(req.userId);
    if (ctx.error) {
      return res.status(ctx.error.status).json({ message: ctx.error.message });
    }

    const sessions = await RecordedSession.find({
      cohortId: ctx.cohortId,
    }).sort({ date: -1 });

    res.status(200).json({ sessions });
  } catch {
    res.status(500).json({ message: "Error fetching recorded sessions." });
  }
};

// ── Assessments ──────────────────────────────────────────────────────────────

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

    const studentIdStr = String(req.userId);

    const formatted = assessments.map((a) => {
      // Only this student's attempt
      const attempt = a.attempts?.find(
        (att) => String(att.studentId) === studentIdStr,
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

export const getStudentAssessmentById = async (req, res) => {
  try {
    const { assessmentId } = req.params;

    const ctx = await getStudentContext(req.userId);
    if (ctx.error) {
      return res.status(ctx.error.status).json({ message: ctx.error.message });
    }
    if (!ctx.courseId) {
      return res
        .status(404)
        .json({ message: "Cohort has no course assigned." });
    }

    const assessment = await Assessment.findById(assessmentId);
    if (!assessment) {
      return res.status(404).json({ message: "Assessment not found." });
    }

    // Isolation: assessment must belong to the student's course
    if (!assertSameCourse(assessment.courseId, ctx.courseId)) {
      return res.status(403).json({ message: "Not allowed." });
    }

    const studentIdStr = String(req.userId);
    const attempt = assessment.attempts?.find(
      (att) => String(att.studentId) === studentIdStr,
    );

    const rawQuestions = assessment.questions || [];

    const questions = rawQuestions.map((q, idx) => {
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
        type,
        question: questionText,
        options,
        correctIdx, // frontend can ignore; do not rely on client for scoring
        points: q.points ?? 1,
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

export const submitAssessment = async (req, res) => {
  try {
    const { assessmentId } = req.params;
    const { answers, scorePercentage } = req.body;

    const ctx = await getStudentContext(req.userId);
    if (ctx.error) {
      return res.status(ctx.error.status).json({ message: ctx.error.message });
    }
    if (!ctx.courseId) {
      return res
        .status(404)
        .json({ message: "Cohort has no course assigned." });
    }

    const assessment = await Assessment.findById(assessmentId);
    if (!assessment) {
      return res.status(404).json({ message: "Assessment not found." });
    }

    // Isolation: cannot submit an assessment from another course
    if (!assertSameCourse(assessment.courseId, ctx.courseId)) {
      return res.status(403).json({ message: "Not allowed." });
    }

    if (assessment.isLocked) {
      return res.status(403).json({ message: "Assessment is locked." });
    }

    const questions = assessment.questions || [];
    let earnedPoints = 0;
    let totalPoints = 0;

    const structuredAnswers = questions.map((q, idx) => {
      const raw = Array.isArray(answers) ? answers[idx] : null;
      const points = typeof q.points === "number" ? q.points : 1;
      totalPoints += points;

      let selectedOptionIndex = null;
      let textAnswer = "";
      let pointsAwarded = 0;
      let similarity = null;

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
      } else {
        textAnswer =
          typeof raw === "string"
            ? raw.trim()
            : typeof raw?.textAnswer === "string"
              ? raw.textAnswer.trim()
              : "";

        const expected = (q.expectedAnswer || "").trim();
        if (expected && textAnswer) {
          const match = textAnswer.toLowerCase() === expected.toLowerCase();
          if (match) {
            pointsAwarded = points;
            similarity = 1;
          } else {
            similarity = 0;
          }
        }
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

    const studentIdStr = String(req.userId);
    const existingIndex = (assessment.attempts || []).findIndex(
      (att) => String(att.studentId) === studentIdStr,
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

// ── Attendance ───────────────────────────────────────────────────────────────

export const getStudentAttendance = async (req, res) => {
  try {
    const ctx = await getStudentContext(req.userId);
    if (ctx.error) {
      return res.status(ctx.error.status).json({ message: ctx.error.message });
    }

    // Strictly this student + this cohort
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
async function computeStudentMetrics(userId) {
  const ctx = await getStudentContext(userId);
  if (!ctx?.user) return null;

  const studentIdStr = String(userId);
  let attendancePercent = 0;
  let soloAvg = 0;
  let assessmentAvg = 0;
  let activityScore = 0;
  let parts = 0;

  if (ctx.cohortId) {
    const records = await Attendance.find({
      studentId: userId,
      cohortId: ctx.cohortId,
    });
    if (records.length > 0) {
      const present = records.filter(
        (r) => r.status === "present" || r.status === "late",
      ).length;
      attendancePercent = Math.round((present / records.length) * 100);
      activityScore += attendancePercent;
      parts += 1;
    }
  }

  if (ctx.courseId) {
    const solos = await Solo.find({ courseId: ctx.courseId });
    const graded = solos
      .map((s) =>
        s.submissions?.find(
          (sub) => String(sub.studentId?._id || sub.studentId) === studentIdStr,
        ),
      )
      .filter(
        (sub) =>
          sub?.status === "graded" &&
          (typeof sub.scorePercentage === "number" ||
            typeof sub.score === "number" ||
            typeof sub.totalScore === "number"),
      );

    if (graded.length > 0) {
      soloAvg = Math.round(
        graded.reduce(
          (a, s) => a + (s.scorePercentage ?? s.score ?? s.totalScore ?? 0),
          0,
        ) / graded.length,
      );
      activityScore += soloAvg;
      parts += 1;
    }

    const assessments = await Assessment.find({ courseId: ctx.courseId });
    const scores = [];
    for (const a of assessments) {
      const att = a.attempts?.find(
        (x) => String(x.studentId) === studentIdStr && x.status === "completed",
      );
      if (att && typeof att.scorePercentage === "number") {
        scores.push(att.scorePercentage);
      }
    }
    if (scores.length > 0) {
      assessmentAvg = Math.round(
        scores.reduce((a, n) => a + n, 0) / scores.length,
      );
      activityScore += assessmentAvg;
      parts += 1;
    }
  }

  return {
    attendancePercent,
    soloAvg,
    assessmentAvg,
    activityScore: parts > 0 ? Math.round(activityScore / parts) : 0,
  };
}

export const getStudentBadges = async (req, res) => {
  try {
    await evaluateAndAwardBadges(req.userId);

    const definitions = await BadgeDefinition.find().sort({ order: 1 });
    const earned = await StudentBadge.find({ studentId: req.userId });
    const earnedKeys = earned.map((e) => e.badgeKey);

    const metrics = await computeStudentMetrics(req.userId);
    const progressPercent = metrics?.activityScore ?? 0;

    const badges = definitions.map((d) => ({
      id: d.key,
      name: d.name,
      imageUrl: d.imageUrl || null,
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
    const ctx = await getStudentContext(req.userId);
    if (ctx.error) {
      return res.status(ctx.error.status).json({ message: ctx.error.message });
    }
    if (!ctx.cohortId) {
      return res.status(200).json({ challenges: [] });
    }

    const studentIdStr = String(req.userId);

    const challenges = await Challenge.find({
      cohortId: ctx.cohortId,
      isActive: true,
      $or: [
        { studentId: null },
        { studentId: { $exists: false } },
        { studentId: req.userId },
      ],
    }).sort({ createdAt: -1 });

    const formatted = challenges.map((c) => ({
      id: c._id,
      avatar: c.avatar || "/default.jpg",
      sender: c.title,
      message: c.description,
      time: `${c.xpReward ?? 100} XP`,
      bgColor: c.bgColor || "bg-[#FFB800]",
      challengeId: c._id,
      completed: c.completions?.some(
        (x) => String(x.studentId) === studentIdStr,
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
      const progress = await getOrCreateProgress(req.userId, courseId);
      const completedSet = idSet(progress.completedSegmentIds);
      const milestones = await Milestone.find({ courseId }).sort({ order: 1 });
      const milestoneIds = milestones.map((m) => m._id);
      const segments = await Segment.find({
        milestoneId: { $in: milestoneIds },
      }).select("milestoneId _id");

      let completedMilestones = 0;
      for (const m of milestones) {
        const segs = segments.filter(
          (s) => String(s.milestoneId) === String(m._id),
        );
        if (
          segs.length > 0 &&
          segs.every((s) => completedSet.has(String(s._id)))
        ) {
          completedMilestones += 1;
        }
      }
      courseProgress =
        milestones.length > 0
          ? Math.round((completedMilestones / milestones.length) * 100)
          : 0;
    }

    res.status(200).json({
      student: {
        id: user._id,
        name: user.fullName || user.name || "Student",
        avatar: user.avatar || "/default.jpg",
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



export const getStudentSchedule = async (req, res) => {
  try {
    const ctx = await getStudentContext(req.userId);
    if (ctx.error) {
      return res.status(ctx.error.status).json({ message: ctx.error.message });
    }

    let sessions = await ClassSession.find({ cohortId: ctx.cohortId })
      .sort({ date: 1 })
      .lean();

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
      }
    }

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
      // ignore
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

    const progress = await getOrCreateProgress(req.userId, ctx.courseId);
    const completedSet = idSet(progress.completedSegmentIds);
    const unlockedSet = idSet(progress.unlockedMilestoneIds);

    const milestones = await Milestone.find({ courseId: ctx.courseId }).sort({
      order: 1,
    });
    const milestoneIds = milestones.map((m) => m._id);

    const segments = await Segment.find({
      milestoneId: { $in: milestoneIds },
    }).select("milestoneId _id");

    const segmentsByMilestone = {};
    for (const s of segments) {
      const key = String(s.milestoneId);
      if (!segmentsByMilestone[key]) segmentsByMilestone[key] = [];
      segmentsByMilestone[key].push(s);
    }

    let previousFullyDone = true;

    const result = milestones.map((m, index) => {
      const obj = m.toObject();
      const segs = segmentsByMilestone[String(m._id)] || [];
      const segmentsCount = segs.length;

      const allSegmentsComplete =
        segmentsCount > 0 && segs.every((s) => completedSet.has(String(s._id)));

      const isUnlocked =
        index === 0 ||
        unlockedSet.has(String(m._id)) ||
        allSegmentsComplete ||
        previousFullyDone;

      previousFullyDone = allSegmentsComplete;

      return {
        ...obj,
        id: m._id,
        isUnlocked,
        isCompleted: allSegmentsComplete,
        segmentsCount,
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


    if (!assertSameCourse(milestone.courseId, ctx.courseId)) {
      return res.status(403).json({ message: "Not allowed." });
    }

    const progress = await getOrCreateProgress(req.userId, ctx.courseId);
    const completedSet = idSet(progress.completedSegmentIds);
    const unlockedSet = idSet(progress.unlockedMilestoneIds);

    const segments = await Segment.find({ milestoneId: milestone._id }).sort({
      order: 1,
    });

    const all = await Milestone.find({ courseId: ctx.courseId })
      .sort({ order: 1 })
      .select("title order");

    const idx = all.findIndex(
      (m) => m._id.toString() === milestone._id.toString(),
    );
    const next = idx >= 0 && idx < all.length - 1 ? all[idx + 1] : null;

    const allSegmentsComplete =
      segments.length > 0 &&
      segments.every((s) => completedSet.has(String(s._id)));

    let isUnlocked =
      idx === 0 ||
      unlockedSet.has(String(milestone._id)) ||
      allSegmentsComplete;

    if (!isUnlocked && idx > 0) {
      const prev = all[idx - 1];
      const prevSegments = await Segment.find({ milestoneId: prev._id }).select(
        "_id",
      );
      const prevDone =
        prevSegments.length > 0 &&
        prevSegments.every((s) => completedSet.has(String(s._id)));
      if (prevDone) isUnlocked = true;
    }

    let soloPayload = null;
    if (milestone.soloId) {
      const soloDoc =
        typeof milestone.soloId === "object" && milestone.soloId._id
          ? milestone.soloId
          : await Solo.findById(milestone.soloId).select("title dueDate");

      if (soloDoc) {
        soloPayload = {
          id: soloDoc._id || soloDoc.id || milestone.soloId,
          title: soloDoc.title,
          dueDate: soloDoc.dueDate,
          isLocked: !allSegmentsComplete,
        };
      }
    }

    const completedCount = segments.filter((s) =>
      completedSet.has(String(s._id)),
    ).length;

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
      isUnlocked,
      isCompleted: allSegmentsComplete,
      clearanceText,
      nextMilestoneTitle: next?.title || null,
      nextMilestone: next
        ? { id: next._id, title: next.title, isUnlocked: false }
        : null,
      segments: segments.map((s) => ({
        _id: s._id,
        id: s._id,
        title: s.title,
        order: s.order,
        isCompleted: completedSet.has(String(s._id)),
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
    if (!assertSameCourse(milestone.courseId, ctx.courseId)) {
      return res.status(403).json({ message: "Not allowed." });
    }

    const segment = await Segment.findOne({
      _id: segmentId,
      milestoneId: milestone._id,
    }).lean();

    if (!segment) {
      return res.status(404).json({ message: "Segment not found." });
    }

    const progress = await getOrCreateProgress(req.userId, ctx.courseId);
    const completedSet = idSet(progress.completedSegmentIds);
    const unlockedSet = idSet(progress.unlockedMilestoneIds);
    const isCompleted = completedSet.has(String(segment._id));
    const milestoneUnlocked =
      unlockedSet.has(String(milestone._id)) || Boolean(milestone.isUnlocked);

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
      .select("_id title order")
      .lean();

    const idx = siblings.findIndex(
      (s) => s._id.toString() === segment._id.toString(),
    );

    res.status(200).json({
      _id: segment._id,
      id: segment._id,
      title: segment.title,
      order: segment.order,
      isCompleted,
      introduction: introFromBlocks || null,
      pages,

      segment: {
        _id: segment._id,
        id: segment._id,
        title: segment.title,
        order: segment.order,
        isCompleted,
        introduction: introFromBlocks || null,
        pages,
      },
      milestone: {
        _id: milestone._id,
        id: milestone._id,
        title: milestone.title,
        isUnlocked: milestoneUnlocked,
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
    if (!assertSameCourse(milestone.courseId, ctx.courseId)) {
      return res.status(403).json({ message: "Not allowed." });
    }

    const segment = await Segment.findOne({
      _id: segmentId,
      milestoneId: milestone._id,
    });
    if (!segment) {
      return res.status(404).json({ message: "Segment not found." });
    }

    const progress = await getOrCreateProgress(req.userId, ctx.courseId);
    const already = progress.completedSegmentIds.some(
      (id) => String(id) === String(segment._id),
    );
    if (!already) {
      progress.completedSegmentIds.push(segment._id);
    }
    if (
      !progress.unlockedMilestoneIds.some(
        (id) => String(id) === String(milestone._id),
      )
    ) {
      progress.unlockedMilestoneIds.push(milestone._id);
    }
    await progress.save();

    const allSegments = await Segment.find({
      milestoneId: milestone._id,
    }).select("_id title");
    const doneSet = idSet(progress.completedSegmentIds);
    const allDone =
      allSegments.length > 0 &&
      allSegments.every((s) => doneSet.has(String(s._id)));

    const soloId = milestone.soloId
      ? String(milestone.soloId._id || milestone.soloId)
      : null;

    res.status(200).json({
      message: allDone
        ? "Segment complete. All segments done — solo unlocked for you."
        : "Segment marked complete.",
      segmentId: segment._id,
      segmentIsCompleted: true,
      allSegmentsComplete: allDone,
      segmentsSnapshot: allSegments.map((s) => ({
        id: s._id,
        title: s.title,
        isCompleted: doneSet.has(String(s._id)),
      })),
      soloUnlocked: allDone && Boolean(soloId),
      soloId,
    });
  } catch (err) {
    console.error("completeStudentSegment error:", err);
    res.status(500).json({ message: "Failed to complete segment." });
  }
};

/** Award any badges this student newly qualifies for (idempotent). */
export async function evaluateAndAwardBadges(userId) {
  const metrics = await computeStudentMetrics(userId);
  if (!metrics) return [];

  const definitions = await BadgeDefinition.find().lean();
  const already = await StudentBadge.find({ studentId: userId })
    .select("badgeKey")
    .lean();
  const owned = new Set(already.map((b) => b.badgeKey));

  const newlyAwarded = [];

  for (const def of definitions) {
    if (owned.has(def.key)) continue;

    const r = def.rules || {};
    const ok =
      (r.minAttendancePercent || 0) <= metrics.attendancePercent &&
      (r.minSoloAvg || 0) <= metrics.soloAvg &&
      (r.minAssessmentAvg || 0) <= metrics.assessmentAvg &&
      (r.minActivityScore || 0) <= metrics.activityScore;

    if (!ok) continue;

    try {
      await StudentBadge.create({
        studentId: userId,
        badgeKey: def.key,
        awardedAt: new Date(),
      });
      newlyAwarded.push(def.key);
    } catch (e) {
      
      if (e?.code !== 11000) throw e;
    }
  }

  return newlyAwarded;
}
