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

    createdByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
  },
  { timestamps: true },
);

export default mongoose.models.Cohort || mongoose.model("Cohort", CohortSchema);
