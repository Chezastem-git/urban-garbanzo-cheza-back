import Notification from "../models/Notification.js";
import ScheduleEvent from "../models/ScheduleEvent.js";
import Challenge from "../models/Challenge.js";
import { BadgeDefinition, StudentBadge } from "../models/Badge.js";
import Attendance from "../models/Attendance.js";
import Solo from "../models/Solo.js";
import Assessment from "../models/Assessment.js";
import Milestone from "../models/Milestone.js";
import User from "../models/User.js";

// ——— Notifications ———
export const getStudentNotifications = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: "User not found." });

    const query = {
      $or: [{ studentId: req.userId }],
    };
    if (user.cohortId) {
      query.$or.push({
        cohortId: user.cohortId,
        studentId: { $exists: false },
      });
      query.$or.push({ cohortId: user.cohortId });
    }

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

// ——— Schedule / Calendar ———
export const getStudentSchedule = async (req, res) => {
  try {
    const user = await User.findById(req.userId).populate("cohortId");
    if (!user?.cohortId) {
      return res.status(404).json({ message: "No cohort assigned." });
    }

    const events = await ScheduleEvent.find({
      cohortId: user.cohortId._id || user.cohortId,
    }).sort({ date: 1 });

    // Shape: { "2026-08-03": [ EventItem, ... ] }
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

// ——— Challenges (optional per course/cohort) ———
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

// ——— Attendance average ———
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

// ——— Badges / medals ———
export const getStudentBadges = async (req, res) => {
  try {
    const definitions = await BadgeDefinition.find().sort({ order: 1 });
    const earned = await StudentBadge.find({ studentId: req.userId });
    const earnedKeys = earned.map((e) => e.badgeKey);

    // Progress toward next badge: average of attendance, solo avg, assessment avg
    const user = await User.findById(req.userId);
    let activityScore = 0;
    let parts = 0;

    // Attendance
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
    }

    // Solo avg
    if (user?.cohortId) {
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
    }

    // Assessment avg
    if (user?.cohortId) {
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

// Auto-award badges based on activity (call after attendance / solo / assessment updates)
export const evaluateStudentBadges = async (studentId) => {
  const user = await User.findById(studentId);
  if (!user?.cohortId) return;

  const definitions = await BadgeDefinition.find().sort({ order: 1 });
  // Reuse same scoring as getStudentBadges (simplified: award if progress meets rule)
  // Implementation can mirror getStudentBadges metrics per definition.rules
  // For brevity: award sequential badges when overall progress crosses thresholds
};

// ——— Dashboard summary (one call for the page) ———
export const getStudentDashboard = async (req, res) => {
  try {
    const user = await User.findById(req.userId).populate("cohortId");
    if (!user) return res.status(404).json({ message: "User not found." });

    // Reuse logic by calling internal pieces or inline minimal versions
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
      // Clients can also hit dedicated endpoints below for full data
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error loading dashboard." });
  }
};
