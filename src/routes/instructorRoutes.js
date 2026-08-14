// src/routes/instructorRoutes.js

import { Router } from "express";
import { requireUserAuth } from "../middleware/userAuth.js";
import {
  getInstructorAssessments,
  getInstructorAssessmentById,
  getInstructorCohorts,
  getInstructorCohortBySlug,
  getInstructorStudentDetail,
  sendStudentNotification,
  getInstructorDashboard,
  getInstructorSoloSubmissions,
  gradeSoloSubmission,
  getInstructorCourses,
  getInstructorCourseById,
  getInstructorSolos,
  getInstructorSoloById,
  getStudentNotificationsForInstructor,
  getInstructorSchedule,
  createStudentChallenge,
  getStudentChallengesForInstructor,
} from "../controllers/instructorController.js";
import {
  getInstructorSessions,
  markSessionAttendance,
} from "../controllers/classSessionController.js";

const router = Router();
router.use(requireUserAuth);

router.get("/dashboard", getInstructorDashboard);
router.get("/schedule", getInstructorSchedule);

// ── Solos: static paths BEFORE :soloId ───────────────────────────────
router.get("/solos", getInstructorSolos);
router.get("/solos/submissions", getInstructorSoloSubmissions);
router.post(
  "/solos/:soloId/submissions/:submissionId/grade",
  gradeSoloSubmission,
);
router.get("/solos/:soloId", getInstructorSoloById);

// ── Per-student: notifications + challenges ──────────────────────────
router.get(
  "/students/:studentId/notifications",
  getStudentNotificationsForInstructor,
);
router.get(
  "/students/:studentId/challenges",
  getStudentChallengesForInstructor,
);
router.post("/students/:studentId/challenges", createStudentChallenge);
router.post("/students/:studentId/notify", sendStudentNotification);

router.get("/courses", getInstructorCourses);
router.get("/courses/:courseId", getInstructorCourseById);

router.get("/sessions", getInstructorSessions);
router.post("/sessions/:sessionId/attendance", markSessionAttendance);

router.get("/assessments", getInstructorAssessments);
router.get("/assessments/:assessmentId", getInstructorAssessmentById);

router.get("/cohorts", getInstructorCohorts);
router.get("/cohorts/:slug", getInstructorCohortBySlug);
router.get("/cohorts/:slug/students/:studentId", getInstructorStudentDetail);

export default router;
