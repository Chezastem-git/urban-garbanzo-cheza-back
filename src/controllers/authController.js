// src/controllers/authController.js
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Cohort from "../models/Cohort.js"; // only needed if you validate cohort code

// ── Helper: decide whether the user must change password ─────────────
function needsPasswordChange(user) {
  // Prefer an explicit flag. Fallbacks for older records.
  if (typeof user.mustChangePassword === "boolean") {
    return user.mustChangePassword;
  }
  if (user.isFirstLogin === true) return true;
  if (user.passwordChanged === false) return true;
  return false;
}

export const login = async (req, res) => {
  try {
    const { email, password, role, cohort } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required." });
    }

    // Optional but recommended: require role from the UI switcher
    if (role && !["student", "instructor"].includes(role)) {
      return res.status(400).json({ message: "Invalid login role." });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).populate(
      "cohortId",
    );

    if (!user) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    if (user.status === "suspended") {
      return res.status(403).json({
        message: "Your account is suspended. Contact administration.",
      });
    }

    if (!user.passwordHash) {
      return res
        .status(500)
        .json({ message: "User password record is corrupted." });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    // --- Role gate: student cannot use instructor login, and vice versa ---
    if (role && user.role !== role) {
      return res.status(403).json({
        message:
          role === "student"
            ? "This account is not a student account. Use Instructor login."
            : "This account is not an instructor account. Use Student login.",
      });
    }

    // --- Student-only: optional cohort check ---
    if (user.role === "student" && cohort) {
      const cohortCode = cohort.trim().toLowerCase();
      const userCohortCode =
        user.cohortId?.code?.toLowerCase?.() ||
        user.cohortId?.name?.toLowerCase?.();

      if (user.cohortId && userCohortCode && userCohortCode !== cohortCode) {
        const normalizedInput = cohortCode.replace(/-/g, " ");
        const normalizedName = (user.cohortId.name || "").toLowerCase();

        if (normalizedName !== normalizedInput) {
          return res.status(401).json({
            message: "Cohort does not match this student account.",
          });
        }
      }
    }

    const token = jwt.sign(
      {
        userId: user._id,
        role: user.role,
        status: user.status,
      },
      process.env.JWT_SECRET || "fallback_secret",
      { expiresIn: "7d" },
    );

    const mustChange = needsPasswordChange(user);

    return res.status(200).json({
      token,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role, // "student" | "instructor"
        status: user.status,
        cohort: user.cohortId,
        mustChangePassword: mustChange, // ← NEW
        avatar: user.avatar || "/default.jpg",
      },
    });
  } catch (error) {
    console.error("Login Controller Error:", error);
    return res
      .status(500)
      .json({ message: "Authentication failed.", error: error.message });
  }
};

// ── Profile (self only) ─────────────────────────────────────────────

export const getMyProfile = async (req, res) => {
  try {
    const user = await User.findById(req.userId)
      .select("-passwordHash -deletedEmail -deletedFullName")
      .populate({
        path: "cohortId",
        select: "name code startDate endDate",
        populate: { path: "courseId", select: "title category" },
      })
      .lean();

    if (!user || user.deletedAt) {
      return res.status(404).json({ message: "User not found." });
    }

    // Never return another user’s data
    if (String(user._id) !== String(req.userId)) {
      return res.status(403).json({ message: "Forbidden." });
    }

    const defaultAvatar = "/default.jpg";

    res.status(200).json({
      id: user._id,
      fullName: user.fullName || user.name || "User",
      email: user.email,
      role: user.role,
      status: user.status,
      avatar: user.avatar || defaultAvatar,
      mustChangePassword: needsPasswordChange(user),
      idPhoto: user.idPhoto || null,
      admissionNumber: user.admissionNumber || null, 
      cohort: user.cohortId
        ? {
            id: user.cohortId._id,
            name: user.cohortId.name,
            code: user.cohortId.code,
            startDate: user.cohortId.startDate,
            endDate: user.cohortId.endDate,
            courseTitle: user.cohortId.courseId?.title || null,
            courseCategory: user.cohortId.courseId?.category || null,
          }
        : null,
      createdAt: user.createdAt,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to load profile." });
  }
};

export const changeMyPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ message: "currentPassword and newPassword are required." });
    }
    if (newPassword.length < 6) {
      return res
        .status(400)
        .json({ message: "New password must be at least 6 characters." });
    }

    const user = await User.findById(req.userId);
    if (!user || user.deletedAt) {
      return res.status(404).json({ message: "User not found." });
    }
    if (String(user._id) !== String(req.userId)) {
      return res.status(403).json({ message: "Forbidden." });
    }

    const match = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!match) {
      return res
        .status(401)
        .json({ message: "Current password is incorrect." });
    }

    // Update password
    user.passwordHash = await bcrypt.hash(newPassword, 10);

    // Clear the force-change flags
    user.mustChangePassword = false;
    user.isFirstLogin = false;
    user.passwordChanged = true;

    await user.save();

    res.status(200).json({
      message: "Password updated successfully.",
      mustChangePassword: false,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to change password." });
  }
};

export const updateMyAvatar = async (req, res) => {
  try {
    const { avatar } = req.body;

    if (!avatar || typeof avatar !== "string" || avatar.trim().length < 3) {
      return res.status(400).json({ message: "A valid image is required." });
    }

    const clean = avatar.trim();

    // ONLY allow:
    // 1. data:image/... (file picked from computer)
    // 2. relative path under /public (e.g. /uploads/avatars/...)
    const isDataUrl = clean.startsWith("data:image/");
    const isLocalPath =
      clean.startsWith("/") &&
      !clean.startsWith("//") &&
      !clean.includes("://");

    if (!isDataUrl && !isLocalPath) {
      return res.status(400).json({
        message:
          "Only images from your computer are allowed. External URLs are not accepted.",
      });
    }

    if (isDataUrl && clean.length > 2.2 * 1024 * 1024) {
      return res
        .status(400)
        .json({ message: "Image too large. Max about 1.5 MB." });
    }

    const user = await User.findByIdAndUpdate(
      req.userId,
      { avatar: clean },
      { new: true },
    ).select("-passwordHash");

    if (!user || user.deletedAt) {
      return res.status(404).json({ message: "User not found." });
    }

    res.status(200).json({
      message: "Avatar updated.",
      avatar: user.avatar,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update avatar." });
  }
};
