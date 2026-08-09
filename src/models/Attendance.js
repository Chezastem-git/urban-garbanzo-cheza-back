// src/models/Attendace.js
import mongoose from "mongoose";

// One record per student per class session (instructor marks present/absent)
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
    },
    scheduleEventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ScheduleEvent",
    },
    date: { type: String, required: true }, // "2026-08-03"
    status: {
      type: String,
      enum: ["present", "absent", "late", "excused"],
      required: true,
    },
    markedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // instructor
    },
  },
  { timestamps: true },
);

attendanceSchema.index({ studentId: 1, date: 1, scheduleEventId: 1 });

export default mongoose.model("Attendance", attendanceSchema);
