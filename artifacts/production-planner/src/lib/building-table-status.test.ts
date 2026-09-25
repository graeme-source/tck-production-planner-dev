import { describe, it, expect } from "vitest";
import { blockedBy, buildingTableStatus, shouldRecordOpen, type BuildingTableFacts } from "./building-table-status";

const t = (iso: string) => new Date(iso).getTime();
const TOMMY = { userId: 11, userName: "Tommy Smith" };
const KERRI = { userId: 22, userName: "Kerri-Leigh Jones" };
const GRANT = { userId: 33, userName: "Grant Brown" };
const NOZOMI = { userId: 44, userName: "Nozomi Sato" };

// Fri 25 Sep 2026 (BST, London = UTC+1).
const tommyOpened06_03 = { ...TOMMY, openedAt: "2026-09-25T05:03:53Z" };

describe("buildingTableStatus", () => {
  // Regression: Table 1 read "Started by Tommy" all day although Kerri-Leigh
  // recorded every batch.
  it("prefers the latest batch recorder over whoever opened the screen", () => {
    const facts: BuildingTableFacts = {
      claim: tommyOpened06_03,
      lastBatch: { ...KERRI, completedAt: "2026-09-25T09:19:00Z" },
    };
    const s = buildingTableStatus(facts, t("2026-09-25T09:25:00Z"), NOZOMI.userId);
    expect(s.label).toBe("Kerri-Leigh — last batch 10:19");
    expect(s.holder).toEqual({ ...KERRI, via: "batch" });
    expect(s.isMe).toBe(false);
  });

  it("Table 2 on the day: Nozomi's batches replace the Grant session", () => {
    const facts: BuildingTableFacts = {
      claim: { ...GRANT, openedAt: "2026-09-25T06:29:00Z" },
      lastBatch: { ...NOZOMI, completedAt: "2026-09-25T09:40:00Z" },
    };
    expect(buildingTableStatus(facts, t("2026-09-25T09:45:00Z"), 0).label).toBe("Nozomi — last batch 10:40");
  });

  it("with no batch yet, an open reads 'Opened by X at HH:MM', never 'the builder'", () => {
    const s = buildingTableStatus({ claim: tommyOpened06_03, lastBatch: null }, t("2026-09-25T05:10:00Z"), KERRI.userId);
    expect(s.label).toBe("Opened by Tommy at 06:03");
    expect(s.holder).toEqual({ ...TOMMY, via: "opened" }); // fresh for 30 min
  });

  it("an open goes stale after 30 minutes: the label stays, but nobody holds the table", () => {
    const s = buildingTableStatus({ claim: tommyOpened06_03, lastBatch: null }, t("2026-09-25T06:29:00Z"), KERRI.userId);
    expect(s.label).toBe("Opened by Tommy at 06:03");
    expect(s.holder).toBeNull();
  });

  it("no batch in the last 30 minutes: the most recent fact is what's said", () => {
    // Kerri-Leigh's last batch 10:19, nobody has opened it since → still her.
    const olderClaim = buildingTableStatus(
      { claim: tommyOpened06_03, lastBatch: { ...KERRI, completedAt: "2026-09-25T09:19:00Z" } },
      t("2026-09-25T10:30:00Z"),
      0,
    );
    expect(olderClaim.label).toBe("Kerri-Leigh — last batch 10:19");
    expect(olderClaim.holder).toBeNull();

    // Someone opened it after her last batch → "Opened by".
    const newerClaim = buildingTableStatus(
      { claim: { ...NOZOMI, openedAt: "2026-09-25T10:05:00Z" }, lastBatch: { ...KERRI, completedAt: "2026-09-25T09:19:00Z" } },
      t("2026-09-25T10:10:00Z"),
      0,
    );
    expect(newerClaim.label).toBe("Opened by Nozomi at 11:05");
    expect(newerClaim.holder).toEqual({ ...NOZOMI, via: "opened" });
  });

  it("a fresh batch beats a newer open (someone just looking doesn't take over)", () => {
    const s = buildingTableStatus(
      { claim: { ...TOMMY, openedAt: "2026-09-25T09:22:00Z" }, lastBatch: { ...KERRI, completedAt: "2026-09-25T09:19:00Z" } },
      t("2026-09-25T09:23:00Z"),
      0,
    );
    expect(s.label).toBe("Kerri-Leigh — last batch 10:19");
    expect(s.holder?.userId).toBe(KERRI.userId);
  });

  it("speaks to the viewer about themselves", () => {
    const facts: BuildingTableFacts = { claim: null, lastBatch: { ...KERRI, completedAt: "2026-09-25T09:19:00Z" } };
    const s = buildingTableStatus(facts, t("2026-09-25T09:20:00Z"), KERRI.userId);
    expect(s.label).toBe("You — last batch 10:19");
    expect(s.isMe).toBe(true);
    const opened = buildingTableStatus({ claim: tommyOpened06_03, lastBatch: null }, t("2026-09-25T05:04:00Z"), TOMMY.userId);
    expect(opened.label).toBe("You opened this at 06:03");
  });

  it("the building lock follows the holder: a stale morning open blocks nobody", () => {
    const stale = buildingTableStatus({ claim: tommyOpened06_03, lastBatch: null }, t("2026-09-25T06:30:00Z"), KERRI.userId);
    expect(blockedBy(stale, KERRI.userId)).toBeNull();
    const working = buildingTableStatus(
      { claim: tommyOpened06_03, lastBatch: { ...KERRI, completedAt: "2026-09-25T09:19:00Z" } },
      t("2026-09-25T09:25:00Z"),
      NOZOMI.userId,
    );
    expect(blockedBy(working, NOZOMI.userId)).toBe("Kerri-Leigh Jones");
    expect(blockedBy(working, KERRI.userId)).toBeNull();
  });

  it("nothing known → free", () => {
    expect(buildingTableStatus({ claim: null, lastBatch: null }, Date.now(), 1)).toEqual({ holder: null, label: null, isMe: false });
    expect(buildingTableStatus(undefined, Date.now(), 1)).toEqual({ holder: null, label: null, isMe: false });
  });
});

