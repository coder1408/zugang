"use client";

import React, { useMemo, useState } from "react";
import type { TranscriptProfile } from "@/lib/schemas";
import {
  analyzeProfileVulnerabilities,
  auditAllPrograms,
  computeEctsMultipliers,
  computeGermanGradeRange,
} from "@/lib/engine";
import { loadSeedPrograms } from "@/data/programs";
import { Screen1UploadVerify } from "@/components/Screen1UploadVerify";
import { Screen2RealityCheck } from "@/components/Screen2RealityCheck";
import { Screen3Shortlist } from "@/components/Screen3Shortlist";

type ScreenStep = 1 | 2 | 3;

const EMPTY_PROFILE: TranscriptProfile = {
  homeUniversity: "",
  degreeName: "B.Tech. Computer Science & Engineering",
  totalDegreeCredits: 160,
  cgpa: 7.5,
  maxGrade: 10.0,
  minPassingGrade: null,
  englishProof: { type: "MOI", score: null },
  standardizedTest: { greQuant: null, greVerbal: null, greAwa: null, dmatScore: null },
  thesis: { creditsIndian: 6, isSolo: false },
  courses: [],
};

const STEPS: Array<{ id: ScreenStep; n: string; label: string }> = [
  { id: 1, n: "01", label: "Transcript" },
  { id: 2, n: "02", label: "Reality check" },
  { id: 3, n: "03", label: "Shortlist" },
];

export function AuditWorkspace() {
  const [step, setStep] = useState<ScreenStep>(1);
  const [profile, setProfile] = useState<TranscriptProfile>(EMPTY_PROFILE);
  const [extractionMeta, setExtractionMeta] = useState<{
    source: "sample" | "pdf" | "empty";
    modelUsed?: string;
  } | null>(null);

  const programs = useMemo(() => loadSeedPrograms(), []);
  const hasCourses = profile.courses.length > 0 && profile.totalDegreeCredits > 0;

  const multipliers = useMemo(() => {
    try {
      return computeEctsMultipliers(profile.totalDegreeCredits);
    } catch {
      return computeEctsMultipliers(160);
    }
  }, [profile.totalDegreeCredits]);

  const gradeRange = useMemo(() => computeGermanGradeRange(profile), [profile]);

  const auditResults = useMemo(
    () => (hasCourses ? auditAllPrograms(profile, programs) : []),
    [profile, programs, hasCourses]
  );

  const vulnerabilities = useMemo(
    () => (hasCourses ? analyzeProfileVulnerabilities(profile, auditResults) : []),
    [profile, auditResults, hasCourses]
  );

  const go = (s: ScreenStep) => {
    setStep(s);
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-[1080px] flex-col gap-4 px-6 py-5 sm:flex-row sm:items-baseline sm:justify-between">
          <div className="flex items-baseline gap-4">
            <span className="font-serif text-[22px] leading-none tracking-tight text-ink">
              Zugang
            </span>
            <span className="eyebrow hidden md:inline">
              Admission audit · Public universities · No commission
            </span>
          </div>

          <nav aria-label="Steps" className="flex gap-6 text-sm">
            {STEPS.map((s) => {
              const disabled = s.id > 1 && !hasCourses;
              const active = step === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={disabled}
                  aria-current={active ? "step" : undefined}
                  onClick={() => go(s.id)}
                  className={`flex items-baseline gap-2 border-b pb-1 transition-colors ${
                    active
                      ? "border-ink text-ink"
                      : disabled
                      ? "cursor-not-allowed border-transparent text-faint"
                      : "cursor-pointer border-transparent text-mute hover:text-ink"
                  }`}
                >
                  <span className="num text-[11px]">{s.n}</span>
                  {s.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1080px] px-6 pb-28 pt-14">
        {step === 1 && (
          <Screen1UploadVerify
            profile={profile}
            onChangeProfile={setProfile}
            onProceed={() => go(2)}
            extractionMeta={extractionMeta}
            onSetExtractionMeta={setExtractionMeta}
          />
        )}

        {step === 2 && hasCourses && (
          <Screen2RealityCheck
            profile={profile}
            multipliers={multipliers}
            gradeRange={gradeRange}
            auditResults={auditResults}
            vulnerabilities={vulnerabilities}
            onBack={() => go(1)}
            onProceed={() => go(3)}
          />
        )}

        {step === 3 && hasCourses && (
          <Screen3Shortlist
            profile={profile}
            auditResults={auditResults}
            onBackToRealityCheck={() => go(2)}
            onEditInputs={() => go(1)}
          />
        )}
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1080px] flex-wrap justify-between gap-2 px-6 py-6 text-xs text-mute">
          <span>Rules sourced from official Zugangsordnungen. Always confirm with the faculty.</span>
          <span className="num">v0.1</span>
        </div>
      </footer>
    </div>
  );
}
