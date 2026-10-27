import { describe, expect, it } from "vitest";
import {
  areaKeysForStation, changesForStation, groupForMeeting, guessAreas, mentions, newDotLabel,
  parseTutorial, stepAfter, tourSelector, unseenCount, unseenFirst, withinDays,
  type ChangeArea,
} from "./index";

const area = (key: string, kind: ChangeArea["kind"], sortOrder: number, extra: Partial<ChangeArea> = {}): ChangeArea => ({
  key, label: key, kind, sortOrder, stationTypes: [], appliesToAllStations: false, pathHints: [], wordHints: [], ...extra,
});

// A cut-down copy of what migration 0300 seeds.
const AREAS: ChangeArea[] = [
  area("all_stations", "station", 5, { label: "Every station", appliesToAllStations: true, pathHints: ["pages/station/shared/station-layout"], wordHints: ["every station"] }),
  area("prep", "station", 40, { stationTypes: ["prep", "main_prep", "prep_bases", "prep_meat"], pathHints: ["prep-section-tabs"], wordHints: ["prep screens"] }),
  area("prep_bases", "station", 42, { stationTypes: ["prep_bases"], pathHints: ["prep-bases-station", "sub-recipe-pot-labels"], wordHints: ["bases & sauces", "garlic mayo"] }),
  area("building", "station", 60, { stationTypes: ["building_1", "building_2"], pathHints: ["building-station"], wordHints: ["building"] }),
  area("wrapping", "station", 80, { stationTypes: ["wrapping"], pathHints: ["wrapping-station"], wordHints: ["wrapping", "back labels"] }),
  area("packing", "station", 90, { stationTypes: ["packing"], pathHints: ["fulfilment", "five-pack-labels"], wordHints: ["packing", "5-pack"] }),
  area("planning", "planning", 100, { pathHints: ["pages/orders"], wordHints: ["create plan", "orders page"] }),
  area("office", "office", 200, { pathHints: ["finance", "marketing"], wordHints: ["cash flow", "klaviyo"] }),
];

