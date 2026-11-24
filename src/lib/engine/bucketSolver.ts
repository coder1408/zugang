import type {
  CourseItem,
  ProgramRule,
  SubjectBucket,
  TranscriptProfile,
} from "@/lib/schemas";
import { computeEctsMultipliers, round2 } from "@/lib/engine/grades";

export interface AllocatedCourseReceipt {
  courseId: string;
  code: string;
  title: string;
  indianCredits: number;
  ects: number;
  primaryBucket: SubjectBucket;
  assignedBucket: SubjectBucket;
}

export interface ExcludedCourseReceipt {
  courseId: string;
  code: string;
  title: string;
  indianCredits: number;
  ects: number;
  reason: string;
}

export interface BucketAllocationReceipt {
  bucket: SubjectBucket;
  label: string;
  requiredEcts: number;
  earnedEcts: number;
  deficitEcts: number;
  met: boolean;
  assignedCourses: AllocatedCourseReceipt[];
}

export interface CombinedBucketReceipt {
  id: string;
  label: string;
  buckets: SubjectBucket[];
  requiredEcts: number;
  earnedEcts: number;
  deficitEcts: number;
  met: boolean;
  includedCourseIds: string[];
}

export interface BucketSolveResult {
  ectsMultiplierUsed: number;
  ectsConversionBasis: "STANDARD_240" | "CONSERVATIVE_180";
  perBucket: BucketAllocationReceipt[];
  combinedChecks: CombinedBucketReceipt[];
  totalRequiredBucketDeficitEcts: number;
  maxCombinedDeficitEcts: number;
  /** True non-double-counted additional ECTS required to satisfy all bucket + combined rules */
  totalDeficitEcts: number;
  excludedCourses: ExcludedCourseReceipt[];
  unallocatedCourses: Array<{
    courseId: string;
    code: string;
    title: string;
    indianCredits: number;
    ects: number;
    primaryBucket: SubjectBucket;
  }>;
}

interface IndexedCourse {
  course: CourseItem;
  ects: number;
  candidateRequiredIndices: number[];
  allSemanticBuckets: Set<SubjectBucket>;
}

function getCourseCandidateBuckets(
  course: CourseItem,
  program: ProgramRule
): {
  requiredIndices: number[];
  allSemanticBuckets: Set<SubjectBucket>;
} {
  const semantic = new Set<SubjectBucket>([
    course.primaryBucket,
    ...(course.eligibleBuckets ?? []),
  ]);

  const hasSeparateStochasticsRule = program.bucketRules.requiredBuckets.some(
    (rb) => rb.bucket === "STOCHASTICS"
  );

  const requiredIndices: number[] = [];
  program.bucketRules.requiredBuckets.forEach((rb, idx) => {
    if (semantic.has(rb.bucket)) {
      requiredIndices.push(idx);
      return;
    }
    // Stochastics/Probability courses satisfy MATH if allowed by rule or if STOCHASTICS is not separately required
    if (
      rb.bucket === "MATH" &&
      semantic.has("STOCHASTICS") &&
      (rb.acceptStochastics || !hasSeparateStochasticsRule)
    ) {
      requiredIndices.push(idx);
    }
  });

  return { requiredIndices, allSemanticBuckets: semantic };
}

/**
 * Deterministic Non-Overlapping Subject-Bucket Solver.
 *
 * Guarantees:
 * 1. Every course is assigned to AT MOST ONE required bucket (zero double-counting).
 * 2. Respects `exclude_thesis_and_internship_from_buckets` strictly.
 * 3. For multi-eligible courses (e.g. Probability & Statistics eligible for STOCHASTICS or MATH),
 *    runs exact branch-and-bound optimization (for <= 18 multi-eligible courses, with deterministic
 *    largest-deficit-first greedy fallback beyond 18) to globally minimize total ECTS deficit.
 */
