import { describe, it, expect } from "vitest";
import { solveNonOverlappingBuckets } from "@/lib/engine/bucketSolver";
import { loadSeedPrograms } from "@/data/programs";
import { SAMPLE_BTECH_CSE_TRANSCRIPT } from "@/data/sampleTranscripts";
import type { TranscriptProfile } from "@/lib/schemas";

const programs = loadSeedPrograms();
const findProgram = (id: string) => {
  const p = programs.find((x) => x.id === id);
  if (!p) throw new Error(`Missing seed program ${id}`);
  return p;
};

describe("Non-Overlapping Subject-Bucket Solver", () => {
  it("NEVER double-counts any course across required buckets", () => {
    const tud = findProgram("tu-dresden-msc-computer-science");
    const result = solveNonOverlappingBuckets(SAMPLE_BTECH_CSE_TRANSCRIPT, tud);

    const seenIds = new Set<string>();
    for (const bucket of result.perBucket) {
      for (const c of bucket.assignedCourses) {
        expect(seenIds.has(c.courseId)).toBe(false);
        seenIds.add(c.courseId);
      }
    }
  });

  it("optimally assigns multi-eligible courses without double-counting to minimize total deficit", () => {
    const rwth = findProgram("rwth-aachen-msc-data-science");
    // RWTH requires MATH >= 18 and STOCHASTICS >= 9 (no acceptStochastics on MATH).
    // Suppose student has 12 ECTS pure MATH, 6 ECTS pure STOCHASTICS,
    // and two 6-ECTS interdisciplinary courses eligible for BOTH MATH & STOCHASTICS (total 12 ECTS).
    // Optimal non-overlapping split: 1 course (6 ECTS) -> MATH (total 18), 1 course (6 ECTS) -> STOCHASTICS (total 12) => 0 Math/Stoch deficit!
    const profile: TranscriptProfile = {
      ...SAMPLE_BTECH_CSE_TRANSCRIPT,
      totalDegreeCredits: 160, // 1.5 ECTS per credit
      courses: [
        {
          id: "m1",
          code: "M1",
          title: "Linear Algebra & Calculus",
          indianCredits: 8, // 12 ECTS
          grade: "A",
          primaryBucket: "MATH",
          isThesisOrCapstone: false,
          isInternship: false,
        },
        {
          id: "s1",
          code: "S1",
          title: "Probability Theory",
          indianCredits: 4, // 6 ECTS
          grade: "A",
          primaryBucket: "STOCHASTICS",
          isThesisOrCapstone: false,
          isInternship: false,
        },
        {
          id: "ms1",
          code: "MS1",
          title: "Mathematical Statistics & Matrix Methods",
          indianCredits: 4, // 6 ECTS — primary STOCHASTICS, also MATH
          grade: "A",
          primaryBucket: "STOCHASTICS",
          eligibleBuckets: ["STOCHASTICS", "MATH"],
          isThesisOrCapstone: false,
          isInternship: false,
        },
        {
          id: "ms2",
          code: "MS2",
          title: "Stochastic Calculus & Optimization",
          indianCredits: 4, // 6 ECTS — primary STOCHASTICS, also MATH
          grade: "A",
          primaryBucket: "STOCHASTICS",
          eligibleBuckets: ["STOCHASTICS", "MATH"],
          isThesisOrCapstone: false,
          isInternship: false,
        },
        {
          id: "p1",
          code: "P1",
          title: "Programming & Machine Learning Core",
          indianCredits: 12, // 18 ECTS
          grade: "A",
          primaryBucket: "PROG_SE_AI_ML",
          isThesisOrCapstone: false,
          isInternship: false,
        },
        {
          id: "sys1",
          code: "SYS1",
          title: "Database Systems",
          indianCredits: 4, // 6 ECTS
          grade: "A",
          primaryBucket: "SYSTEMS_OS_DB_NET",
          isThesisOrCapstone: false,
          isInternship: false,
        },
      ],
    };

    const result = solveNonOverlappingBuckets(profile, rwth);
    const math = result.perBucket.find((b) => b.bucket === "MATH")!;
    const stoch = result.perBucket.find((b) => b.bucket === "STOCHASTICS")!;

    expect(math.earnedEcts).toBe(18);
    expect(stoch.earnedEcts).toBe(12);
    expect(result.totalDeficitEcts).toBe(0);

    // Verify neither ms1 nor ms2 appears in both buckets
    const mathIds = new Set(math.assignedCourses.map((c) => c.courseId));
    const stochIds = new Set(stoch.assignedCourses.map((c) => c.courseId));
    for (const id of mathIds) {
      expect(stochIds.has(id)).toBe(false);
    }
  });

  it("strictly excludes thesis/capstone and internship modules when exclude_thesis_and_internship_from_buckets is true", () => {
    const tud = findProgram("tu-dresden-msc-computer-science");
    const result = solveNonOverlappingBuckets(SAMPLE_BTECH_CSE_TRANSCRIPT, tud);

    // Sample transcript has c-39 (Capstone Phase I, 2 cr), c-42 (Capstone Phase II, 4 cr), c-43 (Internship, 4 cr)
    const excludedIds = new Set(result.excludedCourses.map((e) => e.courseId));
    expect(excludedIds.has("c-39")).toBe(true);
    expect(excludedIds.has("c-42")).toBe(true);
    expect(excludedIds.has("c-43")).toBe(true);

    // Ensure excluded courses are not counted in any required or combined bucket
    for (const b of result.perBucket) {
      for (const c of b.assignedCourses) {
        expect(excludedIds.has(c.courseId)).toBe(false);
      }
    }
    for (const comb of result.combinedChecks) {
      for (const id of comb.includedCourseIds) {
        expect(excludedIds.has(id)).toBe(false);
      }
    }
  });

  it("does NOT let a mislabeled thesis course sneak into PROG_SE_AI_ML when exclusion is active", () => {
    const tud = findProgram("tu-dresden-msc-computer-science");
    // Student only has 15 ECTS of real PROG_SE_AI_ML (needs 25), plus a 12-ECTS AI Capstone tagged PROG_SE_AI_ML with isThesisOrCapstone=true
    const profile: TranscriptProfile = {
      ...SAMPLE_BTECH_CSE_TRANSCRIPT,
      courses: [
        ...SAMPLE_BTECH_CSE_TRANSCRIPT.courses.filter(
          (c) => c.primaryBucket !== "PROG_SE_AI_ML"
        ),
        {
          id: "real-prog",
          code: "CS201",
          title: "Software Engineering & Programming",
          indianCredits: 10, // 15 ECTS (< 25 required)
          grade: "A",
          primaryBucket: "PROG_SE_AI_ML",
          isThesisOrCapstone: false,
          isInternship: false,
        },
        {
          id: "capstone-ai",
          code: "CS899",
          title: "Final Year AI Capstone Thesis",
          indianCredits: 8, // 12 ECTS — would bring total to 27 if NOT excluded!
          grade: "A+",
          primaryBucket: "PROG_SE_AI_ML",
          isThesisOrCapstone: true,
          isInternship: false,
        },
      ],
    };

    const result = solveNonOverlappingBuckets(profile, tud);
    const progBucket = result.perBucket.find((b) => b.bucket === "PROG_SE_AI_ML")!;

    expect(result.excludedCourses.some((e) => e.courseId === "capstone-ai")).toBe(true);
    expect(
      progBucket.assignedCourses.some((c) => c.courseId === "capstone-ai")
    ).toBe(false);
    // 15 ECTS from real-prog + 6 ECTS optimally shifted from surplus multi-eligible DSA (c-12),
    // while strictly excluding the 12-ECTS capstone-ai (which would have inflated it to 33 ECTS).
    expect(progBucket.earnedEcts).toBe(21);
    expect(progBucket.deficitEcts).toBe(4);
    expect(progBucket.met).toBe(false);
  });
});