const NOW = new Date("2026-10-27T09:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

describe("guessAreas — tag a change from the files it touched and its words", () => {
  it("maps station files to their station", () => {
    expect(guessAreas({ paths: ["artifacts/production-planner/src/pages/station/stations/wrapping-station.tsx"] }, AREAS)).toEqual(["wrapping"]);
  });
  it("tags every area a change touched, in display order", () => {
    expect(guessAreas({ paths: ["src/components/five-pack-labels.tsx", "src/pages/station/stations/building-station.tsx"] }, AREAS))
      .toEqual(["building", "packing"]);
  });
  it("reads the words of the entry too", () => {
    expect(guessAreas({ text: "Garlic mayo pot labels print from the iPad" }, AREAS)).toEqual(["prep_bases"]);
    expect(guessAreas({ text: "Cash flow page shows QBO bills" }, AREAS)).toEqual(["office"]);
  });
  it("treats touched-but-unrecognised files as behind-the-scenes (office)", () => {
    expect(guessAreas({ paths: ["artifacts/api-server/src/lib/sql-migrations.ts"] }, AREAS)).toEqual(["office"]);
  });
  it("returns nothing for nothing", () => {
    expect(guessAreas({ text: "" }, AREAS)).toEqual([]);
    expect(guessAreas({}, AREAS)).toEqual([]);
  });
  it("matches whole words only", () => {
    expect(mentions("Rewrapping the box", "wrapping")).toBe(false);
    expect(mentions("New on Wrapping: labels", "wrapping")).toBe(true);
    expect(mentions("Bases & Sauces done screen", "bases & sauces")).toBe(true);
  });
});

describe("withinDays", () => {
  it("keeps the last 7 days, newest first, and drops bad dates", () => {
    const out = withinDays([
      { id: 1, createdAt: daysAgo(8) },
      { id: 2, createdAt: daysAgo(1) },
      { id: 3, createdAt: daysAgo(6.9) },
      { id: 4, createdAt: "not a date" },
    ], NOW);
    expect(out.map(e => e.id)).toEqual([2, 3]);
  });
});

describe("groupForMeeting — station work only, one headline per station", () => {
  const entries = [
    { id: 1, areas: ["wrapping"], createdAt: daysAgo(1) },
    { id: 2, areas: ["office"], createdAt: daysAgo(1) },
    { id: 3, areas: ["packing", "planning"], createdAt: daysAgo(2) },
    { id: 4, areas: [], createdAt: daysAgo(2) },
    { id: 5, areas: ["wrapping"], createdAt: daysAgo(3) },
    { id: 6, areas: ["planning"], createdAt: daysAgo(3) },
  ];
  const groups = groupForMeeting(entries, AREAS);
  it("filters out office and untagged entries", () => {
    const ids = groups.flatMap(g => g.entries.map(e => e.id));
    expect(ids).not.toContain(2);
    expect(ids).not.toContain(4);
  });
  it("groups in station order with planning last", () => {
    expect(groups.map(g => g.area.key)).toEqual(["wrapping", "packing", "planning"]);
    expect(groups[0].entries.map(e => e.id)).toEqual([1, 5]);
  });
  it("lists a multi-area change once, under its first area, naming the others", () => {
    expect(groups[1].entries.map(e => e.id)).toEqual([3]);
    expect(groups[1].entries[0].alsoIn.map(a => a.key)).toEqual(["planning"]);
    expect(groups[2].entries.map(e => e.id)).toEqual([6]);
  });
  it("is empty when nothing is station work", () => {
    expect(groupForMeeting([{ areas: ["office"] }], AREAS)).toEqual([]);
  });
});

describe("changesForStation", () => {
  const entries = [
    { id: 1, areas: ["wrapping"], createdAt: daysAgo(1) },
    { id: 2, areas: ["all_stations"], createdAt: daysAgo(2) },
    { id: 3, areas: ["building"], createdAt: daysAgo(1) },
    { id: 4, areas: ["prep"], createdAt: daysAgo(1) },
    { id: 5, areas: ["prep_bases"], createdAt: daysAgo(1) },
    { id: 6, areas: ["wrapping"], createdAt: daysAgo(10) },
  ];
  it("shows the station's own and every-station changes from the last 7 days", () => {
    expect(changesForStation(entries, AREAS, "wrapping", NOW).map(e => e.id)).toEqual([1, 2]);
  });
  it("maps both building tables to Building", () => {
    expect(changesForStation(entries, AREAS, "building_2", NOW).map(e => e.id).sort()).toEqual([2, 3]);
  });
  it("gives a prep section the whole-prep changes and its own", () => {
    expect(changesForStation(entries, AREAS, "prep_bases", NOW).map(e => e.id).sort()).toEqual([2, 4, 5]);
    expect(changesForStation(entries, AREAS, "prep_meat", NOW).map(e => e.id).sort()).toEqual([2, 4]);
  });
  it("never shows office or planning areas on a station", () => {
    expect(areaKeysForStation("wrapping", AREAS).has("office")).toBe(false);
    expect(areaKeysForStation("wrapping", AREAS).has("planning")).toBe(false);
  });
});

describe("seen / unseen", () => {
  const entries = [
    { id: 1, createdAt: daysAgo(3) },
    { id: 2, createdAt: daysAgo(1) },
    { id: 3, createdAt: daysAgo(2) },
  ];
  it("counts what this person hasn't seen", () => {
    expect(unseenCount(entries, new Set([2]))).toBe(2);
    expect(unseenCount(entries, new Set([1, 2, 3]))).toBe(0);
  });
  it("puts unseen first, newest first within each", () => {
    expect(unseenFirst(entries, new Set([2])).map(e => e.id)).toEqual([3, 1, 2]);
  });
  it("labels the dot", () => {
    expect(newDotLabel(0)).toBeNull();
    expect(newDotLabel(3)).toBe("3");
    expect(newDotLabel(12)).toBe("9+");
  });
});

describe("parseTutorial — step validation", () => {
  it("accepts no tutorial", () => {
    expect(parseTutorial(null)).toEqual({ ok: true, tutorial: null });
    expect(parseTutorial({ steps: [] })).toEqual({ ok: true, tutorial: null });
  });
  it("normalises good steps", () => {
    const r = parseTutorial({ steps: [
      { target: null, title: " Intro ", body: "Why it helps" },
      { target: "wrapping-print-back-labels", title: "Tap here", body: "Prints them", hiddenNote: "Shows once a flavour has a label" },
    ] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tutorial!.steps[0]).toEqual({ target: null, title: "Intro", body: "Why it helps", hiddenNote: null });
      expect(r.tutorial!.steps[1].target).toBe("wrapping-print-back-labels");
    }
  });
  it("names each bad step", () => {
    const r = parseTutorial({ steps: [{ title: "", body: "x" }, { title: "ok", body: "", target: "Bad Target\"]" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toContain("Step 1 needs a title.");
      expect(r.errors).toContain("Step 2 needs some text.");
      expect(r.errors.some(e => e.startsWith("Step 2's target"))).toBe(true);
    }
  });
  it("caps the number of steps", () => {
    const steps = Array.from({ length: 13 }, () => ({ title: "t", body: "b" }));
    expect(parseTutorial({ steps }).ok).toBe(false);
  });
  it("refuses non-objects", () => {
    expect(parseTutorial("steps").ok).toBe(false);
    expect(parseTutorial({ steps: "nope" }).ok).toBe(false);
  });
  it("builds a safe selector, or none for a centred step", () => {
    expect(tourSelector({ target: "five-pack-labels", title: "t", body: "b" })).toBe('[data-tour="five-pack-labels"]');
    expect(tourSelector({ target: null, title: "t", body: "b" })).toBeNull();
    expect(tourSelector({ target: 'x"]', title: "t", body: "b" })).toBeNull();
  });
  it("steps Next/Back with the ends clamped", () => {
    expect(stepAfter(0, 3, "back")).toEqual({ index: 0, finished: false });
    expect(stepAfter(0, 3, "next")).toEqual({ index: 1, finished: false });
    expect(stepAfter(2, 3, "next")).toEqual({ index: 2, finished: true });
  });
});
