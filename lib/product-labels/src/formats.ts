/**
 * Label formats (pure, tested). Objective D.
 *
 * A template's SIZE is part of the template, fixed when it is made from a
 * preset and never edited afterwards (Graeme, 2026-10-27: "Calzone labels
 * are always 140 × 94, and the mayo labels are always the 102 by 25. I
 * don't want to have different versions."). A recipe never picks a size: it
 * picks a template, and the template's format decides everything below.
 *
 *   back-140x94   the back label: title, cooking steps, storage, dates,
 *                 ingredients, allergens, address and an EAN-13 barcode
 *                 (layout.ts / content.ts).
 *   small-102x25  the small pot label: name, USE BY, BATCH and the
 *                 product's barcode — EAN-13 or Code 128 (small-label.ts).
 *
 * Every place that behaves differently by format asks `labelFormat()` for
 * the spec rather than testing the key, so a new format is one entry here.
 * Templates stored before formats existed have none and are back labels.
 */
import { FRONT_LABEL_PAGE } from "./front-label";

export type LabelFormat = "back-140x94" | "small-102x25";

export interface LabelFormatSpec {
  key: LabelFormat;
  /** Plain name for people, e.g. "Small label". */
  name: string;
  widthMm: number;
  heightMm: number;
  /** Fixed printer resolution; null = the template's own (back labels). */
  dpi: number | null;
  /** "102 × 25 mm" — what the pages show as the read-only size. */
  sizeText: string;
  /** The full back label: the ingredient deck, cooking steps, storage,
   *  may-contain and bones checks apply, and the typography / layout
   *  settings are edited on the design page. False = the small label: none
   *  of those print, so none of them can block publishing. */
  backLabel: boolean;
  /** Barcode rule: EAN-13 only, or anything Code 128 can draw. */
  barcode: "ean13" | "ean13-or-code128";
}

export const DEFAULT_LABEL_FORMAT: LabelFormat = "back-140x94";

export const LABEL_FORMATS: Record<LabelFormat, LabelFormatSpec> = {
  "back-140x94": {
    key: "back-140x94", name: "Back label", widthMm: 140, heightMm: 94, dpi: null,
    sizeText: "140 × 94 mm", backLabel: true, barcode: "ean13",
  },
  "small-102x25": {
    key: "small-102x25", name: "Small label", widthMm: FRONT_LABEL_PAGE.widthMm, heightMm: FRONT_LABEL_PAGE.heightMm, dpi: FRONT_LABEL_PAGE.dpi,
    sizeText: `${FRONT_LABEL_PAGE.widthMm} × ${FRONT_LABEL_PAGE.heightMm} mm`, backLabel: false, barcode: "ean13-or-code128",
  },
};

/** A stored value → a known format (anything else = the back label). */
export function normaliseFormat(v: unknown): LabelFormat {
  return typeof v === "string" && v in LABEL_FORMATS ? (v as LabelFormat) : DEFAULT_LABEL_FORMAT;
}

/** The format spec of a template (or of a snapshot's stored template). */
export function labelFormat(template: { format?: unknown } | null | undefined): LabelFormatSpec {
  return LABEL_FORMATS[normaliseFormat(template?.format)];
}
