import Cohort from "../models/Cohort.js";
import Course from "../models/Course.js";
import ClassSession from "../models/ClassSession.js";
import { expandScheduleSlots } from "../utils/scheduleHelpers.js";

// Optional — only if you have this model
// import Attendance from "../models/Attendance.js";

export const updateCohortSchedule = async (req, res) => {
  try {
    const { scheduleSlots, timezone } = req.body;
    if (!Array.isArray(scheduleSlots)) {
      return res.status(400).json({ message: "scheduleSlots array required." });
    }

    for (const s of scheduleSlots) {
      if (s.dayOfWeek === undefined || !s.startTime || !s.endTime) {
        return res.status(400).json({
          message: "Each slot needs dayOfWeek, startTime, endTime.",
        });
      }
    }

    const cohort = await Cohort.findByIdAndUpdate(
      req.params.cohortId,
      {
        scheduleSlots,
        ...(timezone ? { timezone } : {}),
      },
      { new: true },
    );

    if (!cohort) return res.status(404).json({ message: "Cohort not found." });

    res.status(200).json({ message: "Schedule updated.", cohort });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update schedule." });
  }
};

export const generateClassSessions = async (req, res) => {
  try {
    const { replaceExisting = false } = req.body || {};
    const cohort = await Cohort.findById(req.params.cohortId);

    if (!cohort) return res.status(404).json({ message: "Cohort not found." });
    if (!cohort.startDate) {
      return res.status(400).json({ message: "Cohort needs a startDate." });
    }
    if (!cohort.scheduleSlots?.length) {
      return res.status(400).json({
        message: "Add schedule slots before generating classes.",
      });
    }

    if (replaceExisting) {
      await ClassSession.deleteMany({
        cohortId: cohort._id,
        generatedFromSchedule: true,
        status: "scheduled",
      });
    }

    const expanded = expandScheduleSlots({
      startDate: cohort.startDate,
      endDate: cohort.endDate,
      scheduleSlots: cohort.scheduleSlots,
    });

    let courseName;
    if (cohort.courseId) {
      const course = await Course.findById(cohort.courseId).select("title");
      courseName = course?.title;
    }

    let created = 0;
    let skipped = 0;

    for (const s of expanded) {
      try {
        await ClassSession.create({
          title: s.title,
          cohortId: cohort._id,
          courseId: cohort.courseId || undefined,
          courseName,
          date: s.date,
          startTime: s.startTime,
          endTime: s.endTime,
          status: "scheduled",
          instructorId: cohort.instructorId || undefined,
          generatedFromSchedule: true,
        });
        created += 1;
      } catch (e) {
        if (e?.code === 11000) skipped += 1;
        else throw e;
      }
    }

    res.status(201).json({
      message: `Generated ${created} class session(s). ${skipped} skipped (already exist).`,
      created,
      skipped,
      totalExpanded: expanded.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to generate class sessions." });
  }
};

export const getClassSessions = async (req, res) => {
  try {
    const { cohortId, from, to, status } = req.query;
    const filter = {};

    if (cohortId) filter.cohortId = cohortId;
    if (status) filter.status = status;

    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = new Date(from);
      if (to) filter.date.$lte = new Date(to);
    }

    const sessions = await ClassSession.find(filter)
      .populate("cohortId", "name code")
      .populate("courseId", "title slug")
      .populate("instructorId", "fullName email")
      .sort({ date: 1 });

    res.status(200).json({ sessions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch class sessions." });
  }
};

export const getClassSessionById = async (req, res) => {
  try {
    const session = await ClassSession.findById(req.params.sessionId)
      .populate("cohortId", "name code")
      .populate("courseId", "title")
      .populate("instructorId", "fullName email");

    if (!session) {
      return res.status(404).json({ message: "Class session not found." });
    }

    // If you don't have Attendance model yet:
    res.status(200).json({ session, attendance: [] });

    // When Attendance exists:
    // const attendance = await Attendance.find({ classSessionId: session._id })
    //   .populate("studentId", "fullName email");
    // res.status(200).json({ session, attendance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch session." });
  }
};
