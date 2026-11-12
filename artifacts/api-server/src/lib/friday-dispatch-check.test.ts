import { describe, it, expect } from "vitest";
import { parsePostinfo, lookupPostcodeService } from "../services/apc-postinfo";
import type { PostcodeOverride } from "../services/apc-postcode-overrides";
import {
  comingFriday, isFridayDate, fridayDates, apcOrdersForCheck, repeatRefusals, checkOrder, runFridayCheck,
  doneStateByOrder, REFUSAL_LOOKBACK_DAYS, REPEAT_REFUSAL_FRIDAYS, type DepotRefusal, type FridayCheckOrder, type CheckableShopifyOrder,
} from "./friday-dispatch-check";
import { noSaturdayThisWeekEmail } from "./apc-issue-emails";

// Rows copied from APC's POSTINFO sheet (src/data/apc-postinfo.csv) for the
// postcodes that failed on the last four Fridays on live, plus a few others.
const TABLE = parsePostinfo([
  "Postcode, Earliest Achieveable Weekday Del Time, Saturday, Depot, Area",
  "EX7 ,16:00,-,1,0",
  "GL2 ,16:00,-,45,0",
  "EH45,16:00,-,175,17",
  "G83 ,12:00,-,66,17",
  "AB22,16:00,-,296,13",
  "DH1 ,10:30,10:30,60,0",
  "DH3 ,10:30,10:30,60,0",
  "DH5 ,10:30,10:30,60,0",
  "CV2 ,10:30,10:30,28,0",
  "CV5 ,10:30,10:30,28,0",
  "EX8 ,10:30,10:30,2,0",
  "MK17,10:30,10:30,30,0",
  "PA20,2 days,-,297,8",
].join("\n"));

const NOW = new Date("2026-11-11T10:00:00Z"); // Wednesday 11 Nov
const TODAY = "2026-11-11";
const FRIDAY = "2026-11-13";
const DATES = fridayDates(FRIDAY);

const serviceFor = (overrides: PostcodeOverride[] = []) =>
  (pc: string | null) => lookupPostcodeService(pc, TABLE, overrides, NOW);

const order = (name: string, postcode: string | null, id = Number(name.replace(/\D/g, ""))): FridayCheckOrder =>
  ({ orderId: id, orderName: name, customerName: `Customer ${name}`, postcode });

// Depot 60 refused three DH postcodes on one Friday (a bad day — it
// delivered Saturdays again the next week); CV5 was refused on two different
// Fridays (the area, not a bad day). EX7's refusal was expected (no Saturday listed).
const REFUSALS: DepotRefusal[] = [
  { reportDate: "2026-10-30", depot: "60", outward: "DH1", orderName: "#1", tableListedSaturday: true },
  { reportDate: "2026-10-30", depot: "60", outward: "DH3", orderName: "#2", tableListedSaturday: true },
  { reportDate: "2026-10-30", depot: "60", outward: "DH1", orderName: "#3", tableListedSaturday: true },
  { reportDate: "2026-10-30", depot: "28", outward: "CV5", orderName: "#4", tableListedSaturday: true },
  { reportDate: "2026-11-06", depot: "28", outward: "CV5", orderName: "#5", tableListedSaturday: true },
  { reportDate: "2026-11-06", depot: "1", outward: "EX7", orderName: "#6", tableListedSaturday: false },
];

describe("dates", () => {
  it("defaults to the coming Friday, or today on a Friday", () => {
    expect(comingFriday("2026-11-11")).toBe("2026-11-13");
    expect(comingFriday("2026-11-13")).toBe("2026-11-13");
    expect(comingFriday("2026-11-14")).toBe("2026-11-20");
    expect(isFridayDate("2026-11-13")).toBe(true);
    expect(isFridayDate("2026-11-12")).toBe(false);
  });

  it("works out the Saturday tag, the Wednesday reply-by, and both alternatives", () => {
    expect(DATES).toEqual({
      dispatchDate: "2026-11-13",
      deliveryDate: "2026-11-14",
      replyBy: "2026-11-11",
      thursdayDispatch: "2026-11-12",
      thursdayDelivery: "2026-11-13",
      nextWeekDispatch: "2026-11-16",
      nextWeekDelivery: "2026-11-17",
    });
  });
});

