/**
 * GET /api/instructor/courses
 * Courses linked to the instructor’s cohorts.
 */
export const getInstructorCourses = async (req, res) => {
  try {
    const instructor = await User.findById(req.userId);
    if (!instructor) {
      return res.status(404).json({ message: "User not found." });
    }

    const cohortFilter = instructor.cohortIds?.length
      ? { _id: { $in: instructor.cohortIds } }
      : instructor.cohortId
        ? { _id: instructor.cohortId }
        : {};

    const cohorts = await Cohort.find(cohortFilter);

    // One “course card” per cohort (or group by courseTitle if you prefer)
    const courses = await Promise.all(
      cohorts.map(async (c) => {
        const milestones = await Milestone.find({ cohortId: c._id }).sort({
          order: 1,
        });
        const unlocked = milestones.filter((m) => m.isUnlocked).length;
        const progress =
          milestones.length > 0
            ? Math.round((unlocked / milestones.length) * 100)
            : 0;

        return {
          id: c.code || c._id.toString(),          // used as courseId in the URL
          category: c.courseCategory || "Software development",
          title: c.courseTitle || c.name || "Course",
          progress,
          cohortId: c._id.toString(),
        };
      }),
    );

    res.status(200).json({ courses });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch courses." });
  }
};

/**
 * GET /api/instructor/courses/:courseId
 * Full course tree: milestones → segments → pages
 * courseId = cohort code (or ObjectId)
 */
export const getInstructorCourseById = async (req, res) => {
  try {
    const { courseId } = req.params;

    // Resolve cohort the same way as findCohortBySlug
    let cohort = await Cohort.findOne({ code: courseId.toLowerCase() });
    if (!cohort) {
      cohort = await Cohort.findOne({
        name: new RegExp(`^${courseId.replace(/-/g, " ")}$`, "i"),
      });
    }
    if (!cohort && courseId.match(/^[a-f\d]{24}$/i)) {
      cohort = await Cohort.findById(courseId);
    }
    if (!cohort) {
      return res.status(404).json({ message: "Course not found." });
    }

    const milestones = await Milestone.find({ cohortId: cohort._id })
      .sort({ order: 1 })
      .lean();

    // If segments are separate collection:
    // const allSegments = await Segment.find({ milestoneId: { $in: ... } })

    // Map to the shape the UI expects
    const milestonesPayload = await Promise.all(
      milestones.map(async (m) => {
        // Adjust this block to match how YOU store segments
        // Option A: segments embedded on milestone
        // Option B: separate Segment collection
        let segments = m.segments || [];

        // If separate collection:
        // segments = await Segment.find({ milestoneId: m._id }).sort({ order: 1 }).lean();

        return {
          id: m._id.toString(),
          title: m.title,
          description: m.description || "",
          isUnlocked: Boolean(m.isUnlocked),
          duration: m.duration || "—",
          topics: m.topics || [],
          segments: (segments || []).map((s) => ({
            id: s._id?.toString() || s.id,
            title: s.title,
            duration: s.duration || "—",
            isCompleted: Boolean(s.isCompleted), // instructor view can ignore or always true
            pages: (s.pages || []).map((p) => ({
              title: p.title,
              intro: p.intro || "",
              sections: p.sections || [],
            })),
          })),
        };
      }),
    );

    res.status(200).json({
      id: cohort.code || cohort._id.toString(),
      title: cohort.courseTitle || cohort.name,
      category: cohort.courseCategory || "Software development",
      milestones: milestonesPayload,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch course." });
  }
};