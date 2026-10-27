/**
 * Optional checklist items (Objectives E and H).
 *
 * Some checklist items are an invitation, not a check — the first is
 * "Have you made an improvement today?" at the end of every closing list
 * (migration 0320, Graeme 27 Oct 2026). An optional item:
 *   - never counts towards a checklist's done/total, so it can't hold a
 *     checklist at "9/10" or block anyone finishing;
 *   - is never listed as missed on the HACCP outstanding report;
 *   - always sits at the END of its section, whatever order positions say.
 *
 * Which items are optional is decided by their dynamic data TYPE — never by
 * title or station — so the rule follows the item wherever it's added.
 * Pure (no DB) so the rules are unit-tested.
 */

/** The end-of-day "Have you made an improvement today?" question. */
export const IMPROVEMENT_PROMPT_TYPE = "improvement_prompt";

const OPTIONAL_TYPES: ReadonlySet<string> = new Set([IMPROVEMENT_PROMPT_TYPE]);

export function isOptionalChecklistType(dynamicDataType: string | null | undefined): boolean {
  return dynamicDataType != null && OPTIONAL_TYPES.has(dynamicDataType);
}

/** done/total over the REQUIRED items only. */
export function checklistSummary(items: ReadonlyArray<{ completed: boolean; optional?: boolean }>): { total: number; done: number } {
  const required = items.filter(i => !i.optional);
  return { total: required.length, done: required.filter(i => i.completed).length };
}

/** Optional items moved to the end, everything else in its existing order. */
export function pinOptionalLast<T extends { optional?: boolean }>(items: readonly T[]): T[] {
  return [...items.filter(i => !i.optional), ...items.filter(i => i.optional)];
}

/**
 * When a station gets its first closing item, it gets the improvement
 * question too — so a new closing checklist includes it by default. Never
 * when the station already has one, active or removed: a station that took
 * it off keeps it off.
 */
export function shouldAddPromptOnCreate(opts: {
  category: string;
  dynamicDataType: string | null | undefined;
  stationHasPrompt: boolean;
}): boolean {
  return opts.category === "closing"
    && opts.dynamicDataType !== IMPROVEMENT_PROMPT_TYPE
    && !opts.stationHasPrompt;
}
