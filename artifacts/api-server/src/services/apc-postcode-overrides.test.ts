import { describe, it, expect } from "vitest";
import {
  TEMPORARY_RESTRICTION_DAYS, isOverrideActive, overrideExpiresAt, activeOverrides, restrictionsFor,
  mergeOverrides, callPromptText, refusalAdvice, rescheduleDateWarnings, shortLondonDate,
  type PostcodeOverride, type RefusalFacts,
} from "./apc-postcode-overrides";

const NOW = new Date("2026-10-02T12:00:00Z");
function o(p: Partial<PostcodeOverride>): PostcodeOverride {
  return {
    id: 1, outward: "KA3", service: "saturday", kind: "temporary", note: null, depot: "274",
    recordedByName: "Grant", recordedAt: "2026-10-02T09:00:00Z", clearedAt: null, ...p,
  };
}
const APC = { name: "APC Customer Service (Milton Keynes Depot)", phone: "01908 586999" };
const KA3: RefusalFacts = {
  matchedOn: "KA3", depot: "274",
  tableNextDay: true, tableWeekdayCutoff: "10:30", tableSaturdayDelivery: true, tableSaturdayCutoff: "10:30",
  restrictions: { saturday: null, weekday: null },
};

describe("expiry", () => {
  it("temporary restrictions lapse after the named window; permanent ones never do", () => {
    expect(TEMPORARY_RESTRICTION_DAYS).toBe(14);
    const t = o({ recordedAt: "2026-10-02T09:00:00Z" });
    expect(overrideExpiresAt(t)?.toISOString()).toBe("2026-10-16T09:00:00.000Z");
    expect(isOverrideActive(t, new Date("2026-10-16T08:59:59Z"))).toBe(true);
    expect(isOverrideActive(t, new Date("2026-10-16T09:00:00Z"))).toBe(false);
    const p = o({ kind: "permanent", recordedAt: "2025-01-01T00:00:00Z" });
    expect(overrideExpiresAt(p)).toBeNull();
    expect(isOverrideActive(p, NOW)).toBe(true);
  });
  it("a cleared override no longer counts, whatever its kind", () => {
    expect(isOverrideActive(o({ kind: "permanent", clearedAt: "2026-10-02T10:00:00Z" }), NOW)).toBe(false);
  });
  it("activeOverrides keeps live ones, newest first", () => {
    const list = activeOverrides([
      o({ id: 1, recordedAt: "2026-09-01T09:00:00Z" }), // expired
      o({ id: 2, recordedAt: "2026-10-01T09:00:00Z" }),
      o({ id: 3, recordedAt: "2026-10-02T09:00:00Z" }),
    ], NOW);
    expect(list.map(x => x.id)).toEqual([3, 2]);
  });
});

describe("restrictionsFor + mergeOverrides", () => {
  const facts = { nextDay: true, weekdayCutoff: "10:30", saturdayDelivery: true, saturday: "10:30" };
  it("permanent Saturday → no Saturday service, weekday untouched", () => {
    const r = restrictionsFor("ka3", [o({ kind: "permanent" })], NOW);
    const m = mergeOverrides(facts, r);
    expect(m.saturdayDelivery).toBe(false);
    expect(m.saturday).toBeNull();
    expect(m.nextDay).toBe(true);
    expect(r.saturday?.label).toBe("No Saturday delivery — confirmed by APC on 2 Oct, permanent");
    expect(r.saturday?.expiresOn).toBeNull();
  });
  it("permanent weekday → no next-day service", () => {
    const m = mergeOverrides(facts, restrictionsFor("KA3", [o({ service: "weekday", kind: "permanent" })], NOW));
    expect(m.nextDay).toBe(false);
    expect(m.weekdayCutoff).toBeNull();
    expect(m.saturdayDelivery).toBe(true);
  });
  it("temporary → facts unchanged, amber line carried", () => {
    const r = restrictionsFor("KA3", [o({})], NOW);
    const m = mergeOverrides(facts, r);
    expect(m.saturdayDelivery).toBe(true);
    expect(r.saturday?.label).toBe("Temporary Saturday restriction reported 2 Oct by Grant");
    expect(r.saturday?.expiresOn).toBe("16 Oct");
  });
  it("only the matching outward code is affected", () => {
    expect(restrictionsFor("KA1", [o({ kind: "permanent" })], NOW).saturday).toBeNull();
  });
  it("the latest answer wins when there are several", () => {
    const r = restrictionsFor("KA3", [
      o({ id: 1, kind: "temporary", recordedAt: "2026-10-01T09:00:00Z" }),
      o({ id: 2, kind: "permanent", recordedAt: "2026-10-02T09:00:00Z" }),
    ], NOW);
    expect(r.saturday?.id).toBe(2);
  });
  it("an expired temporary restriction is ignored", () => {
    expect(restrictionsFor("KA3", [o({ recordedAt: "2026-09-01T09:00:00Z" })], NOW).saturday).toBeNull();
  });
});

