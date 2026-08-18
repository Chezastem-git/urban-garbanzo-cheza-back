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
        "enrolled",
        "active",
        "inactive",
        "employed",
        "suspended",
        "graduated",
      ],
      required: true,
      default: "enrolled",
    },
    cohortId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Cohort",
      default: null,
    },
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

    // ── Force password change on first login ─────────────────
    mustChangePassword: {
      type: Boolean,
      default: true, // every new user must change password the first time
    },
    isFirstLogin: {
      type: Boolean,
      default: true,
    },
    passwordChanged: {
      type: Boolean,
      default: false,
    },

    // ── Soft delete / audit ─────────────────────────────────
    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
    deletedByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    // Snapshot of identity at deletion (email is rewritten so unique holds)
    deletedEmail: {
      type: String,
      default: null,
    },
    deletedFullName: {
      type: String,
      default: null,
    },
  },
  { timestamps: true },
);

export default mongoose.models.User || mongoose.model("User", UserSchema);
