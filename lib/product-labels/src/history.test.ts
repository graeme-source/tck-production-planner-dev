import { describe, it, expect } from "vitest";
import { archivePdfFilename, archiveStampText, buildLabelHistory, groupPrintsByVersion, slugify, type HistoryVersionInput } from "./history";
import { buildSnapshot, DEFAULT_RECIPE_LABEL_SETTINGS } from "./snapshot";
import { DEFAULT_TEMPLATE, normaliseTemplate } from "./template";

const snap = (deck: string, barcode = "5065018206009") => buildSnapshot({
  recipe: { name: "Garlic Cheese", packSize: "2.0000", shelfLifeDays: 13 },
  deck: { deckText: deck, mayContainStatement: "May also contain traces of nuts" },
  settings: { ...DEFAULT_RECIPE_LABEL_SETTINGS, barcode },
  templateId: 1,
  template: normaliseTemplate(JSON.parse(JSON.stringify(DEFAULT_TEMPLATE))),
});

const versions: HistoryVersionInput[] = [
  { id: 10, versionNo: 1, snapshot: snap("Cheese (40%), **Wheat** Flour"), publishedAt: "2026-10-01T09:00:00Z", publishedByName: "Graeme" },
  { id: 11, versionNo: 2, snapshot: snap("Cheese (45%), **Wheat** Flour"), publishedAt: "2026-10-05T09:00:00Z", publishedByName: "Lorna" },
  { id: 12, versionNo: 3, snapshot: snap("Cheese (45%), **Wheat** Flour", "4006381333931"), publishedAt: new Date("2026-10-12T09:00:00Z"), publishedByName: null },
];

describe("buildLabelHistory", () => {
  it("lists newest first, with only the newest live", () => {
    const h = buildLabelHistory([versions[1], versions[0], versions[2]]);
    expect(h.map(e => e.versionNo)).toEqual([3, 2, 1]);
    expect(h.map(e => e.live)).toEqual([true, false, false]);
    expect(h[2].first).toBe(true);
    expect(h[0].publishedAt).toBe("2026-10-12T09:00:00.000Z");
  });

  it("diffs each version against the one before it", () => {
    const h = buildLabelHistory(versions);
    expect(h.find(e => e.versionNo === 1)!.changes).toEqual([]);
    expect(h.find(e => e.versionNo === 2)!.changes.map(c => c.key)).toEqual(["deckText"]);
    const v3 = h.find(e => e.versionNo === 3)!.changes;
    expect(v3.map(c => c.key)).toEqual(["barcode"]);
    expect(v3[0]).toMatchObject({ before: "5065018206009", after: "4006381333931" });
  });

  it("is empty when nothing was ever published", () => {
    expect(buildLabelHistory([])).toEqual([]);
  });
});

describe("groupPrintsByVersion", () => {
  it("counts production runs and labels per version, first and last print, tests separately", () => {
    const g = groupPrintsByVersion([
      { labelVersionId: 10, versionNo: 1, count: 40, kind: "production", createdAt: "2026-10-02T08:00:00Z" },
      { labelVersionId: 10, versionNo: 1, count: 60, kind: "production", createdAt: "2026-10-03T08:00:00Z" },
      { labelVersionId: 10, versionNo: 1, count: 1, kind: "test", createdAt: "2026-10-01T10:00:00Z" },
      { labelVersionId: 11, versionNo: 2, count: 5, kind: "production", createdAt: new Date("2026-10-06T08:00:00Z") },
    ], versions);
    expect(g.get(10)).toEqual({ runs: 2, labels: 100, firstPrintedAt: "2026-10-02T08:00:00.000Z", lastPrintedAt: "2026-10-03T08:00:00.000Z", testRuns: 1 });
    expect(g.get(11)?.labels).toBe(5);
    expect(g.has(12)).toBe(false);
  });

  it("falls back to the version number when the version id was cleared, and skips unpublished test prints", () => {
    const g = groupPrintsByVersion([
      { labelVersionId: null, versionNo: 2, count: 7, kind: "production", createdAt: "2026-10-06T08:00:00Z" },
      { labelVersionId: null, versionNo: null, count: 1, kind: "test", createdAt: "2026-10-06T08:00:00Z" },
    ], versions);
    expect(g.get(11)?.labels).toBe(7);
    expect([...g.keys()]).toEqual([11]);
  });

  it("feeds the history cards (no prints = zeros)", () => {
    const h = buildLabelHistory(versions, [{ labelVersionId: 12, versionNo: 3, count: 3, kind: "production", createdAt: "2026-10-12T10:00:00Z" }]);
    expect(h[0].prints.labels).toBe(3);
    expect(h[1].prints).toEqual({ runs: 0, labels: 0, firstPrintedAt: null, lastPrintedAt: null, testRuns: 0 });
  });
});

describe("archive file name and stamp", () => {
  it("builds a safe, dated file name", () => {
    expect(archivePdfFilename("Garlic Cheese", 3, "2026-10-12")).toBe("garlic-cheese-label-v3-2026-10-12.pdf");
    expect(archivePdfFilename("Mac & Cheese (Jalapeño)!", 1, "2026-01-02")).toBe("mac-cheese-jalapeno-label-v1-2026-01-02.pdf");
    expect(slugify("***")).toBe("label");
  });

  it("stamps the version and says not for printing", () => {
    expect(archiveStampText(3)).toBe("ARCHIVE v3 — NOT FOR PRINTING");
  });
});
