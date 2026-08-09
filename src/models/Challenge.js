// src/models/challenge.js
import mongoose from "mongoose";

const challengeSchema = new mongoose.Schema(
  {
    title: { type: String, required: true }, // maps to sender in UI
    description: { type: String, required: true }, // maps to message
    xpReward: { type: Number, default: 100 }, // maps to time tag e.g. "500 XP"
    avatar: { type: String, default: "/temp-instructor-asset/instructor.jpg" },
    bgColor: { type: String, default: "bg-[#FFB800]" },
    cohortId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Cohort",
      required: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
    },
    isActive: { type: Boolean, default: true },
    // Optional completions per student
    completions: [
      {
        studentId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        completedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

export default mongoose.model("Challenge", challengeSchema);
