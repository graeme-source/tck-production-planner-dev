import { describe, it, expect } from "vitest";
import { displayedNovaClass, previewableDeclaration, previewLabel, type UpfPreviewResult } from "./upf-preview";

const r = (novaClass: number | null, markers: string[] = []): UpfPreviewResult => ({ novaClass, markers, reasoning: "", confidence: "high", method: "ai" });

describe("previewLabel", () => {
  it("names the markers for NOVA 4", () => {
    expect(previewLabel(r(4, ["flavourings", "emulsifier"]))).toBe("Auto: NOVA 4 — flavourings, emulsifier");
  });
  it("says no UPF markers for NOVA 1-3", () => {
    expect(previewLabel(r(2))).toBe("Auto: NOVA 2 — no UPF markers");
  });
  it("is honest when it couldn't decide", () => {
    expect(previewLabel(null)).toMatch(/couldn't tell/);
    expect(previewLabel(r(null))).toMatch(/couldn't tell/);
  });
});

describe("previewableDeclaration", () => {
  it("only classifies real text", () => {
    expect(previewableDeclaration("")).toBeNull();
    expect(previewableDeclaration("  a ")).toBeNull();
    expect(previewableDeclaration("Water,  Sugar ")).toBe("Water, Sugar");
  });
});

describe("displayedNovaClass — which chip is lit", () => {
  it("shows the live preview when nobody has picked a class", () => {
    expect(displayedNovaClass({ touched: false, formValue: null, storedSource: null, preview: r(4) })).toEqual({ value: 4, auto: true });
    expect(displayedNovaClass({ touched: false, formValue: 3, storedSource: "ai", preview: r(4) })).toEqual({ value: 4, auto: true });
  });
  it("a chip the person tapped stays a manual override", () => {
    expect(displayedNovaClass({ touched: true, formValue: 2, storedSource: "ai", preview: r(4) })).toEqual({ value: 2, auto: false });
  });
  it("a stored manual class is never replaced by the preview", () => {
    expect(displayedNovaClass({ touched: false, formValue: 3, storedSource: "manual", preview: r(4) })).toEqual({ value: 3, auto: false });
  });
  it("no preview → whatever is stored", () => {
    expect(displayedNovaClass({ touched: false, formValue: 1, storedSource: "ai", preview: null })).toEqual({ value: 1, auto: false });
  });
});
