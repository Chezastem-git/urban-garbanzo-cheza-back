// src/middleware/userAuth.js
import jwt from "jsonwebtoken";

export const requireUserAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ message: "Unauthorized: Missing Session Token." });
    return;
  }

  const token = authHeader.split(" ")[1];
  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    res
      .status(500)
      .json({ message: "Server misconfiguration: JWT secret is missing." });
    return;
  }

  try {
    const decoded = jwt.verify(token, jwtSecret);

    if (
      typeof decoded === "object" &&
      decoded !== null &&
      "userId" in decoded &&
      typeof decoded.userId === "string" &&
      "role" in decoded
    ) {
      const role = decoded.role;
      if (role === "student" || role === "instructor") {
        req.userId = decoded.userId;
        req.role = role;
        next();
        return;
      }
    }

    res.status(401).json({ message: "Invalid or expired user session." });
  } catch {
    res.status(401).json({ message: "Invalid or expired user session." });
  }
};