export function solveNonOverlappingBuckets(
  profile: TranscriptProfile,
  program: ProgramRule
): BucketSolveResult {
  const multipliers = computeEctsMultipliers(profile.totalDegreeCredits);
  const basis = program.bucketRules.ectsConversionBasis ?? "STANDARD_240";
  const multiplier =
    basis === "CONSERVATIVE_180"
      ? multipliers.conservative180
      : multipliers.standard240;

  const requiredBuckets = program.bucketRules.requiredBuckets;
  const numBuckets = requiredBuckets.length;
  const requiredMins = requiredBuckets.map((rb) => rb.minEcts);

  const excludedCourses: ExcludedCourseReceipt[] = [];
  const activeCourses: IndexedCourse[] = [];

  for (const course of profile.courses) {
    const ects = round2(course.indianCredits * multiplier);

    const isThesis =
      course.isThesisOrCapstone || course.primaryBucket === "THESIS_CAPSTONE";
    const isInternship =
      course.isInternship || course.primaryBucket === "INTERNSHIP_SEMINAR";

    if (
      program.bucketRules.exclude_thesis_and_internship_from_buckets &&
      (isThesis || isInternship)
    ) {
      excludedCourses.push({
        courseId: course.id,
        code: course.code ?? "",
        title: course.title,
        indianCredits: course.indianCredits,
        ects,
        reason: isThesis
          ? "Bachelor Thesis / Capstone excluded from subject buckets per regulation"
          : "Internship / Industrial Training excluded from subject buckets per regulation",
      });
      continue;
    }

    const { requiredIndices, allSemanticBuckets } = getCourseCandidateBuckets(
      course,
      program
    );

    activeCourses.push({
      course,
      ects,
      candidateRequiredIndices: requiredIndices,
      allSemanticBuckets,
    });
  }

  // Track exact assignment: course index in activeCourses -> requiredBucket index (or -1 if unallocated)
  const assignments = new Array<number>(activeCourses.length).fill(-1);
  const baseTotals = new Array<number>(numBuckets).fill(0);
  const ambiguousIndices: number[] = [];

  for (let i = 0; i < activeCourses.length; i++) {
    const item = activeCourses[i];
    if (item.candidateRequiredIndices.length === 1) {
      const bIdx = item.candidateRequiredIndices[0];
      assignments[i] = bIdx;
      baseTotals[bIdx] += item.ects;
    } else if (item.candidateRequiredIndices.length > 1) {
      ambiguousIndices.push(i);
    }
  }

  // Sort ambiguous courses deterministically (largest ECTS first for tighter branch-and-bound pruning)
  ambiguousIndices.sort((a, b) => {
    const diff = activeCourses[b].ects - activeCourses[a].ects;
    if (Math.abs(diff) > 1e-6) return diff;
    return activeCourses[a].course.id.localeCompare(activeCourses[b].course.id);
  });

  if (ambiguousIndices.length > 0) {
    if (ambiguousIndices.length <= 18) {
      // Exact deterministic branch-and-bound search minimizing total ECTS deficit
      const suffixRemainingEcts = new Array<number>(ambiguousIndices.length + 1).fill(0);
      for (let k = ambiguousIndices.length - 1; k >= 0; k--) {
        suffixRemainingEcts[k] =
          suffixRemainingEcts[k + 1] + activeCourses[ambiguousIndices[k]].ects;
      }

      let bestDeficit = Number.POSITIVE_INFINITY;
      let bestPrimaryMatches = -1;
      let bestChoice = new Array<number>(ambiguousIndices.length).fill(-1);
      const currentChoice = new Array<number>(ambiguousIndices.length).fill(-1);
      const runningTotals = [...baseTotals];

      const computeDeficit = (totals: number[]): number => {
        let def = 0;
        for (let b = 0; b < numBuckets; b++) {
          if (totals[b] < requiredMins[b]) {
            def += requiredMins[b] - totals[b];
          }
        }
        return def;
      };

      const dfs = (pos: number, primaryMatches: number) => {
        const curDeficit = computeDeficit(runningTotals);

        if (pos === ambiguousIndices.length) {
          const isStrictlyBetterDeficit = curDeficit < bestDeficit - 1e-6;
          const isTiedDeficitBetterPrimary =
            Math.abs(curDeficit - bestDeficit) <= 1e-6 &&
            primaryMatches > bestPrimaryMatches;
          if (isStrictlyBetterDeficit || isTiedDeficitBetterPrimary) {
            bestDeficit = curDeficit;
            bestPrimaryMatches = primaryMatches;
            bestChoice = [...currentChoice];
          }
          return;
        }

        // Optimistic lower bound: even if all remaining ECTS eliminated deficits 1:1
        const lowerBound = Math.max(0, curDeficit - suffixRemainingEcts[pos]);
        if (lowerBound > bestDeficit + 1e-6) {
          return;
        }

        const item = activeCourses[ambiguousIndices[pos]];
        // Order candidate buckets: primaryBucket first, then largest current deficit
        const orderedCandidates = [...item.candidateRequiredIndices].sort((b1, b2) => {
          const p1 = requiredBuckets[b1].bucket === item.course.primaryBucket ? 1 : 0;
          const p2 = requiredBuckets[b2].bucket === item.course.primaryBucket ? 1 : 0;
          if (p1 !== p2) return p2 - p1;
          const d1 = Math.max(0, requiredMins[b1] - runningTotals[b1]);
          const d2 = Math.max(0, requiredMins[b2] - runningTotals[b2]);
          if (Math.abs(d1 - d2) > 1e-6) return d2 - d1;
          return b1 - b2;
        });

        for (const bIdx of orderedCandidates) {
          runningTotals[bIdx] += item.ects;
          currentChoice[pos] = bIdx;
          const isPrimary =
            requiredBuckets[bIdx].bucket === item.course.primaryBucket ? 1 : 0;
          dfs(pos + 1, primaryMatches + isPrimary);
          runningTotals[bIdx] -= item.ects;
        }
      };

      dfs(0, 0);

      for (let k = 0; k < ambiguousIndices.length; k++) {
        assignments[ambiguousIndices[k]] = bestChoice[k];
      }
    } else {
      // Deterministic largest-deficit-first greedy fallback for > 18 ambiguous courses
      const runningTotals = [...baseTotals];
      for (const idx of ambiguousIndices) {
        const item = activeCourses[idx];
        let chosen = item.candidateRequiredIndices[0];
        let bestScore = -1;
        for (const bIdx of item.candidateRequiredIndices) {
          const deficit = Math.max(0, requiredMins[bIdx] - runningTotals[bIdx]);
          const primaryBonus =
            requiredBuckets[bIdx].bucket === item.course.primaryBucket ? 0.001 : 0;
          const score = deficit + primaryBonus;
          if (score > bestScore) {
            bestScore = score;
            chosen = bIdx;
          }
        }
        assignments[idx] = chosen;
        runningTotals[chosen] += item.ects;
      }
    }
  }

  // Assemble per-bucket receipts (each course appears in at most ONE bucket)
  const perBucket: BucketAllocationReceipt[] = requiredBuckets.map((rb) => ({
    bucket: rb.bucket,
    label: rb.label,
    requiredEcts: rb.minEcts,
    earnedEcts: 0,
    deficitEcts: rb.minEcts,
    met: rb.minEcts === 0,
    assignedCourses: [],
  }));

  const unallocatedCourses: BucketSolveResult["unallocatedCourses"] = [];

  for (let i = 0; i < activeCourses.length; i++) {
    const item = activeCourses[i];
    const bIdx = assignments[i];
    if (bIdx >= 0) {
      const target = perBucket[bIdx];
      target.assignedCourses.push({
        courseId: item.course.id,
        code: item.course.code ?? "",
        title: item.course.title,
        indianCredits: item.course.indianCredits,
        ects: item.ects,
        primaryBucket: item.course.primaryBucket,
        assignedBucket: target.bucket,
      });
    } else {
      unallocatedCourses.push({
        courseId: item.course.id,
        code: item.course.code ?? "",
        title: item.course.title,
        indianCredits: item.course.indianCredits,
        ects: item.ects,
        primaryBucket: item.course.primaryBucket,
      });
    }
  }

  for (const receipt of perBucket) {
    receipt.earnedEcts = round2(
      receipt.assignedCourses.reduce((sum, c) => sum + c.ects, 0)
    );
    receipt.deficitEcts = round2(
      Math.max(0, receipt.requiredEcts - receipt.earnedEcts)
    );
    receipt.met = receipt.deficitEcts <= 0.001;
  }

  // Evaluate combined bucket minimums across unique non-excluded courses (zero double-counting)
  const combinedChecks: CombinedBucketReceipt[] = (
    program.bucketRules.combinedMinEcts ?? []
  ).map((rule) => {
    const allowedSet = new Set<SubjectBucket>(rule.buckets);
    const includedCourseIds: string[] = [];
    let earned = 0;

    for (let i = 0; i < activeCourses.length; i++) {
      const item = activeCourses[i];
      const assignedIdx = assignments[i];
      const matches =
        (assignedIdx >= 0 && allowedSet.has(requiredBuckets[assignedIdx].bucket)) ||
        Array.from(item.allSemanticBuckets).some((b) => allowedSet.has(b));

      if (matches) {
        includedCourseIds.push(item.course.id);
        earned += item.ects;
      }
    }

    const earnedEcts = round2(earned);
    const deficitEcts = round2(Math.max(0, rule.minEcts - earnedEcts));

    return {
      id: rule.id,
      label: rule.label,
      buckets: rule.buckets,
      requiredEcts: rule.minEcts,
      earnedEcts,
      deficitEcts,
      met: deficitEcts <= 0.001,
      includedCourseIds,
    };
  });

  const totalRequiredBucketDeficitEcts = round2(
    perBucket.reduce((sum, b) => sum + b.deficitEcts, 0)
  );
  const maxCombinedDeficitEcts = round2(
    combinedChecks.reduce((max, c) => Math.max(max, c.deficitEcts), 0)
  );
  const totalDeficitEcts = round2(
    Math.max(totalRequiredBucketDeficitEcts, maxCombinedDeficitEcts)
  );

  return {
    ectsMultiplierUsed: multiplier,
    ectsConversionBasis: basis,
    perBucket,
    combinedChecks,
    totalRequiredBucketDeficitEcts,
    maxCombinedDeficitEcts,
    totalDeficitEcts,
    excludedCourses,
    unallocatedCourses,
  };
}
