// src/routes/instructorRoutes.js

import { Router } from "express";
import { requireUserAuth } from "../middleware/userAuth.js";
import {
  getInstructorSolos,
  gradeSolo,
  createMilestone,
} from "../controllers/instructorController.js";

const router = Router();
router.use(requireUserAuth);

router.get("/solos", getInstructorSolos);
router.post("/solos/:soloId/submissions/:submissionId/grade", gradeSolo);
router.post("/milestones", createMilestone);

export default router;
