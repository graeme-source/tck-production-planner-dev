import { describe, expect, it } from "vitest";
import { campaignSnapshot, campaignsToCalendar, londonDay } from "./klaviyo-campaign-map";

const camp = (id: string, status: string, send: string | null, msgs: string[], included: string[] = ["L1"]) => ({
  id, relationships: { "campaign-messages": { data: msgs.map(m => ({ id: m })) } },
  attributes: { name: `Campaign ${id}`, status, send_time: send, scheduled_at: send, audiences: { included, excluded: ["X1", "X2"] } },
});
const msg = (id: string, subject: string, preview = "Preview") => ({ id, attributes: { content: { subject, preview_text: preview } } });

describe("Klaviyo campaigns on the marketing calendar", () => {
  const base = {
    campaigns: [
      camp("a", "Sent", "2026-09-25T09:07:00+00:00", ["m1"]),
      camp("b", "Scheduled", "2026-09-30T09:07:00+00:00", ["m2", "m3"], ["L2"]),
      camp("c", "Draft", "2026-09-30T10:00:00+00:00", ["m4"]),
      camp("d", "Cancelled", "2026-09-29T10:00:00+00:00", ["m5"]),
      camp("e", "Sent", "2026-08-01T09:00:00+00:00", ["m6"]),
    ],
    messages: [msg("m1", "Philly 2.0 is here"), msg("m2", " Payday Freepack 🎁 "), msg("m3", "B version")],
    audienceNames: new Map([["L1", "Everyone"], ["L2", "VIPs"]]),
    from: "2026-09-01",
    to: "2026-09-30",
  };
  const out = campaignsToCalendar(base);

  it("shows sent and scheduled one-off campaigns in the range, never cancelled", () => {
    expect(out.map(e => e.id)).toEqual(["a", "b"]);
  });

  it("includes a draft on its planned send day (send strategy), with an edit link", () => {
    const draft = {
      id: "dr", relationships: { "campaign-messages": { data: [{ id: "m9" }] } },
      attributes: {
        name: "BF early (draft)", status: "Draft", send_time: null, scheduled_at: null,
        send_strategy: { method: "static", options_static: { datetime: "2026-09-28T08:00:00+00:00" } },
      },
    };
    const res = campaignsToCalendar({ ...base, campaigns: [...base.campaigns, draft], messages: [...base.messages, msg("m9", "Early access")] });
    const d = res.find(e => e.id === "dr")!;
    expect(d.status).toBe("Draft");
    expect(d.date).toBe("2026-09-28");
    expect(d.subject).toBe("Early access");
    expect(d.klaviyoUrl).toBe("https://www.klaviyo.com/campaign/dr/wizard/1");
    // A draft with no planned send time can't be placed — left out.
    expect(res.find(e => e.id === "c")).toBeUndefined();
  });

  it("snapshots one campaign's current subject and status for approvals", () => {
    const snap = campaignSnapshot(base.campaigns[1], base.messages);
    expect(snap).toEqual({ id: "b", name: "Campaign b", status: "Scheduled", subject: "Payday Freepack 🎁", date: "2026-09-30" });
  });

  it("carries the campaign name, subject line, preview text and audience names", () => {
    const b = out.find(e => e.id === "b")!;
    expect(b.name).toBe("Campaign b");
    expect(b.subject).toBe("Payday Freepack 🎁");
    expect(b.previewText).toBe("Preview");
    expect(b.audiences).toEqual(["VIPs"]);
    expect(b.excludedCount).toBe(2);
  });

  it("flags an A/B test and links sent campaigns to their report", () => {
    expect(out.find(e => e.id === "b")!.abTest).toBe(true);
    expect(out.find(e => e.id === "a")!.klaviyoUrl).toContain("/campaign/a/reports");
  });

  it("files a send on its London day, not the UTC one", () => {
    expect(londonDay("2026-09-30T23:30:00+00:00")).toBe("2026-10-01"); // BST
    expect(londonDay("2026-12-31T23:30:00+00:00")).toBe("2026-12-31"); // GMT
  });
});
