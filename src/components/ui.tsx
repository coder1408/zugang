import React from "react";
import type { Verdict } from "@/lib/engine";

export const VERDICT_LABEL: Record<Verdict, string> = {
  GREEN: "Eligible",
  YELLOW: "Verify",
  RED: "Likely rejected",
};

const VERDICT_TEXT: Record<Verdict, string> = {
  GREEN: "text-go",
  YELLOW: "text-warn",
  RED: "text-stop",
};

const VERDICT_BG: Record<Verdict, string> = {
  GREEN: "bg-go",
  YELLOW: "bg-warn",
  RED: "bg-stop",
};

/** A small square — the only place colour appears. */
export function Mark({ v, className = "" }: { v: Verdict; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 shrink-0 ${VERDICT_BG[v]} ${className}`}
    />
  );
}

export function VerdictTag({ v }: { v: Verdict }) {
  return (
    <span
      className={`inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] ${VERDICT_TEXT[v]}`}
    >
      <Mark v={v} />
      {VERDICT_LABEL[v]}
    </span>
  );
}

export function Eyebrow({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <p className={`eyebrow ${className}`}>{children}</p>;
}

export function PageIntro({
  step,
  title,
  children,
}: {
  step: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="max-w-2xl">
      <Eyebrow>{step}</Eyebrow>
      <h1 className="mt-3 font-serif text-[2.5rem] font-normal leading-[1.1] tracking-[-0.01em] text-ink">
        {title}
      </h1>
      {children && (
        <div className="mt-4 text-[15px] leading-relaxed text-ink-2">{children}</div>
      )}
    </div>
  );
}

export function SectionHeader({
  title,
  aside,
}: {
  title: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-ink pb-2">
      <h2 className="text-sm font-medium text-ink">{title}</h2>
      {aside}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[15px]">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`cursor-pointer border-b py-1 transition-colors ${
              active
                ? "border-ink text-ink"
                : "border-transparent text-mute hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