describe("call prompt", () => {
  it("names the contact and number from Contacts", () => {
    expect(callPromptText(APC, "saturday", "KA3", "274")).toBe(
      "Call APC Customer Service (Milton Keynes Depot) on 01908 586999 and ask whether the Saturday restriction to KA3 (depot 274) is temporary or permanent.",
    );
  });
  it("weekday wording", () => {
    expect(callPromptText(APC, "weekday", "KA3", "274")).toMatch(/next-day weekday restriction to KA3/);
  });
  it("falls back to Contacts when there's no contact or no number — never invents one", () => {
    const t = "Find APC in Contacts and call them to ask whether the Saturday restriction to KA3 (depot 274) is temporary or permanent.";
    expect(callPromptText(null, "saturday", "KA3", "274")).toBe(t);
    expect(callPromptText({ name: "APC", phone: "  " }, "saturday", "KA3", "274")).toBe(t);
  });
});

describe("refusalAdvice", () => {
  const sat = { saturdayDelivery: true, refusedNoService: true };
  it("nothing on record → call the depot", () => {
    const a = refusalAdvice(KA3, sat, APC)!;
    expect(a.kind).toBe("call_depot");
    expect(a.call?.phone).toBe("01908 586999");
  });
  it("permanent on record → reschedule, APC confirmed", () => {
    const a = refusalAdvice({ ...KA3, restrictions: restrictionsFor("KA3", [o({ kind: "permanent" })], NOW) }, sat, APC)!;
    expect(a).toMatchObject({ kind: "reschedule_confirmed", text: "Reschedule — APC confirmed no Saturday service here." });
    expect(a.call).toBeUndefined();
  });
  it("temporary on record → reschedule this one", () => {
    const a = refusalAdvice({ ...KA3, restrictions: restrictionsFor("KA3", [o({})], NOW) }, sat, APC)!;
    expect(a).toMatchObject({ kind: "reschedule_temporary", text: "Reschedule this one." });
  });
  it("a Saturday restriction doesn't change weekday advice", () => {
    const a = refusalAdvice({ ...KA3, restrictions: restrictionsFor("KA3", [o({ kind: "permanent" })], NOW) }, { saturdayDelivery: false, refusedNoService: true }, APC)!;
    expect(a.kind).toBe("call_depot");
    expect(a.service).toBe("weekday");
  });
  it("no advice when the table doesn't list the service, or it wasn't a coverage refusal", () => {
    expect(refusalAdvice({ ...KA3, tableSaturdayDelivery: false }, sat, APC)).toBeNull();
    expect(refusalAdvice(KA3, { saturdayDelivery: true, refusedNoService: false }, APC)).toBeNull();
  });
});

describe("Reschedule pop-up warnings", () => {
  const SAT = "2026-10-10";
  const MON = "2026-10-12";
  const facts = { matchedOn: "KA3", saturdayDelivery: true, nextDay: true, transitDays: null };
  it("permanent Saturday override → Saturday warning naming APC's confirmation", () => {
    const r = restrictionsFor("KA3", [o({ kind: "permanent" })], NOW);
    const w = rescheduleDateWarnings({ ...facts, saturdayDelivery: false, restrictions: r }, SAT);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/APC confirmed on 2 Oct there is NO Saturday delivery to KA3/);
  });
  it("table says no Saturday → the sheet warning, as before", () => {
    const w = rescheduleDateWarnings({ ...facts, saturdayDelivery: false, restrictions: { saturday: null, weekday: null } }, SAT);
    expect(w[0]).toMatch(/postcode sheet lists NO Saturday delivery for KA3/);
  });
  it("temporary Saturday restriction → softer Saturday warning", () => {
    const w = rescheduleDateWarnings({ ...facts, restrictions: restrictionsFor("KA3", [o({})], NOW) }, SAT);
    expect(w[0]).toMatch(/temporary Saturday restriction to KA3 was reported on 2 Oct by Grant/);
  });
  it("a weekday date isn't warned about a Saturday restriction", () => {
    expect(rescheduleDateWarnings({ ...facts, restrictions: restrictionsFor("KA3", [o({ kind: "permanent" })], NOW) }, MON)).toEqual([]);
  });
  it("transit warning still shows", () => {
    expect(rescheduleDateWarnings({ ...facts, nextDay: false, transitDays: 2, restrictions: { saturday: null, weekday: null } }, MON)[0]).toMatch(/2 days in transit/);
  });
});

describe("shortLondonDate", () => {
  it("uses the London calendar day (late UTC evening in BST is the next day)", () => {
    expect(shortLondonDate("2026-10-02T23:30:00Z")).toBe("3 Oct");
  });
});
