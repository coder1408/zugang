import { describe, it, expect } from "vitest";
import {
  analyzeProfileVulnerabilities,
  auditAllPrograms,
  evaluateProgram,
  generateEctsMappingCsv,
  generateFacultyVerificationEmail,
} from "@/lib/engine";
import { loadSeedPrograms } from "@/data/programs";
import { SAMPLE_BTECH_CSE_TRANSCRIPT } from "@/data/sampleTranscripts";
import { ProgramRulesDatabaseSchema, type TranscriptProfile } from "@/lib/schemas";

const programs = loadSeedPrograms();
const getProgram = (id: string) => {
  const found = programs.find((p) => p.id === id);
  if (!found) throw new Error(`Seed program not found: ${id}`);
  return found;
};

describe("Seed Rules Database Integrity", () => {
  it("validates all 27 German public M.Sc./M.Eng. programs strictly against Zod schema", () => {
    const parsed = ProgramRulesDatabaseSchema.parse(programs);
    expect(parsed).toHaveLength(27);

    const uniqueIds = new Set(parsed.map((p) => p.id));
    expect(uniqueIds.size).toBe(27);

    for (const p of parsed) {
      const weightSum = p.selectionWeights.reduce(
        (sum, w) => sum + w.weightPercent,
        0
      );
      expect(weightSum).toBe(100);
      expect(p.citation.officialPdfUrl).toMatch(/^https?:\/\//);
      expect(p.citation.paragraphRef.length).toBeGreaterThan(2);
    }
  });

  it("evaluates Tübingen's 27-ECTS Math / 2.0 GPA cliff & BTU Cottbus's strict No-MOI rule accurately", () => {
    const tuebingen = getProgram("uni-tuebingen-msc-machine-learning");
    const btu = getProgram("btu-cottbus-msc-ai");

    // Tübingen: €1,500/sem BW non-EU tuition, hard 2.0 grade & 27-ECTS Math cliff
    expect(tuebingen.tuitionPerSemesterEur).toBe(1500);
    expect(evaluateProgram(SAMPLE_BTECH_CSE_TRANSCRIPT, tuebingen).verdict).toBe("RED");

    // CGPA 8.3 => 1.85 (1.8) opt vs 2.02 (2.0) cons (<= 2.0), IELTS 7.0, +4 cr Math => 28.5 ECTS >= 27 => GREEN
    const strongMathForTuebingen: TranscriptProfile = {
      ...SAMPLE_BTECH_CSE_TRANSCRIPT,
      cgpa: 8.4, // 1.8 opt, 1.9 cons <= 2.0
      englishProof: { type: "IELTS", score: 7.0 },
      courses: [
        ...SAMPLE_BTECH_CSE_TRANSCRIPT.courses,
        {
          id: "extra-math-tueb",
          code: "MAT501",
          title: "Numerical Linear Algebra & Multivariable Analysis",
          indianCredits: 4, // +6 ECTS => Math+Stoch = 28.5 >= 27
          grade: "A",
          primaryBucket: "MATH",
          isThesisOrCapstone: false,
          isInternship: false,
        },
      ],
    };
    expect(evaluateProgram(strongMathForTuebingen, tuebingen).verdict).toBe("GREEN");

    // BTU Cottbus: RED on MOI, GREEN immediately with IELTS 6.0
    expect(evaluateProgram(SAMPLE_BTECH_CSE_TRANSCRIPT, btu).verdict).toBe("RED");
    expect(
      evaluateProgram(
        { ...SAMPLE_BTECH_CSE_TRANSCRIPT, englishProof: { type: "IELTS", score: 6.0 } },
        btu
      ).verdict
    ).toBe("GREEN");
  });

  it("produces a realistic GREEN / YELLOW / RED spread across all 25 programs for the Sample Transcript", () => {
    const results = auditAllPrograms(SAMPLE_BTECH_CSE_TRANSCRIPT, programs);
    const byId = Object.fromEntries(results.map((r) => [r.programId, r.verdict]));

    // Original 6 edge-case anchors
    expect(byId["tu-dresden-msc-computer-science"]).toBe("GREEN");
    expect(byId["uni-passau-msc-computer-science"]).toBe("GREEN");
    expect(byId["uni-wuerzburg-msc-ai"]).toBe("YELLOW");
    expect(byId["tu-braunschweig-msc-data-science"]).toBe("YELLOW");
    expect(byId["uni-marburg-msc-computer-science"]).toBe("RED");
    expect(byId["rwth-aachen-msc-data-science"]).toBe("RED");

    // Folder programmes + newly added Tier-1 programmes
    expect(byId["uni-hildesheim-msc-data-analytics"]).toBe("GREEN");
    expect(byId["uni-hildesheim-msc-software-engineering"]).toBe("GREEN");
    expect(byId["hsrm-meng-ai-advanced-it"]).toBe("YELLOW");
    expect(byId["hbrs-msc-autonomous-systems"]).toBe("RED");
    expect(byId["saarland-msc-computer-science"]).toBe("RED"); // MOI strictly rejected
    expect(byId["uni-bonn-msc-computer-science"]).toBe("RED"); // MOI strictly rejected
    expect(byId["uni-bonn-msc-ai"]).toBe("RED"); // MOI strictly rejected
    expect(byId["fau-erlangen-msc-ai"]).toBe("RED"); // Mandatory GRE missing (even though MOI passes)
    expect(byId["uni-paderborn-msc-computer-science"]).toBe("RED"); // Missing GRE/dMAT & MOI

    // Verify sorting order invariant: all GREENs before YELLOWs before REDs
    const rank = { GREEN: 0, YELLOW: 1, RED: 2 } as const;
    for (let i = 1; i < results.length; i++) {
      expect(rank[results[i].verdict]).toBeGreaterThanOrEqual(
        rank[results[i - 1].verdict]
      );
    }
  });

  it("evaluates Paderborn's GRE/dMAT & < 1.8 GPA exemption and Bonn's solo 12-ECTS thesis rule accurately", () => {
    const paderborn = getProgram("uni-paderborn-msc-computer-science");
    const bonnCs = getProgram("uni-bonn-msc-computer-science");
    const fauAi = getProgram("fau-erlangen-msc-ai");

    // 1. Paderborn accepts dMAT >= 50% in lieu of GRE
    const withDmat: TranscriptProfile = {
      ...SAMPLE_BTECH_CSE_TRANSCRIPT,
      cgpa: 7.5,
      englishProof: { type: "IELTS", score: 7.0 },
      standardizedTest: { dmatScore: 58 },
    };
    const pbDmatRes = evaluateProgram(withDmat, paderborn);
    expect(pbDmatRes.pillars.find((p) => p.pillar === "STANDARDIZED_TEST")!.status).toBe("GREEN");

    // 2. Paderborn waives GRE/dMAT when conservative German grade < 1.8 (e.g. CGPA 8.8 => 1.6 opt, 1.7 cons)
    const highGpaNoGre: TranscriptProfile = {
      ...SAMPLE_BTECH_CSE_TRANSCRIPT,
      cgpa: 8.8,
      englishProof: { type: "IELTS", score: 7.0 },
      standardizedTest: {},
    };
    const pbExemptRes = evaluateProgram(highGpaNoGre, paderborn);
    expect(pbExemptRes.pillars.find((p) => p.pillar === "STANDARDIZED_TEST")!.status).toBe("GREEN");
    expect(pbExemptRes.pillars.find((p) => p.pillar === "STANDARDIZED_TEST")!.headline).toContain("Exempt");

    // 3. Bonn CS: with IELTS 7.0 + group 8-cr (12 ECTS) capstone => YELLOW on solo thesis; solo 8-cr => GREEN
    const bonnGroup: TranscriptProfile = {
      ...SAMPLE_BTECH_CSE_TRANSCRIPT,
      englishProof: { type: "IELTS", score: 7.0 },
      thesis: { creditsIndian: 8, isSolo: false }, // 12.0 ECTS, group
    };
    expect(evaluateProgram(bonnGroup, bonnCs).verdict).toBe("YELLOW");
    expect(
      evaluateProgram({ ...bonnGroup, thesis: { creditsIndian: 8, isSolo: true } }, bonnCs).verdict
    ).toBe("GREEN");

    // 4. FAU AI: accepts MOI, requires GRE
    const fauWithGre: TranscriptProfile = {
      ...SAMPLE_BTECH_CSE_TRANSCRIPT,
      cgpa: 8.2,
      englishProof: { type: "MOI", score: null },
      standardizedTest: { greQuant: 162, greVerbal: 150, greAwa: 4.0 },
    };
    expect(evaluateProgram(fauWithGre, fauAi).verdict).toBe("GREEN");
  });

  it("evaluates Siegen's 10-ECTS project/thesis rule & H-BRS strict MOI rule accurately", () => {
    const siegen = getProgram("uni-siegen-msc-computer-science");
    const hbrs = getProgram("hbrs-msc-autonomous-systems");

    // With IELTS 7.0 + group capstone 7 cr (10.5 ECTS >= 10), Siegen accepts group project work (solo_thesis_required=false)
    const withIeltsAndProject: TranscriptProfile = {
      ...SAMPLE_BTECH_CSE_TRANSCRIPT,
      cgpa: 8.2,
      englishProof: { type: "IELTS", score: 7.0 },
      thesis: { creditsIndian: 7, isSolo: false },
    };
    const siegenRes = evaluateProgram(withIeltsAndProject, siegen);
    expect(siegenRes.pillars.find((p) => p.pillar === "THESIS")!.status).toBe("GREEN");
    expect(siegenRes.pillars.find((p) => p.pillar === "ENGLISH")!.status).toBe("GREEN");

    // H-BRS flips from RED (MOI) to GREEN with IELTS 7.0 & CGPA 8.2 (1.9-2.0 <= 2.5)
    expect(evaluateProgram(SAMPLE_BTECH_CSE_TRANSCRIPT, hbrs).verdict).toBe("RED");
    expect(evaluateProgram(withIeltsAndProject, hbrs).verdict).toBe("GREEN");
  });
});

describe("Edge Case 1: Strict Math/Stochastics Cliff & Mandatory GRE (RWTH Aachen)", () => {
  const rwth = getProgram("rwth-aachen-msc-data-science");

  it("returns RED when Math/Stochastics falls short even if GRE & IELTS pass (auflagen_allowed = false)", () => {
    const profileWithGreAndIelts: TranscriptProfile = {
      ...SAMPLE_BTECH_CSE_TRANSCRIPT,
      englishProof: { type: "IELTS", score: 7.0 },
      standardizedTest: { greQuant: 165, greVerbal: 152, greAwa: 4.0 },
    };

    const res = evaluateProgram(profileWithGreAndIelts, rwth);
    expect(res.verdict).toBe("RED");
    const bucketPillar = res.pillars.find((p) => p.pillar === "BUCKETS")!;
    expect(bucketPillar.status).toBe("RED");
    expect(bucketPillar.headline).toContain("Hard subject-bucket deficit");
  });

  it("returns RED when mandatory GRE is missing even if all Math/Stochastics buckets & IELTS pass", () => {
    const strongMathNoGre: TranscriptProfile = {
      ...SAMPLE_BTECH_CSE_TRANSCRIPT,
      englishProof: { type: "IELTS", score: 7.0 },
      standardizedTest: {},
      courses: [
        ...SAMPLE_BTECH_CSE_TRANSCRIPT.courses,
        {
          id: "extra-stoch",
          code: "MAT499",
          title: "Advanced Mathematical Statistics & Stochastic Processes",
          indianCredits: 4, // +6 ECTS => Stochastics becomes 10.5 >= 9
          grade: "A",
          primaryBucket: "STOCHASTICS",
          isThesisOrCapstone: false,
          isInternship: false,
        },
      ],
    };

    const res = evaluateProgram(strongMathNoGre, rwth);
    expect(res.verdict).toBe("RED");
    expect(res.pillars.find((p) => p.pillar === "BUCKETS")!.status).toBe("GREEN");
    expect(res.pillars.find((p) => p.pillar === "STANDARDIZED_TEST")!.status).toBe(
      "RED"
    );
  });

  it("flips to GREEN when Math >= 18, Stochastics >= 9, IELTS >= 6.5, and GRE cutoffs are all met", () => {
    const fullyEligible: TranscriptProfile = {
      ...SAMPLE_BTECH_CSE_TRANSCRIPT,
      englishProof: { type: "IELTS", score: 7.0 },
      standardizedTest: { greQuant: 164, greVerbal: 150, greAwa: 4.0 },
      courses: [
        ...SAMPLE_BTECH_CSE_TRANSCRIPT.courses,
        {
          id: "extra-stoch",
          code: "MAT499",
          title: "Advanced Mathematical Statistics & Stochastic Processes",
          indianCredits: 4, // +6 ECTS => Stochastics = 10.5 >= 9
          grade: "A",
          primaryBucket: "STOCHASTICS",
          isThesisOrCapstone: false,
          isInternship: false,
        },
      ],
    };

    const res = evaluateProgram(fullyEligible, rwth);
    expect(res.verdict).toBe("GREEN");
  });
});

describe("Edge Case 2: Thesis & Internship Exclusion Rule (TU Dresden § 5(3))", () => {
  const tud = getProgram("tu-dresden-msc-computer-science");

  it("returns RED when removing thesis/internship drops core buckets below threshold", () => {
    // Strip out several PROG_SE_AI_ML courses so student is below 25 ECTS without counting capstone
    const weakCoreProfile: TranscriptProfile = {
      ...SAMPLE_BTECH_CSE_TRANSCRIPT,
      courses: [
        ...SAMPLE_BTECH_CSE_TRANSCRIPT.courses.filter(
          (c) =>
            c.primaryBucket !== "PROG_SE_AI_ML" ||
            ["c-03", "c-10", "c-15"].includes(c.id) // only 12 Indian cr = 18 ECTS (< 25 required)
        ),
        {
          id: "big-capstone",
          code: "CS890",
          title: "AI Software Capstone Thesis",
          indianCredits: 8, // 12 ECTS — MUST be excluded per § 5(3)
          grade: "A+",
          primaryBucket: "PROG_SE_AI_ML",
          isThesisOrCapstone: true,
          isInternship: false,
        },
      ],
    };

    const res = evaluateProgram(weakCoreProfile, tud);
    expect(res.verdict).toBe("RED");
    expect(
      res.bucketSolve.excludedCourses.some((e) => e.courseId === "big-capstone")
    ).toBe(true);
    expect(res.pillars.find((p) => p.pillar === "BUCKETS")!.status).toBe("RED");
  });
});

describe("Edge Case 3: Group Capstone vs. Solo 10-ECTS Thesis & Grade Range Cliff (Uni Würzburg)", () => {
  const wue = getProgram("uni-wuerzburg-msc-ai");

  it("returns YELLOW for a group capstone (even if >= 10 ECTS) and generates a faculty verification email", () => {
    const groupCapstoneProfile: TranscriptProfile = {
      ...SAMPLE_BTECH_CSE_TRANSCRIPT,
      cgpa: 8.2, // Optimistic 1.9, Conservative 2.0 (clearly <= 2.5)
      thesis: { creditsIndian: 7, isSolo: false }, // 10.5 ECTS, but GROUP capstone
    };

    const res = evaluateProgram(groupCapstoneProfile, wue);
    expect(res.verdict).toBe("YELLOW");
    expect(res.pillars.find((p) => p.pillar === "THESIS")!.status).toBe("YELLOW");
    expect(res.pillars.find((p) => p.pillar === "GRADE")!.status).toBe("GREEN");

    const email = generateFacultyVerificationEmail(groupCapstoneProfile, wue, res);
    expect(email.to).toBe(wue.citation.facultyEmail);
    expect(email.body).toContain("group final-year project");
    expect(email.body).toContain(wue.citation.paragraphRef);
  });

  it("returns RED when 0 thesis credits are reported", () => {
    const noThesisProfile: TranscriptProfile = {
      ...SAMPLE_BTECH_CSE_TRANSCRIPT,
      cgpa: 8.2,
      thesis: { creditsIndian: 0, isSolo: false },
    };

    const res = evaluateProgram(noThesisProfile, wue);
    expect(res.verdict).toBe("RED");
    expect(res.pillars.find((p) => p.pillar === "THESIS")!.status).toBe("RED");
  });

  it("returns GREEN when student has a Solo >= 10 ECTS thesis and grade <= 2.5 conservatively", () => {
    const soloStrongProfile: TranscriptProfile = {
      ...SAMPLE_BTECH_CSE_TRANSCRIPT,
      cgpa: 8.2, // 1.9 - 2.0 <= 2.5
      thesis: { creditsIndian: 7, isSolo: true }, // 10.5 ECTS Solo
    };

    const res = evaluateProgram(soloStrongProfile, wue);
    expect(res.verdict).toBe("GREEN");
  });

  it("returns YELLOW when grade cutoff (2.5) sits between optimistic (2.3) and conservative (2.6) N_min", () => {
    const straddlingProfile: TranscriptProfile = {
      ...SAMPLE_BTECH_CSE_TRANSCRIPT,
      cgpa: 7.3, // 2.3 (N_min=4.0) vs 2.6 (N_min=5.0)
      minPassingGrade: null,
      thesis: { creditsIndian: 7, isSolo: true }, // 10.5 ECTS Solo (passes thesis)
    };

    const res = evaluateProgram(straddlingProfile, wue);
    expect(res.verdict).toBe("YELLOW");
    expect(res.pillars.find((p) => p.pillar === "THESIS")!.status).toBe("GREEN");
    expect(res.pillars.find((p) => p.pillar === "GRADE")!.status).toBe("YELLOW");
  });
});

describe("Edge Case 4: Strict MOI Rejection (Uni Marburg)", () => {
  const marburg = getProgram("uni-marburg-msc-computer-science");

  it("returns RED when student relies on MOI without IELTS/TOEFL", () => {
    const res = evaluateProgram(SAMPLE_BTECH_CSE_TRANSCRIPT, marburg);
    expect(res.verdict).toBe("RED");
    expect(res.pillars.find((p) => p.pillar === "ENGLISH")!.status).toBe("RED");
    expect(res.pillars.find((p) => p.pillar === "ENGLISH")!.headline).toContain(
      "MOI Rejected"
    );
  });

  it("flips to GREEN when official IELTS 7.0 (C1) is provided", () => {
    const withIelts: TranscriptProfile = {
      ...SAMPLE_BTECH_CSE_TRANSCRIPT,
      englishProof: { type: "IELTS", score: 7.0 },
    };

    const res = evaluateProgram(withIelts, marburg);
    expect(res.verdict).toBe("GREEN");
  });
});

describe("Edge Case 5: Minor Deficit Auflagen Allowed (TU Braunschweig)", () => {
  const tubs = getProgram("tu-braunschweig-msc-data-science");

  it("returns YELLOW when bucket deficit is <= 15 ECTS (auflagen_allowed = true)", () => {
    // Sample has Math 18 (needs 20, -2) + Stochastics 4.5 (needs 5, -0.5) => 2.5 ECTS total deficit <= 15
    const res = evaluateProgram(SAMPLE_BTECH_CSE_TRANSCRIPT, tubs);
    expect(res.verdict).toBe("YELLOW");
    expect(res.bucketSolve.totalDeficitEcts).toBe(2.5);
    expect(res.pillars.find((p) => p.pillar === "BUCKETS")!.status).toBe("YELLOW");
  });

  it("returns RED when bucket deficit exceeds the 15-ECTS Auflagen cap", () => {
    const hugeMathGap: TranscriptProfile = {
      ...SAMPLE_BTECH_CSE_TRANSCRIPT,
      courses: SAMPLE_BTECH_CSE_TRANSCRIPT.courses.filter(
        (c) => c.primaryBucket !== "MATH" && c.primaryBucket !== "STOCHASTICS"
      ),
    };

    const res = evaluateProgram(hugeMathGap, tubs);
    expect(res.verdict).toBe("RED");
    expect(res.bucketSolve.totalDeficitEcts).toBeGreaterThan(15);
  });
});

describe("Edge Case 6: Open-Admission No-NC Safety & Hard Grade Cliff (Uni Passau)", () => {
  const passau = getProgram("uni-passau-msc-computer-science");

  it("returns GREEN for standard B.Tech. CSE graduate with MOI and CGPA 7.3 (2.3-2.6 <= 2.7)", () => {
    const res = evaluateProgram(SAMPLE_BTECH_CSE_TRANSCRIPT, passau);
    expect(res.verdict).toBe("GREEN");
    expect(passau.isNoNc).toBe(true);
  });

  it("returns RED when grade is worse than hard 2.7 cutoff even under optimistic N_min=4.0", () => {
    const lowGpa: TranscriptProfile = {
      ...SAMPLE_BTECH_CSE_TRANSCRIPT,
      cgpa: 6.2, // Optimistic (4.0) => 1 + 3*(3.8/6) = 2.9 > 2.7
    };

    const res = evaluateProgram(lowGpa, passau);
    expect(res.verdict).toBe("RED");
    expect(res.pillars.find((p) => p.pillar === "GRADE")!.status).toBe("RED");
  });

  it("returns YELLOW when CGPA 7.0 straddles Passau's 2.7 cutoff (2.5 optimistic vs 2.8 conservative)", () => {
    const borderGpa: TranscriptProfile = {
      ...SAMPLE_BTECH_CSE_TRANSCRIPT,
      cgpa: 7.0, // Optimistic (4.0) => 2.5 <= 2.7; Conservative (5.0) => 2.8 > 2.7
    };

    const res = evaluateProgram(borderGpa, passau);
    expect(res.verdict).toBe("YELLOW");
    expect(res.pillars.find((p) => p.pillar === "GRADE")!.status).toBe("YELLOW");
  });
});

describe("Receipts Artifacts: CSV Export & Profile Vulnerabilities", () => {
  it("generates an RFC-4180 CSV ECTS Mapping Table with non-overlapping assignments and regulation citation", () => {
    const tud = getProgram("tu-dresden-msc-computer-science");
    const audit = evaluateProgram(SAMPLE_BTECH_CSE_TRANSCRIPT, tud);
    const csv = generateEctsMappingCsv(SAMPLE_BTECH_CSE_TRANSCRIPT, tud, audit);

    expect(csv).toContain("Course Code,Course Title,Semester,Indian Credits");
    expect(csv).toContain("Excluded: Bachelor Thesis / Capstone excluded");
    expect(csv).toContain("Counted (1x — Non-Overlapping)");
    expect(csv).toContain(tud.citation.paragraphRef);
  });

  it("detects concrete profile vulnerabilities deterministically for Screen 2", () => {
    const results = auditAllPrograms(SAMPLE_BTECH_CSE_TRANSCRIPT, programs);
    const vulns = analyzeProfileVulnerabilities(SAMPLE_BTECH_CSE_TRANSCRIPT, results);
    const ids = vulns.map((v) => v.id);

    expect(ids).toContain("math-stochastics-cliff");
    expect(ids).toContain("capstone-vs-solo-thesis");
    expect(ids).toContain("moi-rejected");
    expect(ids).toContain("missing-mandatory-gre");
    expect(ids).toContain("ambiguous-nmin-spread");
  });
});
