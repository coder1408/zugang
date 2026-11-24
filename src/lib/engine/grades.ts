import type { TranscriptProfile } from "@/lib/schemas";

export interface EctsMultipliers {
  totalIndianCredits: number;
  /** Standard 4-year B.Tech./B.E. conversion (240 ECTS / total Indian credits) */
  standard240: number;
  /** Conservative 3-year equivalent conversion (180 ECTS / total Indian credits) */
  conservative180: number;
}

export interface BavarianGradeResult {
  nActual: number;
  nMax: number;
  nMin: number;
  /** Unrounded raw Bavarian formula output clamped to [1.0, 5.0] */
  raw: number;
  /** Official German grade truncated (NEVER rounded) to 1 decimal place */
  truncated1: number;
  /** Truncated to 2 decimal places for transparent precision */
  truncated2: number;
}

export interface GermanGradeRange {
  optimistic: BavarianGradeResult;
  conservative: BavarianGradeResult;
  /** True when the home university's degree-award pass floor is unspecified/ambiguous (4.0 vs 5.0) */
  isAmbiguousPassFloor: boolean;
}

export interface CreditChecksumResult {
  extractedCredits: number;
  officialTotalCredits: number;
  deltaCredits: number;
  deltaPercent: number;
  status: "MATCHED" | "MINOR_DIFF" | "MISMATCH";
  message: string;
}

/**
 * Floating-point-safe decimal truncation (NEVER rounds up).
 * Uses a 1e-9 epsilon so exact representations like 2.2999999999999998 truncate to 2.3,
 * while true 2.25 or 2.29 truncate cleanly to 2.2 (1 decimal) and 2.25 / 2.29 (2 decimals).
 */
