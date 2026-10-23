/**
 * Checklist readings — the rules (issues #87 and #169, Objective D).
 *
 * A checklist item can ask for a reading instead of a bare tick: a number +
 * unit, saved with who and when, e.g. the Monday 'Calibrate scales' check
 * records what each scale read with the test weight on it. Configured on
 * the item (checklist_templates.reading_*, migration 0227):
 *
 *   unit    NULL = a plain tick. Set = the item asks for a reading.
 *   labels  one reading per label ("Scale 1", "Scale 2"); none = one reading.
 *   min/max optional pass range; NULL = no limit on that side.
 *
 * Pure: no DB, so the route and the tests share one copy.
 */

/** The single unlabelled reading of an item with no labels. */
export const UNLABELLED = "";

/** Labels as stored: trimmed, blanks dropped, duplicates (any case) dropped,
 *  original order kept. No labels → one unlabelled reading. */
export function normaliseReadingLabels(labels: ReadonlyArray<string> | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of labels ?? []) {
    const label = raw.trim().replace(/\s+/g, " ");
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out.length ? out : [UNLABELLED];
}

/** Does the item ask for a reading at all? */
export function asksForReading(unit: string | null | undefined): boolean {
  return typeof unit === "string" && unit.trim() !== "";
}

/** In the pass range? null when the item has no range (no verdict). */
export function readingInRange(value: number, min: number | null, max: number | null): boolean | null {
  if (min == null && max == null) return null;
  if (min != null && value < min) return false;
  if (max != null && value > max) return false;
  return true;
}

/** A problem with an item's reading setup, or null when it's fine. */
export function readingConfigProblem(cfg: {
  unit: string | null | undefined;
  labels?: ReadonlyArray<string> | null;
  min: number | null | undefined;
  max: number | null | undefined;
}): string | null {
  if (!asksForReading(cfg.unit)) {
    const hasExtras = (cfg.min != null) || (cfg.max != null)
      || normaliseReadingLabels(cfg.labels ?? null).some(l => l !== UNLABELLED);
    return hasExtras ? "Give the reading a unit (e.g. g or °C) to use labels or a pass range" : null;
  }
  if ((cfg.unit ?? "").trim().length > 12) return "Keep the unit short (e.g. g, kg, °C)";
  if (cfg.min != null && cfg.max != null && cfg.min > cfg.max) return "The lowest pass value is above the highest";
  if (normaliseReadingLabels(cfg.labels ?? null).length > 20) return "At most 20 readings on one item";
  return null;
}

/** Every label has a reading — the item may be ticked. */
export function readingsComplete(labels: ReadonlyArray<string>, recordedLabels: ReadonlyArray<string>): boolean {
  const have = new Set(recordedLabels);
  return labels.every(l => have.has(l));
}

/** The labels still waiting for a reading, in the item's order. */
export function missingReadings(labels: ReadonlyArray<string>, recordedLabels: ReadonlyArray<string>): string[] {
  const have = new Set(recordedLabels);
  return labels.filter(l => !have.has(l));
}
