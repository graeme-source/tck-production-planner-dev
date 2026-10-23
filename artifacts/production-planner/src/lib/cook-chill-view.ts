/**
 * How the cook-and-chill card reads (issue #244). The rules about WHEN a
 * step is allowed live on the server (api-server lib/cooling-cycles.ts);
 * this file decides what each station shows and how times read.
 * The cook temperature is judged against the FSA table (lib/cook-standards),
 * never a fixed 75°C.
 */
import { meetsCookStandard } from "./cook-standards";

/** React Query keys shared by the Prep/Wrapping card and the sub-recipe tick. */
export const COOK_CHILL_BOARD_KEY = ["cook-chill", "board"] as const;
export const COOK_CHILL_SUB_RECIPES_KEY = ["cook-chill", "sub-recipes"] as const;

export type CookChillStage = "cooked" | "chilling" | "chilled";

export interface CookChillRecordView {
  id: number;
  subRecipeId: number | null;
  subRecipeName: string;
  cookTempC: number;
  cookHeldForSeconds: number;
  cookedByName: string;
  cookedAt: string;
  chillStartAt: string | null;
  chillStartByName: string | null;
  chillEndAt: string | null;
  chillEndByName: string | null;
  chilledVia: string | null;
  stage: CookChillStage;
}

/** Prep sees every record on the board (it starts them); Wrapping sees the
 *  ones that are in, or out of, the blast chiller — what it ticks finished. */
export function recordsForStation(records: ReadonlyArray<CookChillRecordView>, station: "prep" | "wrapping"): CookChillRecordView[] {
  const order: Record<CookChillStage, number> = { chilling: 0, cooked: 1, chilled: 2 };
  return records
    .filter(r => station === "prep" || r.stage !== "cooked")
    .slice()
    .sort((a, b) => order[a.stage] - order[b.stage] || a.cookedAt.localeCompare(b.cookedAt));
}

/** Did the cook-out meet the FSA time/temperature table? */
export function cookMet(r: Pick<CookChillRecordView, "cookTempC" | "cookHeldForSeconds">): boolean {
  return meetsCookStandard(r.cookTempC, r.cookHeldForSeconds);
}

/** "45 min" / "1 h 20 min" between two instants (never negative). */
export function minutesText(fromIso: string, to: Date | string): string {
  const end = (to instanceof Date ? to : new Date(to)).getTime();
  const mins = Math.max(0, Math.round((end - new Date(fromIso).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "14:05" in the kitchen's clock. */
export function clockText(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
}
