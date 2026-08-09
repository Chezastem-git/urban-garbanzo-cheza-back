
// src/models/ScheduleEvent.js
import mongoose from "mongoose";

const scheduleEventSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    type: {
      type: String,
      enum: ["class", "demo", "event"],
      default: "class",
    },
    // ISO date key: "2026-08-03" (matches frontend calendar keys)
    date: { type: String, required: true, index: true },
    startTime: { type: String }, // "10:00 AM"
    endTime: { type: String }, // "12:00 PM"
    time: { type: String }, // "10:00 AM - 12:00 PM" (display)
    location: { type: String },
    cohortId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Cohort",
      required: true,
      index: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
    },
    instructorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    // Optional theme overrides for the calendar UI
    theme: {
      primary: String,
      accent: String,
      bgLight: String,
      border: String,
      text: String,
      badgeBg: String,
    },
  },
  { timestamps: true },
);

export default mongoose.model("ScheduleEvent", scheduleEventSchema);