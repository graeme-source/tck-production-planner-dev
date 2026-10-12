/**
 * Dough Prep mix progress — request schema and response shaping (pure, no
 * DB). The route is routes/dough-mix-progress.ts; the table is
 * dough_mix_progress (migration 0176).
 *
 * A change is ONE operation, never a whole-state overwrite, so two iPads
 * ticking at the same moment each land their own tick:
 *   { action: "tick", mixNo, ingredientKey, ticked }   tick / untick one line
 *   { action: "complete", mixNo, completed }           "Mix N complete" / reopen
 */
import * as z from "zod";

/** Far above any real day (the mixer makes a handful of mixes). */
export const MAX_MIX_NO = 50;

const MixNo = z.number().int().min(1).max(MAX_MIX_NO);

export const DoughMixProgressChange = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("tick"),
    mixNo: MixNo,
    ingredientKey: z.string().trim().min(1).max(200),
    ticked: z.boolean(),
  }).strict(),
  z.object({
    action: z.literal("complete"),
    mixNo: MixNo,
    completed: z.boolean(),
  }).strict(),
]);
export type DoughMixProgressChange = z.infer<typeof DoughMixProgressChange>;

export const DoughMixProgressParams = z.object({
  planId: z.coerce.number().int().positive(),
});

export type DoughMixRowIn = {
  mixNo: number;
  ticks: Record<string, { at: string; by: number | null }> | null;
  completedAt: Date | string | null;
  completedByUserId: number | null;
};

export type DoughMixOut = {
  mixNo: number;
  ticked: Array<{ ingredientKey: string; at: string; byUserId: number | null; byName: string | null }>;
  completedAt: string | null;
  completedBy: { id: number; name: string | null } | null;
};

/** Rows → the GET response's mixes, in mix order, names filled in. */
export function shapeMixes(rows: DoughMixRowIn[], names: Map<number, string>): DoughMixOut[] {
  return [...rows]
    .sort((a, b) => a.mixNo - b.mixNo)
    .map(r => ({
      mixNo: r.mixNo,
      ticked: Object.entries(r.ticks ?? {}).map(([ingredientKey, t]) => ({
        ingredientKey,
        at: t.at,
        byUserId: t.by ?? null,
        byName: t.by != null ? names.get(t.by) ?? null : null,
      })),
      completedAt: r.completedAt == null
        ? null
        : r.completedAt instanceof Date ? r.completedAt.toISOString() : r.completedAt,
      completedBy: r.completedByUserId != null
        ? { id: r.completedByUserId, name: names.get(r.completedByUserId) ?? null }
        : null,
    }));
}
