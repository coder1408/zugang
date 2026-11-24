import { z } from "zod";

/**
 * Canonical subject buckets used across the deterministic non-overlapping solver.
 * The 7 primary academic buckets required by German M.Sc. CS/AI/DS Zugangsordnungen,
 * plus INTERNSHIP_SEMINAR and NON_CS_GENERAL for transparent exclusion tracking.
 */
export const SubjectBucketEnum = z.enum([
  "MATH",
  "STOCHASTICS",
  "THEORETICAL_CS",
  "SYSTEMS_OS_DB_NET",
  "ARCHITECTURE_HPC",
  "PROG_SE_AI_ML",
  "THESIS_CAPSTONE",
  "INTERNSHIP_SEMINAR",
  "NON_CS_GENERAL",
]);

export type SubjectBucket = z.infer<typeof SubjectBucketEnum>;

export const SUBJECT_BUCKET_LABELS: Record<SubjectBucket, string> = {
  MATH: "Mathematics (Linear Algebra, Calculus, Discrete)",
  STOCHASTICS: "Stochastics, Probability & Statistics",
  THEORETICAL_CS: "Theoretical CS & Algorithms",
  SYSTEMS_OS_DB_NET: "Systems (OS, Databases, Networks, Security)",
  ARCHITECTURE_HPC: "Computer Architecture, Digital Logic & HPC",
  PROG_SE_AI_ML: "Programming, Software Eng, AI & ML",
  THESIS_CAPSTONE: "Bachelor Thesis / Final-Year Capstone",
  INTERNSHIP_SEMINAR: "Internship / Industrial Training / Seminar",
  NON_CS_GENERAL: "Non-CS / General Engineering / Humanities",
};

export const CourseItemSchema = z.object({
  id: z.string().min(1),
  code: z.string().optional().default(""),
  title: z.string().min(1),
  indianCredits: z.number().min(0),
  grade: z.string().optional().default(""),
  semester: z.number().int().min(1).max(12).optional(),
  primaryBucket: SubjectBucketEnum,
  /**
   * Optional secondary buckets this single course could legitimately satisfy.
   * The solver will NEVER double-count a course; it assigns each course to at most ONE bucket.
   */
  eligibleBuckets: z.array(SubjectBucketEnum).optional(),
  isThesisOrCapstone: z.boolean().default(false),
  isInternship: z.boolean().default(false),
});

export type CourseItem = z.infer<typeof CourseItemSchema>;

export const EnglishProofTypeEnum = z.enum([
  "IELTS",
  "TOEFL_IBT",
  "MOI",
  "NONE",
]);

export type EnglishProofType = z.infer<typeof EnglishProofTypeEnum>;

export const EnglishProofSchema = z.object({
  type: EnglishProofTypeEnum,
  /** IELTS band (0–9) or TOEFL iBT score (0–120). Ignored for MOI/NONE. */
  score: z.number().min(0).max(120).nullable().optional(),
});

export type EnglishProof = z.infer<typeof EnglishProofSchema>;

export const StandardizedTestSchema = z.object({
  greQuant: z.number().min(130).max(170).nullable().optional(),
  greVerbal: z.number().min(130).max(170).nullable().optional(),
  greAwa: z.number().min(0).max(6).nullable().optional(),
  dmatScore: z.number().min(0).max(100).nullable().optional(),
});

export type StandardizedTest = z.infer<typeof StandardizedTestSchema>;

export const ThesisProfileSchema = z.object({
  creditsIndian: z.number().min(0),
  /** true = individual scientific thesis; false = Indian group B.Tech. capstone project */
  isSolo: z.boolean(),
});

export type ThesisProfile = z.infer<typeof ThesisProfileSchema>;

export const TranscriptProfileSchema = z.object({
  homeUniversity: z.string().min(1),
  degreeName: z.string().min(1).default("B.Tech. Computer Science & Engineering"),
  totalDegreeCredits: z.number().positive(),
  cgpa: z.number().positive(),
  maxGrade: z.number().positive().default(10.0),
  /**
   * When null/undefined, the home university's degree-award pass floor is treated as ambiguous
   * and the Modified Bavarian Formula computes an Optimistic (N_min = 4.0) vs. Conservative (N_min = 5.0) range.
   */
  minPassingGrade: z.number().positive().nullable().optional(),
  englishProof: EnglishProofSchema,
  standardizedTest: StandardizedTestSchema.default({}),
  thesis: ThesisProfileSchema,
  courses: z.array(CourseItemSchema),
});

export type TranscriptProfile = z.infer<typeof TranscriptProfileSchema>;

/* -------------------------------------------------------------------------- */
/* ProgramRule Schema (Version-Controlled German University Rules Database)   */
/* -------------------------------------------------------------------------- */

export const RequiredBucketRuleSchema = z.object({
  bucket: SubjectBucketEnum,
  minEcts: z.number().min(0),
  label: z.string().min(1),
  /**
   * When true (default for MATH if STOCHASTICS is not separately required),
   * courses tagged STOCHASTICS may also fulfill this MATH bucket (still without double-counting).
   */
  acceptStochastics: z.boolean().optional().default(false),
});

export type RequiredBucketRule = z.infer<typeof RequiredBucketRuleSchema>;

export const CombinedBucketRuleSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  buckets: z.array(SubjectBucketEnum).min(1),
  minEcts: z.number().min(0),
});

