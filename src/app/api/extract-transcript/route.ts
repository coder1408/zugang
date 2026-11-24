import dns from "dns";
import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI, Type } from "@google/genai";
import {
  ExtractedTranscriptResponseSchema,
  SubjectBucketEnum,
  type CourseItem,
  type ExtractedTranscriptResponse,
} from "@/lib/schemas";
import { extractClientIp, transcriptExtractLimiter } from "@/lib/rateLimit";

// Prevent Node IPv6 happy-eyeballs timeouts against OpenRouter/Cloudflare on IPv4-only Linux networks
dns.setDefaultResultOrder("ipv4first");

export const runtime = "nodejs";

const MAX_FILES = 10;
const MAX_TOTAL_PDF_BYTES = 20 * 1024 * 1024; // 20 MB combined across all uploaded semester PDFs

const BUCKET_VALUES = SubjectBucketEnum.options;

const EXTRACTION_PROMPT = `You are a strict academic transcript parser for Indian B.Tech./B.E. university transcripts.
Your ONLY job is to extract factual data from the uploaded transcript PDF(s) into the exact JSON schema provided.
Multiple PDF files may be attached (e.g., separate Semester 1 to Semester 8 marksheets). Merge all semesters chronologically without duplicating repeated courses.
DO NOT compute ECTS conversions, DO NOT compute German Bavarian grades, and DO NOT evaluate admission eligibility.

Extraction instructions:
1. Extract homeUniversity, degreeName, totalDegreeCredits (official cumulative credits earned across the full degree if shown, otherwise null), cgpa (final cumulative CGPA or aggregate percentage if percentage-based, otherwise null), maxGrade (10.0 for 10-point CGPA, 100 for percentage marksheets, 4.0 for 4-point GPA), and thesisCreditsIndian (sum of final-year project/thesis/capstone credits if shown, otherwise null).
2. Extract EVERY course row across all attached PDFs/semesters with exact code, title, indianCredits (numeric), grade, and semester (integer 1-8 if clear).
3. Classify each course into ONE primaryBucket from:
   - MATH: Calculus, Linear Algebra, Discrete Math, Differential Equations, Numerical Methods, Graph Theory
   - STOCHASTICS: Probability, Statistics, Random Processes, Queuing Theory, Stochastic Processes
   - THEORETICAL_CS: Automata Theory, Formal Languages, Theory of Computation, Computability, Complexity, Algorithms & Data Structures, Logic
   - SYSTEMS_OS_DB_NET: Operating Systems, Database Management Systems (DBMS), Computer Networks, Distributed Systems, Cloud Systems, Cryptography/Security
   - ARCHITECTURE_HPC: Digital Logic, Computer Organization, Computer Architecture, Microprocessors, Embedded Systems, Parallel Computing/HPC
   - PROG_SE_AI_ML: Programming (C/C++/Java/Python), OOP, Software Engineering, Compilers, AI, Machine Learning, Deep Learning, Data Mining, NLP, Computer Vision, HCI, Computer Graphics, Web Technologies, Data Engineering, Blockchain, Full Stack
   - THESIS_CAPSTONE: Final Year Project, Major Project, Bachelor Thesis, Capstone Project (also set isThesisOrCapstone: true)
   - INTERNSHIP_SEMINAR: Industrial Training, Internship, Technical Seminar (also set isInternship: true)
   - NON_CS_GENERAL: Physics, Chemistry, Mechanical, Civil, Biology, Basic Electrical, Humanities, Ethics, Economics, Environmental Studies, Yoga, Philosophy, Constitution, Management, Finance, Green Tech
4. For interdisciplinary courses (e.g., Probability & Statistics that could also count as MATH, Discrete Math with Graph Theory that could count as MATH or THEORETICAL_CS, or Data Structures & Algorithms that could count as THEORETICAL_CS or PROG_SE_AI_ML), list all valid buckets in eligibleBuckets. Otherwise set eligibleBuckets to [primaryBucket].
5. Never invent courses that are not in the PDF(s). If credits are unclear on a row, use 0 so the user checksum catches it.`;