describe("apcOrdersForCheck — same rules as the batch preflight", () => {
  const base: CheckableShopifyOrder = {
    id: 1, name: "#1", tags: "2026-11-14, Saturday", cancelled_at: null, fulfillment_status: null,
    customer: { first_name: "Jo", last_name: "Bloggs" }, shipping_address: { name: "Jo Bloggs", zip: " EX7 0EA " },
  };
  it("keeps an untagged APC order (the dispatch tag comes on the morning)", () => {
    expect(apcOrdersForCheck([base])).toEqual([{ orderId: 1, orderName: "#1", customerName: "Jo Bloggs", postcode: "EX7 0EA" }]);
  });
  it("drops cancelled, fulfilled, collection and local-delivery orders", () => {
    const out = apcOrdersForCheck([
      { ...base, id: 2, cancelled_at: "2026-11-10T10:00:00Z" },
      { ...base, id: 3, fulfillment_status: "fulfilled" },
      { ...base, id: 4, tags: "2026-11-14, Collections" },
      { ...base, id: 5, tags: "2026-11-14, Local Delivery – Sat" },
      { ...base, id: 6, fulfillment_status: "partial" },
    ]);
    expect(out.map(o => o.orderId)).toEqual([6]);
  });
  it("falls back to the customer's name, and to no postcode", () => {
    const [o] = apcOrdersForCheck([{ ...base, shipping_address: null }]);
    expect(o.customerName).toBe("Jo Bloggs");
    expect(o.postcode).toBeNull();
  });
});

describe("red — APC's table (or a permanent APC answer) says no Saturday", () => {
  for (const pc of ["EX7 0EA", "GL2 0PZ", "EH45 8AA", "G83 0AA", "AB22 8AA"]) {
    it(`${pc} is no_saturday`, () => {
      const r = checkOrder(order("#100", pc), serviceFor()(pc), REFUSALS, DATES, TODAY);
      expect(r.status).toBe("no_saturday");
      expect(r.reason).toMatch(/lists no Saturday delivery/);
      expect(r.thursday.possible).toBe(true);
      expect(r.nextWeek.possible).toBe(true);
      expect(r.canEmail).toBe(true);
      expect(r.canOfferThursday).toBe(true);
    });
  }

  it("a permanent recorded restriction turns a listed Saturday red", () => {
    const perm: PostcodeOverride = {
      id: 9, outward: "MK17", service: "saturday", kind: "permanent", note: null, depot: "30",
      recordedByName: "Grant", recordedAt: new Date("2026-10-02T09:00:00Z"), clearedAt: null,
    };
    const r = checkOrder(order("#101", "MK17 9FX"), serviceFor([perm])("MK17 9FX"), [], DATES, TODAY);
    expect(r.status).toBe("no_saturday");
    expect(r.reason).toContain("APC confirmed on 2 Oct");
  });
});

