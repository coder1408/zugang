"use client";

import React, { useMemo, useRef, useState } from "react";
import {
  SUBJECT_BUCKET_LABELS,
  SubjectBucketEnum,
  type CourseItem,
  type EnglishProofType,
  type SubjectBucket,
  type TranscriptProfile,
} from "@/lib/schemas";
import { computeCreditChecksum, computeEctsMultipliers, round2 } from "@/lib/engine";
import { SAMPLE_BTECH_CSE_TRANSCRIPT } from "@/data/sampleTranscripts";
import { Eyebrow, PageIntro, SectionHeader, Segmented } from "@/components/ui";

interface Screen1UploadVerifyProps {
  profile: TranscriptProfile;
  onChangeProfile: (next: TranscriptProfile) => void;
  onProceed: () => void;
  extractionMeta: { source: "sample" | "pdf" | "empty"; modelUsed?: string } | null;
  onSetExtractionMeta: (
    meta: { source: "sample" | "pdf" | "empty"; modelUsed?: string } | null
  ) => void;
}

const BUCKET_OPTIONS = SubjectBucketEnum.options;

const SHORT_BUCKET_LABELS: Record<SubjectBucket, string> = {
  MATH: "Mathematics",
  STOCHASTICS: "Stochastics",
  THEORETICAL_CS: "Theoretical CS",
  SYSTEMS_OS_DB_NET: "Systems",
  ARCHITECTURE_HPC: "Architecture",
  PROG_SE_AI_ML: "Programming / SE / AI",
  THESIS_CAPSTONE: "Thesis / capstone",
  INTERNSHIP_SEMINAR: "Internship / seminar",
  NON_CS_GENERAL: "Non-CS",
};

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-2">{children}</div>
      {hint && <p className="mt-2 text-xs leading-relaxed text-mute">{hint}</p>}
    </div>
  );
}

