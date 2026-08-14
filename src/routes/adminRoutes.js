import {
  registerAdmin,
  adminLogin,
  getAdminDashboard,
  createCourse,
  getAllCourses,
  getCourseById,
  updateCourse,
  deleteCourse,
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
  bulkAssignStudentsToCohort,
  createMilestone,
  updateMilestone,
  unlockMilestone,
  createSolo,
  createAssessment,
  getGraduationSettings,
  updateGraduationSettings,
  evaluateGraduationEligibility,
  graduateStudent,
  getMilestoneById,
  createSegment,
  getSegmentById,
  updateSegment,
  getAllAssessments,
  getAssessmentById,
  deleteSegment,
  updateCohortSchedule,
  generateClassSessions,
  getClassSessions,
  getClassSessionById,
  getSoloById,
  updateSolo,
  updateAssessment,
  repairCohortInstructorLinks,
  deleteUser,
  getDeletedUsers,
  adminListBadges,
  adminCreateBadge,
  adminUpdateBadge,
  adminDeleteBadge
} from "../controllers/adminController.js";
import { requireAdmin } from "../middleware/adminAuth.js";
import { Router } from "express";

const router = Router();

router.post(
  "/repair/cohort-instructors",
  /* requireAdmin, */
  repairCohortInstructorLinks,
);

router.get("/milestones/:milestoneId", getMilestoneById);
router.post("/segments", createSegment);
router.get("/segments/:segmentId", getSegmentById);
router.patch("/segments/:segmentId", updateSegment);
router.delete("/segments/:segmentId", deleteSegment);

// assessments
// router.post("/assessments", createAssessment);
router.get("/assessments", getAllAssessments);
router.get("/assessments/:assessmentId", getAssessmentById);

router.post("/setup", registerAdmin);
router.post("/login", adminLogin);

router.use(requireAdmin);

router.get("/dashboard", getAdminDashboard);

// Courses
router.post("/courses", createCourse);
router.get("/courses", getAllCourses);
router.get("/courses/:courseId", getCourseById);
router.patch("/courses/:courseId", updateCourse);
router.delete("/courses/:courseId", deleteCourse);

// Cohorts
router.post("/cohorts", createCohort);
router.get("/cohorts", getAllCohorts);
router.get("/cohorts/:cohortId", getCohortById);
router.patch("/cohorts/:cohortId", updateCohort);
router.delete("/cohorts/:cohortId", deleteCohort);

router.patch("/cohorts/:cohortId/schedule", updateCohortSchedule);
router.post("/cohorts/:cohortId/sessions/generate", generateClassSessions);
router.get("/class-sessions", getClassSessions);
router.get("/class-sessions/:sessionId", getClassSessionById);

// Users
router.post("/users/provision", provisionUser);
router.get("/users", getAllUsers);

router.get("/users/deleted", getDeletedUsers);
router.delete("/users/:userId", deleteUser);

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
router.patch("/assessments/:assessmentId", updateAssessment);

// Solos
router.get("/solos/:soloId", getSoloById);
router.patch("/solos/:soloId", updateSolo);

// Graduation
router.get("/graduation-settings", getGraduationSettings);
router.put("/graduation-settings", updateGraduationSettings);
router.get("/students/:studentId/eligibility", evaluateGraduationEligibility);
router.post("/students/:studentId/graduate", graduateStudent);

// adminRoutes.js — behind requireAdmin
router.get("/badges", adminListBadges);
router.post("/badges", adminCreateBadge);
router.patch("/badges/:badgeId", adminUpdateBadge);
router.delete("/badges/:badgeId", adminDeleteBadge);

export default router;
