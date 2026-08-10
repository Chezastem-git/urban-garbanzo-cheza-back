import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ["student", "instructor"],
      required: true,
    },
    status: {
      type: String,
      enum: [
        "enrolled", // newly added student
        "active", // currently participating
        "inactive", // temporarily paused / not attending
        "employed", // for instructors
        "suspended", // blocked by admin
        "graduated", // completed the program
      ],
      required: true,
      default: "enrolled",
    },
    // Main cohort (students usually have one)
    cohortId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Cohort",
      default: null,
    },
    // Optional: support instructors belonging to multiple cohorts
    cohortIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Cohort",
      },
    ],
    avatar: {
      type: String,
      default: null,
    },
    addedByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
    graduatedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

export default mongoose.models.User || mongoose.model("User", UserSchema);
