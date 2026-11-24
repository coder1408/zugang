import type { ProgramRule, TranscriptProfile } from "@/lib/schemas";
import {
  computeEctsMultipliers,
  computeGermanGradeRange,
  computeCreditChecksum,
  round2,
  type EctsMultipliers,
  type GermanGradeRange,
} from "@/lib/engine/grades";
import {
  solveNonOverlappingBuckets,
  type BucketSolveResult,
} from "@/lib/engine/bucketSolver";

export type Verdict = "GREEN" | "YELLOW" | "RED";

export interface PillarCheckResult {
  pillar: "BUCKETS" | "THESIS" | "ENGLISH" | "STANDARDIZED_TEST" | "GRADE";
  status: Verdict;
  headline: string;
  detail: string;
}

export interface ProgramAuditResult {
  programId: string;
  program: ProgramRule;
  verdict: Verdict;
  pillars: PillarCheckResult[];
  bucketSolve: BucketSolveResult;
  gradeRange: GermanGradeRange;
  multipliers: EctsMultipliers;
  thesisEctsStandard: number;
  thesisEctsConservative: number;
  /** Concise non-redundant summary of why the program received this verdict */
  summaryReasons: string[];
}

export interface ProfileVulnerability {
  id: string;
  severity: "HIGH" | "MEDIUM" | "INFO";
  title: string;
  detail: string;
  impactedPrograms: string[];
}

function evaluateBucketsPillar(
  program: ProgramRule,
  bucketSolve: BucketSolveResult
): PillarCheckResult {
  const deficit = bucketSolve.totalDeficitEcts;
  if (deficit <= 0.001) {
    const bucketSummary =
      bucketSolve.perBucket.length > 0 && bucketSolve.combinedChecks.length > 0
        ? `${bucketSolve.perBucket.length} required buckets and ${bucketSolve.combinedChecks.length} combined credit rule${bucketSolve.combinedChecks.length > 1 ? "s" : ""}`
        : bucketSolve.perBucket.length > 0
        ? `${bucketSolve.perBucket.length} required buckets`
        : `${bucketSolve.combinedChecks.length} combined credit rule${bucketSolve.combinedChecks.length > 1 ? "s" : ""}`;
    return {
      pillar: "BUCKETS",
      status: "GREEN",
      headline: "All subject-bucket minimums met",
      detail: `0 ECTS deficit across ${bucketSummary} (non-overlapping).`,
    };
  }

  const failingLabels = [
    ...bucketSolve.perBucket
      .filter((b) => !b.met)
      .map((b) => `${b.label} (-${b.deficitEcts} ECTS)`),
    ...bucketSolve.combinedChecks
      .filter((c) => !c.met)
      .map((c) => `${c.label} (-${c.deficitEcts} ECTS)`),
  ].join("; ");

  if (
    program.bucketRules.auflagen_allowed &&
    deficit <= program.bucketRules.max_auflagen_ects
  ) {
    return {
      pillar: "BUCKETS",
      status: "YELLOW",
      headline: `Minor deficit (${deficit} ECTS) — Auflagen possible`,
      detail: `Shortfall in ${failingLabels}. Regulation permits conditional bridging modules (Auflagen) up to ${program.bucketRules.max_auflagen_ects} ECTS.`,
    };
  }

  const auflagenClause = program.bucketRules.auflagen_allowed
    ? `Deficit (${deficit} ECTS) exceeds the maximum ${program.bucketRules.max_auflagen_ects} ECTS Auflagen cap.`
    : "Regulation does not allow Auflagen (bridging modules) for unmet core buckets.";

  return {
    pillar: "BUCKETS",
    status: "RED",
    headline: `Hard subject-bucket deficit (-${deficit} ECTS)`,
    detail: `Shortfall in ${failingLabels}. ${auflagenClause}`,
  };
}

