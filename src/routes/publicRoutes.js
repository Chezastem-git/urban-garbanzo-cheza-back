// src/routes/publicRoutes.js
import { Router } from "express";
import { getPublicIdCard } from "../controllers/publicController.js";

const router = Router();

router.get("/id-card/:admissionNumber", getPublicIdCard);

export default router;