describe("shouldRecordOpen", () => {
  const free = { holder: null, label: null, isMe: false };
  it("records an open on a free table", () => {
    expect(shouldRecordOpen({ facts: { claim: null, lastBatch: null }, status: free }, free, KERRI.userId)).toBe(true);
  });
  it("takes over a stale open by someone else", () => {
    const facts = { claim: tommyOpened06_03, lastBatch: null };
    const status = buildingTableStatus(facts, t("2026-09-25T06:30:00Z"), KERRI.userId);
    expect(shouldRecordOpen({ facts, status }, free, KERRI.userId)).toBe(true);
  });
  it("never while someone is building there", () => {
    const facts = { claim: null, lastBatch: { ...KERRI, completedAt: "2026-09-25T09:19:00Z" } };
    const status = buildingTableStatus(facts, t("2026-09-25T09:20:00Z"), NOZOMI.userId);
    expect(shouldRecordOpen({ facts, status }, free, NOZOMI.userId)).toBe(false);
  });
  it("not again if the standing open is already mine", () => {
    const facts = { claim: tommyOpened06_03, lastBatch: null };
    const status = buildingTableStatus(facts, t("2026-09-25T07:30:00Z"), TOMMY.userId);
    expect(shouldRecordOpen({ facts, status }, free, TOMMY.userId)).toBe(false);
  });
  it("not while I'm building on the other table", () => {
    const other = buildingTableStatus({ claim: null, lastBatch: { ...KERRI, completedAt: "2026-09-25T09:19:00Z" } }, t("2026-09-25T09:20:00Z"), KERRI.userId);
    expect(shouldRecordOpen({ facts: { claim: null, lastBatch: null }, status: free }, other, KERRI.userId)).toBe(false);
  });
});
