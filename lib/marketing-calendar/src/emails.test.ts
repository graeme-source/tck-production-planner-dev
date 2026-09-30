import { describe, it, expect } from "vitest";
import {
  campaignForDate, defaultEmailDate, buildEmailSections, diffEmailFields, describeEmailFieldChanges,
  describeEmailMove, describeKlaviyoLink, formatDay,
} from "./index";

const early = { id: 1, name: "Early Black Friday", startDate: "2026-11-09", endDate: "2026-11-19" };
const main = { id: 2, name: "Main Black Friday", startDate: "2026-11-20", endDate: "2026-11-30" };
const superBf = { id: 3, name: "Super Black Friday", startDate: "2026-11-27", endDate: "2026-11-29" };

describe("campaignForDate", () => {
  it("finds the campaign whose dates contain the day (ends inclusive)", () => {
    expect(campaignForDate("2026-11-09", [early, main])?.id).toBe(1);
    expect(campaignForDate("2026-11-19", [early, main])?.id).toBe(1);
    expect(campaignForDate("2026-11-20", [early, main])?.id).toBe(2);
    expect(campaignForDate("2026-12-01", [early, main])).toBeNull();
    expect(campaignForDate("2026-11-08", [])).toBeNull();
  });
  it("overlap: the one that started most recently wins", () => {
    expect(campaignForDate("2026-11-26", [main, superBf])?.id).toBe(2);
    expect(campaignForDate("2026-11-27", [main, superBf])?.id).toBe(3);
    expect(campaignForDate("2026-11-30", [main, superBf])?.id).toBe(2);
  });
  it("same start: the shorter wins, then the newer", () => {
    const long = { id: 5, startDate: "2026-11-20", endDate: "2026-12-10" };
    const short = { id: 4, startDate: "2026-11-20", endDate: "2026-11-22" };
    expect(campaignForDate("2026-11-21", [long, short])?.id).toBe(4);
    const twin = { id: 9, startDate: "2026-11-20", endDate: "2026-11-22" };
    expect(campaignForDate("2026-11-21", [twin, short])?.id).toBe(9);
    expect(campaignForDate("2026-11-21", [short, twin])?.id).toBe(9);
  });
  it("moving an email's date re-files it", () => {
    expect(campaignForDate("2026-11-18", [early, main])?.name).toBe("Early Black Friday");
    expect(campaignForDate("2026-11-21", [early, main])?.name).toBe("Main Black Friday");
  });
});

describe("defaultEmailDate", () => {
  it("today when running, otherwise the first day", () => {
    expect(defaultEmailDate(early, "2026-11-12")).toBe("2026-11-12");
    expect(defaultEmailDate(early, "2026-10-01")).toBe("2026-11-09");
    expect(defaultEmailDate(early, "2026-12-25")).toBe("2026-11-09");
  });
});

const p = (id: number, sendDate: string, extra: Partial<{ sendTime: string | null; klaviyoCampaignId: string | null }> = {}) =>
  ({ id, sendDate, sendTime: null, klaviyoCampaignId: null, ...extra });
const k = (id: string, date: string, hm = "09:00") => ({ id, date, sendAt: `${date}T${hm}:00Z` });

