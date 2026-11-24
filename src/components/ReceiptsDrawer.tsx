"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { TranscriptProfile } from "@/lib/schemas";
import {
  generateEctsMappingCsv,
  generateFacultyVerificationEmail,
  type ProgramAuditResult,
} from "@/lib/engine";
import { Mark, VerdictTag } from "@/components/ui";

interface ReceiptsDrawerProps {
  profile: TranscriptProfile;
  audit: ProgramAuditResult | null;
  onClose: () => void;
}

function Block({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-line py-8 last:border-0">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="eyebrow">{title}</h3>
        {aside && <span className="num text-[11px] text-faint">{aside}</span>}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Bar({ earned, required, met }: { earned: number; required: number; met: boolean }) {
  const pct = required > 0 ? Math.min(100, (earned / required) * 100) : 100;
  return (
    <div className="mt-2.5 h-[3px] w-full bg-line">
      <div className={`h-full ${met ? "bg-ink" : "bg-stop"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="link text-sm text-ink">
      {children} <span aria-hidden>↗</span>
    </a>
  );
}

export function ReceiptsDrawer({ profile, audit, onClose }: ReceiptsDrawerProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!audit) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [audit, onClose]);

  const emailDraft = useMemo(() => {
    if (!audit || audit.verdict !== "YELLOW") return null;
    return generateFacultyVerificationEmail(profile, audit.program, audit);
  }, [audit, profile]);

  if (!audit) return null;
  const { program, bucketSolve, pillars, verdict } = audit;

  const downloadCsv = () => {
    const csv = generateEctsMappingCsv(profile, program, audit);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${program.id}-ects-mapping.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const copyEmail = async () => {
    if (!emailDraft) return;
    await navigator.clipboard.writeText(
      `To: ${emailDraft.to}\nSubject: ${emailDraft.subject}\n\n${emailDraft.body}`
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-ink/25" onClick={onClose} aria-hidden />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Receipts for ${program.university}, ${program.programName}`}
        className="relative z-10 flex h-full w-full max-w-[660px] flex-col border-l border-line bg-paper"
      >
        <header className="border-b border-line px-8 pb-7 pt-6">
          <div className="flex items-center justify-between gap-4">
            <VerdictTag v={verdict} />
            <div className="flex gap-6 text-sm">
              <button
                type="button"
                onClick={downloadCsv}
                className="cursor-pointer text-mute transition-colors hover:text-ink"
              >
                Download CSV
              </button>
              <button
                type="button"
                onClick={onClose}
                className="cursor-pointer text-mute transition-colors hover:text-ink"
              >
                Close
              </button>
            </div>
          </div>
          <h2 className="mt-5 font-serif text-[2rem] leading-tight text-ink">
            {program.university}
          </h2>
          <p className="mt-1 text-[15px] text-ink-2">
            {program.degreeType} {program.programName} · {program.city}
          </p>
          <p className="num mt-3 text-xs text-mute">
            €{program.tuitionPerSemesterEur} tuition · €{program.semesterContributionEur} per
            semester · {program.isNoNc ? "open admission" : "ranked admission"}
          </p>
        </header>

        <div className="flex-1 overflow-y-auto px-8">
          <Block title="Verdict, rule by rule">
            <div>
              {pillars.map((p) => (
                <div
                  key={p.pillar}
                  className="grid grid-cols-[1rem_1fr] gap-3 border-b border-line py-4 last:border-0"
                >
                  <Mark v={p.status} className="mt-[7px]" />
                  <div>
                    <p className="text-sm font-medium text-ink">{p.headline}</p>
                    <p className="mt-1 text-sm leading-relaxed text-ink-2">{p.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </Block>

          <Block
            title="Credit buckets"
            aside={`${bucketSolve.ectsMultiplierUsed.toFixed(3)} ECTS per credit · no course counted twice`}
          >
            <div>
              {bucketSolve.perBucket.map((b) => (
                <div key={b.bucket} className="border-b border-line py-5 last:border-0">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-sm text-ink">{b.label}</span>
                    <span className={`num shrink-0 text-sm ${b.met ? "text-ink" : "text-stop"}`}>
                      {b.earnedEcts.toFixed(1)} / {b.requiredEcts}
                      {!b.met && ` (−${b.deficitEcts.toFixed(1)})`}
                    </span>
                  </div>
                  <Bar earned={b.earnedEcts} required={b.requiredEcts} met={b.met} />
                  {b.assignedCourses.length > 0 ? (
                    <p className="mt-3 text-xs leading-relaxed text-mute">
                      {b.assignedCourses.map((c, i) => (
                        <span key={c.courseId}>
                          {c.title} <span className="num text-faint">{c.ects.toFixed(1)}</span>
                          {i < b.assignedCourses.length - 1 && (
                            <span className="text-line-strong"> · </span>
                          )}
                        </span>
                      ))}
                    </p>
                  ) : (
                    <p className="mt-3 text-xs text-stop">No qualifying course.</p>
                  )}
                </div>
              ))}

              {bucketSolve.combinedChecks.map((c) => (
                <div key={c.id} className="border-b border-line py-5 last:border-0">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-sm text-ink">{c.label}</span>
                    <span className={`num shrink-0 text-sm ${c.met ? "text-ink" : "text-stop"}`}>
                      {c.earnedEcts.toFixed(1)} / {c.requiredEcts}
                      {!c.met && ` (−${c.deficitEcts.toFixed(1)})`}
                    </span>
                  </div>
                  <Bar earned={c.earnedEcts} required={c.requiredEcts} met={c.met} />
                  <p className="mt-2 text-xs text-mute">
                    Summed across {c.includedCourseIds.length} courses.
                  </p>
                </div>
              ))}

              {bucketSolve.excludedCourses.length > 0 && (
                <div className="pt-5">
                  <p className="text-sm text-ink">Not counted, by regulation</p>
                  <ul className="mt-2 space-y-1.5 text-xs text-mute">
                    {bucketSolve.excludedCourses.map((ex) => (
                      <li key={ex.courseId} className="flex justify-between gap-4">
                        <span>{ex.title}</span>
                        <span className="num shrink-0 text-faint">{ex.ects.toFixed(1)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Block>

          <Block title="How applicants are ranked">
            <div>
              {program.selectionWeights.map((w) => (
                <div
                  key={w.criterion}
                  className="flex items-baseline justify-between gap-6 border-b border-line py-3 last:border-0"
                >
                  <div>
                    <p className="text-sm text-ink">{w.criterion}</p>
                    {w.note && <p className="mt-0.5 text-xs text-mute">{w.note}</p>}
                  </div>
                  <span className="num shrink-0 text-sm text-ink">{w.weightPercent}%</span>
                </div>
              ))}
            </div>
          </Block>

          <Block title="Application route">
            <dl className="grid grid-cols-2 gap-x-8 gap-y-5">
              <div>
                <dt className="text-xs text-mute">Portal</dt>
                <dd className="mt-0.5 text-sm text-ink">{program.portal.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-mute">Fee</dt>
                <dd className="num mt-0.5 text-sm text-ink">
                  {program.portal.feeEur === 0 ? "None" : `€${program.portal.feeEur}`}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-mute">uni-assist VPD</dt>
                <dd className="mt-0.5 text-sm text-ink">
                  {program.portal.vpdRequired ? "Required" : "Not required"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-mute">Deadline, non-EU</dt>
                <dd className="mt-0.5 text-sm text-ink">
                  Winter {program.portal.winterDeadlineNonEu}
                  {program.portal.summerDeadlineNonEu
                    ? ` · Summer ${program.portal.summerDeadlineNonEu}`
                    : ""}
                </dd>
              </div>
            </dl>
            <p className="mt-5 text-sm leading-relaxed text-ink-2">
              {program.portal.routingNotes}
            </p>
            <div className="mt-4">
              <ExternalLink href={program.portal.url}>Open the portal</ExternalLink>
            </div>
          </Block>

          <Block title="Regulation">
            <p className="font-serif text-[17px] leading-snug text-ink">
              {program.citation.regulationTitle}
            </p>
            <p className="num mt-2 text-xs text-ink-2">{program.citation.paragraphRef}</p>
            <div className="mt-4 flex flex-wrap items-baseline justify-between gap-3">
              <ExternalLink href={program.citation.officialPdfUrl}>
                Read the regulation
              </ExternalLink>
              <span className="num text-xs text-faint">
                checked {program.citation.lastVerifiedDate}
              </span>
            </div>
          </Block>

          {emailDraft && (
            <Block title="Ask the faculty">
              <p className="text-sm leading-relaxed text-ink-2">
                This verdict turns on a judgement only the admissions office can make. A
                draft, citing the regulation:
              </p>
              <div className="mt-4 border border-line bg-surface p-5">
                <p className="num text-xs text-mute">To {emailDraft.to}</p>
                <p className="mt-1 text-sm font-medium text-ink">{emailDraft.subject}</p>
                <pre className="mt-4 whitespace-pre-wrap border-t border-line pt-4 font-sans text-[13px] leading-relaxed text-ink-2">
                  {emailDraft.body}
                </pre>
              </div>
              <div className="mt-4 flex items-center gap-6">
                <button type="button" onClick={() => void copyEmail()} className="btn-ghost">
                  {copied ? "Copied" : "Copy email"}
                </button>
                <a
                  href={`mailto:${encodeURIComponent(emailDraft.to)}?subject=${encodeURIComponent(
                    emailDraft.subject
                  )}&body=${encodeURIComponent(emailDraft.body)}`}
                  className="link text-sm text-ink"
                >
                  Open in mail
                </a>
              </div>
            </Block>
          )}
        </div>
      </aside>
    </div>
  );
}
