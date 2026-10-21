import { describe, expect, it } from "vitest";
import { boardPlace, checkinDay, isCheckinDue, nudgeLine, promptsForDay, PROMPTS_PER_DAY } from "./daily-checkin";
import { LMS_EIGHT_WASTES } from "./lean-corpus";

describe("checkinDay — the London calendar day", () => {
  it("rolls over at UK midnight in BST, not at UTC midnight", () => {
    // 22:59 UTC on 21 Oct = 23:59 BST, still the 21st in London.
    expect(checkinDay(new Date("2026-10-21T22:59:00Z"))).toBe("2026-10-21");
    // 23:00 UTC = 00:00 BST on the 22nd.
    expect(checkinDay(new Date("2026-10-21T23:00:00Z"))).toBe("2026-10-22");
  });

  it("rolls over at UTC midnight in GMT", () => {
    expect(checkinDay(new Date("2026-11-02T23:59:00Z"))).toBe("2026-11-02");
    expect(checkinDay(new Date("2026-11-03T00:00:00Z"))).toBe("2026-11-03");
  });

  it("treats the clocks-go-back night (25 Oct 2026) as one day", () => {
    // 00:30 BST and 01:30 GMT on 25 Oct are both the 25th.
    expect(checkinDay(new Date("2026-10-24T23:30:00Z"))).toBe("2026-10-25");
    expect(checkinDay(new Date("2026-10-25T01:30:00Z"))).toBe("2026-10-25");
  });

  it("treats the clocks-go-forward night (29 Mar 2026) as one day", () => {
    expect(checkinDay(new Date("2026-03-28T23:59:00Z"))).toBe("2026-03-28");
    expect(checkinDay(new Date("2026-03-29T00:30:00Z"))).toBe("2026-03-29");
    expect(checkinDay(new Date("2026-03-29T22:59:00Z"))).toBe("2026-03-29");
    expect(checkinDay(new Date("2026-03-29T23:00:00Z"))).toBe("2026-03-30");
  });
});

describe("isCheckinDue", () => {
  it("is due when they've never acknowledged", () => {
    expect(isCheckinDue(null, "2026-10-21")).toBe(true);
    expect(isCheckinDue(undefined, "2026-10-21")).toBe(true);
  });

  it("is not due again the same London day", () => {
    expect(isCheckinDue("2026-10-21", "2026-10-21")).toBe(false);
  });

  it("is due again the next London day", () => {
    expect(isCheckinDue("2026-10-21", "2026-10-22")).toBe(true);
  });

  it("an acknowledgement at 23:30 BST doesn't cover 00:10 BST the next morning", () => {
    const ackDay = checkinDay(new Date("2026-10-21T22:30:00Z")); // 23:30 BST on the 21st
    const later = checkinDay(new Date("2026-10-21T23:10:00Z")); // 00:10 BST on the 22nd
    expect(isCheckinDue(ackDay, later)).toBe(true);
  });

  it("an acknowledgement at 00:30 BST covers the rest of that day", () => {
    const ackDay = checkinDay(new Date("2026-10-20T23:30:00Z")); // 00:30 BST on the 21st
    const later = checkinDay(new Date("2026-10-21T21:00:00Z")); // 22:00 BST on the 21st
    expect(isCheckinDue(ackDay, later)).toBe(false);
  });

  it("accepts a timestamp-ish day string from the database", () => {
    expect(isCheckinDue("2026-10-21T00:00:00.000Z", "2026-10-21")).toBe(false);
  });

  it("is decided per person: one person's acknowledgement on a shared iPad doesn't clear the next", () => {
    // The status is looked up for whoever the session now belongs to, so
    // after a PIN switch it's the new person's own day that counts.
    const acks = new Map<number, string>([[7, "2026-10-21"]]);
    expect(isCheckinDue(acks.get(7), "2026-10-21")).toBe(false);
    expect(isCheckinDue(acks.get(9), "2026-10-21")).toBe(true);
  });
});

describe("promptsForDay — the 'find one' examples", () => {
  it("gives three different wastes from the Lean Made Simple list", () => {
    const p = promptsForDay(7, "2026-10-21");
    expect(p).toHaveLength(PROMPTS_PER_DAY);
    expect(new Set(p.map(x => x.waste)).size).toBe(PROMPTS_PER_DAY);
    const names = LMS_EIGHT_WASTES.map(w => w.name);
    for (const x of p) expect(names).toContain(x.waste);
  });

  it("is the same all day for one person", () => {
    expect(promptsForDay(7, "2026-10-21")).toEqual(promptsForDay(7, "2026-10-21"));
  });

  it("rotates across the week", () => {
    const days = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"];
    const firsts = new Set(days.map(d => promptsForDay(7, d)[0].waste));
    expect(firsts.size).toBeGreaterThan(2);
  });

  it("copes with a short list", () => {
    const two = LMS_EIGHT_WASTES.slice(0, 2);
    expect(promptsForDay(1, "2026-10-21", 3, two)).toHaveLength(2);
    expect(promptsForDay(1, "2026-10-21", 3, [])).toEqual([]);
  });
});

describe("nudgeLine", () => {
  it("comes from the corpus", () => {
    expect(nudgeLine()?.term).toBe("Leave it better than you found it");
  });
});

describe("boardPlace", () => {
  const ranked = [
    { userId: 1, credits30: 9 },
    { userId: 2, credits30: 5 },
    { userId: 3, credits30: 5 },
    { userId: 4, credits30: 0 },
  ];

  it("places them in the board's order, of everyone with credits this month", () => {
    expect(boardPlace(ranked, 1)).toEqual({ place: 1, of: 3 });
  });

  it("level credits share the higher place", () => {
    expect(boardPlace(ranked, 3)).toEqual({ place: 2, of: 3 });
  });

  it("says nothing when they have no credits this month, or aren't on the board", () => {
    expect(boardPlace(ranked, 4)).toBeNull();
    expect(boardPlace(ranked, 99)).toBeNull();
  });
});
