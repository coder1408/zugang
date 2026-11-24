"use client";

import React, { useMemo, useState } from "react";
import type { TranscriptProfile } from "@/lib/schemas";
import type { ProgramAuditResult } from "@/lib/engine";
import { ReceiptsDrawer } from "@/components/ReceiptsDrawer";
import { Mark, PageIntro, VerdictTag } from "@/components/ui";

interface Screen3ShortlistProps {
  profile: TranscriptProfile;
  auditResults: ProgramAuditResult[];
  onBackToRealityCheck: () => void;
  onEditInputs: () => void;
}

type FilterKey =
  | "ALL"
  | "GREEN_ONLY"
  | "ZERO_TUITION"
  | "FREE_PORTAL"
  | "NO_VPD"
  | "NO_NC"
  | "NO_GRE";

const FILTER_DEFS: Array<{
  key: FilterKey;
  label: string;
  predicate: (r: ProgramAuditResult) => boolean;
}> = [
  { key: "ALL", label: "All", predicate: () => true },
  { key: "GREEN_ONLY", label: "Eligible only", predicate: (r) => r.verdict === "GREEN" },
  {
    key: "ZERO_TUITION",
    label: "€0 tuition",
    predicate: (r) => r.program.tuitionPerSemesterEur === 0,
  },
  { key: "FREE_PORTAL", label: "Free portal", predicate: (r) => r.program.portal.isFreePortal },
  { key: "NO_VPD", label: "No VPD", predicate: (r) => !r.program.portal.vpdRequired },
  { key: "NO_NC", label: "Open admission", predicate: (r) => r.program.isNoNc },
  { key: "NO_GRE", label: "No GRE", predicate: (r) => !r.program.testRule.greRequired },
];

const PILLAR_LABELS: Record<string, string> = {
  BUCKETS: "Credits",
  THESIS: "Thesis",
  ENGLISH: "English",
  STANDARDIZED_TEST: "GRE",
  GRADE: "Grade",
};

export function Screen3Shortlist({
  profile,
  auditResults,
  onBackToRealityCheck,
  onEditInputs,
}: Screen3ShortlistProps) {
  const [activeFilters, setActiveFilters] = useState<Set<FilterKey>>(new Set(["ALL"]));
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);

  const toggleFilter = (key: FilterKey) => {
    if (key === "ALL") {
      setActiveFilters(new Set(["ALL"]));
      return;
    }
    const next = new Set(activeFilters);
    next.delete("ALL");
    if (next.has(key)) next.delete(key);
    else next.add(key);
    if (next.size === 0) next.add("ALL");
    setActiveFilters(next);
  };

  const filteredResults = useMemo(() => {
    if (activeFilters.has("ALL")) return auditResults;
    return auditResults.filter((r) =>
      Array.from(activeFilters).every((key) => {
        const def = FILTER_DEFS.find((d) => d.key === key);
        return def ? def.predicate(r) : true;
      })
    );
  }, [auditResults, activeFilters]);

  const selectedAudit = useMemo(
    () => auditResults.find((r) => r.programId === selectedProgramId) ?? null,
    [auditResults, selectedProgramId]
  );

  return (
    <div>
      <PageIntro step="03 — Shortlist" title={`${auditResults.length} public programmes, audited.`}>
        <p>
          No match scores. Open a programme to see the arithmetic behind its verdict, the
          application route, and the paragraph of the regulation it rests on.
        </p>
        <p className="mt-3 text-sm text-mute">
          We take no commission from universities, agents or consultancies.
        </p>
      </PageIntro>

      <div className="mt-14 flex flex-wrap items-baseline justify-between gap-4 border-b border-ink pb-3">
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {FILTER_DEFS.map((def) => {
            const active = activeFilters.has(def.key);
            const n = auditResults.filter(def.predicate).length;
            return (
              <button
                key={def.key}
                type="button"
                aria-pressed={active}
                onClick={() => toggleFilter(def.key)}
                className={`cursor-pointer transition-colors ${
                  active
                    ? "text-ink underline decoration-1 underline-offset-[6px]"
                    : "text-mute hover:text-ink"
                }`}
              >
                {def.label}
                <sup className="num ml-0.5 text-[10px] text-faint">{n}</sup>
              </button>
            );
          })}
        </div>
        <span className="num text-xs text-mute">
          {filteredResults.length} of {auditResults.length}
        </span>
      </div>

      {filteredResults.length === 0 ? (
        <p className="py-14 text-sm text-mute">
          No programme matches every selected filter.{" "}
          <button
            type="button"
            onClick={() => setActiveFilters(new Set(["ALL"]))}
            className="link text-ink"
          >
            Clear filters
          </button>
        </p>
      ) : (
        <ul>
          {filteredResults.map((audit) => {
            const { program, verdict, pillars, summaryReasons } = audit;
            return (
              <li key={audit.programId}>
                <button
                  type="button"
                  onClick={() => setSelectedProgramId(audit.programId)}
                  className="group -mx-4 grid w-[calc(100%+2rem)] cursor-pointer grid-cols-1 gap-4 border-b border-line px-4 py-7 text-left transition-colors hover:bg-surface sm:grid-cols-[9.5rem_1fr_auto] sm:gap-8"
                >
                  <div className="pt-1.5">
                    <VerdictTag v={verdict} />
                  </div>

                  <div>
                    <h3 className="font-serif text-[1.375rem] leading-snug text-ink">
                      {program.university}
                    </h3>
                    <p className="mt-0.5 text-sm text-ink-2">
                      {program.degreeType} {program.programName} · {program.city}
                    </p>

                    {verdict !== "GREEN" && (
                      <ul className="mt-3 space-y-1 text-sm text-ink-2">
                        {summaryReasons.map((r, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="text-faint">—</span>
                            <span>{r}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-mute">
                      {pillars.map((p) => (
                        <span key={p.pillar} className="flex items-center gap-1.5">
                          <Mark v={p.status} className="h-1.5 w-1.5" />
                          {PILLAR_LABELS[p.pillar]}
                        </span>
                      ))}
                    </div>

                    <p className="num mt-3 text-xs text-faint">
                      {program.tuitionPerSemesterEur > 0 && (
                        <span className="text-ink-2">
                          €{program.tuitionPerSemesterEur.toLocaleString("en-IE")}/sem tuition ·{" "}
                        </span>
                      )}
                      {program.portal.isFreePortal
                        ? "Direct portal, no fee"
                        : `${program.portal.name}, €${program.portal.feeEur}`}
                      {" · "}
                      {program.portal.vpdRequired ? "VPD required" : "No VPD"}
                      {" · "}
                      {program.isNoNc ? "Open admission" : "Ranked admission"}
                      {" · "}
                      Deadline {program.portal.winterDeadlineNonEu}
                    </p>
                  </div>

                  <span className="hidden pt-1 text-sm text-mute transition-colors group-hover:text-ink sm:block">
                    Receipts <span aria-hidden>→</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-12 flex items-center justify-between gap-6">
        <button
          type="button"
          onClick={onBackToRealityCheck}
          className="cursor-pointer text-sm text-mute transition-colors hover:text-ink"
        >
          <span aria-hidden>←</span> Reality check
        </button>
        <button type="button" onClick={onEditInputs} className="link text-sm text-ink">
          Edit transcript
        </button>
      </div>

      <ReceiptsDrawer
        profile={profile}
        audit={selectedAudit}
        onClose={() => setSelectedProgramId(null)}
      />
    </div>
  );
}
