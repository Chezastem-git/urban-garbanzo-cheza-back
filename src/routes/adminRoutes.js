// src/routes/adminRoutes.js
import { Router } from "express";
import {
  registerAdmin,
  adminLogin,
  getAdminDashboard,
  createCohort,
  getAllCohorts,
  getCohortById,
  updateCohort,
  deleteCohort,
  provisionUser,
  getAllUsers,
  getUserById,
  updateUserStatus,
  assignUserToCohort,
  resetUserPassword,
  createMilestone,
  updateMilestone,
  unlockMilestone,
  createSolo,
  createAssessment,
  evaluateGraduationEligibility,
  graduateStudent,
  bulkAssignStudentsToCohort,
} from "../controllers/adminController.js";
import { requireAdmin } from "../middleware/adminAuth.js";

const router = Router();

// ── Public ──────────────────────────────────
router.post("/setup", registerAdmin);
router.post("/login", adminLogin);

// ── Protected ───────────────────────────────
router.use(requireAdmin);

// Dashboard
router.get("/dashboard", getAdminDashboard);

// Cohorts
router.post("/cohorts", createCohort);
router.get("/cohorts", getAllCohorts);
router.get("/cohorts/:cohortId", getCohortById);
router.patch("/cohorts/:cohortId", updateCohort);
router.delete("/cohorts/:cohortId", deleteCohort);

// Users
router.post("/users/provision", provisionUser);
router.get("/users", getAllUsers);
router.get("/users/:userId", getUserById);
router.patch("/users/:userId/status", updateUserStatus);
router.patch("/users/:userId/cohort", assignUserToCohort);
router.patch("/users/:userId/password", resetUserPassword);
router.post("/users/bulk-assign", bulkAssignStudentsToCohort);

// Content
router.post("/milestones", createMilestone);
router.patch("/milestones/:milestoneId", updateMilestone);
router.patch("/milestones/:milestoneId/unlock", unlockMilestone);
router.post("/solos", createSolo);
router.post("/assessments", createAssessment);

// Graduation & Certificates
router.get("/students/:studentId/eligibility", evaluateGraduationEligibility);
router.post("/students/:studentId/graduate", graduateStudent);

export default router;
