import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required." });
    }

    // Find user by lowercase email and populate cohort details
    const user = await User.findOne({ email: email.toLowerCase() }).populate(
      "cohortId",
    );

    if (!user) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    if (user.status === "suspended") {
      return res.status(403).json({
        message: "Your account is suspended. Contact administration.",
      });
    }

    if (!user.passwordHash) {
      return res
        .status(500)
        .json({ message: "User password record is corrupted." });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const token = jwt.sign(
      { userId: user._id, role: user.role, status: user.status },
      process.env.JWT_SECRET || "fallback_secret",
      { expiresIn: "7d" },
    );

    return res.status(200).json({
      token,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        status: user.status,
        cohort: user.cohortId,
      },
    });
  } catch (error) {
    console.error("Login Controller Error:", error);
    return res
      .status(500)
      .json({ message: "Authentication failed.", error: error.message });
  }
};
