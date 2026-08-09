// src/controllers/adminController.js
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Admin from "../models/Admin.js";
import User from "../models/User.js";
import Cohort from "../models/Cohort.js";

// Bootstrap initial Admin using ADMIN_INIT_KEY
export const registerAdmin = async (req, res) => {
  try {
    const { name, email, password, adminInitKey } = req.body;

    if (adminInitKey !== process.env.ADMIN_INIT_KEY) {
      res
        .status(403)
        .json({ message: "Forbidden: Invalid admin initialization key." });
      return;
    }

    const existingAdmin = await Admin.findOne({ email: email.toLowerCase() });
    if (existingAdmin) {
      res.status(400).json({ message: "Admin user already exists." });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await Admin.create({ name, email, passwordHash });

    res.status(201).json({
      message: "Admin account registered successfully.",
      adminId: admin._id,
    });
  } catch {
    res.status(500).json({ message: "Internal server error." });
  }
};

// Admin Login
export const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    const admin = await Admin.findOne({ email: email.toLowerCase() });

    if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) {
      res.status(401).json({ message: "Invalid email or password." });
      return;
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
  } catch {
    res.status(500).json({ message: "Login failed." });
  }
};

// Create Cohort
export const createCohort = async (req, res) => {
  try {
    const { name, code, description, startDate } = req.body;

    const existingCohort = await Cohort.findOne({ code: code.toLowerCase() });
    if (existingCohort) {
      res.status(400).json({ message: "Cohort code already exists." });
      return;
    }

    const cohort = await Cohort.create({
      name,
      code,
      description,
      startDate: new Date(startDate),
      createdByAdminId: req.adminId,
    });

    res.status(201).json({ message: "Cohort created successfully.", cohort });
  } catch {
    res.status(500).json({ message: "Failed to create cohort." });
  }
};

// Enroll Student or Employ Instructor
export const provisionUser = async (req, res) => {
  try {
    const { fullName, email, password, role, cohortId } = req.body;

    if (!["student", "instructor"].includes(role)) {
      res
        .status(400)
        .json({ message: "Role must be either 'student' or 'instructor'." });
      return;
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      res
        .status(400)
        .json({ message: "User with this email is already provisioned." });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const status = role === "student" ? "enrolled" : "employed";

    const user = await User.create({
      fullName,
      email,
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
      },
    });
  } catch {
    res.status(500).json({ message: "Failed to provision user." });
  }
};
