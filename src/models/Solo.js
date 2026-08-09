// src/models/Solo.js

import mongoose from "mongoose";

const soloSubmissionSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  repositoryUrl: { type: String, required: true },
  liveDemoUrl: { type: String },
  notes: { type: String },
  score: { type: Number, min: 0, max: 100 },
  feedback: { type: String },
  gradedByInstructorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  status: { type: String, enum: ["pending", "graded", "resubmit"], default: "pending" }
}, { timestamps: true });

const soloSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  dueDate: { type: Date, required: true },
  cohortId: { type: mongoose.Schema.Types.ObjectId, ref: "Cohort", required: true },
  submissions: [soloSubmissionSchema]
}, { timestamps: true });

export default mongoose.model("Solo", soloSchema);