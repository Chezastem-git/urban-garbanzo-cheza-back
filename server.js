import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import connectDB  from "./src/config/db.js";
import verifyApiHandshake  from "./src/middleware/apiHandshake.js";
import adminRoutes from "./src/routes/adminRoutes.js";
import authRoutes from "./src/routes/authRoutes.js";

dotenv.config();

const app = express();

// 1. Fundamental Middlewares
app.use(cors({ origin: process.env.CLIENT_URL || "*", credentials: true }));

// Express JSON body parser MUST execute BEFORE verifyApiHandshake so req.body exists for signature verification
app.use(express.json());

// 2. Global Security Handshake Middleware
app.use(verifyApiHandshake);

// 3. API Routes

app.use("/api/admin", adminRoutes);
app.use("/api/auth", authRoutes);


// Healthcheck
app.get("/api/health", (_req, res) => {
  res
    .status(200)
    .json({ status: "healthy", timestamp: new Date().toISOString() });
});

// 4. Start Server
const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`[Cheza Backend] Server running on http://localhost:${PORT}`);
  });
});
