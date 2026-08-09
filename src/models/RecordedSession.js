// src/models/RecordedSession
import mongoose from "mongoose";

const recordedSessionSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String },
  videoUrl: { type: String, required: true },
  cohortId: { type: mongoose.Schema.Types.ObjectId, ref: "Cohort", required: true },
  date: { type: Date, default: Date.now }
}, { timestamps: true });

export default mongoose.model("RecordedSession", recordedSessionSchema);