export function truncateToDecimals(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.floor(value * factor + 1e-9) / factor;
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Computes both standard (240 ECTS / total) and conservative (180 ECTS / total) multipliers.
 */
export function computeEctsMultipliers(
  totalIndianCredits: number
): EctsMultipliers {
  if (!Number.isFinite(totalIndianCredits) || totalIndianCredits <= 0) {
    throw new Error("totalIndianCredits must be a positive finite number.");
  }
  return {
    totalIndianCredits,
    standard240: 240 / totalIndianCredits,
    conservative180: 180 / totalIndianCredits,
  };
}

/**
 * Converts Indian credits to ECTS using a given multiplier.
 */
export function indianCreditsToEcts(
  indianCredits: number,
  multiplier: number
): number {
  return round2(indianCredits * multiplier);
}

/**
 * Modified Bavarian Formula (Modifizierte Bayerische Formel):
 *   N_d = 1 + 3 * ((N_max - N_actual) / (N_max - N_min))
 *
 * Clamped to [1.0, 5.0] and TRUNCATED (never rounded) to 1 and 2 decimal places.
 */
export function computeBavarianGrade(
  nActual: number,
  nMax: number,
  nMin: number
): BavarianGradeResult {
  if (!Number.isFinite(nActual) || !Number.isFinite(nMax) || !Number.isFinite(nMin)) {
    throw new Error("Grade inputs must be finite numbers.");
  }
  if (nMax <= nMin) {
    throw new Error("nMax must be strictly greater than nMin.");
  }

  let raw: number;
  if (nActual >= nMax) {
    raw = 1.0;
  } else if (nActual < nMin) {
    raw = 5.0;
  } else {
    raw = 1 + 3 * ((nMax - nActual) / (nMax - nMin));
  }

  raw = Math.min(5.0, Math.max(1.0, raw));

  return {
    nActual,
    nMax,
    nMin,
    raw,
    truncated1: truncateToDecimals(raw, 1),
    truncated2: truncateToDecimals(raw, 2),
  };
}

/**
 * Returns default Optimistic vs. Conservative degree-award pass floors (N_min)
 * when the home university's grading scale pass floor is ambiguous.
 * - 10-point CGPA scale -> 4.0 (40%) vs 5.0 (50%)
 * - 100-point Percentage scale -> 40% vs 50%
 * - 4-point GPA scale -> 2.0 vs 2.5
 */
export function getDefaultAmbiguousPassFloors(maxGrade: number): {
  optimisticMin: number;
  conservativeMin: number;
} {
  if (Math.abs(maxGrade - 100) < 1e-6) {
    return { optimisticMin: 40, conservativeMin: 50 };
  }
  if (Math.abs(maxGrade - 10) < 1e-6) {
    return { optimisticMin: 4.0, conservativeMin: 5.0 };
  }
  if (Math.abs(maxGrade - 4) < 1e-6) {
    return { optimisticMin: 2.0, conservativeMin: 2.5 };
  }
  return {
    optimisticMin: round2(maxGrade * 0.4),
    conservativeMin: round2(maxGrade * 0.5),
  };
}

/**
 * Computes Optimistic vs. Conservative German grade range
 * when the home university's degree-award pass floor is ambiguous, or a single exact grade
 * when `minPassingGrade` is explicitly specified.
 */
export function computeGermanGradeRange(
  profile: Pick<TranscriptProfile, "cgpa" | "maxGrade" | "minPassingGrade">
): GermanGradeRange {
  const maxGrade = profile.maxGrade ?? 10.0;

  if (profile.minPassingGrade != null && Number.isFinite(profile.minPassingGrade)) {
    const exact = computeBavarianGrade(
      profile.cgpa,
      maxGrade,
      profile.minPassingGrade
    );
    return {
      optimistic: exact,
      conservative: exact,
      isAmbiguousPassFloor: false,
    };
  }

  const { optimisticMin, conservativeMin } =
    getDefaultAmbiguousPassFloors(maxGrade);
  const optimistic = computeBavarianGrade(profile.cgpa, maxGrade, optimisticMin);
  const conservative = computeBavarianGrade(
    profile.cgpa,
    maxGrade,
    conservativeMin
  );

  return {
    optimistic,
    conservative,
    isAmbiguousPassFloor: true,
  };
}

/**
 * Live checksum comparing extracted course credits against the official degree total.
 */
export function computeCreditChecksum(
  profile: Pick<TranscriptProfile, "courses" | "totalDegreeCredits">
): CreditChecksumResult {
  const extractedCredits = round2(
    profile.courses.reduce((sum, c) => sum + c.indianCredits, 0)
  );
  const officialTotalCredits = round2(profile.totalDegreeCredits);
  const deltaCredits = round2(extractedCredits - officialTotalCredits);
  const deltaPercent =
    officialTotalCredits > 0
      ? round2((Math.abs(deltaCredits) / officialTotalCredits) * 100)
      : 100;

  if (Math.abs(deltaCredits) <= 0.01) {
    return {
      extractedCredits,
      officialTotalCredits,
      deltaCredits: 0,
      deltaPercent: 0,
      status: "MATCHED",
      message: `Exact match: ${extractedCredits} extracted credits = ${officialTotalCredits} official credits.`,
    };
  }

  if (deltaPercent <= 2.5) {
    return {
      extractedCredits,
      officialTotalCredits,
      deltaCredits,
      deltaPercent,
      status: "MINOR_DIFF",
      message: `Minor delta (${deltaCredits > 0 ? "+" : ""}${deltaCredits} cr / ${deltaPercent}%). Verify missing lab or elective credits before auditing.`,
    };
  }

  return {
    extractedCredits,
    officialTotalCredits,
    deltaCredits,
    deltaPercent,
    status: "MISMATCH",
    message: `Credit checksum mismatch (${deltaCredits > 0 ? "+" : ""}${deltaCredits} cr / ${deltaPercent}% off official total ${officialTotalCredits}). Fix missing or duplicate rows before trusting ECTS totals.`,
  };
}
