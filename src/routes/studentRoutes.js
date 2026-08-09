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
} from "../controllers/studentController.js";

const router = Router();
router.use(requireUserAuth);

router.get("/milestones", getStudentMilestones);

router.get("/solos", getStudentSolos);
router.post("/solos/:soloId/submit", submitSolo);

router.get("/recorded-sessions", getRecordedSessions);
router.get("/alerts/pending", getPendingAlerts);

router.get("/assessments", getStudentAssessments);
router.get("/assessments/:assessmentId", getStudentAssessmentById);
router.post("/assessments/:assessmentId/submit", submitAssessment);

export default router;
