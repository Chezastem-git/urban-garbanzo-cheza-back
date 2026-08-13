import mongoose from "mongoose";

const StudentProgressSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      index: true,
    },
    completedSegmentIds: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Segment" },
    ],
    unlockedMilestoneIds: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Milestone" },
    ],
  },
  { timestamps: true },
);

StudentProgressSchema.index({ studentId: 1, courseId: 1 }, { unique: true });

export default mongoose.models.StudentProgress ||
  mongoose.model("StudentProgress", StudentProgressSchema);
