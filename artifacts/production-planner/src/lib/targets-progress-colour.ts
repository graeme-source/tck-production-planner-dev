/**
 * One colour for the Month to Date card (Graeme, 25 Nov 2026: the bar and
 * "Right on where you should be today" were red while the header was green).
 * The bar and the status line now take the SAME shade as the card's header —
 * where the projected month-end sits between the minimum and the stretch
 * (gradeKpi, lib/numbers-benchmarks.ts) — so the card never says two things.
 * The status words use the shade only when it's dark enough to read on white;
 * otherwise they're plain dark text. Pure and tested. Objective I.
 */
import { gradeKpi, kpiSpec } from "./numbers-benchmarks";

export interface ProgressColour {
  /** The bar's fill colour, as a CSS colour. */
  barHex: string;
  /** The status line's colour, or null for the normal text colour. */
  textHex: string | null;
}

/** No stretch set (no header shade): green on pace for the minimum, red behind. */
const FALLBACK = { on: "#7cb342", behind: "#dc2626" };

export function targetsProgressColour(projected: number, minimum: number, stretch: number | null): ProgressColour {
  const grade = gradeKpi(projected, { minimum, stretch }, kpiSpec("monthlySales"), 1);
  if (grade) return { barHex: grade.shade.hex, textHex: grade.shade.darkBackground ? grade.shade.hex : null };
  const hex = projected >= minimum ? FALLBACK.on : FALLBACK.behind;
  return { barHex: hex, textHex: hex };
}
