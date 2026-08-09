//src/middleware/adminAuth.js
import jwt from "jsonwebtoken";

export const requireAdmin = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ message: "Unauthorized: Missing Admin Token." });
    return;
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "fallback_secret",
    );

    if (decoded.role !== "admin") {
      res
        .status(403)
        .json({ message: "Forbidden: Admin privileges required." });
      return;
    }

    req.adminId = decoded.adminId;
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired admin session." });
  }
};
