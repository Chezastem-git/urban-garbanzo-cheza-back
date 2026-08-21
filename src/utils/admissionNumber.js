// utils/admissionNumber.js
import User from "../models/User.js";

export async function generateUniqueAdmissionNumber() {
  const year = new Date().getFullYear();
  let attempts = 0;

  while (attempts < 20) {
    // Example format: CSE-2026-A7K9M2
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    const candidate = `CSE-${year}-${random}`;

    const exists = await User.exists({ admissionNumber: candidate });
    if (!exists) return candidate;

    attempts++;
  }

  // Fallback with timestamp if collisions keep happening
  return `CSE-${year}-${Date.now().toString(36).toUpperCase()}`;
}