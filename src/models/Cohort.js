import mongoose from "mongoose";

const CohortSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: { type: String, trim: true, default: "" },

    // ── Link to Course ──────────────────────
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },

    // ── Assigned Instructor ─────────────────
    instructorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    startDate: { type: Date, required: true },
    endDate: { type: Date },

    isActive: { type: Boolean, default: true },
    
    scheduleSlots: [
      {
        dayOfWeek: { type: Number, min: 0, max: 6 },
        startTime: { type: String }, // "09:00"
        endTime: { type: String },
        label: { type: String, default: "Live class" },
      },
    ],
    timezone: { type: String, default: "Africa/Nairobi" },

    createdByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
  },
  { timestamps: true },
);

export default mongoose.models.Cohort || mongoose.model("Cohort", CohortSchema);