describe("amber — at risk (high confidence only)", () => {
  // Graeme, 12 Nov 2026: #139579 (SS0, depot 219) was flagged because depot
  // 219 refused SS8 once on 30 Oct — a day APC refused six depots — and
  // depot 219 delivered Saturdays again on 6 Nov. Not confident enough.
  it("a depot's one-off refusal is not a warning, even three in one day", () => {
    const r = checkOrder(order("#200", "DH1 5AA"), serviceFor()("DH1 5AA"), REFUSALS, DATES, TODAY);
    expect(r.status).toBe("ok");
    const oneOff: DepotRefusal[] = [{ reportDate: "2026-10-30", depot: "28", outward: "CV2", orderName: "#9", tableListedSaturday: true }];
    expect(checkOrder(order("#204", "CV2 5LE"), serviceFor()("CV2 5LE"), oneOff, DATES, TODAY).status).toBe("ok");
  });

  it("the order's own area refused on two different Fridays is", () => {
    const r = checkOrder(order("#201", "CV5 1AA"), serviceFor()("CV5 1AA"), REFUSALS, DATES, TODAY);
    expect(r.status).toBe("at_risk");
    expect(r.reason).toBe("APC refused a Saturday to CV5 on 2 different Fridays (Fri 6 Nov, Fri 30 Oct), though its table lists one.");
  });

  it("a refusal the table already predicted adds nothing", () => {
    const expected: DepotRefusal[] = [
      { reportDate: "2026-11-06", depot: "2", outward: "EX8", orderName: "#7", tableListedSaturday: false },
      { reportDate: "2026-10-30", depot: "2", outward: "EX8", orderName: "#8", tableListedSaturday: false },
    ];
    expect(checkOrder(order("#202", "EX8 1AA"), serviceFor()("EX8 1AA"), expected, DATES, TODAY).status).toBe("ok");
  });

  it("only counts refusals in the 56 days before the dispatch day, and needs two Fridays", () => {
    const a: DepotRefusal = { reportDate: "2026-09-17", depot: "30", outward: "MK17", orderName: "#8", tableListedSaturday: true };
    const b: DepotRefusal = { ...a, reportDate: "2026-11-06" };
    const edge: DepotRefusal = { ...a, reportDate: "2026-09-18" };
    const sameDay: DepotRefusal = { ...a, reportDate: FRIDAY };
    expect(REFUSAL_LOOKBACK_DAYS).toBe(56);
    expect(REPEAT_REFUSAL_FRIDAYS).toBe(2);
    expect(repeatRefusals("MK17", [a, b], FRIDAY)).toEqual([]);
    expect(repeatRefusals("MK17", [b, sameDay], FRIDAY)).toEqual([]);
    expect(repeatRefusals("MK17", [edge, b], FRIDAY)).toEqual([b, edge]);
    expect(repeatRefusals("MK17", [b, { ...b, orderName: "#9" }], FRIDAY)).toEqual([]);
  });

  it("a temporary recorded Saturday restriction", () => {
    const temp: PostcodeOverride = {
      id: 10, outward: "MK17", service: "saturday", kind: "temporary", note: null, depot: "30",
      recordedByName: "Grant", recordedAt: new Date("2026-11-06T09:00:00Z"), clearedAt: null,
    };
    const r = checkOrder(order("#203", "MK17 9FX"), serviceFor([temp])("MK17 9FX"), [], DATES, TODAY);
    expect(r.status).toBe("at_risk");
    expect(r.reason).toContain("Temporary Saturday restriction reported 6 Nov by Grant");
    expect(r.reason).toContain("counts until 20 Nov");
  });
});

describe("green and unknown", () => {
  it("a listed Saturday with no warnings will go", () => {
    const r = checkOrder(order("#300", "MK17 9FX"), serviceFor()("MK17 9FX"), REFUSALS, DATES, TODAY);
    expect(r.status).toBe("ok");
    expect(r.reason).toBe("Saturday delivery by 10:30 to MK17 (depot 30).");
    expect(r.canEmail).toBe(false);
  });

  it("a postcode not in the table is unknown, and offers nothing", () => {
    const r = checkOrder(order("#301", "ZZ9 9ZZ"), serviceFor()("ZZ9 9ZZ"), REFUSALS, DATES, TODAY);
    expect(r.status).toBe("unknown");
    expect(r.reason).toContain("ZZ9 isn't in APC's postcode table");
    expect(r.thursday.possible || r.nextWeek.possible || r.canEmail).toBe(false);
  });

  it("no postcode at all is unknown", () => {
    const r = checkOrder(order("#302", null), null, [], DATES, TODAY);
    expect(r.status).toBe("unknown");
    expect(r.reason).toContain("No postcode");
  });
});

