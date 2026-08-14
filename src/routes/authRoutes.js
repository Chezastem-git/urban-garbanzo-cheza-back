// src/routes/authRoutes.js
import { Router } from "express";
import {
  login,
  getMyProfile,
  changeMyPassword,
  updateMyAvatar,
} from "../controllers/authController.js";
import { requireUserAuth } from "../middleware/userAuth.js";

const router = Router();

// Public
router.post("/login", login);

// Protected (student or instructor)
router.get("/me", requireUserAuth, getMyProfile);
router.patch("/me/password", requireUserAuth, changeMyPassword);
router.patch("/me/avatar", requireUserAuth, updateMyAvatar);

export default router;
