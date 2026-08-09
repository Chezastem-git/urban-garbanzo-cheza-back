// src/models/Badge.js
import mongoose from "mongoose";

const badgeDefinitionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true }, // "Maverick", "Craftsman"
    name: { type: String, required: true },
    imageUrl: { type: String },
    color: { type: String }, // tailwind classes for UI
    accentHex: { type: String, default: "#0075FF" },
    description: { type: String },
    order: { type: Number, default: 0 },
    // Thresholds used when auto-awarding (optional)
    rules: {
      minAttendancePercent: { type: Number, default: 0 },
      minSoloAvg: { type: Number, default: 0 },
      minAssessmentAvg: { type: Number, default: 0 },
      minActivityScore: { type: Number, default: 0 },
    },
  },
  { timestamps: true },
);

export const BadgeDefinition = mongoose.model(
  "BadgeDefinition",
  badgeDefinitionSchema,
);

const studentBadgeSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    badgeKey: { type: String, required: true },
    awardedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

studentBadgeSchema.index({ studentId: 1, badgeKey: 1 }, { unique: true });

export const StudentBadge = mongoose.model("StudentBadge", studentBadgeSchema);