describe("alternatives", () => {
  it("no next-day weekday service: neither Thursday nor next week, and no email", () => {
    const r = checkOrder(order("#400", "PA20 0AA"), serviceFor()("PA20 0AA"), [], DATES, TODAY);
    expect(r.status).toBe("no_saturday");
    expect(r.thursday.possible).toBe(false);
    expect(r.nextWeek.possible).toBe(false);
    expect(r.thursday.note).toContain("2 days in transit");
    expect(r.canEmail).toBe(false);
    expect(r.emailNote).toContain("Escalate");
  });

  it("after Wednesday the email stops offering Thursday; Thursday itself is still movable on the day", () => {
    const thu = checkOrder(order("#401", "EX7 0EA"), serviceFor()("EX7 0EA"), [], DATES, "2026-11-12");
    expect(thu.canOfferThursday).toBe(false);
    expect(thu.thursday.possible).toBe(true);
    expect(thu.emailNote).toContain("past Wednesday");
    const fri = checkOrder(order("#402", "EX7 0EA"), serviceFor()("EX7 0EA"), [], DATES, "2026-11-13");
    expect(fri.thursday.possible).toBe(false);
    expect(fri.nextWeek.possible).toBe(true);
  });

  it("moves to the Friday tag (Thursday dispatch) and the Tuesday tag (Monday dispatch)", () => {
    const r = checkOrder(order("#403", "EX7 0EA"), serviceFor()("EX7 0EA"), [], DATES, TODAY);
    expect(r.thursday).toMatchObject({ deliveryDate: "2026-11-13", label: "Thursday 12 November" });
    expect(r.nextWeek).toMatchObject({ deliveryDate: "2026-11-17", label: "Monday 16 November" });
  });
});

describe("runFridayCheck — the last four Fridays' pattern", () => {
  it("catches the table postcodes and the repeat-refused area, worst first, with counts", () => {
    const orders = [
      order("#1", "MK17 9FX"), order("#2", "EX7 0EA"), order("#3", "DH1 2BB"), order("#4", "GL2 0PZ"),
      order("#5", "CV5 1AA"), order("#6", "ZZ9 9ZZ"), order("#7", "AB22 8AA"),
    ];
    const { results, summary } = runFridayCheck({ dispatchDate: FRIDAY, today: TODAY, orders, serviceFor: serviceFor(), refusals: REFUSALS });
    expect(summary).toEqual({ total: 7, ok: 2, noSaturday: 3, atRisk: 1, unknown: 1 });
    expect(results.map(r => r.status)).toEqual(["no_saturday", "no_saturday", "no_saturday", "at_risk", "unknown", "ok", "ok"]);
    // Within a colour: by depot, numerically.
    expect(results.slice(0, 3).map(r => r.depot)).toEqual(["1", "45", "296"]);
  });
});

describe("the customer email", () => {
  const who = { customerFirstName: "Jo", senderFirstName: "Graeme", orderName: "#138001", dates: DATES };
  it("offers Thursday with the reply-by Wednesday, otherwise Monday for Tuesday delivery", () => {
    const e = noSaturdayThisWeekEmail({ ...who, offerThursday: true });
    expect(e.subject).toBe("Your Calzone Kitchen order #138001 — we can't deliver this Saturday");
    expect(e.body).toContain("can't deliver to your postcode this Saturday (Saturday 14 November)");
    expect(e.body).toContain("by the end of Wednesday 11 November");
    expect(e.body).toContain("send it out on Thursday for delivery on Friday 13 November");
    expect(e.body).toContain("send it out on Monday for delivery on Tuesday 17 November");
    expect(e.html).toContain("Tuesday 17 November");
  });
  it("without the offer, only Tuesday", () => {
    const e = noSaturdayThisWeekEmail({ ...who, offerThursday: false });
    expect(e.body).not.toContain("Thursday");
    expect(e.body).toContain("send it out on Monday instead, for delivery on Tuesday 17 November");
  });
});

describe("doneStateByOrder", () => {
  it("keeps the latest email and move per order", () => {
    const s = doneStateByOrder([
      { orderId: 1, orderName: "#1", kind: "emailed", detail: "a@x.com", byName: "Grant", at: "2026-11-11T09:00:00Z" },
      { orderId: 1, orderName: "#1", kind: "emailed", detail: "b@x.com", byName: "Graeme", at: "2026-11-11T10:00:00Z" },
      { orderId: 1, orderName: "#1", kind: "moved", detail: "2026-11-13", byName: "Graeme", at: "2026-11-11T11:00:00Z" },
      { orderId: 2, orderName: "#2", kind: "moved", detail: "2026-11-18", byName: "Grant", at: "2026-11-11T12:00:00Z" },
    ]);
    expect(s.get(1)).toEqual({ emailedAt: "2026-11-11T10:00:00Z", emailedBy: "Graeme", emailedTo: "b@x.com", movedAt: "2026-11-11T11:00:00Z", movedBy: "Graeme", movedTo: "2026-11-13" });
    expect(s.get(2)?.emailedAt).toBeNull();
  });
});
