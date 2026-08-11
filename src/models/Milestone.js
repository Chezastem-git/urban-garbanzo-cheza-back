// src/models/Milestone.js
import mongoose from "mongoose";

const milestoneSchema = new mongoose.Schema(
  {
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    order: { type: Number, default: 0 },
    duration: { type: String, default: "" },
    topics: [{ type: String }],
    isUnlocked: { type: Boolean, default: false },
    soloId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Solo",
      default: null,
    },
  },
  { timestamps: true },
);

export default mongoose.models.Milestone ||
  mongoose.model("Milestone", milestoneSchema);
