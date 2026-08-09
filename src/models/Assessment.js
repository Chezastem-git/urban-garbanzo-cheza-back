// src/models/Assesment.js
import mongoose from "mongoose";

const assessmentSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String },
  cohortId: { type: mongoose.Schema.Types.ObjectId, ref: "Cohort", required: true },
  durationMinutes: { type: Number, default: 60 },
  questions: [{
    questionText: { type: String, required: true },
    options: [{ type: String, required: true }],
    correctOptionIndex: { type: Number, required: true }
  }]
}, { timestamps: true });

export default mongoose.model("Assessment", assessmentSchema);