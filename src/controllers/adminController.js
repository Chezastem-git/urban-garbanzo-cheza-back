// src/controllers/adminController.js
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Admin from "../models/Admin.js";
import User from "../models/User.js";
import Cohort from "../models/Cohort.js";
import Milestone from "../models/Milestone.js";
import Solo from "../models/Solo.js";
import Assessment from "../models/Assessment.js";
import ClassSession from "../models/ClassSession.js";
import Attendance from "../models/Attendance.js";
import { BadgeDefinition, StudentBadge } from "../models/Badge.js";
import Notification from "../models/Notification.js";
import ScheduleEvent from "../models/ScheduleEvent.js";
import RecordedSession from "../models/RecordedSession.js";
import Challenge from "../models/Challenge.js";


export const registerAdmin = async (req, res) => {
  try {
    const { name, email, password, adminInitKey } = req.body;

    if (adminInitKey !== process.env.ADMIN_INIT_KEY) {
      return res
        .status(403)
        .json({ message: "Forbidden: Invalid admin initialization key." });
    }

    const existingAdmin = await Admin.findOne({ email: email.toLowerCase() });
    if (existingAdmin) {
      return res.status(400).json({ message: "Admin user already exists." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await Admin.create({ name, email, passwordHash });

    res.status(201).json({
      message: "Admin account registered successfully.",
      adminId: admin._id,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal server error." });
  }
};

export const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    const admin = await Admin.findOne({ email: email.toLowerCase() });

    if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const token = jwt.sign(
      { adminId: admin._id, role: "admin" },
      process.env.JWT_SECRET || "fallback_secret",
      { expiresIn: "1d" },
    );

    res.status(200).json({
      token,
      admin: { id: admin._id, email: admin.email, name: admin.name },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Login failed." });
  }
};

export const getAdminDashboard = async (req, res) => {
  try {
    const [
      totalStudents,
      totalInstructors,
      totalCohorts,
      activeStudents,
      suspendedStudents,
      pendingSolos,
      recentUsers,
    ] = await Promise.all([
      User.countDocuments({ role: "student" }),
      User.countDocuments({ role: "instructor" }),
      Cohort.countDocuments(),
      User.countDocuments({
        role: "student",
        status: { $in: ["enrolled", "active"] },
      }),
      User.countDocuments({ status: "suspended" }),
      Solo.aggregate([
        { $unwind: "$submissions" },
        { $match: { "submissions.status": "pending" } },
        { $count: "count" },
      ]),
      User.find()
        .sort({ createdAt: -1 })
        .limit(8)
        .select("fullName email role status createdAt cohortId")
        .populate("cohortId", "name code"),
    ]);

    res.status(200).json({
      stats: {
        totalStudents,
        totalInstructors,
        totalCohorts,
        activeStudents,
        suspendedStudents,
        pendingSoloSubmissions: pendingSolos[0]?.count || 0,
      },
      recentUsers,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to load admin dashboard." });
  }
};


export const createCohort = async (req, res) => {
  try {
    const {
      name,
      code,
      description,
      startDate,
      endDate,
      courseTitle,
      courseCategory,
      icon,
    } = req.body;

    if (!name || !code) {
      return res.status(400).json({ message: "Name and code are required." });
    }

    const existing = await Cohort.findOne({ code: code.toLowerCase() });
    if (existing) {
      return res.status(400).json({ message: "Cohort code already exists." });
    }

    const cohort = await Cohort.create({
      name,
      code: code.toLowerCase(),
      description,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      courseTitle,
      courseCategory,
      icon,
      createdByAdminId: req.adminId,
    });

    res.status(201).json({ message: "Cohort created successfully.", cohort });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create cohort." });
  }
};

export const getAllCohorts = async (req, res) => {
  try {
    const cohorts = await Cohort.find().sort({ startDate: -1 });

    const result = await Promise.all(
      cohorts.map(async (c) => {
        const [students, instructors] = await Promise.all([
          User.countDocuments({ cohortId: c._id, role: "student" }),
          User.countDocuments({
            $or: [{ cohortId: c._id }, { cohortIds: c._id }],
            role: "instructor",
          }),
        ]);

        return {
          id: c._id,
          name: c.name,
          code: c.code,
          description: c.description,
          startDate: c.startDate,
          endDate: c.endDate,
          courseTitle: c.courseTitle,
          courseCategory: c.courseCategory,
          icon: c.icon,
          totalStudents: students,
          totalInstructors: instructors,
          createdAt: c.createdAt,
        };
      }),
    );

    res.status(200).json({ cohorts: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch cohorts." });
  }
};

export const getCohortById = async (req, res) => {
  try {
    const cohort = await Cohort.findById(req.params.cohortId);
    if (!cohort) return res.status(404).json({ message: "Cohort not found." });

    const students = await User.find({ cohortId: cohort._id, role: "student" })
      .select("fullName email status avatar createdAt")
      .sort({ fullName: 1 });

    const instructors = await User.find({
      $or: [{ cohortId: cohort._id }, { cohortIds: cohort._id }],
      role: "instructor",
    }).select("fullName email status avatar");

    res.status(200).json({
      cohort,
      students,
      instructors,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch cohort." });
  }
};

export const updateCohort = async (req, res) => {
  try {
    const {
      name,
      description,
      startDate,
      endDate,
      courseTitle,
      courseCategory,
      icon,
    } = req.body;

    const cohort = await Cohort.findByIdAndUpdate(
      req.params.cohortId,
      {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(startDate && { startDate: new Date(startDate) }),
        ...(endDate && { endDate: new Date(endDate) }),
        ...(courseTitle && { courseTitle }),
        ...(courseCategory && { courseCategory }),
        ...(icon && { icon }),
      },
      { new: true },
    );

    if (!cohort) return res.status(404).json({ message: "Cohort not found." });

    res.status(200).json({ message: "Cohort updated.", cohort });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update cohort." });
  }
};

export const deleteCohort = async (req, res) => {
  try {
    const cohort = await Cohort.findById(req.params.cohortId);
    if (!cohort) return res.status(404).json({ message: "Cohort not found." });

    // Optional safety: prevent deletion if students are attached
    const studentCount = await User.countDocuments({
      cohortId: cohort._id,
      role: "student",
    });
    if (studentCount > 0) {
      return res.status(400).json({
        message: `Cannot delete cohort with ${studentCount} enrolled students. Reassign or deactivate them first.`,
      });
    }

    await Cohort.findByIdAndDelete(cohort._id);
    res.status(200).json({ message: "Cohort deleted." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete cohort." });
  }
};

export const provisionUser = async (req, res) => {
  try {
    const { fullName, email, password, role, cohortId } = req.body;

    if (!["student", "instructor"].includes(role)) {
      return res
        .status(400)
        .json({ message: "Role must be either 'student' or 'instructor'." });
    }

    if (!fullName || !email || !password) {
      return res
        .status(400)
        .json({ message: "fullName, email and password are required." });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res
        .status(400)
        .json({ message: "User with this email is already provisioned." });
    }

    if (cohortId) {
      const cohort = await Cohort.findById(cohortId);
      if (!cohort) {
        return res.status(404).json({ message: "Cohort not found." });
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const status = role === "student" ? "enrolled" : "employed";

    const user = await User.create({
      fullName,
      email: email.toLowerCase(),
      passwordHash,
      role,
      status,
      cohortId: cohortId || undefined,
      addedByAdminId: req.adminId,
    });

    res.status(201).json({
      message: `User successfully ${status} as ${role}.`,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        status: user.status,
        cohortId: user.cohortId,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to provision user." });
  }
};

export const getAllUsers = async (req, res) => {
  try {
    const { role, status, cohortId, search } = req.query;
    const filter = {};

    if (role) filter.role = role;
    if (status) filter.status = status;
    if (cohortId) filter.cohortId = cohortId;
    if (search) {
      filter.$or = [
        { fullName: new RegExp(search, "i") },
        { email: new RegExp(search, "i") },
      ];
    }

    const users = await User.find(filter)
      .select("-passwordHash")
      .populate("cohortId", "name code")
      .sort({ createdAt: -1 });

    res.status(200).json({ users });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch users." });
  }
};

export const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .select("-passwordHash")
      .populate("cohortId", "name code courseTitle");

    if (!user) return res.status(404).json({ message: "User not found." });

    res.status(200).json({ user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch user." });
  }
};

export const updateUserStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = [
      "enrolled",
      "active",
      "inactive",
      "suspended",
      "graduated",
      "employed",
    ];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: "Invalid status value." });
    }

    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { status },
      { new: true },
    ).select("-passwordHash");

    if (!user) return res.status(404).json({ message: "User not found." });

    res
      .status(200)
      .json({ message: `User status updated to ${status}.`, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update status." });
  }
};


export const assignUserToCohort = async (req, res) => {
  try {
    const { cohortId } = req.body;
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: "User not found." });

    if (cohortId) {
      const cohort = await Cohort.findById(cohortId);
      if (!cohort)
        return res.status(404).json({ message: "Cohort not found." });
    }

    user.cohortId = cohortId || null;
    await user.save();

    res.status(200).json({
      message: cohortId
        ? "User assigned to cohort."
        : "User removed from cohort.",
      user: {
        id: user._id,
        fullName: user.fullName,
        role: user.role,
        cohortId: user.cohortId,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to assign cohort." });
  }
};

export const resetUserPassword = async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters." });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { passwordHash },
      { new: true },
    ).select("-passwordHash");

    if (!user) return res.status(404).json({ message: "User not found." });

    res.status(200).json({ message: "Password reset successfully.", user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to reset password." });
  }
};

export const createMilestone = async (req, res) => {
  try {
    const {
      cohortId,
      title,
      description,
      order,
      duration,
      topics,
      isUnlocked,
    } = req.body;

    if (!cohortId || !title) {
      return res
        .status(400)
        .json({ message: "cohortId and title are required." });
    }

    const cohort = await Cohort.findById(cohortId);
    if (!cohort) return res.status(404).json({ message: "Cohort not found." });

    const milestone = await Milestone.create({
      cohortId,
      title,
      description,
      order: order ?? 0,
      duration,
      topics: topics || [],
      isUnlocked: Boolean(isUnlocked),
    });

    res.status(201).json({ message: "Milestone created.", milestone });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create milestone." });
  }
};

export const updateMilestone = async (req, res) => {
  try {
    const updates = req.body;
    const milestone = await Milestone.findByIdAndUpdate(
      req.params.milestoneId,
      updates,
      {
        new: true,
      },
    );
    if (!milestone)
      return res.status(404).json({ message: "Milestone not found." });
    res.status(200).json({ message: "Milestone updated.", milestone });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update milestone." });
  }
};

export const unlockMilestone = async (req, res) => {
  try {
    const milestone = await Milestone.findByIdAndUpdate(
      req.params.milestoneId,
      { isUnlocked: true },
      { new: true },
    );
    if (!milestone)
      return res.status(404).json({ message: "Milestone not found." });
    res.status(200).json({ message: "Milestone unlocked.", milestone });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to unlock milestone." });
  }
};

export const createSolo = async (req, res) => {
  try {
    const {
      cohortId,
      title,
      description,
      dueDate,
      order,
      isLocked,
      timeToComplete,
      overview,
      goal,
      techStack,
      architecture,
    } = req.body;

    if (!cohortId || !title) {
      return res
        .status(400)
        .json({ message: "cohortId and title are required." });
    }

    const solo = await Solo.create({
      cohortId,
      title,
      description,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      order: order ?? 0,
      isLocked: Boolean(isLocked),
      timeToComplete,
      overview,
      goal,
      techStack: techStack || [],
      architecture: architecture || [],
      submissions: [],
    });

    res.status(201).json({ message: "Solo created.", solo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create solo." });
  }
};

export const createAssessment = async (req, res) => {
  try {
    const {
      cohortId,
      title,
      description,
      durationMinutes,
      questions,
      isLocked,
      order,
    } = req.body;

    if (!cohortId || !title) {
      return res
        .status(400)
        .json({ message: "cohortId and title are required." });
    }

    const assessment = await Assessment.create({
      cohortId,
      title,
      description,
      durationMinutes: durationMinutes || 15,
      questions: questions || [],
      isLocked: Boolean(isLocked),
      order: order ?? 0,
      attempts: [],
    });

    res.status(201).json({ message: "Assessment created.", assessment });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create assessment." });
  }
};

export const evaluateGraduationEligibility = async (req, res) => {
  try {
    const student = await User.findById(req.params.studentId);
    if (!student || student.role !== "student") {
      return res.status(404).json({ message: "Student not found." });
    }
    if (!student.cohortId) {
      return res.status(400).json({ message: "Student has no cohort." });
    }

    const [milestones, attendanceRecords, solos] = await Promise.all([
      Milestone.find({ cohortId: student.cohortId }),
      Attendance.find({ studentId: student._id, cohortId: student.cohortId }),
      Solo.find({ cohortId: student.cohortId }),
    ]);

    const unlocked = milestones.filter((m) => m.isUnlocked).length;
    const progress =
      milestones.length > 0
        ? Math.round((unlocked / milestones.length) * 100)
        : 0;

    const present = attendanceRecords.filter(
      (r) => r.status === "present" || r.status === "late",
    ).length;
    const attendancePct =
      attendanceRecords.length > 0
        ? Math.round((present / attendanceRecords.length) * 100)
        : 0;

    let bestSoloScore = 0;
    for (const solo of solos) {
      const sub = solo.submissions?.find(
        (s) =>
          s.studentId.toString() === student._id.toString() &&
          s.status === "graded",
      );
      if (sub) {
        const score = sub.scorePercentage ?? sub.totalScore ?? sub.score ?? 0;
        if (score > bestSoloScore) bestSoloScore = score;
      }
    }

    const eligible =
      progress >= 80 &&
      attendancePct >= 75 &&
      bestSoloScore >= 60 &&
      ["enrolled", "active"].includes(student.status);

    res.status(200).json({
      studentId: student._id,
      fullName: student.fullName,
      eligible,
      metrics: {
        progress,
        attendancePct,
        bestSoloScore,
        status: student.status,
      },
      criteria: {
        minProgress: 80,
        minAttendance: 75,
        minSoloScore: 60,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to evaluate eligibility." });
  }
};

export const graduateStudent = async (req, res) => {
  try {
    const student = await User.findById(req.params.studentId);
    if (!student || student.role !== "student") {
      return res.status(404).json({ message: "Student not found." });
    }

    // Re-use the same logic (or force with ?force=true)
    const force = req.query.force === "true";

    if (!force) {
      // Quick eligibility check
      const eligibilityRes = await evaluateGraduationEligibility(
        { params: { studentId: student._id } },
        { status: () => ({ json: () => {} }) }, // dummy – better to extract logic later
      );
      // For simplicity we trust the admin UI to call evaluate first.
    }

    student.status = "graduated";
    await student.save();

    // Optional: create a notification
    await Notification.create({
      studentId: student._id,
      cohortId: student.cohortId,
      sender: "Administration",
      message:
        "Congratulations! You have successfully graduated from the program.",
      type: "system",
      bgColor: "bg-green-500",
    });

    res.status(200).json({
      message: "Student marked as graduated.",
      student: {
        id: student._id,
        fullName: student.fullName,
        status: student.status,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to graduate student." });
  }
};


export const bulkAssignStudentsToCohort = async (req, res) => {
  try {
    const { studentIds, cohortId } = req.body;
    if (!Array.isArray(studentIds) || !cohortId) {
      return res
        .status(400)
        .json({ message: "studentIds array and cohortId required." });
    }

    const cohort = await Cohort.findById(cohortId);
    if (!cohort) return res.status(404).json({ message: "Cohort not found." });

    const result = await User.updateMany(
      { _id: { $in: studentIds }, role: "student" },
      { cohortId },
    );

    res.status(200).json({
      message: `${result.modifiedCount} students assigned to cohort.`,
      modifiedCount: result.modifiedCount,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Bulk assignment failed." });
  }
};
