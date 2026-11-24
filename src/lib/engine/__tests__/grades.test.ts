import { describe, it, expect } from "vitest";
import {
  computeBavarianGrade,
  computeCreditChecksum,
  computeEctsMultipliers,
  computeGermanGradeRange,
  truncateToDecimals,
} from "@/lib/engine/grades";
import { SAMPLE_BTECH_CSE_TRANSCRIPT } from "@/data/sampleTranscripts";

describe("ECTS Multipliers", () => {
  it("computes standard 240-scale and conservative 180-scale multipliers", () => {
    const m = computeEctsMultipliers(160);
    expect(m.standard240).toBeCloseTo(1.5, 6);
    expect(m.conservative180).toBeCloseTo(1.125, 6);
  });

  it("throws on non-positive total Indian credits", () => {
    expect(() => computeEctsMultipliers(0)).toThrow();
    expect(() => computeEctsMultipliers(-120)).toThrow();
  });
});

describe("Modified Bavarian Formula & Truncation", () => {
  it("truncates (never rounds) to 1 and 2 decimal places safely", () => {
    // 7.5/10 with N_min=4.0 => 1 + 3*(2.5/6) = 2.25 => truncated1 MUST be 2.2 (NOT 2.3)
    const g = computeBavarianGrade(7.5, 10, 4);
    expect(g.raw).toBeCloseTo(2.25, 6);
    expect(g.truncated1).toBe(2.2);
    expect(g.truncated2).toBe(2.25);

    // 7.3/10 with N_min=4.0 => 1 + 3*(2.7/6) = 2.35 => truncated1 = 2.3, truncated2 = 2.35
    const g2 = computeBavarianGrade(7.3, 10, 4);
    expect(g2.truncated1).toBe(2.3);
    expect(g2.truncated2).toBe(2.35);

    // 7.3/10 with N_min=5.0 => 1 + 3*(2.7/5) = 2.62 => truncated1 = 2.6, truncated2 = 2.62
    const g3 = computeBavarianGrade(7.3, 10, 5);
    expect(g3.truncated1).toBe(2.6);
    expect(g3.truncated2).toBe(2.62);
  });

  it("handles exact floating-point boundaries without off-by-0.1 errors", () => {
    // 7.4/10 with N_min=4.0 => 1 + 3*(2.6/6) = 2.3 exactly (IEEE-754 can represent 2.2999999999999998)
    const g = computeBavarianGrade(7.4, 10, 4);
    expect(g.truncated1).toBe(2.3);
    expect(g.truncated2).toBe(2.3);

    // 8.0/10 with N_min=4.0 => 2.0 exactly
    const g8 = computeBavarianGrade(8.0, 10, 4);
    expect(g8.truncated1).toBe(2.0);
    expect(g8.truncated2).toBe(2.0);

    expect(truncateToDecimals(2.2999999999999998, 1)).toBe(2.3);
    expect(truncateToDecimals(2.29, 1)).toBe(2.2);
  });

  it("clamps perfect and failing grades to [1.0, 5.0]", () => {
    expect(computeBavarianGrade(10.0, 10, 4).truncated1).toBe(1.0);
    expect(computeBavarianGrade(10.5, 10, 4).truncated1).toBe(1.0);
    expect(computeBavarianGrade(3.5, 10, 4).truncated1).toBe(5.0);
  });

  it("computes optimistic (N_min=4.0) vs conservative (N_min=5.0) range when pass floor is ambiguous", () => {
    const range = computeGermanGradeRange({
      cgpa: 7.3,
      maxGrade: 10.0,
      minPassingGrade: null,
    });
    expect(range.isAmbiguousPassFloor).toBe(true);
    expect(range.optimistic.nMin).toBe(4.0);
    expect(range.conservative.nMin).toBe(5.0);
    expect(range.optimistic.truncated1).toBe(2.3);
    expect(range.conservative.truncated1).toBe(2.6);
  });

  it("uses exact N_min when home university pass floor is explicitly known", () => {
    const range = computeGermanGradeRange({
      cgpa: 7.3,
      maxGrade: 10.0,
      minPassingGrade: 4.5,
    });
    expect(range.isAmbiguousPassFloor).toBe(false);
    expect(range.optimistic.truncated2).toBe(range.conservative.truncated2);
    expect(range.optimistic.nMin).toBe(4.5);
  });

  it("computes optimistic (40%) vs conservative (50%) German grade range on 100-point Indian percentage marksheets", () => {
    // 74.5% out of 100%:
    // N_min=40 => 1 + 3*(25.5/60) = 2.275 => truncated1 = 2.2, truncated2 = 2.27
    // N_min=50 => 1 + 3*(25.5/50) = 2.53  => truncated1 = 2.5, truncated2 = 2.53
    const range = computeGermanGradeRange({
      cgpa: 74.5,
      maxGrade: 100,
      minPassingGrade: null,
    });
    expect(range.isAmbiguousPassFloor).toBe(true);
    expect(range.optimistic.nMin).toBe(40);
    expect(range.conservative.nMin).toBe(50);
    expect(range.optimistic.truncated1).toBe(2.2);
    expect(range.optimistic.truncated2).toBe(2.27);
    expect(range.conservative.truncated1).toBe(2.5);
    expect(range.conservative.truncated2).toBe(2.53);
  });
});

describe("Credit Checksum", () => {
  it("verifies exact match on the default sample transcript (160 / 160 credits)", () => {
    const checksum = computeCreditChecksum(SAMPLE_BTECH_CSE_TRANSCRIPT);
    expect(checksum.extractedCredits).toBe(160);
    expect(checksum.officialTotalCredits).toBe(160);
    expect(checksum.deltaCredits).toBe(0);
    expect(checksum.status).toBe("MATCHED");
  });

  it("flags MINOR_DIFF and MISMATCH accurately", () => {
    const minor = computeCreditChecksum({
      totalDegreeCredits: 160,
      courses: [
        {
          id: "x",
          code: "CS1",
          title: "Bulk",
          indianCredits: 158,
          grade: "A",
          primaryBucket: "PROG_SE_AI_ML",
          isThesisOrCapstone: false,
          isInternship: false,
        },
      ],
    });
    expect(minor.status).toBe("MINOR_DIFF");

    const mismatch = computeCreditChecksum({
      totalDegreeCredits: 160,
      courses: [
        {
          id: "x",
          code: "CS1",
          title: "Bulk",
          indianCredits: 140,
          grade: "A",
          primaryBucket: "PROG_SE_AI_ML",
          isThesisOrCapstone: false,
          isInternship: false,
        },
      ],
    });
    expect(mismatch.status).toBe("MISMATCH");
    expect(mismatch.deltaCredits).toBe(-20);
  });
});
