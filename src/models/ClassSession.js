// src/models/ClassSession.js
import mongoose from "mongoose";

const classSessionSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    cohortId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Cohort",
      required: true,
      index: true,
    },
    courseName: { type: String },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
    },
    date: { type: Date, required: true, index: true },
    startTime: { type: String }, // "10:00 AM"
    endTime: { type: String }, // "12:30 PM"
    status: {
      type: String,
      enum: ["scheduled", "ongoing", "completed"],
      default: "scheduled",
    },
    attendanceMarked: { type: Boolean, default: false },
    instructorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    generatedFromSchedule: { type: Boolean, default: false },
    notes: { type: String },
    recordingUrl: { type: String },
  },
  { timestamps: true },
);

classSessionSchema.index(
  { cohortId: 1, date: 1, startTime: 1 },
  { unique: true },
);

export default mongoose.models.ClassSession ||
  mongoose.model("ClassSession", classSessionSchema);
