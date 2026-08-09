// src/controllers/authController.js
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Cohort from "../models/Cohort.js"; // only needed if you validate cohort code

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
    // Keep this if your product still requires cohort on student login.
    if (user.role === "student" && cohort) {
      const cohortCode = cohort.trim().toLowerCase();
      const userCohortCode =
        user.cohortId?.code?.toLowerCase?.() ||
        user.cohortId?.name?.toLowerCase?.();

      // If the user has a cohort and the provided code doesn't match, reject
      if (user.cohortId && userCohortCode && userCohortCode !== cohortCode) {
        // Also try matching by name with hyphens → spaces
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

    return res.status(200).json({
      token,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role, // "student" | "instructor"
        status: user.status,
        cohort: user.cohortId,
      },
    });
  } catch (error) {
    console.error("Login Controller Error:", error);
    return res
      .status(500)
      .json({ message: "Authentication failed.", error: error.message });
  }
};
