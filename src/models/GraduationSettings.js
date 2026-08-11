// src/models/GraduationSettings.js
import mongoose from "mongoose";

const graduationSettingsSchema = new mongoose.Schema(
  {
    // Optional: scope to a specific course. null = global default
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      default: null,
   
    },

    // Minimum % of milestones that must be unlocked / completed
    minMilestoneProgress: {
      type: Number,
      default: 100,
      min: 0,
      max: 100,
    },

    // Minimum average score across graded solos
    minSoloAverage: {
      type: Number,
      default: 60,
      min: 0,
      max: 100,
    },

    // Minimum average score across completed assessments
    minAssessmentAverage: {
      type: Number,
      default: 60,
      min: 0,
      max: 100,
    },

    // Student must have completed every assessment in the course
    mustCompleteAllAssessments: {
      type: Boolean,
      default: true,
    },

    // Optional extra rules (toggle on/off)
    requireAllSolosGraded: {
      type: Boolean,
      default: false,
    },

    minAttendancePct: {
      type: Number,
      default: 0, // 0 = not enforced
      min: 0,
      max: 100,
    },

    // Who last updated these settings
    updatedByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
  },
  { timestamps: true },
);

// One settings doc per course (or one global when courseId is null)
graduationSettingsSchema.index(
  { courseId: 1 },
  {
    unique: true,
    partialFilterExpression: { courseId: { $type: "objectId" } },
  },
);

const GraduationSettings =
  mongoose.models.GraduationSettings ||
  mongoose.model("GraduationSettings", graduationSettingsSchema);

export default GraduationSettings;
