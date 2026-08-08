import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
  fullName: { type: String, required: true, trim: true },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ["student", "instructor"], required: true },
  status: {
    type: String,
    enum: ["enrolled", "employed", "suspended", "graduated"],
    required: true,
  },
  cohortId: { type: mongoose.Schema.Types.ObjectId, ref: "Cohort" },
  addedByAdminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Admin",
    required: true,
  },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("User", UserSchema);
