// src/models/RecordedSession.js
import mongoose from "mongoose";

const recordedSessionSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String },

    // Playback / links
    videoUrl: { type: String, required: true }, // primary recording link (Drive, Meet archive, etc.)
    meetUrl: { type: String }, // optional Google Meet / external link
    embedUrl: { type: String }, // optional iframe-friendly embed (YouTube, Loom, etc.)

    // Display metadata for the student UI
    milestoneTitle: { type: String }, // e.g. "Milestone 3: Backend Systems"
    instructorName: { type: String },
    instructorAvatar: { type: String },
    duration: { type: String }, // e.g. "1h 45m"
    thumbnail: { type: String }, // card cover image
    topics: [{ type: String }], // e.g. ["FastAPI", "PostgreSQL"]

    // Scope
    cohortId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Cohort",
      required: true,
    },
    date: { type: Date, default: Date.now },

    // Optional: who uploaded it (instructor)
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true },
);

export default mongoose.model("RecordedSession", recordedSessionSchema);
