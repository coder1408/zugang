"use client";

import React from "react";
import type { TranscriptProfile } from "@/lib/schemas";
import type {
  EctsMultipliers,
  GermanGradeRange,
  ProfileVulnerability,
  ProgramAuditResult,
} from "@/lib/engine";
import { Eyebrow, Mark, PageIntro, SectionHeader } from "@/components/ui";

interface Screen2RealityCheckProps {
  profile: TranscriptProfile;
  multipliers: EctsMultipliers;
  gradeRange: GermanGradeRange;
  auditResults: ProgramAuditResult[];
  vulnerabilities: ProfileVulnerability[];
  onBack: () => void;
  onProceed: () => void;
}

function Figure({
  value,
  label,
  note,
  dim = false,
}: {
  value: string;
  label: string;
  note: string;
  dim?: boolean;
}) {
  return (
    <div>
      <div
        className={`font-serif text-[3.25rem] leading-none tracking-[-0.02em] ${
          dim ? "text-ink-2" : "text-ink"
        }`}
      >
        {value}
      </div>
      <div className="mt-4 text-sm text-ink">{label}</div>
      <div className="num mt-0.5 text-xs text-mute">{note}</div>
    </div>
  );
}

const SEVERITY: Record<ProfileVulnerability["severity"], { label: string; cls: string }> = {
  HIGH: { label: "High", cls: "text-stop" },
  MEDIUM: { label: "Medium", cls: "text-warn" },
  INFO: { label: "Note", cls: "text-mute" },
};

export function Screen2RealityCheck({
  profile,
  multipliers,
  gradeRange,
  auditResults,
  vulnerabilities,
  onBack,
  onProceed,
}: Screen2RealityCheckProps) {
  const count = (v: "GREEN" | "YELLOW" | "RED") =>
    auditResults.filter((r) => r.verdict === v).length;
  const { optimistic: opt, conservative: cons } = gradeRange;

  return (
    <div>
      <PageIntro step="02 — Reality check" title="How a German faculty will read your degree.">
        <p className="num text-xs text-mute">
          {profile.homeUniversity || "Home university"} · {profile.degreeName} ·{" "}
          {profile.maxGrade === 100
            ? `${profile.cgpa}%`
            : `CGPA ${profile.cgpa}/${profile.maxGrade}`}{" "}
          · {profile.totalDegreeCredits} credits
        </p>
      </PageIntro>

      <div className="mt-8 flex flex-wrap gap-x-8 gap-y-2 text-sm text-ink-2">
        <span className="flex items-center gap-2">
          <Mark v="GREEN" />
          {count("GREEN")} eligible
        </span>
        <span className="flex items-center gap-2">
          <Mark v="YELLOW" />
          {count("YELLOW")} to verify
        </span>
        <span className="flex items-center gap-2">
          <Mark v="RED" />
          {count("RED")} likely rejected
        </span>
      </div>

      <section className="mt-16 grid gap-14 border-t border-ink pt-10 lg:grid-cols-2 lg:gap-0 lg:divide-x lg:divide-line">
        <div className="lg:pr-14">
          <Eyebrow>ECTS per Indian credit</Eyebrow>
          <div className="mt-8 grid grid-cols-2 gap-8">
            <Figure
              value={multipliers.standard240.toFixed(3)}
              label="Four-year basis"
              note={`240 ÷ ${profile.totalDegreeCredits}`}
            />
            <Figure
              value={multipliers.conservative180.toFixed(3)}
              label="Three-year basis"
              note={`180 ÷ ${profile.totalDegreeCredits}`}
              dim
            />
          </div>
          <p className="mt-8 max-w-md text-sm leading-relaxed text-ink-2">
            Most faculties apply the four-year basis to an H+ Indian B.Tech. A stricter
            reader may benchmark against a 180-ECTS German bachelor&rsquo;s. Your CSV export
            carries both.
          </p>
        </div>

        <div className="lg:pl-14">
          <Eyebrow>German grade · modified Bavarian formula</Eyebrow>
          <div className="mt-8 grid grid-cols-2 gap-8">
            <Figure
              value={opt.truncated1.toFixed(1)}
              label={`Pass floor ${profile.maxGrade === 100 ? `${opt.nMin}%` : opt.nMin.toFixed(1)}`}
              note={`${opt.truncated2.toFixed(2)} before truncation`}
            />
            <Figure
              value={cons.truncated1.toFixed(1)}
              label={`Pass floor ${profile.maxGrade === 100 ? `${cons.nMin}%` : cons.nMin.toFixed(1)}`}
              note={`${cons.truncated2.toFixed(2)} before truncation`}
              dim
            />
          </div>
          <p className="num mt-8 text-xs text-mute">
            N = 1 + 3 × (Nmax − Nd) ÷ (Nmax − Nmin), truncated
          </p>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-ink-2">
            In Germany 1.0 is the best grade and 4.0 the lowest pass.{" "}
            {gradeRange.isAmbiguousPassFloor
              ? "Your university's degree pass floor is unknown, so any cutoff that falls between these two figures is marked for verification."
              : "Using the pass floor you confirmed."}
          </p>
        </div>
      </section>

      <section className="mt-20">
        <SectionHeader
          title="Where your profile is exposed"
          aside={<span className="num text-xs text-mute">{vulnerabilities.length} findings</span>}
        />
        {vulnerabilities.length === 0 ? (
          <p className="py-8 text-sm text-ink-2">
            No structural weaknesses found against the audited regulations.
          </p>
        ) : (
          <ol>
            {vulnerabilities.map((v, i) => (
              <li
                key={v.id}
                className="grid grid-cols-[2.5rem_1fr_auto] gap-x-4 border-b border-line py-6"
              >
                <span className="num pt-0.5 text-xs text-faint">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="text-[15px] font-medium text-ink">{v.title}</h3>
                  <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-2">
                    {v.detail}
                  </p>
                  {v.impactedPrograms.length > 0 && (
                    <p className="mt-2 text-xs text-mute">
                      Affects {v.impactedPrograms.join(", ")}
                    </p>
                  )}
                </div>
                <span
                  className={`num pt-0.5 text-[11px] uppercase tracking-[0.08em] ${
                    SEVERITY[v.severity].cls
                  }`}
                >
                  {SEVERITY[v.severity].label}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="mt-12 flex items-center justify-between gap-6 border-t border-line pt-6">
        <button
          type="button"
          onClick={onBack}
          className="cursor-pointer text-sm text-mute transition-colors hover:text-ink"
        >
          <span aria-hidden>←</span> Edit transcript
        </button>
        <button type="button" onClick={onProceed} className="btn-solid">
          See the shortlist <span aria-hidden>→</span>
        </button>
      </div>
    </div>
  );
}