function evaluateThesisPillar(
  profile: TranscriptProfile,
  program: ProgramRule,
  thesisEctsStandard: number,
  thesisEctsConservative: number
): PillarCheckResult {
  const { min_thesis_ects, solo_thesis_required, note } = program.thesisRule;

  if (min_thesis_ects <= 0) {
    return {
      pillar: "THESIS",
      status: "GREEN",
      headline: "No minimum Bachelor thesis ECTS requirement",
      detail: note,
    };
  }

  if (thesisEctsStandard <= 0) {
    return {
      pillar: "THESIS",
      status: "RED",
      headline: `Missing mandatory ${min_thesis_ects}-ECTS Bachelor thesis`,
      detail: `Your profile reports 0 thesis/capstone credits, but this program requires at least ${min_thesis_ects} ECTS. ${note}`,
    };
  }

  if (thesisEctsStandard < min_thesis_ects) {
    const groupSuffix =
      solo_thesis_required && !profile.thesis.isSolo
        ? " Additionally, your project is marked as a Group Capstone while a solo scientific thesis is expected."
        : "";
    return {
      pillar: "THESIS",
      status: "YELLOW",
      headline: `Capstone (${thesisEctsStandard} ECTS) below ${min_thesis_ects}-ECTS thesis threshold`,
      detail: `Your ${profile.thesis.creditsIndian}-credit project converts to ${thesisEctsStandard} ECTS (240-scale) / ${thesisEctsConservative} ECTS (180-scale) vs. ${min_thesis_ects} ECTS required.${groupSuffix} Verify with faculty whether a research paper or supplementary abstract satisfies this rule.`,
    };
  }

  if (solo_thesis_required && !profile.thesis.isSolo) {
    return {
      pillar: "THESIS",
      status: "YELLOW",
      headline: "Group Capstone vs. Solo Thesis ambiguity",
      detail: `Your capstone converts to ${thesisEctsStandard} ECTS (meets ${min_thesis_ects} ECTS), but it is a Group Capstone while this program expects an individual scientific thesis. Email the Admissions Committee to verify whether an advisor-signed individual contribution letter is accepted.`,
    };
  }

  return {
    pillar: "THESIS",
    status: "GREEN",
    headline: `Thesis requirement met (${thesisEctsStandard} ECTS, ${profile.thesis.isSolo ? "Solo" : "Project"})`,
    detail: `Converts to ${thesisEctsStandard} ECTS (240-scale) / ${thesisEctsConservative} ECTS (180-scale) against the ${min_thesis_ects}-ECTS threshold.`,
  };
}

function evaluateEnglishPillar(
  profile: TranscriptProfile,
  program: ProgramRule
): PillarCheckResult {
  const { type, score } = profile.englishProof;
  const { minIelts, minToeflIbt, moiAccepted, cefrLevel, moiNote } =
    program.englishRule;

  if (type === "IELTS") {
    if (score != null && score >= minIelts) {
      return {
        pillar: "ENGLISH",
        status: "GREEN",
        headline: `IELTS ${score.toFixed(1)} meets ${cefrLevel} (min ${minIelts})`,
        detail: `Satisfies official ${cefrLevel} English requirement.`,
      };
    }
    return {
      pillar: "ENGLISH",
      status: "RED",
      headline: `IELTS ${score ?? "N/A"} below minimum ${minIelts}`,
      detail: `Requires IELTS ≥ ${minIelts} or TOEFL iBT ≥ ${minToeflIbt} (${cefrLevel}).`,
    };
  }

  if (type === "TOEFL_IBT") {
    if (score != null && score >= minToeflIbt) {
      return {
        pillar: "ENGLISH",
        status: "GREEN",
        headline: `TOEFL iBT ${score} meets ${cefrLevel} (min ${minToeflIbt})`,
        detail: `Satisfies official ${cefrLevel} English requirement.`,
      };
    }
    return {
      pillar: "ENGLISH",
      status: "RED",
      headline: `TOEFL iBT ${score ?? "N/A"} below minimum ${minToeflIbt}`,
      detail: `Requires TOEFL iBT ≥ ${minToeflIbt} or IELTS ≥ ${minIelts} (${cefrLevel}).`,
    };
  }

  if (type === "MOI") {
    if (moiAccepted) {
      return {
        pillar: "ENGLISH",
        status: "GREEN",
        headline: `MOI accepted for ${cefrLevel}`,
        detail: moiNote,
      };
    }
    return {
      pillar: "ENGLISH",
      status: "RED",
      headline: "MOI Rejected — Official IELTS/TOEFL Mandatory",
      detail: `${moiNote} You must submit IELTS ≥ ${minIelts} or TOEFL iBT ≥ ${minToeflIbt}.`,
    };
  }

  return {
    pillar: "ENGLISH",
    status: "RED",
    headline: `Missing English proof (${cefrLevel} required)`,
    detail: `Submit IELTS ≥ ${minIelts}, TOEFL iBT ≥ ${minToeflIbt}${moiAccepted ? ", or an official MOI letter" : " (MOI not accepted)"}.`,
  };
}

