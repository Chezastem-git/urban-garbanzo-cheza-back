// src/middleware/adminAuth.js
import jwt from "jsonwebtoken";

export const requireAdmin = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "No token provided." });
  }

  try {
    const decoded = jwt.verify(
      header.split(" ")[1],
      process.env.JWT_SECRET || "fallback_secret",
    );
    if (decoded.role !== "admin") {
      return res.status(403).json({ message: "Admin access required." });
    }
    req.adminId = decoded.adminId;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
};
