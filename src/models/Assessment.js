// src/models/Assessment.js
import mongoose from "mongoose";

const questionSchema = new mongoose.Schema({
  // "mcq" | "short" | "long"
  type: {
    type: String,
    enum: ["mcq", "short", "long"],
    default: "short",
  },

  // Question body (use this name everywhere in admin UI)
  prompt: { type: String, required: true },

  // Points for this question
  points: { type: Number, default: 1, min: 0 },

  // ── MCQ only ──────────────────────────────
  options: [{ type: String }],
  correctOptionIndex: { type: Number, default: null },

  // ── Short / long answer (auto-grade) ──────
  expectedAnswer: { type: String, default: "" },

  explanation: { type: String, default: "" },
});

const attemptAnswerSchema = new mongoose.Schema({
  questionIndex: { type: Number, required: true },
  // MCQ: selected option index; text: free response
  selectedOptionIndex: { type: Number, default: null },
  textAnswer: { type: String, default: "" },
  // Auto-grade result for this question
  pointsAwarded: { type: Number, default: 0 },
  similarity: { type: Number, default: null }, // 0–1 for text
});

const attemptSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  answers: [attemptAnswerSchema],
  scorePercentage: { type: Number, default: 0 },
  totalPoints: { type: Number, default: 0 },
  earnedPoints: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ["completed", "in_progress"],
    default: "completed",
  },
  completedAt: { type: Date, default: Date.now },
});

const assessmentSchema = new mongoose.Schema(
  {
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      index: true,
    },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    durationMinutes: { type: Number, default: 15 },
    order: { type: Number, default: 0 },
    // Student-facing only; admin UI ignores this
    isLocked: { type: Boolean, default: false },
    questions: [questionSchema],
    attempts: [attemptSchema],
  },
  { timestamps: true },
);

export default mongoose.models.Assessment ||
  mongoose.model("Assessment", assessmentSchema);
