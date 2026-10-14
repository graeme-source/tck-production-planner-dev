import { describe, expect, it } from "vitest";
import {
  buildEmailWeeks, cycleCampaignName, cycleSlotOn, cycleSlotsForWeek, fillProduct, freeSlotCampaignName, listFirstMonday,
  normaliseCampaignName, normaliseWeeklyPlan, offerIndexForWeek, plannedCampaignName, weekPause,
  type CycleConfig, type PlannedForList, type KlaviyoForList,
} from "./email-cycle";

const offer = (id: number, code: string, featuresProduct = false) => ({
  id, code, name: `Offer ${id} name`, tag: null, colour: "green", featuresProduct,
  subjects: { launch: `L${id} (Product)`, follow_up: `F${id}`, new_angle: `N${id}`, last_call: `C${id}` },
});

const config: CycleConfig = {
  startDate: "2026-10-12",
  weeklyPlan: ["launch", null, "follow_up", "new_angle", "last_call", "free_slot", null],
  offers: [offer(1, "O1 Free Pack £39.95"), offer(2, "O2 £39.95 + (Product)", true), offer(3, "O3"), offer(4, "O4")],
  pauses: [{ id: 1, name: "Black Friday", startDate: "2026-11-01", endDate: "2026-12-04" }],
  freeIdeas: [{ idea: "Vote", subject: "Vote now" }, { idea: "Events", subject: "What's on" }],
};

describe("cycle maths: which offer runs which week", () => {
  it("rotates 1→2→3→4 from the start Monday", () => {
    expect(offerIndexForWeek("2026-10-12", config)).toBe(0);
    expect(offerIndexForWeek("2026-10-19", config)).toBe(1);
    expect(offerIndexForWeek("2026-10-26", config)).toBe(2);
  });

  it("a week whose offer days hit a pause is paused (a pause starting on Sunday doesn't take that week)", () => {
    expect(weekPause("2026-10-26", config)).toBeNull(); // Sun 1 Nov is in the pause, but Sun isn't an offer day
    expect(weekPause("2026-11-02", config)?.name).toBe("Black Friday");
    expect(weekPause("2026-11-30", config)?.name).toBe("Black Friday"); // Mon–Fri 30 Nov–4 Dec
    expect(weekPause("2026-12-07", config)).toBeNull();
    expect(offerIndexForWeek("2026-11-16", config)).toBeNull();
  });

  it("carries on where it left off after the pause (paused weeks don't use an offer)", () => {
    // 12 Oct O1, 19 Oct O2, 26 Oct O3, five Black Friday weeks, then O4.
    expect(offerIndexForWeek("2026-12-07", config)).toBe(3);
    expect(offerIndexForWeek("2026-12-14", config)).toBe(0);
  });

  it("works backwards before the start, and any day of the week gives its week", () => {
    expect(offerIndexForWeek("2026-10-05", config)).toBe(3);
    expect(offerIndexForWeek("2026-10-16", config)).toBe(0);
  });

  it("no offers → no offer", () => {
    expect(offerIndexForWeek("2026-10-12", { ...config, offers: [] })).toBeNull();
  });
});