describe("buildEmailSections", () => {
  it("groups emails into campaign sections in date order, loose ones between", () => {
    const sections = buildEmailSections({
      campaigns: [main, early],
      planned: [p(10, "2026-11-21"), p(11, "2026-11-10"), p(12, "2026-11-05"), p(13, "2026-12-05")],
      klaviyo: [],
      today: "2026-10-01",
      showPast: false,
    });
    expect(sections.map(s => s.campaign?.name ?? "none")).toEqual(["none", "Early Black Friday", "Main Black Friday", "none"]);
    expect(sections[0].items.map(i => i.kind === "planned" && i.planned.id)).toEqual([12]);
    expect(sections[1].items.map(i => i.kind === "planned" && i.planned.id)).toEqual([11]);
    expect(sections[3].items.map(i => i.kind === "planned" && i.planned.id)).toEqual([13]);
  });
  it("keeps empty campaigns so emails can be added to them", () => {
    const sections = buildEmailSections({ campaigns: [early], planned: [], klaviyo: [], today: "2026-10-01", showPast: false });
    expect(sections).toHaveLength(1);
    expect(sections[0].items).toEqual([]);
  });
  it("merges a linked Klaviyo send into its planned email (not listed twice)", () => {
    const sections = buildEmailSections({
      campaigns: [early],
      planned: [p(10, "2026-11-10", { klaviyoCampaignId: "K1" })],
      klaviyo: [k("K1", "2026-11-10"), k("K2", "2026-11-12")],
      today: "2026-10-01",
      showPast: false,
    });
    const items = sections[0].items;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: "planned", klaviyo: { id: "K1" } });
    expect(items[1]).toMatchObject({ kind: "klaviyo", klaviyo: { id: "K2" } });
  });
  it("sorts within a day by time, and hides the past unless asked", () => {
    const input = {
      campaigns: [early],
      planned: [p(1, "2026-11-10", { sendTime: "18:00" }), p(2, "2026-11-10", { sendTime: "08:00" }), p(3, "2026-11-01")],
      klaviyo: [k("K9", "2026-11-10", "12:00")],
      today: "2026-11-05",
    };
    const upcoming = buildEmailSections({ ...input, showPast: false });
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].items.map(i => (i.kind === "planned" ? i.planned.id : i.klaviyo.id))).toEqual([2, "K9", 1]);
    const all = buildEmailSections({ ...input, showPast: true });
    expect(all.map(s => s.campaign?.id ?? "none")).toEqual(["none", 1]);
  });
  it("drops ended campaigns from the upcoming list, and puts a running one first", () => {
    const sections = buildEmailSections({
      campaigns: [{ id: 7, startDate: "2026-09-01", endDate: "2026-09-10" }, early],
      planned: [p(1, "2026-11-01")],
      klaviyo: [],
      today: "2026-11-01",
      showPast: false,
    });
    expect(sections.map(s => s.campaign?.id ?? "none")).toEqual(["none", 1]);
    const running = buildEmailSections({ campaigns: [early], planned: [p(1, "2026-11-12")], klaviyo: [], today: "2026-11-12", showPast: false });
    expect(running[0].campaign?.id).toBe(1);
  });
});

describe("email history sentences", () => {
  it("records only real changes, in plain English", () => {
    const changes = diffEmailFields(
      { subject: "Early access", status: "planned", audiences: ["vip"], notes: null, coreMessage: "x" },
      { subject: "Early access!", status: "created", audiences: ["vip"], notes: "", coreMessage: "y", name: "ignored" },
    );
    expect(Object.keys(changes)).toEqual(["subject", "status", "coreMessage"]);
    expect(describeEmailFieldChanges(changes)).toBe("changed the subject line to “Early access!”, changed the stage to Created in Klaviyo and edited the core message");
  });
  it("names audiences and clears", () => {
    expect(describeEmailFieldChanges({
      audiences: { from: [], to: ["vip", "new"] },
      metaChange: { from: "x", to: "" },
      sendTime: { from: null, to: "09:00" },
    })).toBe("set the audience to VIP, New customers, cleared the Meta change and set the send time to 09:00");
    expect(describeEmailFieldChanges({})).toBeNull();
  });
  it("a move says which campaign it landed in", () => {
    expect(formatDay("2026-11-20")).toBe("Fri 20 Nov");
    expect(describeEmailMove("2026-11-18", "2026-11-21", "Early Black Friday", "Main Black Friday"))
      .toBe("moved it from Wed 18 Nov to Sat 21 Nov — now in “Main Black Friday”");
    expect(describeEmailMove("2026-11-10", "2026-11-11", "Early Black Friday", "Early Black Friday"))
      .toBe("moved it from Tue 10 Nov to Wed 11 Nov");
    expect(describeEmailMove("2026-11-19", "2026-12-02", "Early Black Friday", null))
      .toBe("moved it from Thu 19 Nov to Wed 2 Dec — now not in a phase");
    expect(describeEmailMove("2026-11-19", "2026-11-19", null, null)).toBeNull();
  });
  it("linking and unlinking Klaviyo", () => {
    expect(describeKlaviyoLink(null, "BF early access")).toEqual({ action: "linked", summary: "linked it to the Klaviyo email “BF early access”" });
    expect(describeKlaviyoLink("BF early access", null)).toEqual({ action: "unlinked", summary: "unlinked the Klaviyo email “BF early access”" });
    expect(describeKlaviyoLink(null, null)).toBeNull();
  });
});
