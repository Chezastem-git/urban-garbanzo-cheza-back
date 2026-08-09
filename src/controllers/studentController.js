// src/controllers/studentController.js
import Milestone from "../models/Milestone.js";
import Solo from "../models/Solo.js";
import Assessment from "../models/Assessment.js";
import RecordedSession from "../models/RecordedSession.js";
import User from "../models/User.js";

import Notification from "../models/Notification.js";
import ScheduleEvent from "../models/ScheduleEvent.js";
import Challenge from "../models/Challenge.js";
import { BadgeDefinition, StudentBadge } from "../models/Badge.js";
import Attendance from "../models/Attendance.js";

// Fetch Student Milestones & Segments
export const getStudentMilestones = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user?.cohortId)
      return res.status(404).json({ message: "No cohort assigned." });

    const milestones = await Milestone.find({ cohortId: user.cohortId }).sort({
      order: 1,
    });
    res.status(200).json({ milestones });
  } catch {
    res.status(500).json({ message: "Error fetching milestones." });
  }
};

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
    const user = await User.findById(req.userId);
    const solos = await Solo.find({ cohortId: user.cohortId });

    // Attach current student's specific submission status
    const formattedSolos = solos.map((solo) => {
      const submission = solo.submissions.find(
        (s) => s.studentId.toString() === req.userId,
      );
      return {
        _id: solo._id,
        title: solo.title,
        description: solo.description,
        dueDate: solo.dueDate,
        mySubmission: submission || null,
      };
    });

    res.status(200).json({ solos: formattedSolos });
  } catch {
    res.status(500).json({ message: "Error fetching solos." });
  }
};

// Submit Solo Project
export const submitSolo = async (req, res) => {
  try {
    const { soloId } = req.params;
    const { repositoryUrl, liveDemoUrl, notes } = req.body;

    const solo = await Solo.findById(soloId);
    if (!solo)
      return res.status(404).json({ message: "Solo project not found." });

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
    res.status(200).json({ message: "Solo project submitted successfully." });
  } catch {
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
    const user = await User.findById(req.userId);
    if (!user?.cohortId) {
      return res.status(404).json({ message: "No cohort assigned." });
    }

    const assessments = await Assessment.find({
      cohortId: user.cohortId,
    }).sort({ order: 1 });

    const formatted = assessments.map((a) => {
      const attempt = a.attempts.find(
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
        // Do not send correct answers in the list
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

    const user = await User.findById(req.userId);
    if (
      !user?.cohortId ||
      assessment.cohortId.toString() !== user.cohortId.toString()
    ) {
      return res.status(403).json({ message: "Not allowed." });
    }

    const attempt = assessment.attempts.find(
      (att) => att.studentId.toString() === req.userId,
    );

    // Strip correct answers when sending to client for taking the quiz
    // (or include them if you prefer client-side scoring like your mock)
    const questions = assessment.questions.map((q, idx) => ({
      id: idx,
      question: q.questionText,
      options: q.options,
      // Optional: omit correctOptionIndex for stricter security
      correctIdx: q.correctOptionIndex,
    }));

    res.status(200).json({
      _id: assessment._id,
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
    const { answers, scorePercentage } = req.body; // answers: number[]

    const assessment = await Assessment.findById(assessmentId);
    if (!assessment) {
      return res.status(404).json({ message: "Assessment not found." });
    }

    // Prefer server-side scoring if answers provided
    let finalScore = scorePercentage;
    if (Array.isArray(answers) && assessment.questions.length > 0) {
      let correct = 0;
      assessment.questions.forEach((q, idx) => {
        if (answers[idx] === q.correctOptionIndex) correct++;
      });
      finalScore = Math.round((correct / assessment.questions.length) * 100);
    }

    if (typeof finalScore !== "number") {
      return res.status(400).json({ message: "Score or answers required." });
    }

    const existingIndex = assessment.attempts.findIndex(
      (att) => att.studentId.toString() === req.userId,
    );

    if (existingIndex > -1) {
      assessment.attempts[existingIndex].answers = answers || [];
      assessment.attempts[existingIndex].scorePercentage = finalScore;
      assessment.attempts[existingIndex].status = "completed";
    } else {
      assessment.attempts.push({
        studentId: req.userId,
        answers: answers || [],
        scorePercentage: finalScore,
        status: "completed",
      });
    }

    await assessment.save();
    res.status(200).json({
      message: "Assessment submitted successfully.",
      scorePercentage: finalScore,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to submit assessment." });
  }
};

export const getStudentAttendance = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user?.cohortId) {
      return res.status(404).json({ message: "No cohort assigned." });
    }

    const records = await Attendance.find({
      studentId: req.userId,
      cohortId: user.cohortId,
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

    const user = await User.findById(req.userId);
    let activityScore = 0;
    let parts = 0;

    if (user?.cohortId) {
      const records = await Attendance.find({
        studentId: req.userId,
        cohortId: user.cohortId,
      });
      if (records.length > 0) {
        const present = records.filter(
          (r) => r.status === "present" || r.status === "late",
        ).length;
        activityScore += Math.round((present / records.length) * 100);
        parts += 1;
      }

      const solos = await Solo.find({ cohortId: user.cohortId });
      const graded = solos
        .map((s) =>
          s.submissions.find((sub) => sub.studentId.toString() === req.userId),
        )
        .filter(
          (sub) => sub?.status === "graded" && typeof sub.score === "number",
        );
      if (graded.length > 0) {
        activityScore += Math.round(
          graded.reduce((a, s) => a + s.score, 0) / graded.length,
        );
        parts += 1;
      }

      const assessments = await Assessment.find({ cohortId: user.cohortId });
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
    const user = await User.findById(req.userId).populate("cohortId");
    if (!user) return res.status(404).json({ message: "User not found." });

    const cohortId = user.cohortId?._id || user.cohortId;

    let courseProgress = 0;
    if (cohortId) {
      const milestones = await Milestone.find({ cohortId }).sort({ order: 1 });
      const unlocked = milestones.filter((m) => m.isUnlocked).length;
      courseProgress =
        milestones.length > 0
          ? Math.round((unlocked / milestones.length) * 100)
          : 0;
    }

    res.status(200).json({
      student: {
        id: user._id,
        name: user.name || user.fullName || "Student",
        avatar: user.avatar || "/temp-student-asset/joan.jpg",
        cohortName: user.cohortId?.name || "—",
      },
      course: {
        category: user.cohortId?.courseCategory || "Software development",
        title: user.cohortId?.courseTitle || "MERN",
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
    const user = await User.findById(req.userId).populate("cohortId");
    if (!user?.cohortId) {
      return res.status(404).json({ message: "No cohort assigned." });
    }

    const events = await ScheduleEvent.find({
      cohortId: user.cohortId._id || user.cohortId,
    }).sort({ date: 1 });

    const schedule = {};
    for (const ev of events) {
      const key = ev.date;
      if (!schedule[key]) schedule[key] = [];
      schedule[key].push({
        id: ev._id,
        title: ev.title,
        type: ev.type,
        time: ev.time || `${ev.startTime || ""} - ${ev.endTime || ""}`.trim(),
        location: ev.location,
        theme: ev.theme || undefined,
      });
    }

    const end = user.cohortId.endDate ? new Date(user.cohortId.endDate) : null;
    const daysLeft = end
      ? Math.max(
          0,
          Math.ceil((end.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
        )
      : null;

    res.status(200).json({
      schedule,
      daysLeftToCompletion: daysLeft,
      courseStartDate: user.cohortId.startDate,
      courseEndDate: user.cohortId.endDate,
      cohortName: user.cohortId.name,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching schedule." });
  }
};