describe("weekly plan → slots", () => {
  it("puts each email type on its weekday, none on rest days", () => {
    const s = cycleSlotsForWeek("2026-10-12", config);
    expect(s.map(x => x?.type ?? null)).toEqual(["launch", null, "follow_up", "new_angle", "last_call", "free_slot", null]);
    expect(s[0]?.subject).toBe("L1 (Product)"); // offer 1 doesn't feature a product
    expect(s[0]?.campaignName).toBe("12 Oct – O1 Free Pack £39.95 – 1 Launch");
    expect(s[4]?.campaignName).toBe("16 Oct – O1 Free Pack £39.95 – 4 Last Call");
  });

  it("fills (Product) for an offer that features one", () => {
    const s = cycleSlotsForWeek("2026-10-19", config, "Carnizone");
    expect(s[0]?.subject).toBe("L2 Carnizone");
    expect(s[0]?.campaignName).toBe("19 Oct – O2 £39.95 + Carnizone – 1 Launch");
    expect(s[0]?.offerNumber).toBe(2);
  });

  it("free slot idea rotates week by week", () => {
    expect(cycleSlotsForWeek("2026-10-12", config)[5]?.idea).toBe("Vote");
    expect(cycleSlotsForWeek("2026-10-19", config)[5]?.idea).toBe("Events");
    expect(cycleSlotsForWeek("2026-10-19", config)[5]?.campaignName).toBe("24 Oct – Saturday – Events");
  });

  it("paused weeks and days inside a pause have no cycle email", () => {
    expect(cycleSlotsForWeek("2026-11-09", config).every(x => x == null)).toBe(true);
    const cfg = { ...config, pauses: [{ id: 2, name: "Bonfire", startDate: "2026-10-17", endDate: "2026-10-17" }] };
    expect(cycleSlotOn("2026-10-17", cfg)).toBeNull(); // Saturday inside the pause
    expect(cycleSlotOn("2026-10-16", cfg)?.type).toBe("last_call");
  });

  it("normalises a stored plan", () => {
    expect(normaliseWeeklyPlan(["launch", "nonsense", null])).toEqual(["launch", null, null, null, null, null, null]);
  });
});

describe("campaign names", () => {
  it("builds the names the team pastes into Klaviyo", () => {
    expect(cycleCampaignName("2026-10-12", "O1 Free Pack £39.95", "launch")).toBe("12 Oct – O1 Free Pack £39.95 – 1 Launch");
    expect(cycleCampaignName("2026-10-21", "O2 £39.95 + (Product)", "follow_up", "Philly")).toBe("21 Oct – O2 £39.95 + Philly – 2 Follow-up");
    expect(freeSlotCampaignName("2026-10-17", "Behind the scenes")).toBe("17 Oct – Saturday – Behind the scenes");
    expect(plannedCampaignName("2026-11-02", "Better Than Black Friday Week 1", " Offer Live ")).toBe("2 Nov – Better Than Black Friday Week 1 – Offer Live");
    expect(plannedCampaignName("2026-11-02", null, "Teaser")).toBe("2 Nov – Email – Teaser");
  });

  it("compares names ignoring case, dash style, spacing and (clone)", () => {
    expect(normaliseCampaignName("12 Oct – O1 Free Pack £39.95 – 1 Launch"))
      .toBe(normaliseCampaignName("12 oct - O1 free pack £39.95-1 Launch (clone)"));
  });

  it("fillProduct leaves the token when no product is set", () => {
    expect(fillProduct("Try (Product)", "")).toBe("Try (Product)");
    expect(fillProduct("Try (product)", "Philly")).toBe("Try Philly");
  });
});

