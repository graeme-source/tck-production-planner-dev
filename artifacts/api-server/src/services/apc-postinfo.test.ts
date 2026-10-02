import { describe, it, expect } from "vitest";
import {
  parsePostinfo, outwardCode, lookupPostcodeService, postcodeServiceFor, postinfoSize, postcodeRefusalAdvice, postcodeServiceView,
} from "./apc-postinfo";

const FIXTURE = [
  "Postcode, Earliest Achieveable Weekday Del Time, Saturday, Depot, Area",
  "MK17,10:30,10:30,21,0",
  "AB10,16:00,-,296,13",
  "AB30,2 days,-,296,13",
  "ZE2 ,5 days,-,296,8",
  "EC1A,10:30,10:30,64,0",
  "N1  ,10:30,12:00,64,0",
].join("\n");

describe("parsePostinfo", () => {
  it("keys rows on the trimmed outward code and skips the header", () => {
    const rows = parsePostinfo(FIXTURE);
    expect(rows.size).toBe(6);
    expect(rows.get("MK17")).toEqual({ outward: "MK17", weekday: "10:30", saturday: "10:30", depot: "21", area: "0" });
    expect(rows.get("ZE2")?.weekday).toBe("5 days");
  });

  it("reads '-' in the Saturday column as no Saturday service", () => {
    expect(parsePostinfo(FIXTURE).get("AB10")?.saturday).toBeNull();
  });

  it("drops junk lines rather than throwing — a bad carrier file must not take the packing screen down", () => {
    const rows = parsePostinfo("Postcode,x\n\nnot-a-postcode,10:30,-\nMK17,10:30,10:30,21,0\n,,,\n");
    expect([...rows.keys()]).toEqual(["MK17"]);
  });
});

describe("outwardCode", () => {
  it("strips the inward code off a full postcode", () => {
    expect(outwardCode("MK17 9FX")).toBe("MK17");
    expect(outwardCode("mk179fx")).toBe("MK17");
    expect(outwardCode("N1C 4AG")).toBe("N1C");
    expect(outwardCode("B1 1AA")).toBe("B1");
  });

  it("leaves an outward code alone", () => {
    expect(outwardCode("MK17")).toBe("MK17");
    expect(outwardCode("N1")).toBe("N1");
  });
});

describe("lookupPostcodeService (against the real APC sheet)", () => {
  it("loads the whole sheet", () => {
    // APC's August 2026 file. A parse that silently collapsed to a handful of
    // rows would still "work" and quietly answer "not listed" for everything.
    expect(postinfoSize()).toBeGreaterThan(2900);
  });

  it("reports a next-day postcode with Saturday service", () => {
    const a = lookupPostcodeService("MK17 9FX")!;
    expect(a.matchedOn).toBe("MK17");
    expect(a.nextDay).toBe(true);
    expect(a.weekdayCutoff).toBe("10:30");
    expect(a.saturdayDelivery).toBe(true);
    expect(a.summary).toContain("next-day weekday delivery by 10:30");
    expect(a.summary).toContain("Saturday delivery by 10:30");
  });

  it("reports a postcode with NO next-day and NO Saturday service — the reschedule case", () => {
    const a = lookupPostcodeService("AB30 1AA")!;
    expect(a.nextDay).toBe(false);
    expect(a.transitDays).toBe(2);
    expect(a.saturdayDelivery).toBe(false);
    expect(a.summary).toContain("NO next-day service — 2 days in transit");
    expect(a.summary).toContain("NO Saturday delivery");
  });

  it("matches London sub-districts on their own row", () => {
    // The current sheet lists sub-districts in their own right.
    expect(lookupPostcodeService("N1C 4AG")?.matchedOn).toBe("N1C");
    expect(lookupPostcodeService("EC1A 1BB")?.matchedOn).toBe("EC1A");
  });

  it("degrades a missing sub-district to its district rather than 'not listed'", () => {
    // Fixture table has N1 but not N1C — the peel-back path.
    const rows = parsePostinfo(FIXTURE);
    expect(lookupPostcodeService("N1C 4AG", rows)?.matchedOn).toBe("N1");
    expect(lookupPostcodeService("EC1A 1BB", rows)?.matchedOn).toBe("EC1A");
  });

  it("says so out loud when a postcode isn't in the sheet", () => {
    expect(lookupPostcodeService("QQ99 9ZZ")).toBeNull();
    expect(postcodeServiceFor("QQ99 9ZZ")?.summary).toContain("not listed");
  });

  it("returns nothing for a missing postcode rather than guessing", () => {
    expect(postcodeServiceFor("")).toBeNull();
    expect(postcodeServiceFor(null)).toBeNull();
  });
});