const OPENROUTER_JSON_SCHEMA = {
  name: "transcript_extraction",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      homeUniversity: { type: "string" },
      degreeName: { type: "string" },
      totalDegreeCredits: { type: ["number", "null"] },
      cgpa: { type: ["number", "null"] },
      maxGrade: { type: "number" },
      thesisCreditsIndian: { type: ["number", "null"] },
      courses: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            code: { type: "string" },
            title: { type: "string" },
            indianCredits: { type: "number" },
            grade: { type: "string" },
            semester: { type: ["integer", "null"] },
            primaryBucket: { type: "string", enum: [...BUCKET_VALUES] },
            eligibleBuckets: {
              type: "array",
              items: { type: "string", enum: [...BUCKET_VALUES] },
            },
            isThesisOrCapstone: { type: "boolean" },
            isInternship: { type: "boolean" },
          },
          required: [
            "code",
            "title",
            "indianCredits",
            "grade",
            "semester",
            "primaryBucket",
            "eligibleBuckets",
            "isThesisOrCapstone",
            "isInternship",
          ],
        },
      },
    },
    required: [
      "homeUniversity",
      "degreeName",
      "totalDegreeCredits",
      "cgpa",
      "maxGrade",
      "thesisCreditsIndian",
      "courses",
    ],
  },
};

interface EncodedPdf {
  filename: string;
  base64: string;
}

interface ExtractionOutcome {
  data: ExtractedTranscriptResponse;
  modelUsed: string;
  provider: string;
  pdfEngine: "native" | "mistral-ocr";
  fallbackUsed: boolean;
  fallbackReason?: string;
}

function sanitizeExtractedPayload(raw: unknown): ExtractedTranscriptResponse {
  if (raw && typeof raw === "object" && "courses" in raw) {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.courses)) {
      obj.courses = obj.courses.map((c: unknown) => {
        if (c && typeof c === "object") {
          const item = { ...(c as Record<string, unknown>) };
          if (item.semester === null || item.semester === 0) {
            delete item.semester;
          }
          return item;
        }
        return c;
      });
    }
  }
  return ExtractedTranscriptResponseSchema.parse(raw);
}

function computeRelativeChecksumError(data: ExtractedTranscriptResponse): number | null {
  if (!data.totalDegreeCredits || data.totalDegreeCredits <= 0) return null;
  const sum = data.courses.reduce((s, c) => s + c.indianCredits, 0);
  return Math.abs(sum - data.totalDegreeCredits) / data.totalDegreeCredits;
}

async function callOpenRouterExtractor(
  pdfs: EncodedPdf[],
  model: string,
  pdfEngine: "native" | "mistral-ocr"
): Promise<Omit<ExtractionOutcome, "fallbackUsed" | "fallbackReason">> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured.");
  }

  const contentParts: Array<Record<string, unknown>> = [
    { type: "text", text: EXTRACTION_PROMPT },
    ...pdfs.map((pdf) => ({
      type: "file",
      file: {
        filename: pdf.filename || "transcript.pdf",
        file_data: `data:application/pdf;base64,${pdf.base64}`,
      },
    })),
  ];

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "German Public MSc Eligibility Audit MVP",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: contentParts,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: OPENROUTER_JSON_SCHEMA,
      },
      plugins: [
        {
          id: "file-parser",
          pdf: { engine: pdfEngine },
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(
      `OpenRouter (${model}, ${pdfEngine}) failed (${response.status}): ${errText.slice(0, 300)}`
    );
  }

  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error(`OpenRouter (${model}) returned an empty extraction response.`);
  }

  const cleaned = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "");

  const parsedJson = JSON.parse(cleaned);
  return {
    data: sanitizeExtractedPayload(parsedJson),
    modelUsed: json?.model || model,
    provider: "openrouter",
    pdfEngine,
  };
}

/**
 * Primary: openai/gpt-6-luna (native PDF — fastest & lowest cost with 100% benchmark accuracy).
 * Backup:  mistral-ocr PDF parser plugin + mistralai/mistral-small-2603
 *          Automatically invoked if primary errors, returns 0 courses, or has >10% credit checksum error.
 */