export type CombinedBucketRule = z.infer<typeof CombinedBucketRuleSchema>;

export const SelectionWeightSchema = z.object({
  criterion: z.string().min(1),
  weightPercent: z.number().min(0).max(100),
  note: z.string().optional(),
});

export type SelectionWeight = z.infer<typeof SelectionWeightSchema>;

export const ProgramRuleSchema = z.object({
  id: z.string().min(1),
  university: z.string().min(1),
  programName: z.string().min(1),
  degreeType: z.enum(["M.Sc.", "M.Eng."]).default("M.Sc."),
  city: z.string().min(1),
  language: z.literal("English").default("English"),
  tuitionPerSemesterEur: z.number().min(0).default(0),
  semesterContributionEur: z.number().min(0),
  /** True when program has no fixed seat-cap Numerus Clausus (eligibility-gated open admission) */
  isNoNc: z.boolean(),
  portal: z.object({
    name: z.string().min(1),
    url: z.string().url(),
    /** True when applicants do NOT pay uni-assist or university portal processing fees */
    isFreePortal: z.boolean(),
    feeEur: z.number().min(0),
    vpdRequired: z.boolean(),
    apsRequired: z.boolean().default(true),
    winterDeadlineNonEu: z.string().min(1),
    summerDeadlineNonEu: z.string().nullable().optional(),
    routingNotes: z.string().min(1),
  }),
  gradeRule: z.object({
    /** Maximum (worst allowed) German grade, e.g. 2.5 (lower is better in Germany). Null = no hard cutoff. */
    maxGermanGradeCutoff: z.number().min(1.0).max(4.0).nullable(),
    /** HARD_REJECT => RED if optimistic > cutoff; INTERVIEW_FALLBACK => YELLOW (oral aptitude test) */
    cutoffBehavior: z.enum(["HARD_REJECT", "INTERVIEW_FALLBACK"]).default("HARD_REJECT"),
    note: z.string().min(1),
  }),
  englishRule: z.object({
    cefrLevel: z.enum(["B2", "B2+", "C1"]),
    minIelts: z.number().min(4.0).max(9.0),
    minToeflIbt: z.number().min(50).max(120),
    moiAccepted: z.boolean(),
    moiNote: z.string().min(1),
  }),
  testRule: z.object({
    greRequired: z.boolean(),
    dmatAccepted: z.boolean().default(false),
    minGreQuant: z.number().min(130).max(170).optional(),
    minGreVerbal: z.number().min(130).max(170).optional(),
    minGreAwa: z.number().min(0).max(6).optional(),
    minDmatScore: z.number().min(0).max(100).optional(),
    /** Optional GPA threshold (strictly better than this German grade waives GRE/dMAT) */
    exemptBelowGermanGrade: z.number().min(1.0).max(4.0).nullable().optional(),
    note: z.string().min(1),
  }),
  bucketRules: z.object({
    ectsConversionBasis: z
      .enum(["STANDARD_240", "CONSERVATIVE_180"])
      .default("STANDARD_240"),
    exclude_thesis_and_internship_from_buckets: z.boolean(),
    auflagen_allowed: z.boolean(),
    max_auflagen_ects: z.number().min(0).default(0),
    requiredBuckets: z.array(RequiredBucketRuleSchema),
    combinedMinEcts: z.array(CombinedBucketRuleSchema).optional().default([]),
  }),
  thesisRule: z.object({
    min_thesis_ects: z.number().min(0),
    solo_thesis_required: z.boolean(),
    note: z.string().min(1),
  }),
  selectionWeights: z.array(SelectionWeightSchema).min(1),
  citation: z.object({
    regulationTitle: z.string().min(1),
    paragraphRef: z.string().min(1),
    officialPdfUrl: z.string().url(),
    facultyEmail: z.string().email(),
    lastVerifiedDate: z.string().min(1),
  }),
});

export type ProgramRule = z.infer<typeof ProgramRuleSchema>;

export const ProgramRulesDatabaseSchema = z.array(ProgramRuleSchema).min(1);

/* -------------------------------------------------------------------------- */
/* Gemini Strict Extraction Schema (Used ONLY in /api/extract-transcript)     */
/* -------------------------------------------------------------------------- */

export const ExtractedCourseSchema = z.object({
  code: z.string().optional().default(""),
  title: z.string().min(1),
  indianCredits: z.number().min(0),
  grade: z.string().optional().default(""),
  semester: z.number().int().min(1).max(12).optional(),
  primaryBucket: SubjectBucketEnum,
  eligibleBuckets: z.array(SubjectBucketEnum).optional(),
  isThesisOrCapstone: z.boolean().default(false),
  isInternship: z.boolean().default(false),
});

export const ExtractedTranscriptResponseSchema = z.object({
  homeUniversity: z.string().optional().default(""),
  degreeName: z.string().optional().default("B.Tech. Computer Science & Engineering"),
  totalDegreeCredits: z.number().positive().nullable().optional(),
  cgpa: z.number().positive().nullable().optional(),
  maxGrade: z.number().positive().optional().default(10.0),
  thesisCreditsIndian: z.number().min(0).nullable().optional(),
  courses: z.array(ExtractedCourseSchema),
});

export type ExtractedTranscriptResponse = z.infer<
  typeof ExtractedTranscriptResponseSchema
>;
