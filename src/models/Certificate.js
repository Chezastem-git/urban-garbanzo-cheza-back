// src/models/Certificate.js
import mongoose from "mongoose";

const certificateSchema = new mongoose.Schema(
  {
    // Who received the certificate
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Which cohort / program
    cohortId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Cohort",
      required: true,
      index: true,
    },

    // Unique certificate identifier
    certificateNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    // Snapshot of data at the time of issuance (so it never changes later)
    studentName: {
      type: String,
      required: true,
      trim: true,
    },
    courseTitle: {
      type: String,
      required: true,
      trim: true,
    },
    cohortName: {
      type: String,
      required: true,
      trim: true,
    },

    // Final metrics recorded at graduation
    metrics: {
      progress: { type: Number, default: 0 },
      attendancePct: { type: Number, default: 0 },
      bestSoloScore: { type: Number, default: 0 },
      soloAverage: { type: Number, default: 0 },
      assessmentAverage: { type: Number, default: 0 },
    },
    forceGraduated: { type: Boolean, default: false },

    // When it was issued
    issuedAt: {
      type: Date,
      default: Date.now,
    },

    // Which admin issued it
    issuedByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },

    // Optional: link to a generated PDF later
    pdfUrl: {
      type: String,
      default: null,
    },

    // Can be revoked if needed
    status: {
      type: String,
      enum: ["issued", "revoked"],
      default: "issued",
    },
  },
  { timestamps: true },
);

// Prevent a student from getting multiple certificates for the same cohort
certificateSchema.index({ studentId: 1, cohortId: 1 }, { unique: true });

const Certificate =
  mongoose.models.Certificate ||
  mongoose.model("Certificate", certificateSchema);

export default Certificate;
