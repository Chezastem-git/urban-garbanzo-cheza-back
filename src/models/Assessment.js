// src/models/Assessment.js
import mongoose from "mongoose";

const questionSchema = new mongoose.Schema({
  questionText: { type: String, required: true },
  options: [{ type: String, required: true }],
  correctOptionIndex: { type: Number, required: true },
});

const attemptSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    answers: [{ type: Number }], // selected option index per question
    scorePercentage: { type: Number, min: 0, max: 100 },
    status: {
      type: String,
      enum: ["in_progress", "completed"],
      default: "completed",
    },
  },
  { timestamps: true },
);

const assessmentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String },
    cohortId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Cohort",
      required: true,
    },
    order: { type: Number, default: 0 },
    isLocked: { type: Boolean, default: true },
    durationMinutes: { type: Number, default: 60 },
    questions: [questionSchema],
    attempts: [attemptSchema],
  },
  { timestamps: true },
);

export default mongoose.model("Assessment", assessmentSchema);
