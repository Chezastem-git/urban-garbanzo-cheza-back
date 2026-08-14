// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import connectDB from "./src/config/db.js";
import verifyApiHandshake from "./src/middleware/apiHandshake.js";
import adminRoutes from "./src/routes/adminRoutes.js";
import authRoutes from "./src/routes/authRoutes.js";
import studentRoutes from "./src/routes/studentRoutes.js";
import instructorRoutes from "./src/routes/instructorRoutes.js";

import dns from "node:dns";
dns.setServers(["1.1.1.1", "8.8.8.8"]);

dotenv.config();

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL || "*", credentials: true }));

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

// app.use(verifyApiHandshake);

// 3. API Routes
app.use("/api/admin", adminRoutes);
app.use("/api/auth", authRoutes);

app.use("/api/student", studentRoutes);
app.use("/api/instructor", instructorRoutes);

app.get("/api/health", (_req, res) => {
  res
    .status(200)
    .json({ status: "healthy", timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`[Cheza Backend] Server running on http://localhost:${PORT}`);
  });
});
