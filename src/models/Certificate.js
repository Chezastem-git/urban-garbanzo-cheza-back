// src/models/Certificate.js
import mongoose from "mongoose";

const certificateSchema = new mongoose.Schema(
  {
 
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    cohortId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Cohort",
      required: true,
      index: true,
    },

    certificateNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

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

    metrics: {
      progress: { type: Number, default: 0 },
      attendancePct: { type: Number, default: 0 },
      bestSoloScore: { type: Number, default: 0 },
      soloAverage: { type: Number, default: 0 },
      assessmentAverage: { type: Number, default: 0 },
    },
    forceGraduated: { type: Boolean, default: false },

    issuedAt: {
      type: Date,
      default: Date.now,
    },

    issuedByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },

    pdfUrl: {
      type: String,
      default: null,
    },

    status: {
      type: String,
      enum: ["issued", "revoked"],
      default: "issued",
    },
  },
  { timestamps: true },
);

certificateSchema.index({ studentId: 1, cohortId: 1 }, { unique: true });

const Certificate =
  mongoose.models.Certificate ||
  mongoose.model("Certificate", certificateSchema);

export default Certificate;
