// src/routed/adminRoutes.js
import { Router } from "express";
import {
  registerAdmin,
  adminLogin,
  createCohort,
  provisionUser,
} from "../controllers/adminController.js";
import { requireAdmin } from "../middleware/adminAuth.js";


const router = Router();

// Public Admin Bootstrapping & Auth
router.post("/setup", registerAdmin);
router.post("/login", adminLogin);

// Protected Admin Actions
router.post("/cohorts", requireAdmin, createCohort);
router.post("/users/provision", requireAdmin, provisionUser);

export default router;