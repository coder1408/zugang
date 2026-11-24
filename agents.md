# Architectural Guardrails (`agents.md`)

This repository implements a zero-commission, customer-obsessed B2C eligibility audit tool for Indian B.Tech./B.E. graduates applying to English-taught public M.Sc. programs (CS, AI, Data Science) in Germany.

Every human engineer and AI agent contributing to this codebase **MUST** obey the following four non-negotiable architectural rules:

---

## 1. Zero-Hallucination Split
- **LLM Scope (Strictly Extraction Only):** Use an LLM with strict JSON schema output validated by Zod (OpenRouter primary: `openai/gpt-6-luna` native PDF with automatic `mistral-ocr` + `mistralai/mistral-small-2603` backup, or direct `@google/genai` `gemini-3.8-flash`) **ONLY** to extract raw courses, Indian credit values, grades, and profile metadata from uploaded transcript PDFs inside `/api/extract-transcript`.
- **Deterministic Engine (`src/lib/engine/`):** Zero LLM calls, zero network calls, and zero non-deterministic logic are allowed inside `src/lib/engine/`.
- All ECTS conversion multipliers (`240 / total_indian_credits` and `180 / total_indian_credits`), Modified Bavarian Formula grade conversions (truncated, never rounded), non-overlapping subject-bucket allocations, and `GREEN` / `YELLOW` / `RED` verdicts **MUST** be pure, deterministic TypeScript functions covered by Vitest unit tests.

## 2. Receipts Over Match Scores
- **No Arbitrary Match Percentages:** Never compute, store, or display fabricated percentage scores such as `"90% match"` or `"84% chance of admission"`.
- **Verifiable Receipts Required:** Every program evaluation (`ProgramAuditResult`) must surface exact, auditable receipts:
  - Bucket-by-bucket required vs. earned ECTS math with the exact non-overlapping list of mapped courses (and any excluded thesis/internship modules).
  - Exact selection formula weights verbatim from the admission regulations.
  - Exact application portal, fee, VPD, APS, and deadline routing.
  - Direct official *Zugangsordnung* / *Prüfungsordnung* URL and exact paragraph citation (`§`).

## 3. User-in-the-Loop Parsing
- Never run an eligibility audit blindly on raw OCR / LLM output without giving the user verification control.
- Always render an editable course & credit table immediately after PDF extraction (or sample transcript loading), displaying a live **Credit Checksum Badge** (`Extracted Course Credits vs. Official Total Degree Credits`) with a prominent mismatch warning whenever the sum diverges from the official degree total.

## 4. Scope Discipline (v1)
- **No user authentication** (no accounts, logins, OAuth, or sessions).
- **No payment gateways** or paywalls (100% free public-university audit; zero commissions from private universities or consultancies).
- **No live web scraping** at runtime.
- All German university admission rules live in a clean, version-controlled, Zod-validated JSON database (`src/data/programs.seed.json`) audited against official *Zugangsordnung* PDFs.
