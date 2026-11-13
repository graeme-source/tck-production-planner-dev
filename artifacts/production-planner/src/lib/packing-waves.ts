/**
 * Packing waves (Graeme, 13 Nov 2026): "we always pack these boxes in the
 * same order … just put the person on the view that we want." Order (Graeme,
 * 13 Nov 2026): local delivery, wholesale, large boxes, small boxes. The
 * bench opens on the first wave that has orders ready (label booked) and
 * moves on by itself when it's done; a tap on another wave jumps there. Pure.
 */
import type { BoxCategory, LabelFilter } from "./dispatch-tagging";

export type WaveKey = "local" | "large" | "wholesale" | "small";

export const WAVES: ReadonlyArray<{ key: WaveKey; label: string }> = [
  { key: "local", label: "Local delivery" },
  { key: "wholesale", label: "Wholesale" },
  { key: "large", label: "Large boxes" },
  { key: "small", label: "Small boxes" },
];

/** Which wave an order's box category belongs to (collections aren't packed
 *  in a wave — they're handed over). */
export function waveOf(category: BoxCategory): WaveKey | null {
  switch (category) {
    case "local delivery": return "local";
    case "large box": return "large";
    case "wholesale": return "wholesale";
    case "small box":
    case "other": return "small";
    default: return null;
  }
}

/** The wave to show: the one chosen if it still has orders, else the first
 *  in the day's order that does. null = nothing left to pack. */
export function currentWave(counts: Partial<Record<WaveKey, number>>, chosen: WaveKey | null): WaveKey | null {
  if (chosen && (counts[chosen] ?? 0) > 0) return chosen;
  return WAVES.find(w => (counts[w.key] ?? 0) > 0)?.key ?? null;
}

/** The pick-list filters that show one wave. Courier waves show booked
 *  orders only when the app books the labels ("No label" never helps). */
export function waveFilters(key: WaveKey, appBooksLabels: boolean): { box: BoxCategory[]; label: LabelFilter } {
  switch (key) {
    case "local": return { box: [], label: "local" };
    case "wholesale": return { box: [], label: "wholesale" };
    case "large": return { box: ["large box"], label: appBooksLabels ? "booked" : "all" };
    case "small": return { box: ["small box", "other"], label: appBooksLabels ? "booked" : "all" };
  }
}
