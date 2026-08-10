import mongoose from "mongoose";

const CohortSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    code: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
    },
    // Course metadata (very useful for the frontend)
    courseTitle: {
      type: String,
      default: "",
      trim: true,
    },
    courseCategory: {
      type: String,
      default: "Software development",
      trim: true,
    },
    icon: {
      type: String,
      default: "/badges/skyboss.png",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
  },
  { timestamps: true }, // automatically adds createdAt + updatedAt
);

export default mongoose.models.Cohort || mongoose.model("Cohort", CohortSchema);
