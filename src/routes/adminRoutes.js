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
} from "../controllers/adminController.js";
import { requireAdmin } from "../middleware/adminAuth.js";
import { Router } from "express";

const router = Router();

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

// Graduation
router.get("/graduation-settings", getGraduationSettings);
router.put("/graduation-settings", updateGraduationSettings);
router.get("/students/:studentId/eligibility", evaluateGraduationEligibility);
router.post("/students/:studentId/graduate", graduateStudent);

export default router;
