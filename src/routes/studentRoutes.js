import { Router } from "express";
import { requireUserAuth } from "../middleware/userAuth.js";
import {
  getStudentMilestones,
  getStudentSolos,
  submitSolo,
  getRecordedSessions,
  getPendingAlerts,
  getStudentAssessments,
  getStudentAssessmentById,
  submitAssessment,
  getStudentNotifications,
  clearStudentNotifications,
  getStudentSchedule,
  getStudentChallenges,
  getStudentAttendance,
  getStudentBadges,
  getStudentDashboard,
  getStudentMilestoneById,
  getStudentSegmentById,
  completeStudentSegment,
  getStudentSoloById,
  updateStudentIdPhoto, 
  // setStudentAdmissionNumber, 
} from "../controllers/studentController.js";

const router = Router();
router.use(requireUserAuth);

router.get("/milestones", getStudentMilestones);
router.get("/milestones/:milestoneId", getStudentMilestoneById);
router.get(
  "/milestones/:milestoneId/segments/:segmentId",
  getStudentSegmentById,
);
router.post(
  "/milestones/:milestoneId/segments/:segmentId/complete",
  requireUserAuth,
  completeStudentSegment,
);

router.get("/solos", getStudentSolos);
router.post("/solos/:soloId/submit", submitSolo);
router.get("/solos/:soloId", getStudentSoloById);

router.get("/recorded-sessions", getRecordedSessions);
router.get("/alerts/pending", getPendingAlerts);

router.get("/assessments", getStudentAssessments);
router.get("/assessments/:assessmentId", getStudentAssessmentById);
router.post("/assessments/:assessmentId/submit", submitAssessment);

router.get("/dashboard", getStudentDashboard);
router.get("/notifications", getStudentNotifications);
router.post("/notifications/clear", clearStudentNotifications);
router.get("/schedule", getStudentSchedule);
router.get("/challenges", getStudentChallenges);
router.get("/attendance", getStudentAttendance);
router.get("/badges", getStudentBadges);

// ── Student ID card ──────────────────────────────────────────
router.patch("/id-photo", updateStudentIdPhoto);
// router.patch("/admission-number", setStudentAdmissionNumber);

export default router;