export function Screen1UploadVerify({
  profile,
  onChangeProfile,
  onProceed,
  extractionMeta,
  onSetExtractionMeta,
}: Screen1UploadVerifyProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractingFileCount, setExtractingFileCount] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [courseSearch, setCourseSearch] = useState("");
  const [bucketFilter, setBucketFilter] = useState<SubjectBucket | "ALL">("ALL");

  const checksum = useMemo(() => computeCreditChecksum(profile), [profile]);
  const multipliers = useMemo(() => {
    try {
      return computeEctsMultipliers(profile.totalDegreeCredits);
    } catch {
      return { totalIndianCredits: 160, standard240: 1.5, conservative180: 1.125 };
    }
  }, [profile.totalDegreeCredits]);

  const filteredCourses = useMemo(() => {
    const q = courseSearch.trim().toLowerCase();
    return profile.courses.filter((c) => {
      if (bucketFilter !== "ALL" && c.primaryBucket !== bucketFilter) return false;
      if (!q) return true;
      return (
        c.title.toLowerCase().includes(q) ||
        (c.code || "").toLowerCase().includes(q) ||
        SHORT_BUCKET_LABELS[c.primaryBucket].toLowerCase().includes(q)
      );
    });
  }, [profile.courses, courseSearch, bucketFilter]);

  const handleLoadSample = () => {
    setUploadError(null);
    onChangeProfile(structuredClone(SAMPLE_BTECH_CSE_TRANSCRIPT));
    onSetExtractionMeta({ source: "sample" });
  };

  const handlePdfFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) => f.size > 0);
    if (files.length === 0) return;

    setUploadError(null);
    setIsExtracting(true);
    setExtractingFileCount(files.length);
    try {
      const fd = new FormData();
      for (const f of files) {
        fd.append("files", f);
      }
      const res = await fetch("/api/extract-transcript", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Extraction failed (${res.status})`);

      const hints = json.profileHints || {};
      const extractedCourses: CourseItem[] = Array.isArray(json.courses) ? json.courses : [];
      const sumExtracted = round2(
        extractedCourses.reduce((s, c) => s + (Number(c.indianCredits) || 0), 0)
      );
      const inferredThesisCredits =
        hints.thesisCreditsIndian ??
        round2(
          extractedCourses
            .filter((c) => c.isThesisOrCapstone || c.primaryBucket === "THESIS_CAPSTONE")
            .reduce((s, c) => s + (Number(c.indianCredits) || 0), 0)
        );

      const detectedMaxGrade =
        hints.maxGrade && hints.maxGrade > 0 ? hints.maxGrade : 10.0;

      onChangeProfile({
        ...profile,
        homeUniversity: hints.homeUniversity || profile.homeUniversity || "Indian University",
        degreeName: hints.degreeName || profile.degreeName,
        totalDegreeCredits:
          hints.totalDegreeCredits && hints.totalDegreeCredits > 0
            ? hints.totalDegreeCredits
            : sumExtracted > 0
            ? sumExtracted
            : profile.totalDegreeCredits,
        cgpa: hints.cgpa && hints.cgpa > 0 ? hints.cgpa : profile.cgpa,
        maxGrade: detectedMaxGrade,
        minPassingGrade:
          detectedMaxGrade !== profile.maxGrade ? null : profile.minPassingGrade,
        thesis: { ...profile.thesis, creditsIndian: inferredThesisCredits },
        courses: extractedCourses,
      });
      const fileLabel = files.length > 1 ? ` across ${files.length} PDFs` : "";
      onSetExtractionMeta({
        source: "pdf",
        modelUsed: json.fallbackUsed
          ? `${json.modelUsed} via ${json.pdfEngine} fallback${fileLabel}`
          : `${json.modelUsed}${fileLabel}`,
      });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Could not read the PDF.");
    } finally {
      setIsExtracting(false);
      setExtractingFileCount(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const updateCourse = (id: string, patch: Partial<CourseItem>) => {
    onChangeProfile({
      ...profile,
      courses: profile.courses.map((c) => {
        if (c.id !== id) return c;
        const updated = { ...c, ...patch };
        if (patch.primaryBucket) {
          updated.isThesisOrCapstone =
            patch.primaryBucket === "THESIS_CAPSTONE" ? true : c.isThesisOrCapstone;
          updated.isInternship =
            patch.primaryBucket === "INTERNSHIP_SEMINAR" ? true : c.isInternship;
          const existing = updated.eligibleBuckets ?? [];
          if (!existing.includes(patch.primaryBucket)) {
            updated.eligibleBuckets = [patch.primaryBucket];
          }
        }
        return updated;
      }),
    });
  };

  const deleteCourse = (id: string) =>
    onChangeProfile({ ...profile, courses: profile.courses.filter((c) => c.id !== id) });

  const addCourse = () => {
    const newCourse: CourseItem = {
      id: `manual-${Date.now()}`,
      code: "",
      title: "New course",
      indianCredits: 4,
      grade: "",
      semester: 1,
      primaryBucket: "PROG_SE_AI_ML",
      eligibleBuckets: ["PROG_SE_AI_ML"],
      isThesisOrCapstone: false,
      isInternship: false,
    };
    onChangeProfile({ ...profile, courses: [newCourse, ...profile.courses] });
  };

  const canAudit = profile.courses.length > 0 && profile.totalDegreeCredits > 0 && profile.cgpa > 0;

  const checksumColor =
    checksum.status === "MATCHED"
      ? "text-go"
      : checksum.status === "MINOR_DIFF"
      ? "text-warn"
      : "text-stop";

  const setTest = (key: "greQuant" | "greVerbal" | "greAwa" | "dmatScore", raw: string) =>
    onChangeProfile({
      ...profile,
      standardizedTest: {
        ...profile.standardizedTest,
        [key]: raw === "" ? null : Number(raw),
      },
    });

  return (
    <div>
      <PageIntro step="01 — Transcript" title="Start from your transcript.">
        <p>
          A language model reads the PDF and lists your courses — nothing more. Everything
          after that, from ECTS to grade conversion to the verdict, is computed by fixed
          rules you can inspect line by line.
        </p>
      </PageIntro>

      {/* Upload */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          if (e.dataTransfer.files?.length) void handlePdfFiles(e.dataTransfer.files);
        }}
        className={`mt-12 flex flex-col gap-6 border border-dashed px-8 py-9 transition-colors sm:flex-row sm:items-center sm:justify-between ${
          isDragging ? "border-ink bg-surface" : "border-line-strong"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void handlePdfFiles(e.target.files);
          }}
        />
        {isExtracting ? (
          <div>
            <p className="text-[15px] text-ink">
              Reading {extractingFileCount > 1 ? `${extractingFileCount} PDFs` : "transcript"}
              <span className="animate-pulse">…</span>
            </p>
            <p className="mt-1 text-sm text-mute">
              GPT-6 Luna, with Mistral OCR as fallback. You will check every row next.
            </p>
          </div>
        ) : (
          <div>
            <p className="text-[15px] text-ink">
              Drop one transcript PDF or separate semester marksheets here
            </p>
            <p className="mt-1 text-sm text-mute">
              or{" "}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="link text-ink"
              >
                choose files
              </button>{" "}
              · up to 10 PDFs, 20 MB combined
            </p>
          </div>
        )}
        <button
          type="button"
          onClick={handleLoadSample}
          disabled={isExtracting}
          className="btn-ghost self-start sm:self-auto"
        >
          Use a sample B.Tech. transcript
        </button>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-mute">
        Parsed in memory and discarded immediately — never stored on disk or in a database.
        Feel free to redact your name or roll number before uploading.
      </p>

      {uploadError && (
        <p className="mt-4 border-l-2 border-stop pl-3 text-sm text-stop">{uploadError}</p>
      )}

      {extractionMeta && extractionMeta.source !== "empty" && !uploadError && (
        <p className="num mt-4 text-xs text-mute">
          {extractionMeta.source === "sample"
            ? "Loaded sample — VTU B.Tech. CSE, 48 courses, 160 credits, CGPA 7.3"
            : `Read ${profile.courses.length} courses · ${extractionMeta.modelUsed}`}
        </p>
      )}

      {/* Profile */}
      <section className="mt-20">
        <SectionHeader
          title="Profile"
          aside={<span className="text-xs text-mute">Every change re-runs the audit</span>}
        />
        <div className="mt-8 grid gap-x-12 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label="Home university"
            hint={
              <span className="flex items-center gap-2">
                Pass floor
                <select
                  value={profile.minPassingGrade == null ? "AMBIGUOUS" : String(profile.minPassingGrade)}
                  onChange={(e) =>
                    onChangeProfile({
                      ...profile,
                      minPassingGrade:
                        e.target.value === "AMBIGUOUS" ? null : Number(e.target.value),
                    })
                  }
                  className="select-plain text-xs text-ink underline decoration-line-strong underline-offset-4"
                >
                  {profile.maxGrade === 100 ? (
                    <>
                      <option value="AMBIGUOUS">unknown (40%–50%)</option>
                      <option value="40">40%</option>
                      <option value="45">45%</option>
                      <option value="50">50%</option>
                    </>
                  ) : (
                    <>
                      <option value="AMBIGUOUS">unknown (4.0–5.0)</option>
                      <option value="4">4.0</option>
                      <option value="4.5">4.5</option>
                      <option value="5">5.0</option>
                    </>
                  )}
                </select>
              </span>
            }
          >
            <input
              type="text"
              value={profile.homeUniversity}
              onChange={(e) => onChangeProfile({ ...profile, homeUniversity: e.target.value })}
              placeholder="e.g. MIT World Peace University"
              className="field"
            />
          </Field>

          <Field
            label="Total degree credits"
            hint={
              <span className="num">
                × {multipliers.standard240.toFixed(3)} ECTS (4-yr) · ×{" "}
                {multipliers.conservative180.toFixed(3)} (3-yr)
              </span>
            }
          >
            <input
              type="number"
              min={60}
              max={300}
              value={profile.totalDegreeCredits}
              onChange={(e) =>
                onChangeProfile({
                  ...profile,
                  totalDegreeCredits: Math.max(1, Number(e.target.value) || 1),
                })
              }
              className="field num"
            />
          </Field>

          <Field
            label={profile.maxGrade === 100 ? "Aggregate percentage" : `CGPA, out of ${profile.maxGrade}`}
            hint="Supports both 10-point CGPA and Indian percentage marksheets."
          >
            <div className="flex items-end gap-5">
              <input
                type="number"
                min={1}
                max={profile.maxGrade}
                step={profile.maxGrade === 100 ? 0.1 : 0.01}
                value={profile.cgpa}
                onChange={(e) =>
                  onChangeProfile({
                    ...profile,
                    cgpa: Math.max(0.1, Number(e.target.value) || 0.1),
                  })
                }
                className="field num w-24"
              />
              <Segmented<"10" | "100">
                value={profile.maxGrade === 100 ? "100" : "10"}
                options={[
                  { value: "10", label: "/ 10" },
                  { value: "100", label: "%" },
                ]}
                onChange={(scale) => {
                  const nextMax = scale === "100" ? 100 : 10;
                  if (nextMax === profile.maxGrade) return;
                  const convertedGrade =
                    nextMax === 100
                      ? Math.min(100, round2(profile.cgpa <= 10 ? profile.cgpa * 10 : profile.cgpa))
                      : Math.min(10, round2(profile.cgpa > 10 ? profile.cgpa / 10 : profile.cgpa));
                  onChangeProfile({
                    ...profile,
                    maxGrade: nextMax,
                    cgpa: convertedGrade,
                    minPassingGrade: null,
                  });
                }}
              />
            </div>
          </Field>

          <Field
            label="English"
            hint="Several faculties refuse a medium-of-instruction letter."
          >
            <div className="flex items-end gap-5">
              <Segmented<EnglishProofType>
                value={profile.englishProof.type}
                options={[
                  { value: "MOI", label: "MOI" },
                  { value: "IELTS", label: "IELTS" },
                  { value: "TOEFL_IBT", label: "TOEFL" },
                  { value: "NONE", label: "None" },
                ]}
                onChange={(nextType) =>
                  onChangeProfile({
                    ...profile,
                    englishProof: {
                      type: nextType,
                      score: nextType === "IELTS" ? 7.0 : nextType === "TOEFL_IBT" ? 95 : null,
                    },
                  })
                }
              />
              {(profile.englishProof.type === "IELTS" ||
                profile.englishProof.type === "TOEFL_IBT") && (
                <input
                  type="number"
                  aria-label="Score"
                  step={profile.englishProof.type === "IELTS" ? 0.5 : 1}
                  min={0}
                  max={profile.englishProof.type === "IELTS" ? 9 : 120}
                  value={profile.englishProof.score ?? ""}
                  onChange={(e) =>
                    onChangeProfile({
                      ...profile,
                      englishProof: {
                        ...profile.englishProof,
                        score: e.target.value === "" ? null : Number(e.target.value),
                      },
                    })
                  }
                  className="field num w-16"
                />
              )}
            </div>
          </Field>

          <Field label="GRE or dMAT — optional" hint="Quant · Verbal · Writing · dMAT %. Leave blank if not taken.">
            <div className="grid grid-cols-4 gap-3">
              <input
                type="number"
                placeholder="Q"
                aria-label="GRE Quant"
                value={profile.standardizedTest?.greQuant ?? ""}
                onChange={(e) => setTest("greQuant", e.target.value)}
                className="field num"
              />
              <input
                type="number"
                placeholder="V"
                aria-label="GRE Verbal"
                value={profile.standardizedTest?.greVerbal ?? ""}
                onChange={(e) => setTest("greVerbal", e.target.value)}
                className="field num"
              />
              <input
                type="number"
                step={0.5}
                placeholder="AWA"
                aria-label="GRE Analytical Writing"
                value={profile.standardizedTest?.greAwa ?? ""}
                onChange={(e) => setTest("greAwa", e.target.value)}
                className="field num"
              />
              <input
                type="number"
                min={0}
                max={100}
                placeholder="dMAT"
                aria-label="TestAS dMAT CS score percentage"
                value={profile.standardizedTest?.dmatScore ?? ""}
                onChange={(e) => setTest("dmatScore", e.target.value)}
                className="field num"
              />
            </div>
          </Field>

          <Field
            label="Thesis or capstone"
            hint={
              <span className="num">
                = {round2(profile.thesis.creditsIndian * multipliers.standard240)} ECTS
              </span>
            }
          >
            <div className="flex items-end gap-5">
              <input
                type="number"
                min={0}
                max={40}
                step={0.5}
                aria-label="Thesis credits"
                value={profile.thesis.creditsIndian}
                onChange={(e) =>
                  onChangeProfile({
                    ...profile,
                    thesis: {
                      ...profile.thesis,
                      creditsIndian: Math.max(0, Number(e.target.value) || 0),
                    },
                  })
                }
                className="field num w-16"
              />
              <Segmented<"SOLO" | "GROUP">
                value={profile.thesis.isSolo ? "SOLO" : "GROUP"}
                options={[
                  { value: "SOLO", label: "Solo" },
                  { value: "GROUP", label: "Group" },
                ]}
                onChange={(v) =>
                  onChangeProfile({
                    ...profile,
                    thesis: { ...profile.thesis, isSolo: v === "SOLO" },
                  })
                }
              />
            </div>
          </Field>
        </div>
      </section>

      {/* Courses */}
      <section className="mt-20">
        <SectionHeader
          title={`Courses${profile.courses.length ? ` · ${profile.courses.length}` : ""}`}
          aside={
            profile.courses.length > 0 && (
              <span className={`num text-sm ${checksumColor}`}>
                Σ {checksum.extractedCredits} / {checksum.officialTotalCredits} credits
                {checksum.status === "MATCHED"
                  ? " · balanced"
                  : ` · ${checksum.deltaCredits > 0 ? "+" : ""}${checksum.deltaCredits}`}
              </span>
            )
          }
        />

        {checksum.status !== "MATCHED" && profile.courses.length > 0 && (
          <p
            className={`mt-4 border-l-2 pl-3 text-sm ${
              checksum.status === "MINOR_DIFF" ? "border-warn text-warn" : "border-stop text-stop"
            }`}
          >
            {checksum.message}
          </p>
        )}

        {profile.courses.length === 0 ? (
          <p className="py-14 text-sm text-mute">
            Nothing here yet. Upload a transcript, or{" "}
            <button type="button" onClick={handleLoadSample} className="link text-ink">
              load the sample
            </button>
            .
          </p>
        ) : (
          <>
            <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
              <div className="flex flex-wrap items-end gap-8">
                <input
                  type="text"
                  value={courseSearch}
                  onChange={(e) => setCourseSearch(e.target.value)}
                  placeholder="Search courses"
                  className="field w-56 text-sm"
                />
                <select
                  value={bucketFilter}
                  onChange={(e) => setBucketFilter(e.target.value as SubjectBucket | "ALL")}
                  className="select-plain border-b border-line-strong py-1.5"
                >
                  <option value="ALL">All subject areas</option>
                  {BUCKET_OPTIONS.map((b) => (
                    <option key={b} value={b}>
                      {SHORT_BUCKET_LABELS[b]}
                    </option>
                  ))}
                </select>
              </div>
              <button type="button" onClick={addCourse} className="link text-sm text-ink">
                Add a course
              </button>
            </div>

            <div className="mt-6 max-h-[520px] overflow-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-paper">
                  <tr className="border-b border-line-strong text-left">
                    <th className="eyebrow w-24 py-2 pr-3 font-normal">Code</th>
                    <th className="eyebrow py-2 pr-3 font-normal">Course</th>
                    <th className="eyebrow w-16 py-2 pr-3 text-right font-normal">Cr</th>
                    <th className="eyebrow w-16 py-2 pr-4 text-right font-normal">ECTS</th>
                    <th className="eyebrow w-48 py-2 pr-3 font-normal">Subject area</th>
                    <th className="eyebrow w-32 py-2 pr-3 font-normal">Excluded as</th>
                    <th className="w-8 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {filteredCourses.map((course) => (
                    <tr key={course.id} className="group border-b border-line hover:bg-surface">
                      <td className="py-1.5 pr-3">
                        <input
                          type="text"
                          aria-label="Course code"
                          value={course.code || ""}
                          onChange={(e) => updateCourse(course.id, { code: e.target.value })}
                          className="cell num text-xs text-mute"
                        />
                      </td>
                      <td className="py-1.5 pr-3">
                        <input
                          type="text"
                          aria-label="Course title"
                          value={course.title}
                          onChange={(e) => updateCourse(course.id, { title: e.target.value })}
                          className="cell text-ink"
                        />
                      </td>
                      <td className="py-1.5 pr-3">
                        <input
                          type="number"
                          aria-label="Indian credits"
                          min={0}
                          max={30}
                          step={0.5}
                          value={course.indianCredits}
                          onChange={(e) =>
                            updateCourse(course.id, {
                              indianCredits: Math.max(0, Number(e.target.value) || 0),
                            })
                          }
                          className="cell num text-right"
                        />
                      </td>
                      <td className="num py-1.5 pr-4 text-right text-mute">
                        {(course.indianCredits * multipliers.standard240).toFixed(1)}
                      </td>
                      <td className="py-1.5 pr-3">
                        <select
                          aria-label="Subject area"
                          value={course.primaryBucket}
                          title={SUBJECT_BUCKET_LABELS[course.primaryBucket]}
                          onChange={(e) =>
                            updateCourse(course.id, {
                              primaryBucket: e.target.value as SubjectBucket,
                            })
                          }
                          className="select-plain w-full"
                        >
                          {BUCKET_OPTIONS.map((b) => (
                            <option key={b} value={b}>
                              {SHORT_BUCKET_LABELS[b]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1.5 pr-3">
                        <div className="flex gap-3 text-xs text-mute">
                          <label className="flex cursor-pointer items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={course.isThesisOrCapstone}
                              onChange={(e) =>
                                updateCourse(course.id, { isThesisOrCapstone: e.target.checked })
                              }
                            />
                            Thesis
                          </label>
                          <label className="flex cursor-pointer items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={course.isInternship}
                              onChange={(e) =>
                                updateCourse(course.id, { isInternship: e.target.checked })
                              }
                            />
                            Intern
                          </label>
                        </div>
                      </td>
                      <td className="py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => deleteCourse(course.id)}
                          aria-label={`Remove ${course.title}`}
                          className="cursor-pointer px-1 text-faint opacity-0 transition-opacity hover:text-stop group-hover:opacity-100 focus:opacity-100"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <div className="mt-12 flex flex-col gap-6 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-md text-xs leading-relaxed text-mute">
          From this point no model is involved. The audit runs on rules taken from each
          university&rsquo;s published admission regulations.
        </p>
        <button type="button" disabled={!canAudit} onClick={onProceed} className="btn-solid">
          Run the audit <span aria-hidden>→</span>
        </button>
      </div>
    </div>
  );
}
