// src/models/Notification.js
import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Optional: cohort-wide announcements (if set, shown to all in cohort)
    cohortId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Cohort",
    },
    sender: { type: String, required: true }, // "From Instructor", "System Alert", etc.
    message: { type: String, required: true },
    avatar: { type: String, default: "/default.jpg" },
    bgColor: { type: String, default: "bg-[#CB96EC]" },
    type: {
      type: String,
      enum: ["instructor", "school", "reminder", "system", "calendar"],
      default: "system",
    },
    isRead: { type: Boolean, default: false },
    // Optional link to calendar event that generated this reminder
    relatedEventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ScheduleEvent",
    },
  },
  { timestamps: true },
);

export default mongoose.model("Notification", notificationSchema);
