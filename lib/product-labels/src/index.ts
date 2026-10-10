/**
 * Product labels — the pure model shared by the API server and the browser:
 * template + typography settings, per-recipe label settings, snapshots and
 * change detection, use-by/batch dates, EAN-13 and the legal x-height rule.
 * Measuring, layout with real fonts and rendering are in "./render" (server).
 */
export * from "./dates";
export * from "./ean13";
export * from "./legal";
export * from "./template";
export * from "./text";
export * from "./snapshot";
export * from "./content";
export * from "./cooking";
export * from "./status";
export * from "./print-record";
export { enforceLegalMinimums, legalMinimums, layoutLabel } from "./layout";
export type { TextMeasurer, Face, FaceMetrics, FieldLayout, FitProblem, LabelLayout, PlacedRun, Rect, BarcodeLayout } from "./layout";