function evaluateStandardizedTestPillar(
  profile: TranscriptProfile,
  program: ProgramRule,
  gradeRange: GermanGradeRange
): PillarCheckResult {
  const {
    greRequired,
    dmatAccepted,
    minGreQuant,
    minGreVerbal,
    minGreAwa,
    minDmatScore,
    exemptBelowGermanGrade,
    note,
  } = program.testRule;

  if (!greRequired) {
    return {
      pillar: "STANDARDIZED_TEST",
      status: "GREEN",
      headline: "No GRE or dMAT required",
      detail: note,
    };
  }

  const test = profile.standardizedTest ?? {};

  // Check strict GPA-based GRE exemption
  if (
    exemptBelowGermanGrade != null &&
    gradeRange.conservative.truncated1 < exemptBelowGermanGrade
  ) {
    return {
      pillar: "STANDARDIZED_TEST",
      status: "GREEN",
      headline: `Exempt from GRE/dMAT (German grade ${gradeRange.conservative.truncated1.toFixed(1)} < ${exemptBelowGermanGrade.toFixed(1)})`,
      detail: note,
    };
  }

  // Check GRE thresholds
  const hasGreScores = test.greQuant != null;
  const quantOk = minGreQuant == null || (test.greQuant != null && test.greQuant >= minGreQuant);
  const verbalOk = minGreVerbal == null || (test.greVerbal != null && test.greVerbal >= minGreVerbal);
  const awaOk = minGreAwa == null || (test.greAwa != null && test.greAwa >= minGreAwa);

  if (hasGreScores && quantOk && verbalOk && awaOk) {
    return {
      pillar: "STANDARDIZED_TEST",
      status: "GREEN",
      headline: `GRE meets cutoffs (Q:${test.greQuant}${test.greVerbal != null ? `, V:${test.greVerbal}` : ""}${test.greAwa != null ? `, AWA:${test.greAwa}` : ""})`,
      detail: note,
    };
  }

  // Check dMAT alternative
  if (
    dmatAccepted &&
    test.dmatScore != null &&
    (minDmatScore == null || test.dmatScore >= minDmatScore)
  ) {
    return {
      pillar: "STANDARDIZED_TEST",
      status: "GREEN",
      headline: `dMAT score (${test.dmatScore}) meets requirement`,
      detail: note,
    };
  }

  // Ambiguous GPA exemption straddling optimistic vs. conservative N_min
  if (
    exemptBelowGermanGrade != null &&
    gradeRange.optimistic.truncated1 < exemptBelowGermanGrade
  ) {
    return {
      pillar: "STANDARDIZED_TEST",
      status: "YELLOW",
      headline: `GRE/dMAT exemption depends on N_min (${gradeRange.optimistic.truncated1.toFixed(1)}–${gradeRange.conservative.truncated1.toFixed(1)} vs. < ${exemptBelowGermanGrade.toFixed(1)})`,
      detail: `Under N_min=4.0 your grade qualifies for exemption, but under N_min=5.0 a GRE/dMAT score is mandatory. ${note}`,
    };
  }

  const requirementsList = [
    minGreQuant != null ? `Quant ≥ ${minGreQuant}` : null,
    minGreVerbal != null ? `Verbal ≥ ${minGreVerbal}` : null,
    minGreAwa != null ? `AWA ≥ ${minGreAwa}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return {
    pillar: "STANDARDIZED_TEST",
    status: "RED",
    headline: dmatAccepted
      ? "Missing mandatory GRE or dMAT score"
      : "Missing mandatory GRE score (Non-EU)",
    detail: `${hasGreScores ? "Submitted GRE is below cutoffs" : "No valid score provided"}. Required: GRE (${requirementsList || "Official report"})${dmatAccepted ? ` or dMAT ≥ ${minDmatScore ?? "pass"}` : ""}. ${note}`,
  };
}

function evaluateGradePillar(
  program: ProgramRule,
  gradeRange: GermanGradeRange
): PillarCheckResult {
  const { maxGermanGradeCutoff, cutoffBehavior, note } = program.gradeRule;
  const opt = gradeRange.optimistic.truncated1;
  const cons = gradeRange.conservative.truncated1;

  if (maxGermanGradeCutoff == null) {
    return {
      pillar: "GRADE",
      status: "GREEN",
      headline: `No hard minimum grade cutoff (Your range: ${opt.toFixed(1)}–${cons.toFixed(1)})`,
      detail: note,
    };
  }

  if (cons <= maxGermanGradeCutoff) {
    return {
      pillar: "GRADE",
      status: "GREEN",
      headline: `German grade (${opt.toFixed(1)}${opt !== cons ? `–${cons.toFixed(1)}` : ""}) clears ≤ ${maxGermanGradeCutoff.toFixed(1)} cutoff`,
      detail: `Passes even under conservative N_min = ${gradeRange.conservative.nMin.toFixed(1)}. ${note}`,
    };
  }

  if (opt <= maxGermanGradeCutoff && cons > maxGermanGradeCutoff) {
    return {
      pillar: "GRADE",
      status: "YELLOW",
      headline: `Grade cutoff (${maxGermanGradeCutoff.toFixed(1)}) sits inside your Bavarian range (${opt.toFixed(1)}–${cons.toFixed(1)})`,
      detail: `Passes under optimistic N_min=${gradeRange.optimistic.nMin.toFixed(1)} (${opt.toFixed(1)}), but fails under conservative N_min=${gradeRange.conservative.nMin.toFixed(1)} (${cons.toFixed(1)}). Verify your university's official degree-award minimum passing grade certificate.`,
    };
  }

  if (cutoffBehavior === "INTERVIEW_FALLBACK") {
    return {
      pillar: "GRADE",
      status: "YELLOW",
      headline: `Grade (${opt.toFixed(1)}) worse than ${maxGermanGradeCutoff.toFixed(1)} direct-admit cutoff — Aptitude Test path`,
      detail: `Even under optimistic N_min=${gradeRange.optimistic.nMin.toFixed(1)}, your grade is worse than ${maxGermanGradeCutoff.toFixed(1)}, so direct admission is not automatic; regulation routes eligible applicants to an oral aptitude test. ${note}`,
    };
  }

  return {
    pillar: "GRADE",
    status: "RED",
    headline: `Grade (${opt.toFixed(1)}) worse than hard ≤ ${maxGermanGradeCutoff.toFixed(1)} cutoff`,
    detail: `Fails hard minimum grade requirement even under optimistic N_min=${gradeRange.optimistic.nMin.toFixed(1)} (${gradeRange.optimistic.truncated2.toFixed(2)}). ${note}`,
  };
}

