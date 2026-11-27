// Regression (Graeme, 27 Nov 2026): the packing room's Move pop-up offered
// Tuesday 1 December, a Zapiet blackout, as the default new date. It now
// reads the same delivery calendar as the Friday dispatch check, and its
// email carries the website assistant's "choose a delivery day" link.
import { describe, it, expect } from "vitest";
import { nextAvailableDeliveryDate, deliveryDateChoices, rescheduleEmailText } from "./order-reschedule";
import { isOpenDeliveryDate, firstDeliveryAfterWeekend, type DeliveryCalendar } from "./next-delivery-after-weekend";
import { permanentSaturdayEmailText, rescheduleEmailFor } from "./apc-issue-emails";

const cal = (over: Partial<DeliveryCalendar> = {}): DeliveryCalendar => ({
  disabledWeekdays: new Set([0, 1]),
  blockedDates: new Set(["2026-12-01"]),
  nonDispatchDates: new Set(),
  ...over,
});

describe("reschedule dates skip the checkout's blackouts", () => {
  it("a Saturday 28 Nov failure moves to Wednesday 2 Dec, not the blacked-out Tuesday", () => {
    expect(nextAvailableDeliveryDate("2026-11-28")).toBe("2026-12-01"); // plain rule, no calendar
    expect(nextAvailableDeliveryDate("2026-11-28", { calendar: cal() })).toBe("2026-12-02");
  });

  it("the one-tap choices leave the blackout out", () => {
    const d = deliveryDateChoices("2026-11-28", 6, false, cal());
    expect(d).not.toContain("2026-12-01");
    expect(d[0]).toBe("2026-12-02");
    expect(d).toHaveLength(6);
  });

  it("our own closures count too — the delivery day or the dispatch day before it", () => {
    expect(isOpenDeliveryDate("2026-12-03", cal({ nonDispatchDates: new Set(["2026-12-02"]) }))).toBe(false);
    expect(isOpenDeliveryDate("2026-12-03", cal({ nonDispatchDates: new Set(["2026-12-03"]) }))).toBe(false);
    expect(isOpenDeliveryDate("2026-12-03", cal())).toBe(true);
  });

  it("allow-list mode: only the listed dates are open", () => {
    const c = cal({ allowedDates: new Set(["2026-12-04"]) });
    expect(isOpenDeliveryDate("2026-12-02", c)).toBe(false);
    expect(nextAvailableDeliveryDate("2026-11-28", { calendar: c })).toBe("2026-12-04");
  });

  it("weekdays-only and the calendar together", () => {
    const c = cal({ blockedDates: new Set(["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04"]) });
    expect(nextAvailableDeliveryDate("2026-11-28", { weekdaysOnly: true, calendar: c })).toBe("2026-12-08");
  });

  it("the Friday dispatch check agrees with the Move pop-up", () => {
    expect(firstDeliveryAfterWeekend("2026-11-28", cal())?.delivery).toBe("2026-12-02");
  });
});

const who = { customerFirstName: "Jan", senderFirstName: "Graeme", newTagDate: "2026-12-02" };
const LINK = "https://assistant.example/r/abc?x=1&y=2";

describe("reschedule email with the choose-a-day link", () => {
  it("offers the link instead of a reply deadline", () => {
    const body = rescheduleEmailText({ ...who, link: LINK });
    expect(body).toContain(LINK);
    expect(body).toContain("choose a different day here");
    expect(body).not.toContain("before the end of the day tomorrow");
    expect(body).toContain("Wednesday 2 December");
    // The link is the only way offered — no "or just reply" (Graeme, 27 Nov 2026).
    expect(body).not.toMatch(/reply to this email/i);
  });

  it("the no-Saturdays email with a link doesn't offer replying either", () => {
    expect(permanentSaturdayEmailText({ ...who, link: LINK })).not.toMatch(/reply to this email/i);
  });

  it("without a link the original wording stands", () => {
    expect(rescheduleEmailText(who)).toContain("please reply to this email with a new delivery date, before the end of the day tomorrow");
    expect(rescheduleEmailText({ ...who, link: null })).toBe(rescheduleEmailText(who));
  });

  it("the no-Saturdays email asks for a weekday through the link", () => {
    const body = permanentSaturdayEmailText({ ...who, link: LINK });
    expect(body).toContain("choose a different weekday here");
    expect(body).toContain(LINK);
    expect(body).toContain("Please don't use Saturday as a delivery date going forwards");
  });

  it("the HTML turns the link into a button", () => {
    const e = rescheduleEmailFor("temporary_saturday", { ...who, orderName: "#140771", link: LINK });
    expect(e.html).toContain(">Choose a delivery day</a>");
    expect(e.html).toContain('href="https://assistant.example/r/abc?x=1&amp;y=2"');
    expect(e.body).toContain(LINK);
  });
});
