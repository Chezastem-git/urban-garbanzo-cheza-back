import mongoose from "mongoose";

const sectionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["text", "image", "video"],
      required: true,
    },
    // text → HTML or markdown body
    content: { type: String, default: "" },
    // image / video → URL
    url: { type: String, default: "" },
    caption: { type: String, default: "" },
  },
  { _id: true },
);

const pageSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    intro: { type: String, default: "" },
    sections: { type: [sectionSchema], default: [] },
  },
  { _id: true },
);

const segmentSchema = new mongoose.Schema(
  {
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      index: true,
    },
    milestoneId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Milestone",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    order: { type: Number, default: 0 },
    pages: { type: [pageSchema], default: [] },
  },
  { timestamps: true },
);

segmentSchema.index({ milestoneId: 1, order: 1 });

export default mongoose.models.Segment ||
  mongoose.model("Segment", segmentSchema);
