import mongoose from "mongoose";

const CohortSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  code: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  description: { type: String, trim: true },
  startDate: { type: Date, required: true },
  createdByAdminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Admin",
    required: true,
  },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("Cohort", CohortSchema);
