// src/controllers/publicController.js
import User from "../models/User.js"; 

export const getPublicIdCard = async (req, res) => {
  try {
    const { admissionNumber } = req.params;

    if (!admissionNumber || admissionNumber.trim().length < 3) {
      return res.status(400).json({ message: "Invalid admission number" });
    }

    const student = await User.findOne({
      admissionNumber: admissionNumber.trim(),
      role: "student",
    })
      .select(
        "fullName admissionNumber idPhoto officialPhoto avatar status createdAt cohortName courseTitle",
      )
      .lean();

    if (!student) {
      return res.status(404).json({ message: "Student ID not found" });
    }

    // Optional: block inactive students
    if (student.status === "suspended" || student.status === "inactive") {
      return res.status(403).json({
        message: "This student ID is no longer active",
      });
    }

    const issuedAt = student.createdAt || new Date();
    const validUntil = new Date(issuedAt);
    validUntil.setFullYear(validUntil.getFullYear() + 1);

    return res.status(200).json({
      fullName: student.fullName,
      admissionNumber: student.admissionNumber,
      idPhoto:
        student.idPhoto || student.officialPhoto || student.avatar || null,
      courseName: student.courseTitle || null,
      cohortName: student.cohortName || null,
      status: student.status || "active",
      issuedAt,
      validUntil,
    });
  } catch (err) {
    console.error("[public/id-card]", err);
    return res.status(500).json({ message: "Unable to verify student ID" });
  }
};