describe("the List view's weeks", () => {
  const p = (over: Partial<PlannedForList> & { id: number; sendDate: string }): PlannedForList => ({
    sendTime: null, subject: `Plan ${over.id}`, status: "planned", klaviyoCampaignId: null, campaignTitle: null,
    cycleDate: null, emailType: null, campaignName: null, skipped: false, ...over,
  });
  const k = (id: string, date: string, status = "Sent"): KlaviyoForList => ({ id, name: `K ${id}`, status, date, sendAt: `${date}T09:00:00Z`, subject: null });

  it("one row per email: a slot, a planner email replacing it, a Klaviyo send linked to it, an unplanned one", () => {
    const weeks = buildEmailWeeks({
      config, firstMonday: "2026-10-12", weeks: 1, today: "2026-10-14",
      planned: [
        p({ id: 1, sendDate: "2026-10-14", klaviyoCampaignId: "k1", campaignTitle: "Autumn" }), // fills Wed
        p({ id: 2, sendDate: "2026-10-14" }), // a second email that day
        p({ id: 3, sendDate: "2026-10-12", cycleDate: "2026-10-12", status: "scheduled" }),
      ],
      klaviyo: [k("k1", "2026-10-14"), k("k2", "2026-10-15")],
      results: new Map([["k1", { campaignId: "k1", recipients: 100, openRate: 0.5, clickRate: 0.1, orders: 3, revenue: 120 }],
        ["k2", { campaignId: "k2", recipients: 50, openRate: 0.4, clickRate: 0.1, orders: 1, revenue: 30 }]]),
      keyDates: [{ id: 1, date: "2026-10-16", name: "Big day", big: true }],
    });
    const [w] = weeks;
    expect(w.offerNumber).toBe(1);
    expect(w.isThisWeek).toBe(true);
    const mon = w.days[0].rows, wed = w.days[2].rows, thu = w.days[3].rows, tue = w.days[1].rows;
    expect(mon).toHaveLength(1);
    expect(mon[0]).toMatchObject({ kind: "email", key: "p-3", scheduled: true, scheduledByKlaviyo: false });
    expect(tue).toHaveLength(0);
    expect(wed.map(r => r.key)).toEqual(["p-1", "p-2"]);
    expect(wed[0]).toMatchObject({ type: "follow_up", scheduled: true, scheduledByKlaviyo: true, campaignName: "14 Oct – Autumn – Plan 1" });
    expect(wed[1]).toMatchObject({ slot: null, type: null });
    expect(thu.map(r => r.kind)).toEqual(["email", "unplanned"]); // the cycle idea + Klaviyo's unplanned send
    expect(thu[0]).toMatchObject({ key: "slot-2026-10-15", planned: null, subject: "N1" });
    expect(w.total).toBe(6); // Mon, Wed ×2, Thu, Fri, Sat
    expect(w.done).toBe(2);
    expect(w.orders).toBe(4);
    expect(w.revenue).toBe(150);
    expect(w.bigKeyDates).toEqual(["Big day"]);
    expect(w.days[2].isToday).toBe(true);
  });

  it("a Klaviyo campaign linked to a plan outside the range is not shown as unplanned", () => {
    const [w] = buildEmailWeeks({ config, firstMonday: "2026-10-12", weeks: 1, today: "2026-10-14", planned: [], klaviyo: [k("kx", "2026-10-13")], linkedCampaignIds: ["kx"] });
    expect(w.days[1].rows).toHaveLength(0);
  });

  it("paused weeks show the planner's emails only; skipped and moved slots", () => {
    const weeks = buildEmailWeeks({
      config, firstMonday: "2026-11-02", weeks: 1, today: "2026-10-14",
      planned: [p({ id: 9, sendDate: "2026-11-02", campaignTitle: "BTBF Week 1", emailType: "launch" })],
      klaviyo: [],
    });
    expect(weeks[0].pause?.name).toBe("Black Friday");
    expect(weeks[0].days[0].rows).toHaveLength(1);
    expect(weeks[0].days[2].rows).toHaveLength(0);
    expect(weeks[0].phases).toEqual(["BTBF Week 1"]);

    const [w] = buildEmailWeeks({
      config, firstMonday: "2026-10-12", weeks: 1, today: "2026-10-14",
      planned: [
        p({ id: 4, sendDate: "2026-10-12", cycleDate: "2026-10-12", skipped: true }),
        p({ id: 5, sendDate: "2026-10-15", cycleDate: "2026-10-14" }), // Wed's slot, moved to Thu
      ],
      klaviyo: [],
    });
    expect(w.days[0].rows[0]).toMatchObject({ skipped: true });
    expect(w.days[2].rows[0]).toMatchObject({ kind: "moved" });
    expect(w.days[3].rows.map(r => r.key)).toEqual(["slot-2026-10-15", "p-5"]);
    expect(w.total).toBe(4); // Thu slot, p-5, Fri, Sat — not the skipped Mon or the moved Wed
  });

  it("starts at this week, or the cycle's first week when that's later", () => {
    expect(listFirstMonday("2026-10-14", "2026-10-12")).toBe("2026-10-12");
    expect(listFirstMonday("2026-10-14", "2026-11-09")).toBe("2026-11-09");
    expect(listFirstMonday("2026-10-14", "2026-10-12", 2)).toBe("2026-09-28");
  });
});
