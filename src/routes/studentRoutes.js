// src/routes/studentRoutes

import { Router } from "express";
import { requireUserAuth } from "../middleware/userAuth.js";
import {
  getStudentMilestones,
  getStudentSolos,
  submitSolo,
  getRecordedSessions
} from "../controllers/studentController.js";

const router = Router();
router.use(requireUserAuth);

router.get("/milestones", getStudentMilestones);
router.get("/solos", getStudentSolos);
router.post("/solos/:soloId/submit", submitSolo);
router.get("/recorded-sessions", getRecordedSessions);

export default router;