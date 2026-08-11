// src/models/Solo.js
import mongoose from "mongoose";

const submissionSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  repositoryUrl: String,
  liveDemoUrl: String,
  notes: String,
  status: { type: String, enum: ["pending", "graded"], default: "pending" },
  scorePercentage: Number,
  totalScore: Number,
  generalFeedback: String,
  rubricScores: { type: Map, of: Number },
  rubricRemarks: { type: Map, of: String },
  submittedAt: { type: Date, default: Date.now },
  gradedAt: Date,
  gradedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
});

const soloSchema = new mongoose.Schema(
  {
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      index: true,
    },
    milestoneId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Milestone",
      default: null,
    },
    title: { type: String, required: true },
    description: String,
    overview: String,
    goal: String,
    techStack: [String],
    architecture: [String],
    dueDate: Date,
    order: { type: Number, default: 0 },
    isLocked: { type: Boolean, default: true },
    timeToComplete: String,
    submissions: [submissionSchema],
  },
  { timestamps: true },
);

export default mongoose.models.Solo || mongoose.model("Solo", soloSchema);
