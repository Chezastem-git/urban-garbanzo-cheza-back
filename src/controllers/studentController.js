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

export const getPendingAlerts = async (req, res) => {
  try {
    const studentId = req.userId; // Change req.user.id to req.userId

    const overdueAssignments = await Milestone.find({
      dueDate: { $lt: new Date() },
      "submissions.studentId": { $ne: studentId },
    });

    const pendingCount = overdueAssignments.length;

    return res.json({
      pendingCount,
      message:
        pendingCount > 0
          ? `You have ${pendingCount} overdue assignment${pendingCount > 1 ? "s" : ""} to catch up on!`
          : "You are completely on schedule.",
    });
  } catch (err) {
    console.error("Error fetching pending alerts:", err);
    return res
      .status(500)
      .json({ error: "Failed to evaluate student progress alerts" });
  }
};
// Fetch Recorded Sessions
export const getRecordedSessions = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user?.cohortId) {
      return res.status(404).json({ message: "No cohort assigned." });
    }

    const sessions = await RecordedSession.find({
      cohortId: user.cohortId,
    }).sort({ date: -1 });

    res.status(200).json({ sessions });
  } catch {
    res.status(500).json({ message: "Error fetching recorded sessions." });
  }
};
// List assessments for the student's cohort + their attempt status
export const getStudentAssessments = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user?.cohortId) {
      return res.status(404).json({ message: "No cohort assigned." });
    }

    const assessments = await Assessment.find({
      cohortId: user.cohortId,
    }).sort({ order: 1 });

    const formatted = assessments.map((a) => {
      const attempt = a.attempts.find(
        (att) => att.studentId.toString() === req.userId,
      );

      let status = "locked";
      if (!a.isLocked) {
        status = attempt?.status === "completed" ? "completed" : "unlocked";
      } else if (attempt?.status === "completed") {
        status = "completed";
      }

      return {
        _id: a._id,
        title: a.title,
        description: a.description,
        durationMinutes: a.durationMinutes,
        questionsCount: a.questions?.length || 0,
        isLocked: a.isLocked,
        status,
        completionPercentage:
          attempt?.status === "completed" ? attempt.scorePercentage : undefined,
        // Do not send correct answers in the list
      };
    });

    res.status(200).json({ assessments: formatted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching assessments." });
  }
};

// Get one assessment with questions (for taking it)
export const getStudentAssessmentById = async (req, res) => {
  try {
    const { assessmentId } = req.params;
    const assessment = await Assessment.findById(assessmentId);
    if (!assessment) {
      return res.status(404).json({ message: "Assessment not found." });
    }

    const user = await User.findById(req.userId);
    if (
      !user?.cohortId ||
      assessment.cohortId.toString() !== user.cohortId.toString()
    ) {
      return res.status(403).json({ message: "Not allowed." });
    }

    const attempt = assessment.attempts.find(
      (att) => att.studentId.toString() === req.userId,
    );

    // Strip correct answers when sending to client for taking the quiz
    // (or include them if you prefer client-side scoring like your mock)
    const questions = assessment.questions.map((q, idx) => ({
      id: idx,
      question: q.questionText,
      options: q.options,
      // Optional: omit correctOptionIndex for stricter security
      correctIdx: q.correctOptionIndex,
    }));

    res.status(200).json({
      _id: assessment._id,
      title: assessment.title,
      description: assessment.description,
      durationMinutes: assessment.durationMinutes,
      isLocked: assessment.isLocked,
      questions,
      myAttempt: attempt || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching assessment." });
  }
};

// Submit answers and store score
export const submitAssessment = async (req, res) => {
  try {
    const { assessmentId } = req.params;
    const { answers, scorePercentage } = req.body; // answers: number[]

    const assessment = await Assessment.findById(assessmentId);
    if (!assessment) {
      return res.status(404).json({ message: "Assessment not found." });
    }

    // Prefer server-side scoring if answers provided
    let finalScore = scorePercentage;
    if (Array.isArray(answers) && assessment.questions.length > 0) {
      let correct = 0;
      assessment.questions.forEach((q, idx) => {
        if (answers[idx] === q.correctOptionIndex) correct++;
      });
      finalScore = Math.round((correct / assessment.questions.length) * 100);
    }

    if (typeof finalScore !== "number") {
      return res.status(400).json({ message: "Score or answers required." });
    }

    const existingIndex = assessment.attempts.findIndex(
      (att) => att.studentId.toString() === req.userId,
    );

    if (existingIndex > -1) {
      assessment.attempts[existingIndex].answers = answers || [];
      assessment.attempts[existingIndex].scorePercentage = finalScore;
      assessment.attempts[existingIndex].status = "completed";
    } else {
      assessment.attempts.push({
        studentId: req.userId,
        answers: answers || [],
        scorePercentage: finalScore,
        status: "completed",
      });
    }

    await assessment.save();
    res.status(200).json({
      message: "Assessment submitted successfully.",
      scorePercentage: finalScore,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to submit assessment." });
  }
};
