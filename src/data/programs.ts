import rawPrograms from "@/data/programs.seed.json";
import { ProgramRulesDatabaseSchema, type ProgramRule } from "@/lib/schemas";

let cachedPrograms: ProgramRule[] | null = null;

/**
 * Loads and Zod-validates the version-controlled German university rules database.
 * Throws immediately if any rule violates ProgramRuleSchema.
 */
export function loadSeedPrograms(): ProgramRule[] {
  if (!cachedPrograms) {
    cachedPrograms = ProgramRulesDatabaseSchema.parse(rawPrograms);
  }
  return cachedPrograms;
}
