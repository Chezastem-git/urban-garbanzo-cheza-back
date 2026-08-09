// src/controllers/instructorController.js
import Solo from "../models/Solo.js";
import Milestone from "../models/Milestone.js";

// Fetch Pending Solos for Grading
export const getInstructorSolos = async (req, res) => {
  try {
    const solos = await Solo.find().populate("submissions.studentId", "fullName email");
    res.status(200).json({ solos });
  } catch {
    res.status(500).json({ message: "Failed to fetch student solos." });
  }
};

// Grade Student Solo Project
export const gradeSolo = async (req, res) => {
  try {
    const { soloId, submissionId } = req.params;
    const { score, feedback } = req.body;

    const solo = await Solo.findById(soloId);
    if (!solo) return res.status(404).json({ message: "Solo project not found." });

    const sub = solo.submissions.id(submissionId);
    if (!sub) return res.status(404).json({ message: "Submission not found." });

    sub.score = score;
    sub.feedback = feedback;
    sub.status = "graded";
    sub.gradedByInstructorId = req.userId;

    await solo.save();
    res.status(200).json({ message: "Submission graded successfully.", submission: sub });
  } catch {
    res.status(500).json({ message: "Failed to submit grade." });
  }
};

// Create New Milestone & Segments
export const createMilestone = async (req, res) => {
  try {
    const { title, description, cohortId, order, segments } = req.body;
    const milestone = await Milestone.create({ title, description, cohortId, order, segments });
    res.status(201).json({ message: "Milestone created.", milestone });
  } catch {
    res.status(500).json({ message: "Failed to create milestone." });
  }
};