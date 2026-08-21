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

    // ── Student ID card ──────────────────────────────────────
    /** Official photo for the physical/digital ID card (set once only) */
    idPhoto: {
      type: String,
      default: null,
    },
    /** Student-generated unique admission / student ID number */
    admissionNumber: {
      type: String,
      unique: true,
      sparse: true, // allows multiple nulls until student sets it
      trim: true,
      uppercase: true,
    },
    /** When the student first set their admission number */
    admissionNumberSetAt: {
      type: Date,
      default: null,
    },

    // ── Force password change on first login ─────────────────
    mustChangePassword: {
      type: Boolean,
      default: true,
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
