// src/controllers/studentController.js
import Milestone from "../models/Milestone.js";
import Solo from "../models/Solo.js";
import Assessment from "../models/Assessment.js";
import RecordedSession from "../models/RecordedSession.js";
import User from "../models/User.js";

// Fetch Student Milestones & Segments
export const getStudentMilestones = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user?.cohortId)
      return res.status(404).json({ message: "No cohort assigned." });

    const milestones = await Milestone.find({ cohortId: user.cohortId }).sort({
      order: 1,
    });
    res.status(200).json({ milestones });
  } catch {
    res.status(500).json({ message: "Error fetching milestones." });
  }
};

// Fetch Student Solos & Submissions
export const getStudentSolos = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    const solos = await Solo.find({ cohortId: user.cohortId });

    // Attach current student's specific submission status
    const formattedSolos = solos.map((solo) => {
      const submission = solo.submissions.find(
        (s) => s.studentId.toString() === req.userId,
      );
      return {
        _id: solo._id,
        title: solo.title,
        description: solo.description,
        dueDate: solo.dueDate,
        mySubmission: submission || null,
      };
    });

    res.status(200).json({ solos: formattedSolos });
  } catch {
    res.status(500).json({ message: "Error fetching solos." });
  }
};

// Submit Solo Project
export const submitSolo = async (req, res) => {
  try {
    const { soloId } = req.params;
    const { repositoryUrl, liveDemoUrl, notes } = req.body;

    const solo = await Solo.findById(soloId);
    if (!solo)
      return res.status(404).json({ message: "Solo project not found." });

    const existingIndex = solo.submissions.findIndex(
      (s) => s.studentId.toString() === req.userId,
    );
    if (existingIndex > -1) {
      solo.submissions[existingIndex].repositoryUrl = repositoryUrl;
      solo.submissions[existingIndex].liveDemoUrl = liveDemoUrl;
      solo.submissions[existingIndex].notes = notes;
      solo.submissions[existingIndex].status = "pending";
    } else {
      solo.submissions.push({
        studentId: req.userId,
        repositoryUrl,
        liveDemoUrl,
        notes,
        status: "pending",
      });
    }

    await solo.save();
    res.status(200).json({ message: "Solo project submitted successfully." });
  } catch {
    res.status(500).json({ message: "Failed to submit solo project." });
  }
};

// Fetch Recorded Sessions
export const getRecordedSessions = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    const sessions = await RecordedSession.find({
      cohortId: user.cohortId,
    }).sort({ date: -1 });
    res.status(200).json({ sessions });
  } catch {
    res.status(500).json({ message: "Error fetching recorded sessions." });
  }
};
