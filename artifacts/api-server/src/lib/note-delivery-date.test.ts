import { describe, it, expect } from "vitest";
import { suggestDeliveryDateFromNote } from "./note-delivery-date";

// Anchor: Tuesday 8 September 2026 (order placed). Today: same day unless a
// test says otherwise.
const ANCHOR = "2026-09-08";
const TODAY = "2026-09-08";

const suggest = (note: string, anchor = ANCHOR, today = TODAY) =>
  suggestDeliveryDateFromNote(note, anchor, today);

describe("suggestDeliveryDateFromNote", () => {
  it("returns null for empty or date-free notes", () => {
    expect(suggest("")).toBeNull();
    expect(suggest("   ")).toBeNull();
    expect(suggestDeliveryDateFromNote(null, ANCHOR, TODAY)).toBeNull();
    expect(suggest("Please leave with the neighbour if we're out")).toBeNull();
  });

  it("reads weekday names as the next occurrence after the note was written", () => {
    // Anchor is a Tuesday → Friday = 11 Sept.
    expect(suggest("Deliver Friday please")).toEqual({ date: "2026-09-11", matched: "friday" });
    expect(suggest("could we have this for next friday?")?.date).toBe("2026-09-11");
    expect(suggest("fri would be great")?.date).toBe("2026-09-11");
  });

  it("a weekday named on its own day means NEXT week, not today", () => {
    // Tuesday note saying "Tuesday" → 15 Sept, not 8 Sept.
    expect(suggest("deliver tuesday")?.date).toBe("2026-09-15");
  });

  it("reads day + month name in both orders, with ordinals and 'of'", () => {
    expect(suggest("Needed for the 12th September")?.date).toBe("2026-09-12");
    expect(suggest("deliver 12 sept")?.date).toBe("2026-09-12");
    expect(suggest("delivery on 12th of September please")?.date).toBe("2026-09-12");
    expect(suggest("September 12th if possible")?.date).toBe("2026-09-12");
  });

  it("reads UK numeric dates day-first", () => {
    expect(suggest("deliver 12/9 please")?.date).toBe("2026-09-12");
    expect(suggest("for 12/09/26")?.date).toBe("2026-09-12");
    expect(suggest("delivery 12.9.2026")?.date).toBe("2026-09-12");
  });

  it("reads ISO dates apps write into notes", () => {
    expect(suggest("Zapiet: delivery 2026-09-12")?.date).toBe("2026-09-12");
  });

  it("'tomorrow' is relative to when the note was written, not to processing day", () => {
    expect(suggest("deliver tomorrow please")?.date).toBe("2026-09-09");
    // Processed two days later: the written "tomorrow" is now in the past →
    // no suggestion rather than a wrong one.
    expect(suggest("deliver tomorrow please", "2026-09-05", "2026-09-08")).toBeNull();
  });

  it("reads 'the 12th' as the next 12th", () => {
    expect(suggest("okay for the 12th?")?.date).toBe("2026-09-12");
    // Already past this month's → next month's.
    expect(suggest("the 3rd works for us")?.date).toBe("2026-10-03");
  });

  it("a yearless date already behind the anchor rolls forward", () => {
    // "5/9" written on 8 Sept → 5 Sept next year… which is beyond the
    // 60-day window, so no suggestion — better than proposing last week.
    expect(suggest("deliver 5/9")).toBeNull();
  });

  it("street numbers and quantities do not become dates", () => {
    expect(suggest("Deliver to 12 High Street, use the side door")).toBeNull();
    expect(suggest("Please send 12 packs of the margherita")).toBeNull();
    expect(suggest("gate code 1234, ring bell 12")).toBeNull();
  });

  it("prices do not become dates", () => {
    expect(suggest("agreed at £12.99 a pack")).toBeNull();
  });

  it("phone numbers do not become dates", () => {
    expect(suggest("call 07123 456789 on arrival")).toBeNull();
  });

  it("rejects dates in the past or beyond the window", () => {
    expect(suggest("delivered 2026-09-01 last time")).toBeNull();
    expect(suggest("book us in for 2026-12-25")).toBeNull(); // > 60 days out
  });

  it("the first date mentioned wins", () => {
    expect(suggest("Deliver Friday — last order came Saturday")?.date).toBe("2026-09-11");
  });

  it("skips an implausible mention and takes a later plausible one", () => {
    // "31/2" is not a real date; the weekday after it still counts.
    expect(suggest("ref 31/2 — deliver thursday")?.date).toBe("2026-09-10");
  });

  it("reports the matched text so the UI can show why", () => {
    expect(suggest("Needed for the 12th September")?.matched).toBe("12th september");
  });
});
