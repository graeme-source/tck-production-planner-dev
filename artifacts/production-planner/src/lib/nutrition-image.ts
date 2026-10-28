/**
 * The website nutrition image (custom.nutritional_info) — LAYOUT, pure and
 * tested. Objective A: a test box's Shopify products get the recipe's
 * nutrition table without Graeme making the picture by hand.
 *
 * Drawn to look like the images already on the website (Carnizone, Garlic &
 * Cheese, read 28 Oct 2026): black on white inside a thin black border,
 * "Typical values | per 100g | per 355g serving" in bold (the serving
 * heading on two lines), Energy kJ then kcal on its own line, "of which"
 * rows indented, values right-aligned. Only the mandatory UK rows — fibre is
 * voluntary and the website's images leave it out.
 *
 * The rows arrive already worded and rounded by the server (nutritionRows →
 * @workspace/product-labels formatNutrient), so the image says exactly what
 * the preview table says. Drawing to a canvas is nutrition-image-canvas.ts.
 */

export interface NutritionImageRow { key: string; label: string; indent: boolean; optional: boolean; per100g: string; perPortion: string | null }

export interface ImageText { text: string; x: number; y: number; align: "left" | "right"; bold: boolean; size: number }
export interface NutritionImageLayout {
  width: number;
  height: number;
  font: string;
  border: { x: number; y: number; w: number; h: number; lineWidth: number };
  texts: ImageText[];
}

export const NUTRITION_IMAGE_WIDTH = 1000;
const FONT = "Roboto, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const SIZE = 36;
const INSET = 12; // border inset from the edge
const LEFT = 40; // label x
const INDENT = 30; // "of which" rows
const RIGHT = 962; // last column's right edge
const MID_RIGHT = 672; // per-100g right edge when there is a serving column
const FIRST_BASELINE = 60;
const HEADING_LINE = 49;
const ROW = 61;
const BOTTOM = 36; // last baseline → border

/** The rows the image shows: every mandatory row, none unknown. Null when
 *  the table can't be drawn (no rows, or a value is missing). */
export function imageRows(rows: NutritionImageRow[]): NutritionImageRow[] | null {
  const shown = rows.filter(r => !r.optional);
  if (!shown.length) return null;
  const hasPortion = shown[0].perPortion != null;
  const missing = (v: string | null) => v == null || v.trim() === "" || v === "—";
  if (shown.some(r => missing(r.per100g) || (hasPortion && missing(r.perPortion)))) return null;
  return shown;
}

/** Where everything goes on a 1000 px wide image. Null when imageRows is. */
export function nutritionImageLayout(rows: NutritionImageRow[], portionWeightG: number | null): NutritionImageLayout | null {
  const shown = imageRows(rows);
  if (!shown) return null;
  const portion = shown[0].perPortion != null && Number(portionWeightG) > 0 ? Math.round(Number(portionWeightG)) : null;
  const per100Right = portion ? MID_RIGHT : RIGHT;
  const texts: ImageText[] = [];
  const t = (text: string, x: number, y: number, align: "left" | "right", bold = false) => texts.push({ text, x, y, align, bold, size: SIZE });

  let y = FIRST_BASELINE;
  t("Typical values", LEFT, y, "left", true);
  t("per 100g", per100Right, y, "right", true);
  if (portion) {
    t(`per ${portion}g`, RIGHT, y, "right", true);
    y += HEADING_LINE;
    t("serving", RIGHT, y, "right", true);
  }
  for (const r of shown) {
    y += ROW;
    if (r.label) t(r.label, LEFT + (r.indent ? INDENT : 0), y, "left");
    t(r.per100g, per100Right, y, "right");
    if (portion) t(r.perPortion ?? "", RIGHT, y, "right");
  }
  const height = y + BOTTOM + INSET;
  return {
    width: NUTRITION_IMAGE_WIDTH,
    height,
    font: FONT,
    border: { x: INSET, y: INSET, w: NUTRITION_IMAGE_WIDTH - INSET * 2, h: height - INSET * 2, lineWidth: 2 },
    texts,
  };
}

/** "data:image/png;base64,AAAA" → "AAAA" (what the create request carries). */
export function base64FromDataUrl(dataUrl: string): string | null {
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  return m ? m[1] : null;
}
