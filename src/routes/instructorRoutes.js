// src/routes/instructorRoutes.js

import { Router } from "express";
import { requireUserAuth } from "../middleware/userAuth.js";
import {
  // getInstructorSolos,
  // gradeSolo,
  // createMilestone,
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
} from "../controllers/instructorController.js";
import { getInstructorSessions,markSessionAttendance } from "../controllers/classSessionController.js";

const router = Router();
router.use(requireUserAuth);

// router.get("/solos", getInstructorSolos);
// router.post("/solos/:soloId/submissions/:submissionId/grade", gradeSolo);
// router.post("/milestones", createMilestone);

router.get("/solos", getInstructorSolos);
router.get("/solos/:soloId", getInstructorSoloById);

router.get("/dashboard", getInstructorDashboard);

router.get("/solos/submissions", getInstructorSoloSubmissions);
router.post(
  "/solos/:soloId/submissions/:submissionId/grade",
  gradeSoloSubmission,
);

router.get("/courses", getInstructorCourses);
router.get("/courses/:courseId", getInstructorCourseById);

// instructorRoutes.js
router.get("/sessions", getInstructorSessions);
router.post("/sessions/:sessionId/attendance", markSessionAttendance);

router.get("/assessments", getInstructorAssessments);
router.get("/assessments/:assessmentId", getInstructorAssessmentById);

router.get("/cohorts", getInstructorCohorts);
router.get("/cohorts/:slug", getInstructorCohortBySlug);
router.get("/cohorts/:slug/students/:studentId", getInstructorStudentDetail);
router.post("/students/:studentId/notify", sendStudentNotification);

export default router;
