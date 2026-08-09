import User from "../models/User.js";
import Cohort from "../models/Cohort.js";
import Milestone from "../models/Milestone.js";
import Solo from "../models/Solo.js";
import Assessment from "../models/Assessment.js";
import Attendance from "../models/Attendance.js";
import { BadgeDefinition, StudentBadge } from "../models/Badge.js";
import Notification from "../models/Notification.js";

/** Resolve cohort by code or ObjectId */
async function findCohortBySlug(slug) {
  if (!slug) return null;
  // Try code first (e.g. "cheza-2026-01"), then name match
  let cohort = await Cohort.findOne({ code: slug.toLowerCase() });
  if (!cohort) {
    cohort = await Cohort.findOne({
      name: new RegExp(`^${slug.replace(/-/g, " ")}$`, "i"),
    });
  }
  if (!cohort && slug.match(/^[a-f\d]{24}$/i)) {
    cohort = await Cohort.findById(slug);
  }
  return cohort;
}

/**
 * GET /api/instructor/cohorts
 * Cohorts this instructor is linked to (via user.cohortId for now).
 */
export const getInstructorCohorts = async (req, res) => {
  try {
    const instructor = await User.findById(req.userId);
    if (!instructor) {
      return res.status(404).json({ message: "User not found." });
    }

    // Single cohort from instructor profile; extend later for multi-cohort
    const filter = instructor.cohortId ? { _id: instructor.cohortId } : {}; // or restrict to empty if you require assignment

    const cohorts = await Cohort.find(filter).sort({ startDate: -1 });

    const result = await Promise.all(
      cohorts.map(async (c) => {
        const students = await User.find({
          cohortId: c._id,
          role: "student",
        }).select("fullName email avatar status");

        const active = students.filter(
          (s) => s.status === "enrolled" || s.status === "active",
        ).length;

        return {
          id: c._id.toString(),
          slug: c.code, // use as URL slug
          title: c.name,
          code: c.code,
          description: c.description,
          startDate: c.startDate,
          totalStudents: students.length,
          activeStudents: active,
          inactiveStudents: students.length - active,
          icon: "/badges/skyboss.png", // or c.icon if you add the field
        };
      }),
    );

    res.status(200).json({ cohorts: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch cohorts." });
  }
};

export const getInstructorCohortBySlug = async (req, res) => {
  try {
    const cohort = await findCohortBySlug(req.params.slug);
    if (!cohort) {
      return res.status(404).json({ message: "Cohort not found." });
    }

    const students = await User.find({
      cohortId: cohort._id,
      role: "student",
    }).select("fullName email avatar status");

    const badgeDefs = await BadgeDefinition.find();
    const totalBadges = Math.max(badgeDefs.length, 1);

    const milestones = await Milestone.find({ cohortId: cohort._id }).sort({
      order: 1,
    });

    const studentCards = await Promise.all(
      students.map(async (s) => {
        const earned = await StudentBadge.countDocuments({ studentId: s._id });

        // Progress from unlocked milestones (same idea as student dashboard)
        const unlocked = milestones.filter((m) => m.isUnlocked).length;
        const progress =
          milestones.length > 0
            ? Math.round((unlocked / milestones.length) * 100)
            : 0;

        return {
          id: s._id.toString(),
          name: s.fullName || s.name || "Student",
          email: s.email,
          avatar: s.avatar || "/temp-student-asset/joan.jpg",
          coverImage: s.avatar || "/temp-student-asset/joan.jpg",
          course: cohort.courseTitle || cohort.name || "Software development",
          progress,
          badgesCount: totalBadges,
          unlockedBadges: earned,
        };
      }),
    );

    const active = students.filter(
      (s) => s.status === "enrolled" || s.status === "active",
    ).length;

    res.status(200).json({
      id: cohort._id.toString(),
      slug: cohort.code,
      title: cohort.name,
      icon: "/badges/skyboss.png",
      totalStudents: students.length,
      activeStudents: active,
      inactiveStudents: students.length - active,
      students: studentCards,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch cohort." });
  }
};

export const getInstructorStudentDetail = async (req, res) => {
  try {
    const { slug, studentId } = req.params;
    const cohort = await findCohortBySlug(slug);
    if (!cohort) {
      return res.status(404).json({ message: "Cohort not found." });
    }

    const student = await User.findOne({
      _id: studentId,
      cohortId: cohort._id,
      role: "student",
    });
    if (!student) {
      return res.status(404).json({ message: "Student not found in cohort." });
    }

    // Attendance
    const records = await Attendance.find({
      studentId: student._id,
      cohortId: cohort._id,
    });
    const present = records.filter(
      (r) => r.status === "present" || r.status === "late",
    ).length;
    const attendancePct =
      records.length > 0
        ? `${Math.round((present / records.length) * 100)}%`
        : "—";

    // Solos
    const solos = await Solo.find({ cohortId: cohort._id });
    const completedSolos = solos.filter((solo) =>
      solo.submissions?.some(
        (sub) =>
          sub.studentId.toString() === studentId &&
          (sub.status === "graded" || sub.status === "pending"),
      ),
    ).length;

    // Assessments
    const assessments = await Assessment.find({ cohortId: cohort._id });
    const completedAssessments = assessments.filter((a) =>
      a.attempts?.some(
        (att) =>
          att.studentId.toString() === studentId && att.status === "completed",
      ),
    ).length;

    // Milestones
    const milestones = await Milestone.find({ cohortId: cohort._id }).sort({
      order: 1,
    });
    const unlocked = milestones.filter((m) => m.isUnlocked);
    const progress =
      milestones.length > 0
        ? Math.round((unlocked.length / milestones.length) * 100)
        : 0;
    const currentMilestone =
      unlocked[unlocked.length - 1]?.title || milestones[0]?.title || "—";
    // Simple “behind” heuristic: progress under 30%
    const isBehind = progress < 30;
    const expectedMilestone =
      milestones[Math.min(unlocked.length, milestones.length - 1)]?.title ||
      currentMilestone;

    // Badges
    const badgeDefs = await BadgeDefinition.find();
    const earned = await StudentBadge.countDocuments({
      studentId: student._id,
    });

    res.status(200).json({
      id: student._id.toString(),
      name: student.fullName || student.name || "Student",
      email: student.email,
      avatar: student.avatar || "/temp-student-asset/joan.jpg",
      coverImage: student.avatar || "/temp-student-asset/joan.jpg",
      track: cohort.courseCategory || "Software development",
      subTrack: cohort.courseTitle || cohort.name || "MERN",
      progress,
      unlockedBadges: earned,
      totalBadges: Math.max(badgeDefs.length, 1),
      attendance: attendancePct,
      completedSolos,
      totalSolos: solos.length,
      completedAssessments,
      totalAssessments: assessments.length,
      currentMilestone,
      isBehind,
      expectedMilestone,
      cohortName: cohort.name,
      cohortSlug: cohort.code,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch student detail." });
  }
};

/**
 * POST /api/instructor/students/:studentId/notify
 * Body: { message: string }
 */
export const sendStudentNotification = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { message } = req.body;
    if (!message?.trim()) {
      return res.status(400).json({ message: "Message is required." });
    }

    const student = await User.findById(studentId);
    if (!student) {
      return res.status(404).json({ message: "Student not found." });
    }

    const instructor = await User.findById(req.userId);

    await Notification.create({
      studentId: student._id,
      cohortId: student.cohortId,
      sender: instructor?.fullName || "Instructor",
      message: message.trim(),
      avatar: instructor?.avatar || "/temp-instructor-asset/instructor.jpg",
      bgColor: "bg-[#CB96EC]",
      type: "instructor",
    });

    res.status(201).json({ message: "Notification sent." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to send notification." });
  }
};

/**
 * GET /api/instructor/assessments
 * List assessments for the instructor's cohort(s).
 */
export const getInstructorAssessments = async (req, res) => {
  try {
    const instructor = await User.findById(req.userId);
    if (!instructor) {
      return res.status(404).json({ message: "User not found." });
    }

    const filter = instructor.cohortId ? { cohortId: instructor.cohortId } : {};

    const assessments = await Assessment.find(filter).sort({ createdAt: -1 });

    const result = assessments.map((a) => {
      const attempts = a.attempts || [];
      const completedAttempts = attempts.filter(
        (att) => att.status === "completed",
      );
      const avgScore =
        completedAttempts.length > 0
          ? Math.round(
              completedAttempts.reduce(
                (sum, att) => sum + (att.scorePercentage || 0),
                0,
              ) / completedAttempts.length,
            )
          : null;

      return {
        id: a._id.toString(),
        title: a.title,
        description: a.description || "",
        status: a.isLocked ? "locked" : "unlocked",
        questionsCount: a.questions?.length ?? 0,
        durationMinutes: a.durationMinutes ?? a.duration ?? 15,
        attemptsCount: attempts.length,
        completionPercentage: avgScore,
      };
    });

    res.status(200).json({ assessments: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch assessments." });
  }
};

/**
 * GET /api/instructor/assessments/:assessmentId
 * Full assessment with questions + answer key (instructor only).
 */
export const getInstructorAssessmentById = async (req, res) => {
  try {
    const { assessmentId } = req.params;

    const assessment = await Assessment.findById(assessmentId);
    if (!assessment) {
      return res.status(404).json({ message: "Assessment not found." });
    }

    const questions = (assessment.questions || []).map((q, idx) => ({
      id: q._id?.toString() || idx,
      question: q.questionText || q.question || q.text || "",
      options: q.options || [],
      correctIdx: q.correctOptionIndex ?? q.correctIdx ?? q.correctAnswer ?? 0,
      explanation: q.explanation || q.rationale || "",
    }));

    res.status(200).json({
      id: assessment._id.toString(),
      title: assessment.title,
      description: assessment.description || "",
      durationMinutes: assessment.durationMinutes ?? assessment.duration ?? 15,
      questions,
      attemptsCount: (assessment.attempts || []).length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch assessment." });
  }
};

/**
 * GET /api/instructor/dashboard
 * Aggregated data for the facilitator dashboard.
 */
export const getInstructorDashboard = async (req, res) => {
  try {
    const instructor = await User.findById(req.userId).select(
      "fullName name email avatar role status createdAt cohortId cohortIds",
    );
    if (!instructor) {
      return res.status(404).json({ message: "User not found." });
    }

    // Support both single cohortId and future multi-cohort (cohortIds)
    const cohortFilter = instructor.cohortIds?.length
      ? { _id: { $in: instructor.cohortIds } }
      : instructor.cohortId
        ? { _id: instructor.cohortId }
        : {}; // empty → no cohorts

    const cohorts = await Cohort.find(cohortFilter).sort({ startDate: -1 });

    // ---- Cohorts + student counts ----
    const cohortCards = await Promise.all(
      cohorts.map(async (c) => {
        const students = await User.find({
          cohortId: c._id,
          role: "student",
        }).select("status");

        const active = students.filter(
          (s) => s.status === "enrolled" || s.status === "active",
        ).length;

        return {
          id: c._id.toString(),
          slug: c.code,
          title: c.name,
          totalStudents: students.length,
          activeStudents: active,
          inactiveStudents: students.length - active,
          icon: c.icon || "/badges/skyboss.png",
        };
      }),
    );

    const totalStudents = cohortCards.reduce(
      (sum, c) => sum + c.totalStudents,
      0,
    );

    // ---- Pending solos to grade ----
    // A submission is "to grade" when status === "pending"
    const cohortIds = cohorts.map((c) => c._id);
    const solos = await Solo.find({ cohortId: { $in: cohortIds } }).populate(
      "submissions.studentId",
      "fullName name avatar",
    );

    const pendingSolos = [];
    for (const solo of solos) {
      for (const sub of solo.submissions || []) {
        if (sub.status === "pending") {
          const student = sub.studentId; // populated
          pendingSolos.push({
            id: `${solo._id}-${sub._id || sub.studentId}`, // unique key
            soloId: solo._id.toString(),
            submissionId: sub._id?.toString(),
            title: solo.title || "Untitled Solo",
            studentName: student?.fullName || student?.name || "Student",
            studentAvatar: student?.avatar || "/temp-student-asset/joan.jpg",
            submittedAt: sub.submittedAt || sub.createdAt || null,
          });
        }
      }
    }

    // Sort newest first and limit (optional)
    pendingSolos.sort((a, b) => {
      if (!a.submittedAt) return 1;
      if (!b.submittedAt) return -1;
      return new Date(b.submittedAt) - new Date(a.submittedAt);
    });

    // ---- Profile ----
    const profile = {
      id: instructor._id.toString(),
      name: instructor.fullName || instructor.name || "Instructor",
      email: instructor.email,
      avatar: instructor.avatar || "/temp-instructor-asset/instructor.jpg",
      title: "Gold star Facilitator", // hardcode or derive from role/badges later
      joinedAt: instructor.createdAt,
    };

    // Hours – no tracking model exists yet → return 0
    // You can replace this later with real aggregation
    const stats = {
      cohortsCount: cohortCards.length,
      studentsCount: totalStudents,
      hoursThisMonth: 0,
      hoursOverall: 0,
    };

    res.status(200).json({
      profile,
      stats,
      cohorts: cohortCards,
      pendingSolos: pendingSolos.slice(0, 10), // show top 10
      // schedule can be added later
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to load dashboard." });
  }
};
/**
 * GET /api/instructor/solos/submissions
 * All submissions (pending + graded) across the instructor's cohorts.
 */
export const getInstructorSoloSubmissions = async (req, res) => {
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

    const cohorts = await Cohort.find(cohortFilter).select("_id name code");
    const cohortIds = cohorts.map((c) => c._id);

    if (cohortIds.length === 0) {
      return res.status(200).json({ submissions: [] });
    }

    const solos = await Solo.find({ cohortId: { $in: cohortIds } })
      .populate("submissions.studentId", "fullName name avatar email")
      .sort({ updatedAt: -1 });

    const submissions = [];

    for (const solo of solos) {
      for (const sub of solo.submissions || []) {
        const student = sub.studentId;
        if (!student) continue;

        submissions.push({
          id: sub._id?.toString() || `${solo._id}-${student._id}`,
          soloId: solo._id.toString(),
          submissionId: sub._id?.toString(),
          studentName: student.fullName || student.name || "Student",
          studentAvatar: student.avatar || "/temp-student-asset/joan.jpg",
          studentEmail: student.email,
          projectTitle: solo.title || "Untitled Solo",
          repoLink: sub.repositoryUrl || sub.repoLink || "#",
          liveDemoLink: sub.liveDemoUrl || sub.liveDemoLink || "#",
          notes: sub.notes || "",
          status: sub.status === "graded" ? "graded" : "pending",
          totalScore: sub.scorePercentage ?? sub.totalScore ?? null,
          submittedAt: sub.submittedAt || sub.createdAt || null,
          gradedAt: sub.gradedAt || null,
          // keep original feedback if already graded
          generalFeedback: sub.generalFeedback || "",
          rubricScores: sub.rubricScores || {},
          rubricRemarks: sub.rubricRemarks || {},
        });
      }
    }

    // Newest first
    submissions.sort((a, b) => {
      const da = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
      const db = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
      return db - da;
    });

    res.status(200).json({ submissions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch solo submissions." });
  }
};

/**
 * POST /api/instructor/solos/:soloId/submissions/:submissionId/grade
 * Body: {
 *   scores: { [criterionId]: number },
 *   remarks: { [criterionId]: string },
 *   generalFeedback: string,
 *   totalScore: number   // percentage 0-100
 * }
 */
export const gradeSoloSubmission = async (req, res) => {
  try {
    const { soloId, submissionId } = req.params;
    const { scores, remarks, generalFeedback, totalScore } = req.body;

    if (totalScore === undefined || totalScore === null) {
      return res.status(400).json({ message: "totalScore is required." });
    }

    const solo = await Solo.findById(soloId);
    if (!solo) {
      return res.status(404).json({ message: "Solo not found." });
    }

    const submission = solo.submissions.id(submissionId);
    if (!submission) {
      // fallback if submissions don't use subdocuments with _id
      const idx = solo.submissions.findIndex(
        (s) => s._id?.toString() === submissionId,
      );
      if (idx === -1) {
        return res.status(404).json({ message: "Submission not found." });
      }
      // mutate by index
      solo.submissions[idx].status = "graded";
      solo.submissions[idx].scorePercentage = totalScore;
      solo.submissions[idx].totalScore = totalScore;
      solo.submissions[idx].generalFeedback = generalFeedback || "";
      solo.submissions[idx].rubricScores = scores || {};
      solo.submissions[idx].rubricRemarks = remarks || {};
      solo.submissions[idx].gradedAt = new Date();
      solo.submissions[idx].gradedBy = req.userId;
    } else {
      submission.status = "graded";
      submission.scorePercentage = totalScore;
      submission.totalScore = totalScore;
      submission.generalFeedback = generalFeedback || "";
      submission.rubricScores = scores || {};
      submission.rubricRemarks = remarks || {};
      submission.gradedAt = new Date();
      submission.gradedBy = req.userId;
    }

    await solo.save();

    res.status(200).json({
      message: "Grade submitted successfully.",
      totalScore,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to submit grade." });
  }
};

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
          id: c.code || c._id.toString(), // used as courseId in the URL
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
/**
 * GET /api/instructor/solos
 * All solos for the instructor’s cohort(s)
 */
export const getInstructorSolos = async (req, res) => {
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

    const cohorts = await Cohort.find(cohortFilter).select("_id");
    const cohortIds = cohorts.map((c) => c._id);

    if (cohortIds.length === 0) {
      return res.status(200).json({ solos: [] });
    }

    const solos = await Solo.find({ cohortId: { $in: cohortIds } })
      .sort({ order: 1, createdAt: -1 })
      .select("title description dueDate order isLocked timeToComplete");

    const result = solos.map((s) => ({
      id: s._id.toString(),
      title: s.title,
      description: s.description,
      dueDate: s.dueDate,
      isLocked: s.isLocked,
      timeToComplete: s.timeToComplete,
    }));

    res.status(200).json({ solos: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch solos." });
  }
};

/**
 * GET /api/instructor/solos/:soloId
 * Full solo brief for instructor view
 */
export const getInstructorSoloById = async (req, res) => {
  try {
    const { soloId } = req.params;

    const solo = await Solo.findById(soloId).populate(
      "submissions.gradedByInstructorId",
      "fullName name avatar",
    );

    if (!solo) {
      return res.status(404).json({ message: "Solo not found." });
    }

    // For the instructor “brief” view we mostly care about the assignment itself.
    // If you later want a specific student’s graded view, pass ?studentId=...
    const { studentId } = req.query;
    let gradedView = null;

    if (studentId) {
      const sub = (solo.submissions || []).find(
        (s) => s.studentId.toString() === studentId && s.status === "graded",
      );
      if (sub) {
        const grader = sub.gradedByInstructorId;
        gradedView = {
          isGraded: true,
          score: sub.score ?? null,
          feedback: sub.feedback || "",
          instructorName: grader?.fullName || grader?.name || "Instructor",
          instructorAvatar:
            grader?.avatar || "/temp-instructor-asset/instructor.jpg",
        };
      }
    }

    res.status(200).json({
      id: solo._id.toString(),
      title: solo.title,
      description: solo.description,
      dueDate: solo.dueDate,
      timeToComplete: solo.timeToComplete || "—",
      overview: solo.overview || solo.description || "",
      goal: solo.goal || "",
      techStack: solo.techStack || [],
      architecture: solo.architecture || [],
      isLocked: solo.isLocked,
      // graded view only when a specific student submission is graded
      ...(gradedView || { isGraded: false }),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch solo." });
  }
};
