// src/models
import mongoose from "mongoose";

const segmentSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String },
  duration: { type: String }, // e.g. "2 hours"
  order: { type: Number, required: true },
  content: { type: String }, // Markdown / HTML content
  videoUrl: { type: String },
  isCompleted: { type: Boolean, default: false }
});

const milestoneSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String },
  cohortId: { type: mongoose.Schema.Types.ObjectId, ref: "Cohort", required: true },
  order: { type: Number, required: true },
  segments: [segmentSchema]
}, { timestamps: true });

export default mongoose.model("Milestone", milestoneSchema);