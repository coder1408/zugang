import type { ProgramRule, TranscriptProfile } from "@/lib/schemas";
import type { ProgramAuditResult } from "@/lib/engine/verdictEngine";
import { SUBJECT_BUCKET_LABELS } from "@/lib/schemas";
import { round2 } from "@/lib/engine/grades";

function escapeCsvCell(value: string | number): string {
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generates an auditable RFC-4180 CSV ECTS Mapping Table for a specific German M.Sc. program.
 * Proves non-overlapping course allocation and lists both 240-scale and 180-scale ECTS.
 */
export function generateEctsMappingCsv(
  profile: TranscriptProfile,
  program: ProgramRule,
  audit: ProgramAuditResult
): string {
  const assignedMap = new Map<string, string>();
  for (const bucket of audit.bucketSolve.perBucket) {
    for (const c of bucket.assignedCourses) {
      assignedMap.set(c.courseId, `${bucket.label} (${bucket.bucket})`);
    }
  }

  const excludedMap = new Map<string, string>();
  for (const ex of audit.bucketSolve.excludedCourses) {
    excludedMap.set(ex.courseId, ex.reason);
  }

  const headers = [
    "Course Code",
    "Course Title",
    "Semester",
    "Indian Credits",
    "ECTS (240-Scale)",
    "ECTS (180-Scale)",
    "Primary Bucket",
    "Allocated Program Bucket (Non-Overlapping)",
    "Audit Status / Notes",
  ];

  const rows: string[][] = [headers];

  for (const course of profile.courses) {
    const ects240 = round2(course.indianCredits * audit.multipliers.standard240);
    const ects180 = round2(
      course.indianCredits * audit.multipliers.conservative180
    );

    const assigned = assignedMap.get(course.id);
    const excludedReason = excludedMap.get(course.id);

    let status = "Unallocated (Elective / General)";
    if (excludedReason) {
      status = `Excluded: ${excludedReason}`;
    } else if (assigned) {
      status = "Counted (1x — Non-Overlapping)";
    }

    rows.push([
      course.code || "-",
      course.title,
      course.semester != null ? String(course.semester) : "-",
      String(course.indianCredits),
      ects240.toFixed(2),
      ects180.toFixed(2),
      SUBJECT_BUCKET_LABELS[course.primaryBucket],
      assigned ?? "Not Assigned",
      status,
    ]);
  }

  // Blank separator + summary section
  rows.push([]);
  rows.push(["AUDIT SUMMARY", `${program.university} — ${program.programName}`]);
  rows.push(["Verdict", audit.verdict]);
  rows.push([
    `Bavarian Grade (Optimistic N_min=${audit.gradeRange.optimistic.nMin})`,
    `${audit.gradeRange.optimistic.truncated1.toFixed(1)} (${audit.gradeRange.optimistic.truncated2.toFixed(2)})`,
  ]);
  rows.push([
    `Bavarian Grade (Conservative N_min=${audit.gradeRange.conservative.nMin})`,
    `${audit.gradeRange.conservative.truncated1.toFixed(1)} (${audit.gradeRange.conservative.truncated2.toFixed(2)})`,
  ]);
  rows.push([
    "Official Regulation Citation",
    `${program.citation.regulationTitle} — ${program.citation.paragraphRef}`,
  ]);

  return rows
    .map((row) => row.map((cell) => escapeCsvCell(cell)).join(","))
    .join("\n");
}
