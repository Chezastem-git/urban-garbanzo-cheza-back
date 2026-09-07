// src/controllers/publicController.js
import User from "../models/User.js";

export const getPublicIdCard = async (req, res) => {
  try {
    const { admissionNumber } = req.params;

    if (!admissionNumber || admissionNumber.trim().length < 3) {
      return res.status(400).json({ message: "Invalid admission number" });
    }

    const student = await User.findOne({
      admissionNumber: admissionNumber.trim().toUpperCase(),
      role: "student",
    })
      .select(
        "fullName admissionNumber idPhoto avatar status createdAt cohortId",
      )
      .populate({
        path: "cohortId",
        select: "name courseTitle title course courseId startDate endDate",
        populate: [
          { path: "course", select: "name title courseTitle" },
          { path: "courseId", select: "name title courseTitle" },
        ],
      })
      .lean();

    if (!student) {
      return res.status(404).json({ message: "Student ID not found" });
    }

    if (student.status === "suspended" || student.status === "inactive") {
      return res.status(403).json({
        message: "This student ID is no longer active",
      });
    }

    const cohort = student.cohortId || null;

    const issuedAt = cohort?.startDate || student.createdAt || new Date();
    const validUntil = new Date(issuedAt);
    validUntil.setFullYear(validUntil.getFullYear() + 1);

    const courseName =
      cohort?.courseTitle ||
      cohort?.title ||
      cohort?.course?.courseTitle ||
      cohort?.course?.title ||
      cohort?.course?.name ||
      cohort?.courseId?.courseTitle ||
      cohort?.courseId?.title ||
      cohort?.courseId?.name ||
      null;

    return res.status(200).json({
      fullName: student.fullName,
      admissionNumber: student.admissionNumber,
      idPhoto: student.idPhoto || student.avatar || null,
      courseName,
      cohortName: cohort?.name || null,
      courseTitle:
        cohort?.courseTitle ||
        cohort?.title ||
        cohort?.course?.courseTitle ||
        cohort?.course?.title ||
        cohort?.courseId?.courseTitle ||
        cohort?.courseId?.title ||
        null,
      cohort: cohort
        ? {
            name: cohort.name || null,
            courseTitle:
              cohort.courseTitle ||
              cohort.title ||
              cohort.course?.courseTitle ||
              cohort.course?.title ||
              cohort.courseId?.courseTitle ||
              cohort.courseId?.title ||
              null,
            startDate: cohort.startDate || null,
            endDate: cohort.endDate || null,
          }
        : null,
      status: student.status || "active",
      issuedAt,
      validUntil,
    });
  } catch (err) {
    console.error("[public/id-card]", err);
    return res.status(500).json({
      message: "Unable to verify student ID",
      error: err?.message,
    });
  }
};