async function extractViaOpenRouterWithBackup(
  pdfs: EncodedPdf[]
): Promise<ExtractionOutcome> {
  const primaryModel =
    process.env.OPENROUTER_PRIMARY_MODEL || "openai/gpt-6-luna";
  const backupModel =
    process.env.OPENROUTER_BACKUP_MODEL || "mistralai/mistral-small-2603";

  let primaryResult: Omit<ExtractionOutcome, "fallbackUsed" | "fallbackReason"> | null =
    null;
  let primaryError: string | null = null;

  try {
    primaryResult = await callOpenRouterExtractor(pdfs, primaryModel, "native");
  } catch (err) {
    primaryError = err instanceof Error ? err.message : String(err);
  }

  const primaryChecksumErr = primaryResult
    ? computeRelativeChecksumError(primaryResult.data)
    : null;
  const needsBackup =
    !primaryResult ||
    primaryResult.data.courses.length === 0 ||
    (primaryChecksumErr !== null && primaryChecksumErr > 0.1);

  if (!needsBackup && primaryResult) {
    return {
      ...primaryResult,
      fallbackUsed: false,
    };
  }

  const fallbackReason = primaryError
    ? `Primary (${primaryModel}) error: ${primaryError}`
    : primaryResult && primaryResult.data.courses.length === 0
    ? `Primary (${primaryModel}) extracted 0 courses`
    : `Primary (${primaryModel}) checksum delta exceeded 10% (${((primaryChecksumErr ?? 0) * 100).toFixed(1)}%)`;

  try {
    const backupResult = await callOpenRouterExtractor(
      pdfs,
      backupModel,
      "mistral-ocr"
    );

    if (primaryResult && primaryResult.data.courses.length > 0) {
      const backupChecksumErr = computeRelativeChecksumError(backupResult.data);
      if (
        primaryChecksumErr !== null &&
        backupChecksumErr !== null &&
        primaryChecksumErr < backupChecksumErr
      ) {
        return {
          ...primaryResult,
          fallbackUsed: false,
        };
      }
    }

    return {
      ...backupResult,
      fallbackUsed: true,
      fallbackReason,
    };
  } catch (backupErr) {
    if (primaryResult && primaryResult.data.courses.length > 0) {
      return {
        ...primaryResult,
        fallbackUsed: false,
      };
    }
    const backupMsg =
      backupErr instanceof Error ? backupErr.message : String(backupErr);
    throw new Error(
      `Both primary (${primaryModel}) and mistral-ocr backup (${backupModel}) failed. Primary: ${fallbackReason}. Backup: ${backupMsg}`
    );
  }
}

async function extractViaGeminiDirect(
  pdfs: EncodedPdf[]
): Promise<ExtractionOutcome> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model,
    contents: [
      ...pdfs.map((pdf) => ({
        inlineData: {
          mimeType: "application/pdf",
          data: pdf.base64,
        },
      })),
      { text: EXTRACTION_PROMPT },
    ],
    config: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          homeUniversity: { type: Type.STRING },
          degreeName: { type: Type.STRING },
          totalDegreeCredits: { type: Type.NUMBER, nullable: true },
          cgpa: { type: Type.NUMBER, nullable: true },
          maxGrade: { type: Type.NUMBER },
          thesisCreditsIndian: { type: Type.NUMBER, nullable: true },
          courses: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                code: { type: Type.STRING },
                title: { type: Type.STRING },
                indianCredits: { type: Type.NUMBER },
                grade: { type: Type.STRING },
                semester: { type: Type.INTEGER, nullable: true },
                primaryBucket: {
                  type: Type.STRING,
                  enum: [...BUCKET_VALUES],
                },
                eligibleBuckets: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.STRING,
                    enum: [...BUCKET_VALUES],
                  },
                },
                isThesisOrCapstone: { type: Type.BOOLEAN },
                isInternship: { type: Type.BOOLEAN },
              },
              required: [
                "title",
                "indianCredits",
                "primaryBucket",
                "isThesisOrCapstone",
                "isInternship",
              ],
            },
          },
        },
        required: ["courses"],
      },
    },
  });

  if (!response.text) {
    throw new Error("Gemini returned an empty extraction response.");
  }

  const parsedJson = JSON.parse(response.text);
  return {
    data: sanitizeExtractedPayload(parsedJson),
    modelUsed: model,
    provider: "google-genai",
    pdfEngine: "native",
    fallbackUsed: false,
  };
}

