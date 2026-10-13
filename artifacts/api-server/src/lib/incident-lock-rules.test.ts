import { describe, it, expect } from "vitest";
import {
  isIncidentLocked,
  incidentEditRefusal,
  incidentSignRefusal,
  incidentUnlockRefusal,
  snapshotIncident,
  diffIncidentSnapshots,
  buildIncidentHistory,
  LOCKED_EDIT_ERROR,
} from "./incident-lock-rules";

const SIGNED = new Date("2026-10-13T09:00:00Z");
const UNLOCKED = new Date("2026-10-13T10:00:00Z");

describe("lock rule", () => {
  it("an unsigned report can be edited and signed", () => {
    const r = { signedAt: null, unlockedAt: null };
    expect(isIncidentLocked(r)).toBe(false);
    expect(incidentEditRefusal(r)).toBeNull();
    expect(incidentSignRefusal(r)).toBeNull();
  });

  it("a signed report refuses edits with a 409 and a clear message", () => {
    const r = { signedAt: SIGNED, unlockedAt: null };
    expect(isIncidentLocked(r)).toBe(true);
    expect(incidentEditRefusal(r)).toEqual({ status: 409, error: LOCKED_EDIT_ERROR });
    expect(incidentSignRefusal(r)?.status).toBe(409);
  });

  it("after an unlock the report can be edited and signed again", () => {
    const r = { signedAt: SIGNED, unlockedAt: UNLOCKED };
    expect(isIncidentLocked(r)).toBe(false);
    expect(incidentEditRefusal(r)).toBeNull();
    expect(incidentSignRefusal(r)).toBeNull();
  });

  it("signing again (unlock cleared) locks it again", () => {
    const r = { signedAt: new Date("2026-10-13T11:00:00Z"), unlockedAt: null };
    expect(incidentEditRefusal(r)?.status).toBe(409);
  });

  it("works on ISO strings from JSON as well as Dates", () => {
    expect(isIncidentLocked({ signedAt: SIGNED.toISOString(), unlockedAt: null })).toBe(true);
    expect(isIncidentLocked({ signedAt: SIGNED.toISOString(), unlockedAt: UNLOCKED.toISOString() })).toBe(false);
  });
});

describe("unlock rule", () => {
  it("needs a signed, locked report and a reason", () => {
    expect(incidentUnlockRefusal({ signedAt: null, unlockedAt: null }, "typo")?.status).toBe(409);
    expect(incidentUnlockRefusal({ signedAt: SIGNED, unlockedAt: UNLOCKED }, "typo")?.status).toBe(409);
    expect(incidentUnlockRefusal({ signedAt: SIGNED, unlockedAt: null }, "  ")?.status).toBe(400);
    expect(incidentUnlockRefusal({ signedAt: SIGNED, unlockedAt: null }, undefined)?.status).toBe(400);
    expect(incidentUnlockRefusal({ signedAt: SIGNED, unlockedAt: null }, "Add the supplier's reply")).toBeNull();
  });
});

describe("snapshot + diff", () => {
  const v1 = {
    kind: "incident",
    occurredAt: new Date("2026-10-12T14:30:00Z"),
    title: "Blue plastic in dough",
    location: "Mixing",
    description: "",
    peopleInvolved: null,
    injuries: null,
    foodSafetyImpact: "Batch binned",
    immediateActions: null,
    correctiveActions: null,
    productionStopped: true,
    foodDiscarded: true,
    riskAssessmentDone: false,
    areaCleaned: false,
  };

  it("normalises: ISO timestamps, empty text → null, booleans", () => {
    const s = snapshotIncident(v1);
    expect(s.occurredAt).toBe("2026-10-12T14:30:00.000Z");
    expect(s.description).toBeNull();
    expect(s.productionStopped).toBe(true);
  });

  it("finds nothing between a row and its own snapshot (incl. SQL-style timestamp strings)", () => {
    const stored = { ...snapshotIncident(v1), occurredAt: "2026-10-12T14:30:00.000Z" };
    expect(diffIncidentSnapshots(v1, stored)).toEqual([]);
  });

  it("lists changed fields in form order with before and after", () => {
    const v2 = { ...v1, correctiveActions: "Supplier changed scraper", riskAssessmentDone: true, location: "Mixing room" };
    const d = diffIncidentSnapshots(v1, v2);
    expect(d.map(c => c.key)).toEqual(["location", "correctiveActions", "riskAssessmentDone"]);
    expect(d[0]).toMatchObject({ label: "Where in the factory", before: "Mixing", after: "Mixing room" });
    expect(d[2]).toMatchObject({ type: "bool", before: false, after: true });
  });
});

describe("history", () => {
  const s1 = snapshotIncident({ kind: "accident", occurredAt: "2026-10-12T08:00:00Z", title: "Cut finger", injuries: "Plaster" });
  const s2 = { ...s1, injuries: "Plaster; went to A&E, two stitches" };
  it("signed v1 → unlocked → signed v2 with the differences", () => {
    const h = buildIncidentHistory([
      { id: 3, event: "signed", version: 2, snapshot: s2, actorName: "Lorna", reason: null, createdAt: "2026-10-13T12:00:00Z" },
      { id: 1, event: "signed", version: 1, snapshot: s1, actorName: "Graeme", reason: null, createdAt: "2026-10-12T09:00:00Z" },
      { id: 2, event: "unlocked", version: 1, snapshot: s1, actorName: "Lorna", reason: "Hospital visit", createdAt: "2026-10-13T11:00:00Z" },
    ]);
    expect(h.map(e => `${e.event} v${e.version}`)).toEqual(["signed v1", "unlocked v1", "signed v2"]);
    expect(h[0].changes).toBeNull();
    expect(h[1]).toMatchObject({ actorName: "Lorna", reason: "Hospital visit", changes: null });
    expect(h[2].changes).toEqual([
      { key: "injuries", label: "Injuries & first aid", type: "text", before: "Plaster", after: "Plaster; went to A&E, two stitches" },
    ]);
  });
  it("re-signed with no changes shows an empty change list", () => {
    const h = buildIncidentHistory([
      { id: 1, event: "signed", version: 1, snapshot: s1, actorName: "A", reason: null, createdAt: "2026-10-12T09:00:00Z" },
      { id: 2, event: "signed", version: 2, snapshot: s1, actorName: "A", reason: null, createdAt: "2026-10-12T10:00:00Z" },
    ]);
    expect(h[1].changes).toEqual([]);
  });
});