describe("refusal advice when the table says the depot normally delivers (2026-10-02)", () => {
  const ka3 = postcodeServiceView(lookupPostcodeService("KA3 1AA")!);
  const apc = { name: "APC Customer Service (Milton Keynes Depot)", phone: "01908 586999" };
  it("Saturday listed but refused → call APC and ask whether it's temporary or permanent", () => {
    const a = postcodeRefusalAdvice(ka3, { saturdayDelivery: true, refusedNoService: true }, apc)!;
    expect(a.kind).toBe("call_depot");
    expect(a.text).toMatch(/Depot 274 normally takes Saturday deliveries by 10:30/);
    expect(a.text).toContain("Call APC Customer Service (Milton Keynes Depot) on 01908 586999 and ask whether the Saturday restriction to KA3 (depot 274) is temporary or permanent.");
    expect(a.text).not.toMatch(/check with a manager/);
    expect(a.call).toEqual({ outward: "KA3", depot: "274", contactName: apc.name, phone: "01908 586999" });
  });
  it("weekday listed but refused → call about the next-day weekday restriction", () => {
    const a = postcodeRefusalAdvice(ka3, { saturdayDelivery: false, refusedNoService: true }, apc)!;
    expect(a.text).toMatch(/next-day weekday deliveries by 10:30/);
    expect(a.service).toBe("weekday");
  });
  it("no advice when the table already says there's no Saturday service", () => {
    const ka18 = postcodeServiceView(lookupPostcodeService("KA18 1AA")!);
    expect(postcodeRefusalAdvice(ka18, { saturdayDelivery: true, refusedNoService: true }, apc)).toBeNull();
  });
  it("no advice for failures that aren't coverage refusals", () => {
    expect(postcodeRefusalAdvice(ka3, { saturdayDelivery: true, refusedNoService: false }, apc)).toBeNull();
  });
});

describe("lookupPostcodeService applies recorded APC answers", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  const base = { id: 1, outward: "KA3", depot: "274", note: null, recordedByName: "Grant", recordedAt: "2026-10-02T09:00:00Z", clearedAt: null };
  it("a permanent Saturday answer removes Saturday service and says so in the summary", () => {
    const s = lookupPostcodeService("KA3 1AA", undefined, [{ ...base, service: "saturday", kind: "permanent" }], now)!;
    expect(s.saturdayDelivery).toBe(false);
    expect(s.saturday).toBeNull();
    expect(s.listed.saturdayDelivery).toBe(true);
    expect(s.nextDay).toBe(true);
    expect(s.summary).toMatch(/NO Saturday delivery/);
    expect(s.summary).toMatch(/confirmed by APC on 2 Oct, permanent/);
    const view = postcodeServiceView(s);
    expect(view.tableSaturdayDelivery).toBe(true);
    expect(view.restrictions.saturday?.kind).toBe("permanent");
  });
  it("other outward codes on the same depot are untouched", () => {
    const s = lookupPostcodeService("KA1 1AA", undefined, [{ ...base, service: "saturday", kind: "permanent" }], now)!;
    expect(s.saturdayDelivery).toBe(true);
    expect(s.restrictions.saturday).toBeNull();
  });
  it("postcodeServiceFor passes overrides through (the Reschedule pop-up's source)", () => {
    const r = postcodeServiceFor("KA3 1AA", [{ ...base, service: "saturday", kind: "permanent" }], now)!;
    expect(r.service?.saturdayDelivery).toBe(false);
  });
});
