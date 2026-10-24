import { describe, it, expect } from "vitest";
import { parseSmartAdd, extractMentions } from "./smart-add";

const TODAY = "2026-10-24"; // a Saturday
const PEOPLE = [
  { id: 1, name: "Jane Miles" },
  { id: 2, name: "Jane Doe" },
  { id: 3, name: "Lorna Smith" },
];

describe("@mentions", () => {
  it("full name wins over a shared first name", () => {
    const r = extractMentions("check fridge seals @Jane Miles p1", PEOPLE);
    expect(r.mentions.map(m => m.id)).toEqual([1]);
    expect(r.rest).toBe("check fridge seals p1");
  });
  it("a unique first name is enough, a shared one is not", () => {
    expect(extractMentions("@lorna order gloves", PEOPLE).mentions.map(m => m.id)).toEqual([3]);
    const shared = extractMentions("@jane order gloves", PEOPLE);
    expect(shared.mentions).toEqual([]);
    expect(shared.unknown).toEqual(["jane"]);
  });
});

describe("parseSmartAdd", () => {
  it("repeat, priority and person together", () => {
    expect(parseSmartAdd("Clean packing computer every Thursday p2 @Lorna", TODAY, PEOPLE)).toMatchObject({
      title: "Clean packing computer", priority: 2, rule: { kind: "weekly", days: [4] }, mentions: [{ id: 3 }], date: null,
    });
  });
  it("next monday is a do-on date", () => {
    expect(parseSmartAdd("Ring the butcher next monday", TODAY)).toMatchObject({ title: "Ring the butcher", date: "2026-10-26", dateKind: "on" });
  });
  it("by friday is a deadline", () => {
    expect(parseSmartAdd("Send VAT figures by friday p1", TODAY)).toMatchObject({ title: "Send VAT figures", date: "2026-10-30", dateKind: "by", priority: 1 });
  });
  it("tomorrow, 3 nov, in 3 days", () => {
    expect(parseSmartAdd("defrost chicken tomorrow", TODAY).date).toBe("2026-10-25");
    expect(parseSmartAdd("book oven service on 3 nov", TODAY).date).toBe("2026-11-03");
    expect(parseSmartAdd("chase invoice in 3 days", TODAY).date).toBe("2026-10-27");
  });
  it("a weekday that starts the title stays in the title", () => {
    expect(parseSmartAdd("Monday deep clean of the walk-in", TODAY)).toMatchObject({ title: "Monday deep clean of the walk-in", date: null });
    expect(parseSmartAdd("deep clean the walk-in monday", TODAY)).toMatchObject({ title: "deep clean the walk-in", date: "2026-10-26" });
  });
  it("a repeat in the middle keeps the words after it", () => {
    expect(parseSmartAdd("clean packing computer every thursday cleaning check", TODAY)).toMatchObject({
      title: "clean packing computer cleaning check", rule: { kind: "weekly", days: [4] },
    });
  });
  it("every thursday is a repeat, not a date", () => {
    const r = parseSmartAdd("clean packing computer every thursday", TODAY);
    expect(r.rule).toEqual({ kind: "weekly", days: [4] });
    expect(r.date).toBeNull();
  });
});