/**
 * Evaluates a single German M.Sc. program deterministically against a student's TranscriptProfile.
 * Zero LLM calls; 100% pure function.
 */
export function evaluateProgram(
  profile: TranscriptProfile,
  program: ProgramRule
): ProgramAuditResult {
  const multipliers = computeEctsMultipliers(profile.totalDegreeCredits);
  const gradeRange = computeGermanGradeRange(profile);
  const bucketSolve = solveNonOverlappingBuckets(profile, program);

  const thesisEctsStandard = round2(
    profile.thesis.creditsIndian * multipliers.standard240
  );
  const thesisEctsConservative = round2(
    profile.thesis.creditsIndian * multipliers.conservative180
  );

  const pillars: PillarCheckResult[] = [
    evaluateBucketsPillar(program, bucketSolve),
    evaluateThesisPillar(
      profile,
      program,
      thesisEctsStandard,
      thesisEctsConservative
    ),
    evaluateEnglishPillar(profile, program),
    evaluateStandardizedTestPillar(profile, program, gradeRange),
    evaluateGradePillar(program, gradeRange),
  ];

  let verdict: Verdict = "GREEN";
  if (pillars.some((p) => p.status === "RED")) {
    verdict = "RED";
  } else if (pillars.some((p) => p.status === "YELLOW")) {
    verdict = "YELLOW";
  }

  const summaryReasons =
    verdict === "GREEN"
      ? [
          "Meets all required subject-bucket ECTS, thesis, English, standardized test, and grade rules.",
        ]
      : pillars
          .filter((p) => p.status === verdict || (verdict === "RED" && p.status === "RED"))
          .map((p) => p.headline);

  return {
    programId: program.id,
    program,
    verdict,
    pillars,
    bucketSolve,
    gradeRange,
    multipliers,
    thesisEctsStandard,
    thesisEctsConservative,
    summaryReasons,
  };
}

