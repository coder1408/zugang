# Zugang

**Zero-commission German public M.Sc. eligibility audit for Indian B.Tech./B.E. graduates.**

Zugang checks Indian engineering transcripts against the published admission regulations (*Zugangsordnungen*) of **27 English-taught public German Master's programmes** in Computer Science, Artificial Intelligence, and Data Science — returning verifiable arithmetic, portal/VPD routing, selection weights, and official regulation citations instead of fabricated percentage "match scores".

---

## Core Guardrails (`agents.md`)

1. **Zero-Hallucination Split** — An LLM is used *only* in `/api/extract-transcript` to parse raw courses, credits, and grades from uploaded PDFs (`openai/gpt-6-luna` primary → automatic `mistral-ocr` fallback, validated via strict JSON schema + Zod). All ECTS conversions, Modified Bavarian Formula calculations, non-overlapping bucket allocations, and `Eligible` / `Verify` / `Likely rejected` verdicts live in 100% deterministic TypeScript under `src/lib/engine/` covered by Vitest unit tests.
2. **Receipts Over Match Scores** — Never generates arbitrary match percentages. Every verdict opens a Receipts Drawer showing exact bucket-by-bucket credit math, excluded modules, selection weights, portal/VPD/APS routing, a 1-click `.csv` ECTS mapping export, an official *Zugangsordnung* citation, and (for `Verify` edge cases) a pre-drafted faculty email.
3. **User-in-the-Loop Parsing** — Every PDF upload renders an editable course/credit table with a live credit checksum (`Extracted vs. Official Total`) before running the audit.
4. **Scope Discipline (v1)** — No user accounts, no payment gateways, no live scraping, and **€0 commission** from universities or consultancies. Transcript PDFs are parsed in memory and discarded immediately.

---

## Key Features

- **Multi-PDF & Percentage Scale Support**: Upload a consolidated transcript PDF or up to 10 separate semester marksheets (4.5 MB combined); supports both 10-point CGPA (`4.0`–`5.0` pass floor range) and 100-point percentage marksheets (`40%`–`50%` pass floor range), plus an offline **Sample B.Tech. CSE Transcript** mode requiring no API key.
- **Deterministic Engine (`src/lib/engine/`)**:
  - **ECTS Multipliers**: Computes both 4-year standard (`240 / total`) and 3-year conservative (`180 / total`) conversion factors.
  - **Modified Bavarian Formula**: `N_d = 1 + 3 × ((N_max − N_actual) / (N_max − N_min))`, **truncated** (never rounded) to 1 and 2 decimal places, with Optimistic vs. Conservative range when the home university's degree-award pass floor is ambiguous.
  - **Non-Overlapping Subject-Bucket Solver**: Exact branch-and-bound assignment across canonical buckets (`MATH`, `STOCHASTICS`, `THEORETICAL_CS`, `SYSTEMS_OS_DB_NET`, `ARCHITECTURE_HPC`, `PROG_SE_AI_ML`, `THESIS_CAPSTONE`) guaranteeing zero double-counting and enforcing `exclude_thesis_and_internship_from_buckets`, `min_thesis_ects`, and `solo_thesis_required`.
  - **GRE & TestAS dMAT Rules**: Supports mandatory GRE cutoffs, dMAT alternatives, and GPA-based exemptions (e.g., Paderborn `< 1.8`).
- **27 Verified Public German Programmes (`src/data/programs.seed.json`)**:
  RWTH Aachen (DS), TU Dresden (CS), TU Berlin (CS), TU Darmstadt (AI & ML), TU Braunschweig (DS), University of Bonn (CS & AI), Saarland University (CS), University of Tübingen (ML), FAU Erlangen-Nürnberg (AI), Paderborn University (CS), Leibniz University Hannover (CS), University of Würzburg (AI), University of Bremen (AI & Intelligent Systems), University of Hamburg (IAS), University of Göttingen (Applied CS), University of Marburg (CS), University of Passau (CS), University of Siegen (CS), RPTU Kaiserslautern-Landau (CS), University of Potsdam (Cognitive Systems), University of Hildesheim (Data Analytics & Software Engineering), BTU Cottbus-Senftenberg (AI), TH Köln (Digital Sciences), H-BRS (Autonomous Systems), and Hochschule RheinMain (AI & Advanced IT).
- **Shortlist Filters**: `All`, `Eligible only`, `€0 tuition`, `Free portal`, `No VPD`, `Open admission`, `No GRE`.
- **Abuse Guard**: Built-in per-IP 24h rate limiter (`EXTRACT_DAILY_LIMIT_PER_IP`, default `5`) protecting OpenRouter API spend.

---

## Tech Stack

- **Framework**: Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4
- **Validation**: Zod (`src/lib/schemas.ts`)
- **PDF Extraction**: OpenRouter (`openai/gpt-6-luna` native PDF primary + `mistral-ocr` / `mistralai/mistral-small-2603` automatic backup), with `@google/genai` direct fallback
- **Testing**: Vitest (`38` unit tests across 4 suites)

---

## Local Development

```bash
git clone https://github.com/coder1408/zugang.git
cd zugang
npm install
cp .env.example .env.local
```

Add your `OPENROUTER_API_KEY` (or `GEMINI_API_KEY`) to `.env.local` for live PDF uploads — or leave it empty and use the built-in **Sample B.Tech. CSE Transcript** offline.

```bash
npm run dev       # Start dev server on http://localhost:3000
npm test          # Run Vitest deterministic engine & rate-limit tests
npm run typecheck # Run strict TypeScript check
npm run build     # Verify production build
```

---

## Environment Variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `OPENROUTER_API_KEY` | For live PDF upload | — | OpenRouter key for PDF extraction |
| `OPENROUTER_PRIMARY_MODEL` | No | `openai/gpt-6-luna` | Primary native PDF extractor |
| `OPENROUTER_BACKUP_MODEL` | No | `mistralai/mistral-small-2603` | Backup model paired with `mistral-ocr` plugin |
| `GEMINI_API_KEY` | Alternative | — | Direct Google Gemini fallback if OpenRouter key is unset |
| `GEMINI_MODEL` | No | `gemini-3.8-flash` | Model used with direct `@google/genai` SDK |
| `EXTRACT_DAILY_LIMIT_PER_IP` | No | `5` | Max PDF extractions per client IP per 24h |
| `UPSTASH_REDIS_REST_URL` | Recommended on Vercel | — | Upstash Redis REST URL for persistent rate limiting across cold starts |
| `UPSTASH_REDIS_REST_TOKEN` | Recommended on Vercel | — | Upstash Redis REST token (also supports Vercel `KV_REST_API_*` vars) |

---

## Deploying to Vercel

1. Import `coder1408/zugang` in the [Vercel Dashboard](https://vercel.com/new).
2. Keep the auto-detected **Next.js** build settings (`npm run build`).
3. Add the environment variables above (`OPENROUTER_API_KEY`, `OPENROUTER_PRIMARY_MODEL`, `OPENROUTER_BACKUP_MODEL`, `EXTRACT_DAILY_LIMIT_PER_IP`).
4. Click **Deploy**.

> **Note:** Vercel Serverless Functions enforce a 4.5 MB request body limit on the Hobby plan — standard 1–4 page transcript PDFs fit comfortably; very large scanned PDFs should be compressed before upload.

---

## Disclaimer

All rules are encoded from published official *Zugangsordnungen* and *Prüfungsordnungen* and linked directly in every programme's Receipts Drawer. Admission committees retain final authority over degree and syllabus equivalence — always confirm edge cases with the faculty before paying application fees.
