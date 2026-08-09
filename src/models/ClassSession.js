// src/models/ClassSession.js
import mongoose from "mongoose";

const classSessionSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    // e.g. "Session 12: Asynchronous JS, Promises & Async/Await"
    cohortId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Cohort",
      required: true,
    },
    // optional free-text course label (can also come from cohort)
    courseName: { type: String },

    // When the class happens
    date: { type: Date, required: true },          // calendar day
    startTime: { type: String },                   // "10:00 AM"
    endTime: { type: String },                     // "12:30 PM"
    // or use a single timeRange string if you prefer

    status: {
      type: String,
      enum: ["scheduled", "ongoing", "completed"],
      default: "scheduled",
    },

    // true once the instructor has submitted the roster
    attendanceMarked: { type: Boolean, default: false },

    // Who taught it (useful later)
    instructorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    // Optional notes / recording link etc.
    notes: { type: String },
  },
  { timestamps: true },
);

export default mongoose.model("ClassSession", classSessionSchema);