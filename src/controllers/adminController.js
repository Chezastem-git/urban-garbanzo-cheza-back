// src/controllers/adminController.js
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Admin from "../models/Admin.js";
import User from "../models/User.js";
import Cohort from "../models/Cohort.js";
import Course from "../models/Course.js";
import Milestone from "../models/Milestone.js";
import Solo from "../models/Solo.js";
import Assessment from "../models/Assessment.js";
import Attendance from "../models/Attendance.js";
import Notification from "../models/Notification.js";
import Certificate from "../models/Certificate.js";
import GraduationSettings from "../models/GraduationSettings.js";
import Segment from "../models/Segment.js";
import StudentProgress from "../models/StudentProgress.js";

import { BadgeDefinition, StudentBadge } from "../models/Badge.js";

// import Cohort from "../models/Cohort.js";
// import Course from "../models/Course.js";
import ClassSession from "../models/ClassSession.js";
import { expandScheduleSlots } from "../utils/scheduleHelpers.js";

async function setCohortInstructor(cohortId, instructorId) {
  const cohort = await Cohort.findById(cohortId);
  if (!cohort) {
    const err = new Error("COHORT_NOT_FOUND");
    err.status = 404;
    throw err;
  }

  // Strip this cohort from every instructor
  await User.updateMany(
    { role: "instructor", cohortIds: cohortId },
    { $pull: { cohortIds: cohortId } },
  );
  await User.updateMany(
    { role: "instructor", cohortId: cohortId },
    { $unset: { cohortId: "" } },
  );

  if (!instructorId) {
    cohort.instructorId = null;
    await cohort.save();
    return cohort;
  }

  const instructor = await User.findOne({
    _id: instructorId,
    role: "instructor",
  });
  if (!instructor) {
    const err = new Error("INSTRUCTOR_NOT_FOUND");
    err.status = 404;
    throw err;
  }

  cohort.instructorId = instructor._id;
  await cohort.save();

  if (!Array.isArray(instructor.cohortIds)) instructor.cohortIds = [];
  if (!instructor.cohortIds.some((id) => String(id) === String(cohortId))) {
    instructor.cohortIds.push(cohort._id);
  }
  await instructor.save();

  return cohort;
}

// ─────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────