/**
 * Audits all programs in the rules database and sorts deterministically:
 * GREEN -> YELLOW -> RED, then alphabetical by university.
 */
export function auditAllPrograms(
  profile: TranscriptProfile,
  programs: ProgramRule[]
): ProgramAuditResult[] {
  const rank: Record<Verdict, number> = { GREEN: 0, YELLOW: 1, RED: 2 };
  return programs
    .map((program) => evaluateProgram(profile, program))
    .sort((a, b) => {
      const diff = rank[a.verdict] - rank[b.verdict];
      if (diff !== 0) return diff;
      return a.program.university.localeCompare(b.program.university);
    });
}

/**
 * Generates the blunt, deterministic "Top Profile Vulnerabilities" list for Screen 2.
 */
export function analyzeProfileVulnerabilities(
  profile: TranscriptProfile,
  results: ProgramAuditResult[]
): ProfileVulnerability[] {
  const vulnerabilities: ProfileVulnerability[] = [];
  const multipliers = computeEctsMultipliers(profile.totalDegreeCredits);
  const gradeRange = computeGermanGradeRange(profile);
  const checksum = computeCreditChecksum(profile);

  // 1. Checksum warning
  if (checksum.status === "MISMATCH") {
    vulnerabilities.push({
      id: "credit-checksum-mismatch",
      severity: "HIGH",
      title: `Transcript Credit Checksum Off by ${checksum.deltaCredits > 0 ? "+" : ""}${checksum.deltaCredits} Credits`,
      detail: checksum.message,
      impactedPrograms: results.map((r) => r.program.university),
    });
  }

  // 2. Bucket-level raw ECTS totals (excluding thesis & internship)
  const ectsByPrimary = (bucket: string) =>
    round2(
      profile.courses
        .filter(
          (c) =>
            !c.isThesisOrCapstone &&
            !c.isInternship &&
            (c.primaryBucket === bucket || c.eligibleBuckets?.includes(bucket as never))
        )
        .reduce((s, c) => s + c.indianCredits * multipliers.standard240, 0)
    );

  const theoreticalEcts = ectsByPrimary("THEORETICAL_CS");
  const theoreticalImpacted = results
    .filter((r) =>
      r.bucketSolve.perBucket.some((b) => b.bucket === "THEORETICAL_CS" && !b.met)
    )
    .map((r) => r.program.university);

  if (theoreticalEcts < 15 || theoreticalImpacted.length > 0) {
    vulnerabilities.push({
      id: "low-theoretical-cs",
      severity: theoreticalImpacted.length > 0 ? "HIGH" : "MEDIUM",
      title: `Low Theoretical CS Coverage (${theoreticalEcts} ECTS on 240-scale)`,
      detail:
        "German public CS faculties strictly check Automata, Formal Languages, Computability, Logic, and Algorithm Theory. Most Indian B.Tech. CSE degrees under-credit pure theory.",
      impactedPrograms: theoreticalImpacted,
    });
  }

  const mathEcts = ectsByPrimary("MATH");
  const stochEcts = ectsByPrimary("STOCHASTICS");
  const mathStochImpacted = results
    .filter((r) =>
      r.bucketSolve.perBucket.some(
        (b) => (b.bucket === "MATH" || b.bucket === "STOCHASTICS") && !b.met
      )
    )
    .map((r) => r.program.university);

  if (mathEcts < 18 || stochEcts < 6 || mathStochImpacted.length > 0) {
    vulnerabilities.push({
      id: "math-stochastics-cliff",
      severity: mathStochImpacted.length > 0 ? "HIGH" : "MEDIUM",
      title: `Math / Stochastics Cliff (Math: ${mathEcts} ECTS, Stochastics: ${stochEcts} ECTS)`,
      detail:
        "Data Science & AI programs enforce hard floors on Linear Algebra, Calculus/Analysis, and Probability/Statistics—often without Auflagen.",
      impactedPrograms: mathStochImpacted,
    });
  }

  // 3. Thesis / Group Capstone vulnerability
  const thesisEcts = round2(profile.thesis.creditsIndian * multipliers.standard240);
  const thesisImpacted = results
    .filter((r) =>
      r.pillars.some((p) => p.pillar === "THESIS" && p.status !== "GREEN")
    )
    .map((r) => r.program.university);

  if (thesisEcts < 10 || !profile.thesis.isSolo || thesisImpacted.length > 0) {
    vulnerabilities.push({
      id: "capstone-vs-solo-thesis",
      severity: thesisImpacted.length > 0 ? "HIGH" : "MEDIUM",
      title: !profile.thesis.isSolo
        ? `Group Capstone (${thesisEcts} ECTS) vs. Solo 10-ECTS German Thesis`
        : `Sub-10 ECTS Thesis (${thesisEcts} ECTS on 240-scale)`,
      detail:
        "Many Indian B.Tech. degrees award 4–6 credits for a 3-4 student Final Year Project. German M.Sc. regulations frequently expect an individual 10–12 ECTS scientific Bachelor thesis.",
      impactedPrograms: thesisImpacted,
    });
  }

  // 4. MOI rejection vulnerability
  const moiRejectedPrograms = results
    .filter((r) =>
      r.pillars.some((p) => p.pillar === "ENGLISH" && p.status === "RED")
    )
    .map((r) => r.program.university);

  if (profile.englishProof.type === "MOI" && moiRejectedPrograms.length > 0) {
    vulnerabilities.push({
      id: "moi-rejected",
      severity: "HIGH",
      title: `MOI Rejected by ${moiRejectedPrograms.length} of ${results.length} Programs`,
      detail:
        "Indian Medium of Instruction (MOI) letters trigger automatic rejection at C1-strict faculties. Taking IELTS (≥ 7.0) or TOEFL iBT (≥ 95) unlocks these programs immediately.",
      impactedPrograms: moiRejectedPrograms,
    });
  } else if (profile.englishProof.type === "NONE") {
    vulnerabilities.push({
      id: "no-english-proof",
      severity: "HIGH",
      title: "No English Proficiency Proof Entered",
      detail:
        "Every English-taught German M.Sc. requires either IELTS/TOEFL or (where explicitly permitted) an official university MOI certificate.",
      impactedPrograms: moiRejectedPrograms,
    });
  }

  // 5. Missing mandatory GRE
  const greBlocked = results
    .filter((r) =>
      r.pillars.some((p) => p.pillar === "STANDARDIZED_TEST" && p.status === "RED")
    )
    .map((r) => r.program.university);

  if (greBlocked.length > 0) {
    vulnerabilities.push({
      id: "missing-mandatory-gre",
      severity: "HIGH",
      title: `Mandatory GRE Blocking ${greBlocked.length} Program${greBlocked.length > 1 ? "s" : ""}`,
      detail:
        "Top TU9 programs like RWTH Aachen enforce non-negotiable GRE percentile cutoffs for non-EU applicants regardless of CGPA.",
      impactedPrograms: greBlocked,
    });
  }

  // 6. Ambiguous N_min pass floor spread
  if (gradeRange.isAmbiguousPassFloor) {
    const gradeStraddled = results
      .filter((r) =>
        r.pillars.some((p) => p.pillar === "GRADE" && p.status === "YELLOW")
      )
      .map((r) => r.program.university);

    vulnerabilities.push({
      id: "ambiguous-nmin-spread",
      severity: gradeStraddled.length > 0 ? "HIGH" : "INFO",
      title: `Bavarian Grade Spread: ${gradeRange.optimistic.truncated1.toFixed(1)} (N_min=${gradeRange.optimistic.nMin}) vs. ${gradeRange.conservative.truncated1.toFixed(1)} (N_min=${gradeRange.conservative.nMin})`,
      detail:
        "uni-assist and German faculties sometimes use 50% (degree-award minimum) instead of 40% (single-course pass) as N_min for Indian universities. Obtain an official grading-scale certificate from your Registrar.",
      impactedPrograms: gradeStraddled,
    });
  }

  return vulnerabilities;
}
