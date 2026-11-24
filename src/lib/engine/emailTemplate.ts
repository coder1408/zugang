import type { ProgramRule, TranscriptProfile } from "@/lib/schemas";
import type { ProgramAuditResult } from "@/lib/engine/verdictEngine";

export interface FacultyEmailDraft {
  to: string;
  subject: string;
  body: string;
}

/**
 * Generates a concise, regulation-citing faculty verification email for YELLOW edge-case programs.
 * 100% deterministic template — zero LLM hallucination.
 */
export function generateFacultyVerificationEmail(
  profile: TranscriptProfile,
  program: ProgramRule,
  audit: ProgramAuditResult
): FacultyEmailDraft {
  const yellowPillars = audit.pillars.filter((p) => p.status === "YELLOW");
  const topicSummary =
    yellowPillars.map((p) => p.headline).join(" / ") ||
    "Eligibility Clarification";

  const subject = `Eligibility Inquiry (${program.degreeType} ${program.programName}): ${topicSummary}`;

  const questions: string[] = [];

  for (const pillar of yellowPillars) {
    if (pillar.pillar === "THESIS") {
      questions.push(
        `Bachelor Thesis / Capstone Equivalence: My ${profile.degreeName} at ${profile.homeUniversity} includes a ${profile.thesis.isSolo ? "solo" : "group"} final-year project worth ${profile.thesis.creditsIndian} local credits (${audit.thesisEctsStandard} ECTS on a 240-ECTS 4-year scale). Under ${program.citation.paragraphRef}, would an advisor-signed individual contribution statement and project abstract/research paper satisfy the ${program.thesisRule.min_thesis_ects}-ECTS thesis requirement?`
      );
    } else if (pillar.pillar === "BUCKETS") {
      const missingList = audit.bucketSolve.perBucket
        .filter((b) => !b.met)
        .map((b) => `${b.label} (short by ~${b.deficitEcts} ECTS)`)
        .join(", ");
      questions.push(
        `Conditional Admission (Auflagen): Based on a strict non-overlapping credit audit (${audit.bucketSolve.ectsMultiplierUsed.toFixed(2)} ECTS/credit), I appear to have a minor shortfall of ${audit.bucketSolve.totalDeficitEcts} ECTS (${missingList || "combined credit total"}). Could you confirm whether this falls within the conditional admission (Auflagen) allowance under ${program.citation.paragraphRef}?`
      );
    } else if (pillar.pillar === "GRADE") {
      questions.push(
        `Bavarian Grade Conversion (N_min): My CGPA is ${profile.cgpa}/${profile.maxGrade}. Under the Modified Bavarian Formula, this converts to ${audit.gradeRange.optimistic.truncated1.toFixed(1)} (with N_min=${audit.gradeRange.optimistic.nMin.toFixed(1)}) or ${audit.gradeRange.conservative.truncated1.toFixed(1)} (with N_min=${audit.gradeRange.conservative.nMin.toFixed(1)}). Could you confirm how the Admissions Committee determines N_min for Indian 10-point CGPA transcripts (and whether applicants above ${program.gradeRule.maxGermanGradeCutoff?.toFixed(1) ?? "the cutoff"} are evaluated via the aptitude procedure)?`
      );
    } else if (pillar.pillar === "STANDARDIZED_TEST") {
      questions.push(
        `GRE / dMAT Exemption Verification: My converted German grade spans ${audit.gradeRange.optimistic.truncated1.toFixed(1)}–${audit.gradeRange.conservative.truncated1.toFixed(1)} depending on N_min. Could you clarify whether a GRE/dMAT score is required in my case?`
      );
    }
  }

  const body = [
    `Dear Admissions Committee (${program.university} — ${program.degreeType} ${program.programName}),`,
    "",
    `I am an Indian graduate holding a ${profile.degreeName} (${profile.totalDegreeCredits} total credits, CGPA ${profile.cgpa}/${profile.maxGrade}) from ${profile.homeUniversity}, planning to apply for the upcoming intake.`,
    "",
    `After reviewing the official admission regulations (${program.citation.regulationTitle}, ${program.citation.paragraphRef}), I would be very grateful for a brief clarification on the following point(s) before submitting my formal application via ${program.portal.name}:`,
    "",
    ...questions.map((q, idx) => `${idx + 1}. ${q}`),
    "",
    "I have prepared a non-overlapping ECTS course mapping table and official module descriptions if helpful.",
    "",
    "Thank you very much for your time and guidance.",
    "",
    "Kind regards,",
    "[Your Full Name]",
    `[Degree: ${profile.degreeName}, ${profile.homeUniversity}]`,
  ].join("\n");

  return {
    to: program.citation.facultyEmail,
    subject,
    body,
  };
}
