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
export type { Face, FaceMetrics, FieldLayout, FitProblem, LabelLayout, PlacedRun, Rect, BarcodeLayout } from "./layout";