export const getAdminDashboard = async (req, res) => {
  try {
    const [
      totalStudents,
      totalInstructors,
      totalCohorts,
      totalCourses,
      activeStudents,
      suspendedStudents,
      pendingSolos,
      recentUsers,
    ] = await Promise.all([
      User.countDocuments({ role: "student" }),
      User.countDocuments({ role: "instructor" }),
      Cohort.countDocuments(),
      Course.countDocuments(),
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
        totalCourses,
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

// ─────────────────────────────────────────────
// COURSES
// ─────────────────────────────────────────────

export const createCourse = async (req, res) => {
  try {
    const { title, slug, category, description, icon } = req.body;
    if (!title || !slug) {
      return res.status(400).json({ message: "title and slug are required." });
    }

    const existing = await Course.findOne({ slug: slug.toLowerCase() });
    if (existing) {
      return res.status(400).json({ message: "Course slug already exists." });
    }

    const course = await Course.create({
      title,
      slug: slug.toLowerCase(),
      category,
      description,
      icon,
      createdByAdminId: req.adminId,
    });

    res.status(201).json({ message: "Course created.", course });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create course." });
  }
};

export const getAllCourses = async (req, res) => {
  try {
    const courses = await Course.find().sort({ createdAt: -1 });

    const result = await Promise.all(
      courses.map(async (c) => {
        const [milestones, solos, assessments, cohorts] = await Promise.all([
          Milestone.countDocuments({ courseId: c._id }),
          Solo.countDocuments({ courseId: c._id }),
          Assessment.countDocuments({ courseId: c._id }),
          Cohort.countDocuments({ courseId: c._id }),
        ]);
        return {
          id: c._id,
          title: c.title,
          slug: c.slug,
          category: c.category,
          description: c.description,
          icon: c.icon,
          isActive: c.isActive,
          milestonesCount: milestones,
          solosCount: solos,
          assessmentsCount: assessments,
          cohortsCount: cohorts,
          createdAt: c.createdAt,
        };
      }),
    );

    res.status(200).json({ courses: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch courses." });
  }
};

// export const getCourseById = async (req, res) => {
//   try {
//     const course = await Course.findById(req.params.courseId);
//     if (!course) return res.status(404).json({ message: "Course not found." });

//     const [milestones, solos, assessments] = await Promise.all([
//       Milestone.find({ courseId: course._id }).sort({ order: 1 }),
//       Solo.find({ courseId: course._id }).sort({ order: 1 }),
//       Assessment.find({ courseId: course._id }).sort({ order: 1 }),
//     ]);

//     res.status(200).json({ course, milestones, solos, assessments });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: "Failed to fetch course." });
//   }
// };

export const getAllAssessments = async (req, res) => {
  try {
    const assessments = await Assessment.find()
      .populate("courseId", "title slug")
      .sort({ order: 1, createdAt: -1 });
    res.status(200).json({ assessments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch assessments." });
  }
};

export const getAssessmentById = async (req, res) => {
  try {
    const assessment = await Assessment.findById(
      req.params.assessmentId,
    ).populate("courseId", "title slug");
    if (!assessment) {
      return res.status(404).json({ message: "Assessment not found." });
    }
    res.status(200).json({ assessment });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch assessment." });
  }
};

export const updateCourse = async (req, res) => {
  try {
    const course = await Course.findByIdAndUpdate(
      req.params.courseId,
      req.body,
      {
        new: true,
      },
    );
    if (!course) return res.status(404).json({ message: "Course not found." });
    res.status(200).json({ message: "Course updated.", course });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update course." });
  }
};

export const deleteCourse = async (req, res) => {
  try {
    const course = await Course.findById(req.params.courseId);
    if (!course) return res.status(404).json({ message: "Course not found." });

    const cohortCount = await Cohort.countDocuments({ courseId: course._id });
    if (cohortCount > 0) {
      return res.status(400).json({
        message: `Cannot delete course used by ${cohortCount} cohort(s).`,
      });
    }

    await Promise.all([
      Milestone.deleteMany({ courseId: course._id }),
      Solo.deleteMany({ courseId: course._id }),
      Assessment.deleteMany({ courseId: course._id }),
      Course.findByIdAndDelete(course._id),
    ]);

    res.status(200).json({ message: "Course and its content deleted." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete course." });
  }
};

// ─────────────────────────────────────────────
// COHORTS
// ─────────────────────────────────────────────

export const createCohort = async (req, res) => {
  try {
    const {
      name,
      code,
      description,
      startDate,
      endDate,
      courseId,
      instructorId,
      scheduleSlots,
      timezone,
    } = req.body;

    if (!name || !code || !courseId || !startDate) {
      return res.status(400).json({
        message: "name, code, courseId and startDate are required.",
      });
    }

    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ message: "Course not found." });

    if (instructorId) {
      const instructor = await User.findOne({
        _id: instructorId,
        role: "instructor",
      });
      if (!instructor) {
        return res.status(404).json({ message: "Instructor not found." });
      }
    }

    const existing = await Cohort.findOne({ code: code.toLowerCase() });
    if (existing) {
      return res.status(400).json({ message: "Cohort code already exists." });
    }

    // Create WITHOUT instructor first, then assign via helper
    const cohort = await Cohort.create({
      name,
      code: code.toLowerCase(),
      description,
      startDate: new Date(startDate),
      endDate: endDate ? new Date(endDate) : undefined,
      courseId,
      instructorId: null,
      createdByAdminId: req.adminId,
      scheduleSlots: Array.isArray(scheduleSlots) ? scheduleSlots : [],
      timezone: timezone || "Africa/Nairobi",
    });

    if (instructorId) {
      await setCohortInstructor(cohort._id, instructorId);
      const refreshed = await Cohort.findById(cohort._id);
      return res
        .status(201)
        .json({ message: "Cohort created successfully.", cohort: refreshed });
    }

    res.status(201).json({ message: "Cohort created successfully.", cohort });
  } catch (err) {
    console.error(err);
    if (err.status === 404) {
      return res.status(404).json({ message: err.message });
    }
    res.status(500).json({ message: "Failed to create cohort." });
  }
};
export const getAllCohorts = async (req, res) => {
  try {
    const cohorts = await Cohort.find()
      .populate("courseId", "title slug category")
      .populate("instructorId", "fullName email")
      .sort({ startDate: -1 });

    const result = await Promise.all(
      cohorts.map(async (c) => {
        const students = await User.countDocuments({
          cohortId: c._id,
          role: "student",
        });
        return {
          id: c._id,
          name: c.name,
          code: c.code,
          description: c.description,
          startDate: c.startDate,
          endDate: c.endDate,
          isActive: c.isActive,
          course: c.courseId,
          instructor: c.instructorId,
          totalStudents: students,
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
    const cohort = await Cohort.findById(req.params.cohortId)
      .populate("courseId")
      .populate("instructorId", "fullName email avatar");

    if (!cohort) return res.status(404).json({ message: "Cohort not found." });

    const students = await User.find({ cohortId: cohort._id, role: "student" })
      .select("fullName email status avatar createdAt")
      .sort({ fullName: 1 });

    res.status(200).json({ cohort, students });
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
      courseId,
      instructorId,
      isActive,
    } = req.body;

    const updates = {};
    if (name) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (startDate) updates.startDate = new Date(startDate);
    if (endDate) updates.endDate = new Date(endDate);
    if (courseId) updates.courseId = courseId;
    if (isActive !== undefined) updates.isActive = isActive;
    // Do NOT put instructorId in updates — handled by setCohortInstructor

    let cohort = await Cohort.findByIdAndUpdate(req.params.cohortId, updates, {
      new: true,
    });

    if (!cohort) return res.status(404).json({ message: "Cohort not found." });

    // Reassign instructor (or clear) — enforces single owner
    if (instructorId !== undefined) {
      await setCohortInstructor(cohort._id, instructorId || null);
      cohort = await Cohort.findById(cohort._id)
        .populate("courseId", "title slug")
        .populate("instructorId", "fullName email");
    } else {
      cohort = await Cohort.findById(cohort._id)
        .populate("courseId", "title slug")
        .populate("instructorId", "fullName email");
    }

    res.status(200).json({ message: "Cohort updated.", cohort });
  } catch (err) {
    console.error(err);
    if (err.status === 404) {
      return res.status(404).json({ message: err.message.replace(/_/g, " ") });
    }
    res.status(500).json({ message: "Failed to update cohort." });
  }
};

export const deleteCohort = async (req, res) => {
  try {
    const cohort = await Cohort.findById(req.params.cohortId);
    if (!cohort) return res.status(404).json({ message: "Cohort not found." });

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

// ─────────────────────────────────────────────
// COHORT / INSTRUCTOR LINK REPAIR
// ─────────────────────────────────────────────

export const repairCohortInstructorLinks = async (req, res) => {
  try {
    const cohorts = await Cohort.find().select("_id instructorId");
    let fixed = 0;

    for (const c of cohorts) {
      // Source of truth = Cohort.instructorId
      await User.updateMany(
        {
          role: "instructor",
          $or: [{ cohortIds: c._id }, { cohortId: c._id }],
          ...(c.instructorId ? { _id: { $ne: c.instructorId } } : {}),
        },
        { $pull: { cohortIds: c._id } },
      );

      await User.updateMany(
        {
          role: "instructor",
          cohortId: c._id,
          ...(c.instructorId ? { _id: { $ne: c.instructorId } } : {}),
        },
        { $unset: { cohortId: "" } },
      );

      if (c.instructorId) {
        await User.updateOne(
          { _id: c.instructorId, role: "instructor" },
          { $addToSet: { cohortIds: c._id } },
        );
      }

      fixed += 1;
    }

    res.status(200).json({
      message: `Repaired instructor links for ${fixed} cohort(s).`,
      fixed,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Repair failed." });
  }
};

// ─────────────────────────────────────────────
// USERS
// ─────────────────────────────────────────────

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
    const filter = {
      deletedAt: null, // ← exclude soft-deleted users
    };

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
      .populate({
        path: "cohortId",
        populate: { path: "courseId", select: "title slug" },
      })
      .populate("cohortIds", "name code"); // ← instructors’ multiple cohorts

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
    const { cohortId, action = "set", cohortIds } = req.body;

    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: "User not found." });

    if (cohortId) {
      const cohort = await Cohort.findById(cohortId);
      if (!cohort) {
        return res.status(404).json({ message: "Cohort not found." });
      }
    }

    // ── Students: single cohortId only ─────────────────────────────
    if (user.role === "student") {
      user.cohortId = cohortId || null;
      await user.save();

      return res.status(200).json({
        message: cohortId
          ? "Student assigned to cohort."
          : "Student removed from cohort.",
        user: {
          id: user._id,
          fullName: user.fullName,
          role: user.role,
          cohortId: user.cohortId,
        },
      });
    }

    // ── Instructors ────────────────────────────────────────────────
    if (user.role !== "instructor") {
      return res.status(400).json({ message: "Unsupported role." });
    }

    if (!Array.isArray(user.cohortIds)) {
      user.cohortIds = [];
    }

    if (action === "add" && cohortId) {
      // Transfer ownership of this cohort to this instructor only
      await setCohortInstructor(cohortId, user._id);
    } else if (action === "remove" && cohortId) {
      // Unassign only if this instructor currently owns it
      const cohort = await Cohort.findById(cohortId);
      if (
        cohort?.instructorId &&
        String(cohort.instructorId) === String(user._id)
      ) {
        await setCohortInstructor(cohortId, null);
      } else {
        // Still strip from their array if stale
        user.cohortIds = user.cohortIds.filter(
          (id) => String(id) !== String(cohortId),
        );
        await user.save();
      }
    } else if (action === "set") {
      const desired = Array.isArray(cohortIds)
        ? cohortIds.map(String)
        : cohortId
          ? [String(cohortId)]
          : [];

      // Current owned cohorts (from Cohort.instructorId is source of truth)
      const currentlyOwned = await Cohort.find({
        instructorId: user._id,
      }).select("_id");

      const currentIds = currentlyOwned.map((c) => String(c._id));

      // Remove cohorts no longer in desired list
      for (const id of currentIds) {
        if (!desired.includes(id)) {
          await setCohortInstructor(id, null);
        }
      }

      // Assign each desired cohort to this instructor (moves off anyone else)
      for (const id of desired) {
        await setCohortInstructor(id, user._id);
      }
    }

    const populated = await User.findById(user._id)
      .select("-passwordHash")
      .populate("cohortIds", "name code")
      .populate("cohortId", "name code");

    res.status(200).json({
      message: "Instructor cohorts updated.",
      user: populated,
    });
  } catch (err) {
    console.error(err);
    if (err.status === 404) {
      return res.status(404).json({
        message: String(err.message).replace(/_/g, " ").toLowerCase(),
      });
    }
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

// ─────────────────────────────────────────────
// CONTENT (courseId)
// ─────────────────────────────────────────────

export const createMilestone = async (req, res) => {
  try {
    const {
      courseId,
      title,
      description,
      order,
      duration,
      topics,
      isUnlocked,
      soloId,
    } = req.body;

    if (!courseId || !title) {
      return res
        .status(400)
        .json({ message: "courseId and title are required." });
    }

    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ message: "Course not found." });

    const milestone = await Milestone.create({
      courseId,
      title,
      description,
      order: order ?? 0,
      duration,
      topics: topics || [],
      isUnlocked: Boolean(isUnlocked),
      soloId: soloId || null,
    });

    res.status(201).json({ message: "Milestone created.", milestone });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create milestone." });
  }
};

export const updateMilestone = async (req, res) => {
  try {
    const milestone = await Milestone.findByIdAndUpdate(
      req.params.milestoneId,
      req.body,
      { new: true },
    );
    if (!milestone) {
      return res.status(404).json({ message: "Milestone not found." });
    }
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
    if (!milestone) {
      return res.status(404).json({ message: "Milestone not found." });
    }
    res.status(200).json({ message: "Milestone unlocked.", milestone });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to unlock milestone." });
  }
};

export const createSolo = async (req, res) => {
  try {
    const {
      courseId,
      milestoneId, // required now
      title,
      description,
      dueDate,
      order,
      timeToComplete,
      overview,
      goal,
      techStack,
      architecture,
    } = req.body;

    if (!courseId || !title) {
      return res
        .status(400)
        .json({ message: "courseId and title are required." });
    }
    if (!milestoneId) {
      return res.status(400).json({
        message: "milestoneId is required. Solos must belong to a milestone.",
      });
    }

    const milestone = await Milestone.findById(milestoneId);
    if (!milestone) {
      return res.status(404).json({ message: "Milestone not found." });
    }
    if (milestone.courseId?.toString() !== courseId.toString()) {
      return res
        .status(400)
        .json({ message: "Milestone does not belong to this course." });
    }

    // New solos start locked until segments are finished
    const solo = await Solo.create({
      courseId,
      milestoneId,
      title,
      description,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      order: order ?? 0,
      isLocked: true,
      timeToComplete,
      overview,
      goal,
      techStack: techStack || [],
      architecture: architecture || [],
      submissions: [],
    });

    await Milestone.findByIdAndUpdate(milestoneId, { soloId: solo._id });

    res
      .status(201)
      .json({ message: "Solo created and linked to milestone.", solo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create solo." });
  }
};

export const createAssessment = async (req, res) => {
  try {
    const {
      courseId,
      title,
      description,
      durationMinutes,
      questions,
      isLocked,
      order,
    } = req.body;

    if (!courseId || !title) {
      return res
        .status(400)
        .json({ message: "courseId and title are required." });
    }

    const assessment = await Assessment.create({
      courseId,
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

// ─────────────────────────────────────────────
// GRADUATION SETTINGS
// ─────────────────────────────────────────────

export const getGraduationSettings = async (req, res) => {
  try {
    const { courseId } = req.query;

    let settings = null;
    if (courseId) {
      settings = await GraduationSettings.findOne({ courseId });
    }
    if (!settings) {
      settings = await GraduationSettings.findOne({ courseId: null });
    }

    if (!settings) {
      return res.status(200).json({
        settings: {
          courseId: courseId || null,
          minMilestoneProgress: 100,
          minSoloAverage: 60,
          minAssessmentAverage: 60,
          mustCompleteAllAssessments: true,
          requireAllSolosGraded: false,
          minAttendancePct: 0,
        },
        isDefault: true,
      });
    }

    res.status(200).json({ settings, isDefault: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch graduation settings." });
  }
};

export const updateGraduationSettings = async (req, res) => {
  try {
    const {
      courseId = null,
      minMilestoneProgress,
      minSoloAverage,
      minAssessmentAverage,
      mustCompleteAllAssessments,
      requireAllSolosGraded,
      minAttendancePct,
    } = req.body;

    if (courseId) {
      const course = await Course.findById(courseId);
      if (!course) {
        return res.status(404).json({ message: "Course not found." });
      }
    }

    const payload = { updatedByAdminId: req.adminId };

    if (minMilestoneProgress !== undefined)
      payload.minMilestoneProgress = Number(minMilestoneProgress);
    if (minSoloAverage !== undefined)
      payload.minSoloAverage = Number(minSoloAverage);
    if (minAssessmentAverage !== undefined)
      payload.minAssessmentAverage = Number(minAssessmentAverage);
    if (mustCompleteAllAssessments !== undefined)
      payload.mustCompleteAllAssessments = Boolean(mustCompleteAllAssessments);
    if (requireAllSolosGraded !== undefined)
      payload.requireAllSolosGraded = Boolean(requireAllSolosGraded);
    if (minAttendancePct !== undefined)
      payload.minAttendancePct = Number(minAttendancePct);

    const filter = courseId ? { courseId } : { courseId: null };

    const settings = await GraduationSettings.findOneAndUpdate(
      filter,
      { $set: payload, $setOnInsert: { courseId: courseId || null } },
      { upsert: true, new: true, runValidators: true },
    );

    res.status(200).json({ message: "Graduation settings updated.", settings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update graduation settings." });
  }
};

// ─────────────────────────────────────────────
// GRADUATION
// ─────────────────────────────────────────────

export const evaluateGraduationEligibility = async (req, res) => {
  try {
    const student = await User.findById(req.params.studentId);
    if (!student || student.role !== "student") {
      return res.status(404).json({ message: "Student not found." });
    }
    if (!student.cohortId) {
      return res.status(400).json({ message: "Student has no cohort." });
    }

    const cohort = await Cohort.findById(student.cohortId).populate("courseId");
    if (!cohort?.courseId) {
      return res
        .status(400)
        .json({ message: "Cohort has no course assigned." });
    }

    const courseId = cohort.courseId._id || cohort.courseId;

    let settings = await GraduationSettings.findOne({ courseId });
    if (!settings) {
      settings = await GraduationSettings.findOne({ courseId: null });
    }
    if (!settings) {
      settings = {
        minMilestoneProgress: 100,
        minSoloAverage: 60,
        minAssessmentAverage: 60,
        mustCompleteAllAssessments: true,
        requireAllSolosGraded: false,
        minAttendancePct: 0,
      };
    }

    const [milestones, solos, assessments, attendanceRecords] =
      await Promise.all([
        Milestone.find({ courseId }).sort({ order: 1 }),
        Solo.find({ courseId }),
        Assessment.find({ courseId }),
        settings.minAttendancePct > 0
          ? Attendance.find({
              studentId: student._id,
              cohortId: student.cohortId,
            })
          : Promise.resolve([]),
      ]);

    // ── Milestone progress (per-student, from StudentProgress) ──────────────
    // Do NOT use Milestone.isUnlocked — that is a global course flag and leaks
    // progress across all students on the same course.
    const progress = await StudentProgress.findOne({
      studentId: student._id,
      courseId,
    });

    const completedSet = new Set(
      (progress?.completedSegmentIds || []).map((id) => String(id)),
    );

    const segments = await Segment.find({
      milestoneId: { $in: milestones.map((m) => m._id) },
    }).select("milestoneId _id");

    let completedMilestones = 0;
    for (const m of milestones) {
      const segs = segments.filter(
        (s) => String(s.milestoneId) === String(m._id),
      );
      // Same rule as studentController: only count when the milestone has
      // segments AND every one of them is in this student's completed set
      if (
        segs.length > 0 &&
        segs.every((s) => completedSet.has(String(s._id)))
      ) {
        completedMilestones += 1;
      }
    }

    const milestoneProgress =
      milestones.length > 0
        ? Math.round((completedMilestones / milestones.length) * 100)
        : 0;

    const soloScores = [];
    let gradedSoloCount = 0;
    for (const solo of solos) {
      const sub = solo.submissions?.find(
        (s) =>
          s.studentId.toString() === student._id.toString() &&
          s.status === "graded",
      );
      if (sub) {
        gradedSoloCount += 1;
        soloScores.push(sub.scorePercentage ?? sub.totalScore ?? 0);
      }
    }
    const soloAverage =
      soloScores.length > 0
        ? Math.round(soloScores.reduce((a, b) => a + b, 0) / soloScores.length)
        : 0;

    const assessmentScores = [];
    for (const a of assessments) {
      const attempt = a.attempts?.find(
        (att) =>
          att.studentId.toString() === student._id.toString() &&
          att.status === "completed",
      );
      if (attempt && typeof attempt.scorePercentage === "number") {
        assessmentScores.push(attempt.scorePercentage);
      }
    }
    const assessmentAverage =
      assessmentScores.length > 0
        ? Math.round(
            assessmentScores.reduce((a, b) => a + b, 0) /
              assessmentScores.length,
          )
        : 0;

    const assessmentsCompleted = assessmentScores.length;
    const totalAssessments = assessments.length;
    const totalSolos = solos.length;

    let attendancePct = 0;
    if (settings.minAttendancePct > 0 && attendanceRecords.length > 0) {
      const present = attendanceRecords.filter(
        (r) => r.status === "present" || r.status === "late",
      ).length;
      attendancePct = Math.round((present / attendanceRecords.length) * 100);
    }

    const eligible =
      milestoneProgress >= settings.minMilestoneProgress &&
      soloAverage >= settings.minSoloAverage &&
      assessmentAverage >= settings.minAssessmentAverage &&
      (!settings.mustCompleteAllAssessments ||
        assessmentsCompleted === totalAssessments) &&
      (!settings.requireAllSolosGraded || gradedSoloCount === totalSolos) &&
      (settings.minAttendancePct <= 0 ||
        attendancePct >= settings.minAttendancePct) &&
      ["enrolled", "active"].includes(student.status);

    res.status(200).json({
      studentId: student._id,
      fullName: student.fullName,
      courseTitle: cohort.courseId.title,
      eligible,
      metrics: {
        milestoneProgress,
        soloAverage,
        assessmentAverage,
        assessmentsCompleted,
        totalAssessments,
        gradedSoloCount,
        totalSolos,
        attendancePct,
        status: student.status,
      },
      criteria: {
        minMilestoneProgress: settings.minMilestoneProgress,
        minSoloAverage: settings.minSoloAverage,
        minAssessmentAverage: settings.minAssessmentAverage,
        mustCompleteAllAssessments: settings.mustCompleteAllAssessments,
        requireAllSolosGraded: settings.requireAllSolosGraded,
        minAttendancePct: settings.minAttendancePct,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to evaluate eligibility." });
  }
};

export const graduateStudent = async (req, res) => {
  try {
    const force = Boolean(req.body?.force);

    const student = await User.findById(req.params.studentId);
    if (!student || student.role !== "student") {
      return res.status(404).json({ message: "Student not found." });
    }

    if (student.status === "graduated") {
      // already graduated – return existing certificate if present
      const existing = await Certificate.findOne({
        studentId: student._id,
        status: "issued",
      }).sort({ issuedAt: -1 });

      return res.status(200).json({
        message: "Student is already graduated.",
        student: {
          id: student._id,
          fullName: student.fullName,
          status: student.status,
          graduatedAt: student.graduatedAt,
        },
        certificateNumber: existing?.certificateNumber || null,
        certificate: existing || null,
      });
    }

    const cohort = await Cohort.findById(student.cohortId).populate("courseId");
    if (!cohort) {
      return res.status(400).json({ message: "Student has no valid cohort." });
    }

    // ── Eligibility check (skip when force=true) ──────────────────────────
    if (!force) {
      // Re-use the same logic as evaluateGraduationEligibility
      const courseId = cohort.courseId?._id || cohort.courseId;

      let settings = await GraduationSettings.findOne({ courseId });
      if (!settings) {
        settings = await GraduationSettings.findOne({ courseId: null });
      }
      if (!settings) {
        settings = {
          minMilestoneProgress: 100,
          minSoloAverage: 60,
          minAssessmentAverage: 60,
          mustCompleteAllAssessments: true,
          requireAllSolosGraded: false,
          minAttendancePct: 0,
        };
      }

      const [milestones, solos, assessments, attendanceRecords] =
        await Promise.all([
          Milestone.find({ courseId }).sort({ order: 1 }),
          Solo.find({ courseId }),
          Assessment.find({ courseId }),
          settings.minAttendancePct > 0
            ? Attendance.find({
                studentId: student._id,
                cohortId: student.cohortId,
              })
            : Promise.resolve([]),
        ]);

      const progress = await StudentProgress.findOne({
        studentId: student._id,
        courseId,
      });

      const completedSet = new Set(
        (progress?.completedSegmentIds || []).map((id) => String(id)),
      );

      const segments = await Segment.find({
        milestoneId: { $in: milestones.map((m) => m._id) },
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

      const milestoneProgress =
        milestones.length > 0
          ? Math.round((completedMilestones / milestones.length) * 100)
          : 0;

      const soloScores = [];
      let gradedSoloCount = 0;
      for (const solo of solos) {
        const sub = solo.submissions?.find(
          (s) =>
            s.studentId.toString() === student._id.toString() &&
            s.status === "graded",
        );
        if (sub) {
          gradedSoloCount += 1;
          soloScores.push(sub.scorePercentage ?? sub.totalScore ?? 0);
        }
      }
      const soloAverage =
        soloScores.length > 0
          ? Math.round(
              soloScores.reduce((a, b) => a + b, 0) / soloScores.length,
            )
          : 0;

      const assessmentScores = [];
      for (const a of assessments) {
        const attempt = a.attempts?.find(
          (att) =>
            att.studentId.toString() === student._id.toString() &&
            att.status === "completed",
        );
        if (attempt && typeof attempt.scorePercentage === "number") {
          assessmentScores.push(attempt.scorePercentage);
        }
      }
      const assessmentAverage =
        assessmentScores.length > 0
          ? Math.round(
              assessmentScores.reduce((a, b) => a + b, 0) /
                assessmentScores.length,
            )
          : 0;

      const assessmentsCompleted = assessmentScores.length;
      const totalAssessments = assessments.length;
      const totalSolos = solos.length;

      let attendancePct = 0;
      if (settings.minAttendancePct > 0 && attendanceRecords.length > 0) {
        const present = attendanceRecords.filter(
          (r) => r.status === "present" || r.status === "late",
        ).length;
        attendancePct = Math.round((present / attendanceRecords.length) * 100);
      }

      const eligible =
        milestoneProgress >= settings.minMilestoneProgress &&
        soloAverage >= settings.minSoloAverage &&
        assessmentAverage >= settings.minAssessmentAverage &&
        (!settings.mustCompleteAllAssessments ||
          assessmentsCompleted === totalAssessments) &&
        (!settings.requireAllSolosGraded || gradedSoloCount === totalSolos) &&
        (settings.minAttendancePct <= 0 ||
          attendancePct >= settings.minAttendancePct) &&
        ["enrolled", "active"].includes(student.status);

      if (!eligible) {
        return res.status(400).json({
          message:
            "Student does not meet graduation criteria. Use force=true to override.",
          eligible: false,
        });
      }
    }

    // ── Build metrics snapshot (always) ───────────────────────────────────
    const courseId = cohort.courseId?._id || cohort.courseId;

    const [milestones, solos, assessments, attendanceRecords] =
      await Promise.all([
        Milestone.find({ courseId }).sort({ order: 1 }),
        Solo.find({ courseId }),
        Assessment.find({ courseId }),
        Attendance.find({
          studentId: student._id,
          cohortId: student.cohortId,
        }),
      ]);

    const progress = await StudentProgress.findOne({
      studentId: student._id,
      courseId,
    });

    const completedSet = new Set(
      (progress?.completedSegmentIds || []).map((id) => String(id)),
    );

    const segments = await Segment.find({
      milestoneId: { $in: milestones.map((m) => m._id) },
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

    const milestoneProgress =
      milestones.length > 0
        ? Math.round((completedMilestones / milestones.length) * 100)
        : 0;

    const soloScores = [];
    for (const solo of solos) {
      const sub = solo.submissions?.find(
        (s) =>
          s.studentId.toString() === student._id.toString() &&
          s.status === "graded",
      );
      if (sub) {
        soloScores.push(sub.scorePercentage ?? sub.totalScore ?? 0);
      }
    }
    const bestSoloScore = soloScores.length > 0 ? Math.max(...soloScores) : 0;
    const soloAverage =
      soloScores.length > 0
        ? Math.round(soloScores.reduce((a, b) => a + b, 0) / soloScores.length)
        : 0;

    const assessmentScores = [];
    for (const a of assessments) {
      const attempt = a.attempts?.find(
        (att) =>
          att.studentId.toString() === student._id.toString() &&
          att.status === "completed",
      );
      if (attempt && typeof attempt.scorePercentage === "number") {
        assessmentScores.push(attempt.scorePercentage);
      }
    }
    const assessmentAverage =
      assessmentScores.length > 0
        ? Math.round(
            assessmentScores.reduce((a, b) => a + b, 0) /
              assessmentScores.length,
          )
        : 0;

    let attendancePct = 0;
    if (attendanceRecords.length > 0) {
      const present = attendanceRecords.filter(
        (r) => r.status === "present" || r.status === "late",
      ).length;
      attendancePct = Math.round((present / attendanceRecords.length) * 100);
    }

    const certNumber = `CHEZA-${new Date().getFullYear()}-${student._id
      .toString()
      .slice(-6)
      .toUpperCase()}`;

    const certificate = await Certificate.findOneAndUpdate(
      { studentId: student._id, cohortId: cohort._id },
      {
        studentId: student._id,
        cohortId: cohort._id,
        certificateNumber: certNumber,
        studentName: student.fullName,
        courseTitle: cohort.courseId?.title || "Course",
        cohortName: cohort.name,
        metrics: {
          progress: milestoneProgress,
          attendancePct,
          bestSoloScore,
          soloAverage,
          assessmentAverage,
        },
        issuedByAdminId: req.adminId,
        issuedAt: new Date(),
        status: "issued",
        forceGraduated: force,
      },
      { upsert: true, new: true },
    );

    student.status = "graduated";
    student.graduatedAt = new Date();
    await student.save();

    await Notification.create({
      studentId: student._id,
      cohortId: student.cohortId,
      sender: "Administration",
      message: force
        ? "You have been graduated by an administrator."
        : "Congratulations! You have successfully graduated.",
      type: "system",
      bgColor: "bg-green-500",
    });

    res.status(200).json({
      message: force
        ? "Student force-graduated and certificate issued."
        : "Student graduated and certificate issued.",
      student: {
        id: student._id,
        fullName: student.fullName,
        status: student.status,
        graduatedAt: student.graduatedAt,
      },
      certificateNumber: certNumber,
      certificate,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to graduate student." });
  }
};

export const getStudentCertificate = async (req, res) => {
  try {
    const cert = await Certificate.findOne({
      studentId: req.params.studentId,
      status: "issued",
    })
      .populate("cohortId", "name code")
      .populate("issuedByAdminId", "name email")
      .sort({ issuedAt: -1 });

    if (!cert) {
      return res.status(404).json({ message: "No certificate found." });
    }

    res.status(200).json({ certificate: cert });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch certificate." });
  }
};

export const getCourseById = async (req, res) => {
  try {
    const course = await Course.findById(req.params.courseId);
    if (!course) return res.status(404).json({ message: "Course not found." });

    const [milestones, solos, assessments] = await Promise.all([
      Milestone.find({ courseId: course._id }).sort({ order: 1 }),
      Solo.find({ courseId: course._id }).sort({ order: 1 }),
      Assessment.find({ courseId: course._id }).sort({ order: 1 }),
    ]);

    const milestoneIds = milestones.map((m) => m._id);
    const segmentCounts = await Segment.aggregate([
      { $match: { milestoneId: { $in: milestoneIds } } },
      { $group: { _id: "$milestoneId", count: { $sum: 1 } } },
    ]);
    const countMap = Object.fromEntries(
      segmentCounts.map((s) => [s._id.toString(), s.count]),
    );

    const milestonesWithCounts = milestones.map((m) => ({
      ...m.toObject(),
      segmentsCount: countMap[m._id.toString()] || 0,
    }));

    res.status(200).json({
      course,
      milestones: milestonesWithCounts,
      solos,
      assessments,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch course." });
  }
};

// GET /admin/milestones/:milestoneId
export const getMilestoneById = async (req, res) => {
  try {
    const milestone = await Milestone.findById(req.params.milestoneId).populate(
      "soloId",
      "title",
    );
    if (!milestone) {
      return res.status(404).json({ message: "Milestone not found." });
    }

    const segments = await Segment.find({ milestoneId: milestone._id }).sort({
      order: 1,
    });

    res.status(200).json({ milestone, segments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch milestone." });
  }
};

// POST /admin/segments
export const createSegment = async (req, res) => {
  try {
    const { milestoneId, title, order, pages } = req.body;
    if (!milestoneId || !title) {
      return res
        .status(400)
        .json({ message: "milestoneId and title are required." });
    }

    const milestone = await Milestone.findById(milestoneId);
    if (!milestone) {
      return res.status(404).json({ message: "Milestone not found." });
    }

    const segment = await Segment.create({
      courseId: milestone.courseId,
      milestoneId,
      title,
      order: order ?? 0,
      pages: pages || [],
    });

    res.status(201).json({ message: "Segment created.", segment });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create segment." });
  }
};

// GET /admin/segments/:segmentId
export const getSegmentById = async (req, res) => {
  try {
    const segment = await Segment.findById(req.params.segmentId);
    if (!segment) {
      return res.status(404).json({ message: "Segment not found." });
    }
    res.status(200).json({ segment });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch segment." });
  }
};

// PATCH /admin/segments/:segmentId  — title, order, or full pages[]
export const updateSegment = async (req, res) => {
  try {
    const { title, order, pages } = req.body;
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (order !== undefined) updates.order = order;
    if (pages !== undefined) updates.pages = pages;

    const segment = await Segment.findByIdAndUpdate(
      req.params.segmentId,
      updates,
      { new: true },
    );
    if (!segment) {
      return res.status(404).json({ message: "Segment not found." });
    }
    res.status(200).json({ message: "Segment updated.", segment });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update segment." });
  }
};

export const deleteSegment = async (req, res) => {
  try {
    const segment = await Segment.findByIdAndDelete(req.params.segmentId);
    if (!segment) {
      return res.status(404).json({ message: "Segment not found." });
    }
    res.status(200).json({ message: "Segment deleted." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete segment." });
  }
};

export const updateCohortSchedule = async (req, res) => {
  try {
    const { scheduleSlots, timezone } = req.body;
    if (!Array.isArray(scheduleSlots)) {
      return res.status(400).json({ message: "scheduleSlots array required." });
    }

    for (const s of scheduleSlots) {
      if (s.dayOfWeek === undefined || !s.startTime || !s.endTime) {
        return res.status(400).json({
          message: "Each slot needs dayOfWeek, startTime, endTime.",
        });
      }
    }

    const cohort = await Cohort.findByIdAndUpdate(
      req.params.cohortId,
      {
        scheduleSlots,
        ...(timezone ? { timezone } : {}),
      },
      { new: true },
    );

    if (!cohort) return res.status(404).json({ message: "Cohort not found." });

    res.status(200).json({ message: "Schedule updated.", cohort });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update schedule." });
  }
};

export const generateClassSessions = async (req, res) => {
  try {
    const { replaceExisting = false } = req.body || {};
    const cohort = await Cohort.findById(req.params.cohortId);

    if (!cohort) return res.status(404).json({ message: "Cohort not found." });
    if (!cohort.startDate) {
      return res.status(400).json({ message: "Cohort needs a startDate." });
    }
    if (!cohort.scheduleSlots?.length) {
      return res.status(400).json({
        message: "Add schedule slots before generating classes.",
      });
    }

    if (replaceExisting) {
      await ClassSession.deleteMany({
        cohortId: cohort._id,
        generatedFromSchedule: true,
        status: "scheduled",
      });
    }

    const expanded = expandScheduleSlots({
      startDate: cohort.startDate,
      endDate: cohort.endDate,
      scheduleSlots: cohort.scheduleSlots,
    });

    let courseName;
    if (cohort.courseId) {
      const course = await Course.findById(cohort.courseId).select("title");
      courseName = course?.title;
    }

    let created = 0;
    let skipped = 0;

    for (const s of expanded) {
      try {
        await ClassSession.create({
          title: s.title,
          cohortId: cohort._id,
          courseId: cohort.courseId || undefined,
          courseName,
          date: s.date,
          startTime: s.startTime,
          endTime: s.endTime,
          status: "scheduled",
          instructorId: cohort.instructorId || undefined,
          generatedFromSchedule: true,
        });
        created += 1;
      } catch (e) {
        if (e?.code === 11000) skipped += 1;
        else throw e;
      }
    }

    res.status(201).json({
      message: `Generated ${created} class session(s). ${skipped} skipped (already exist).`,
      created,
      skipped,
      totalExpanded: expanded.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to generate class sessions." });
  }
};

export const getClassSessions = async (req, res) => {
  try {
    const { cohortId, from, to, status } = req.query;
    const filter = {};

    if (cohortId) filter.cohortId = cohortId;
    if (status) filter.status = status;

    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = new Date(from);
      if (to) filter.date.$lte = new Date(to);
    }

    const sessions = await ClassSession.find(filter)
      .populate("cohortId", "name code")
      .populate("courseId", "title slug")
      .populate("instructorId", "fullName email")
      .sort({ date: 1 });

    res.status(200).json({ sessions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch class sessions." });
  }
};

export const getClassSessionById = async (req, res) => {
  try {
    const session = await ClassSession.findById(req.params.sessionId)
      .populate("cohortId", "name code")
      .populate("courseId", "title")
      .populate("instructorId", "fullName email");

    if (!session) {
      return res.status(404).json({ message: "Class session not found." });
    }

    // If you don't have Attendance model yet:
    res.status(200).json({ session, attendance: [] });

    // When Attendance exists:
    // const attendance = await Attendance.find({ classSessionId: session._id })
    //   .populate("studentId", "fullName email");
    // res.status(200).json({ session, attendance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch session." });
  }
};

// ── Get solo by id
export const getSoloById = async (req, res) => {
  try {
    const solo = await Solo.findById(req.params.soloId).populate(
      "courseId",
      "title slug",
    );
    if (!solo) return res.status(404).json({ message: "Solo not found." });
    res.status(200).json({ solo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch solo." });
  }
};

// ── Update solo
export const updateSolo = async (req, res) => {
  try {
    const allowed = [
      "title",
      "description",
      "dueDate",
      "order",
      "isLocked",
      "timeToComplete",
      "overview",
      "goal",
      "techStack",
      "architecture",
      "milestoneId",
    ];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates[key] =
          key === "dueDate" && req.body[key]
            ? new Date(req.body[key])
            : req.body[key];
      }
    }

    const solo = await Solo.findByIdAndUpdate(req.params.soloId, updates, {
      new: true,
    }).populate("courseId", "title slug");

    if (!solo) return res.status(404).json({ message: "Solo not found." });
    res.status(200).json({ message: "Solo updated.", solo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update solo." });
  }
};

// ── Update assessment
export const updateAssessment = async (req, res) => {
  try {
    const allowed = [
      "title",
      "description",
      "durationMinutes",
      "order",
      "isLocked",
      "questions",
    ];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const assessment = await Assessment.findByIdAndUpdate(
      req.params.assessmentId,
      updates,
      { new: true },
    ).populate("courseId", "title slug");

    if (!assessment) {
      return res.status(404).json({ message: "Assessment not found." });
    }
    res.status(200).json({ message: "Assessment updated.", assessment });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update assessment." });
  }
};

export const deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    if (user.deletedAt) {
      return res.status(400).json({ message: "User is already deleted." });
    }

    if (user.role === "instructor") {
      const owned = await Cohort.find({ instructorId: user._id }).select("_id");
      for (const c of owned) {
        await Cohort.findByIdAndUpdate(c._id, { instructorId: null });
      }
      user.cohortIds = [];
      user.cohortId = undefined;
    }

    // Soft delete — keep row for accountability; block login via deletedAt check
    user.deletedAt = new Date();
    user.deletedByAdminId = req.adminId || null;
    user.deletedEmail = user.email;
    user.deletedFullName = user.fullName;
    user.status = "suspended";
    // Invalidate credentials without exposing password
    user.passwordHash = await bcrypt.hash(
      `deleted-${user._id}-${Date.now()}`,
      10,
    );
    // Free email so a new user can be provisioned with same address
    user.email = `deleted+${user._id}@deleted.local`;
    await user.save();

    res.status(200).json({
      message: "User permanently deactivated and archived.",
      deleted: {
        id: user._id,
        fullName: user.deletedFullName,
        email: user.deletedEmail,
        role: user.role,
        deletedAt: user.deletedAt,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete user." });
  }
};

export const getDeletedUsers = async (req, res) => {
  try {
    const users = await User.find({ deletedAt: { $ne: null } })
      .select(
        "deletedFullName deletedEmail role deletedAt deletedByAdminId createdAt",
      )
      .populate("deletedByAdminId", "name email")
      .sort({ deletedAt: -1 })
      .limit(100);

    res.status(200).json({
      users: users.map((u) => ({
        id: u._id,
        fullName: u.deletedFullName || "—",
        email: u.deletedEmail || "—",
        role: u.role,
        deletedAt: u.deletedAt,
        deletedBy: u.deletedByAdminId
          ? {
              name: u.deletedByAdminId.name,
              email: u.deletedByAdminId.email,
            }
          : null,
        createdAt: u.createdAt,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch deleted users." });
  }
};

export const adminListBadges = async (req, res) => {
  try {
    const badges = await BadgeDefinition.find().sort({ order: 1 }).lean();
    res.status(200).json({
      badges: badges.map((b) => ({
        id: b._id.toString(),
        key: b.key,
        name: b.name,
        imageUrl: b.imageUrl || null,
        color: b.color,
        accentHex: b.accentHex,
        description: b.description,
        order: b.order,
        rules: b.rules || {},
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to list badges." });
  }
};

/**
 * POST /api/admin/badges
 * body: { name, key?, imageUrl, description?, color?, accentHex?, order?, rules? }
 * imageUrl: data:image/... from computer OR /path under public
 */
export const adminCreateBadge = async (req, res) => {
  try {
    const { name, key, imageUrl, description, color, accentHex, order, rules } =
      req.body;

    if (!name?.trim()) {
      return res
        .status(400)
        .json({ message: "Badge name (title) is required." });
    }

    const cleanName = name.trim();
    const badgeKey =
      (key && String(key).trim().toLowerCase().replace(/\s+/g, "-")) ||
      cleanName
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");

    if (!badgeKey) {
      return res.status(400).json({ message: "Could not derive a badge key." });
    }

    let cleanImage = null;
    if (imageUrl && typeof imageUrl === "string") {
      const s = imageUrl.trim();
      const isData = s.startsWith("data:image/");
      const isLocal =
        s.startsWith("/") && !s.startsWith("//") && !s.includes("://");
      if (!isData && !isLocal) {
        return res.status(400).json({
          message: "Image must be from computer (data URL) or a local path.",
        });
      }
      if (isData && s.length > 7 * 1024 * 1024) {
        return res
          .status(400)
          .json({ message: "Image too large (max ~5 MB)." });
      }
      cleanImage = s;
    }

    const existing = await BadgeDefinition.findOne({ key: badgeKey });
    if (existing) {
      return res
        .status(409)
        .json({ message: "A badge with this key already exists." });
    }

    const badge = await BadgeDefinition.create({
      key: badgeKey,
      name: cleanName,
      imageUrl: cleanImage,
      description: description?.trim() || "",
      color: color || "bg-amber-100 text-amber-600",
      accentHex: accentHex || "#F7B631",
      order: typeof order === "number" ? order : 0,
      rules: {
        minAttendancePercent: rules?.minAttendancePercent ?? 0,
        minSoloAvg: rules?.minSoloAvg ?? 0,
        minAssessmentAvg: rules?.minAssessmentAvg ?? 0,
        minActivityScore: rules?.minActivityScore ?? 0,
      },
    });

    res.status(201).json({
      message: "Badge created.",
      badge: {
        id: badge._id.toString(),
        key: badge.key,
        name: badge.name,
        imageUrl: badge.imageUrl,
        description: badge.description,
        order: badge.order,
        rules: badge.rules,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create badge." });
  }
};

export const adminUpdateBadge = async (req, res) => {
  try {
    const { badgeId } = req.params;
    const badge = await BadgeDefinition.findById(badgeId);
    if (!badge) {
      return res.status(404).json({ message: "Badge not found." });
    }

    const { name, imageUrl, description, color, accentHex, order, rules } =
      req.body;

    if (name?.trim()) badge.name = name.trim();
    if (typeof description === "string") badge.description = description.trim();
    if (color) badge.color = color;
    if (accentHex) badge.accentHex = accentHex;
    if (typeof order === "number") badge.order = order;

    if (imageUrl !== undefined) {
      if (imageUrl === null || imageUrl === "") {
        badge.imageUrl = null;
      } else {
        const s = String(imageUrl).trim();
        const isData = s.startsWith("data:image/");
        const isLocal =
          s.startsWith("/") && !s.startsWith("//") && !s.includes("://");
        if (!isData && !isLocal) {
          return res.status(400).json({
            message: "Image must be from computer or a local path.",
          });
        }
        badge.imageUrl = s;
      }
    }

    if (rules && typeof rules === "object") {
      badge.rules = {
        minAttendancePercent:
          rules.minAttendancePercent ?? badge.rules?.minAttendancePercent ?? 0,
        minSoloAvg: rules.minSoloAvg ?? badge.rules?.minSoloAvg ?? 0,
        minAssessmentAvg:
          rules.minAssessmentAvg ?? badge.rules?.minAssessmentAvg ?? 0,
        minActivityScore:
          rules.minActivityScore ?? badge.rules?.minActivityScore ?? 0,
      };
    }

    await badge.save();

    res.status(200).json({
      message: "Badge updated.",
      badge: {
        id: badge._id.toString(),
        key: badge.key,
        name: badge.name,
        imageUrl: badge.imageUrl,
        description: badge.description,
        order: badge.order,
        rules: badge.rules,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update badge." });
  }
};

export const adminDeleteBadge = async (req, res) => {
  try {
    const { badgeId } = req.params;
    const badge = await BadgeDefinition.findByIdAndDelete(badgeId);
    if (!badge) {
      return res.status(404).json({ message: "Badge not found." });
    }
    // Optional: remove awards of this badge
    await StudentBadge.deleteMany({ badgeKey: badge.key });
    res.status(200).json({ message: "Badge deleted." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete badge." });
  }
};
