// src/models/Attendace.js  (or Attendance.js — match your import)
import mongoose from "mongoose";

const attendanceSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    cohortId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Cohort",
      required: true,
      index: true,
    },
    // New: link to ClassSession (attendance page)
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClassSession",
      index: true,
    },
    // Legacy calendar / schedule events
    scheduleEventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ScheduleEvent",
    },
    // "2026-08-03"
    date: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ["present", "absent", "late", "excused"],
      required: true,
    },
    markedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    markedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

// Prefer one row per student per class session when sessionId is set
attendanceSchema.index(
  { sessionId: 1, studentId: 1 },
  { unique: true, sparse: true },
);

// Legacy uniqueness
attendanceSchema.index({ studentId: 1, date: 1, scheduleEventId: 1 });

export default mongoose.models.Attendance ||
  mongoose.model("Attendance", attendanceSchema);