export async function POST(req: NextRequest) {
  try {
    // Per-IP daily rate limit guard to protect OpenRouter spend
    const clientIp = extractClientIp(req.headers);
    const rate = transcriptExtractLimiter.check(clientIp);
    const rateHeaders = {
      "X-RateLimit-Limit": String(rate.limit),
      "X-RateLimit-Remaining": String(rate.remaining),
      "X-RateLimit-Reset": String(Math.floor(rate.resetAtMs / 1000)),
    };

    if (!rate.allowed) {
      return NextResponse.json(
        {
          error: `Daily PDF extraction limit reached (${rate.limit} uploads per 24h per IP). You can still edit rows manually or use the sample transcript offline.`,
        },
        {
          status: 429,
          headers: {
            ...rateHeaders,
            "Retry-After": String(rate.retryAfterSeconds),
          },
        }
      );
    }

    const formData = await req.formData();
    const multiEntries = formData.getAll("files");
    const singleEntry = formData.get("file");

    const rawEntries = multiEntries.length > 0 ? multiEntries : singleEntry ? [singleEntry] : [];
    const files = rawEntries.filter((f): f is File => f instanceof File);

    if (files.length === 0) {
      return NextResponse.json(
        { error: "Attach one or more PDF transcript files under 'files' (or 'file')." },
        { status: 400, headers: rateHeaders }
      );
    }

    if (files.length > MAX_FILES) {
      return NextResponse.json(
        { error: `Maximum ${MAX_FILES} PDF files can be uploaded at once.` },
        { status: 400, headers: rateHeaders }
      );
    }

    let totalBytes = 0;
    for (const f of files) {
      if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
        return NextResponse.json(
          { error: `Only PDF files are supported (rejected: ${f.name}).` },
          { status: 400, headers: rateHeaders }
        );
      }
      totalBytes += f.size;
    }

    if (totalBytes > MAX_TOTAL_PDF_BYTES) {
      return NextResponse.json(
        { error: "Combined PDF size exceeds the 20 MB upload limit." },
        { status: 400, headers: rateHeaders }
      );
    }

    const hasOpenRouter = Boolean(process.env.OPENROUTER_API_KEY);
    const hasGemini = Boolean(process.env.GEMINI_API_KEY);

    if (!hasOpenRouter && !hasGemini) {
      return NextResponse.json(
        {
          error:
            "No LLM API key configured (OPENROUTER_API_KEY or GEMINI_API_KEY). Add one to .env.local or use the sample transcript offline.",
        },
        { status: 503, headers: rateHeaders }
      );
    }

    const pdfs: EncodedPdf[] = await Promise.all(
      files.map(async (f) => ({
        filename: f.name,
        base64: Buffer.from(await f.arrayBuffer()).toString("base64"),
      }))
    );

    const extracted = hasOpenRouter
      ? await extractViaOpenRouterWithBackup(pdfs)
      : await extractViaGeminiDirect(pdfs);

    const coursesWithIds: CourseItem[] = extracted.data.courses.map((c, idx) => ({
      ...c,
      id: `ext-${idx + 1}`,
      eligibleBuckets:
        c.eligibleBuckets && c.eligibleBuckets.length > 0
          ? c.eligibleBuckets
          : [c.primaryBucket],
    }));

    return NextResponse.json(
      {
        provider: extracted.provider,
        modelUsed: extracted.modelUsed,
        pdfEngine: extracted.pdfEngine,
        fallbackUsed: extracted.fallbackUsed,
        fallbackReason: extracted.fallbackReason,
        fileCount: files.length,
        profileHints: {
          homeUniversity: extracted.data.homeUniversity || "",
          degreeName:
            extracted.data.degreeName || "B.Tech. Computer Science & Engineering",
          totalDegreeCredits: extracted.data.totalDegreeCredits ?? null,
          cgpa: extracted.data.cgpa ?? null,
          maxGrade: extracted.data.maxGrade ?? 10.0,
          thesisCreditsIndian: extracted.data.thesisCreditsIndian ?? null,
        },
        courses: coursesWithIds,
      },
      { headers: rateHeaders }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to extract transcript PDF.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
