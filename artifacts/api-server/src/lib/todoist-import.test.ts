import { describe, expect, it } from "vitest";
import { parseCsv, parseTodoistRecurrence, parseTodoistTemplate } from "./todoist-import";

const TODAY = "2026-10-13"; // Tuesday

describe("parseCsv", () => {
  it("handles quotes, commas inside quotes, doubled quotes and CRLF", () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\r\n')).toEqual([["a", "b, c", 'say "hi"'], ["1", "2", "3"]]);
  });
  it("keeps newlines inside quoted fields and drops blank lines", () => {
    expect(parseCsv('x,"line1\nline2"\n\n')).toEqual([["x", "line1\nline2"]]);
  });
});

describe("parseTodoistRecurrence", () => {
  const p = (s: string) => parseTodoistRecurrence(s, TODAY);
  it("every day / daily", () => {
    expect(p("every day")?.rule).toEqual({ kind: "daily" });
    expect(p("Daily")?.rule).toEqual({ kind: "daily" });
    expect(p("ev day")?.rule).toEqual({ kind: "daily" });
  });
  it("every weekday / workday", () => {
    expect(p("every weekday")?.rule).toEqual({ kind: "weekdays" });
    expect(p("every workday")?.rule).toEqual({ kind: "weekdays" });
  });
  it("single and several weekdays", () => {
    expect(p("every tue")?.rule).toEqual({ kind: "weekly", days: [2] });
    expect(p("every Tuesday")?.rule).toEqual({ kind: "weekly", days: [2] });
    expect(p("every mon, thu")?.rule).toEqual({ kind: "weekly", days: [1, 4] });
    expect(p("every monday and thursday")?.rule).toEqual({ kind: "weekly", days: [1, 4] });
    expect(p("every week on fri")?.rule).toEqual({ kind: "weekly", days: [5] });
    expect(p("every thurs")?.rule).toEqual({ kind: "weekly", days: [4] });
  });
  it("every other / every N weeks, anchored on the first one from today", () => {
    expect(p("every other fri")?.rule).toEqual({ kind: "weekly", days: [5], interval: 2, anchor: "2026-10-16" });
    expect(p("every 2 weeks on mon")?.rule).toEqual({ kind: "weekly", days: [1], interval: 2, anchor: "2026-10-19" });
  });
  it("monthly", () => {
    expect(p("every month on the 15th")?.rule).toEqual({ kind: "monthly", dayOfMonth: 15 });
    expect(p("every 1st")?.rule).toEqual({ kind: "monthly", dayOfMonth: 1 });
    expect(p("monthly on 28")?.rule).toEqual({ kind: "monthly", dayOfMonth: 28 });
  });
  it("pulls out a time", () => {
    expect(p("every tue at 9am")).toEqual({ rule: { kind: "weekly", days: [2] }, time: "09:00" });
    expect(p("every day at 14:30")).toEqual({ rule: { kind: "daily" }, time: "14:30" });
    expect(p("every weekday 4pm")).toEqual({ rule: { kind: "weekdays" }, time: "16:00" });
    expect(p("every mon at 12am")?.time).toBe("00:00");
  });
  it("ignores 'starting …'", () => {
    expect(p("every thu starting 1 nov")?.rule).toEqual({ kind: "weekly", days: [4] });
  });
  it("returns null for anything it doesn't know", () => {
    expect(p("every 3 days")).toBeNull();
    expect(p("every month")).toBeNull();
    expect(p("tomorrow")).toBeNull();
    expect(p("every last fri")).toBeNull();
  });
});

describe("parseTodoistTemplate", () => {
  const csv = [
    "TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE",
    "meta,view_style=list,,,,,,,,",
    "section,Morning,,,,,,,,",
    'task,Collect the Kanban cards,From every station,4,1,Graeme (1),,every weekday at 7am,en,Europe/London',
    "note,Bring them to the desk,,,,,,,,",
    "task,Order from the supplier,,2,1,Graeme (1),,every tue,en,Europe/London",
    "task,Odd one,,1,1,Graeme (1),,every last fri,en,Europe/London",
    "task,No date,,1,1,Graeme (1),,,en,Europe/London",
  ].join("\n");

  it("imports tasks, flips Todoist's priority, attaches notes, skips sections", () => {
    const { items, skipped, error } = parseTodoistTemplate(csv, TODAY);
    expect(error).toBeNull();
    expect(skipped).toBe(2);
    expect(items.map(i => [i.title, i.priority])).toEqual([
      ["Collect the Kanban cards", 1], ["Order from the supplier", 3], ["Odd one", 4], ["No date", 4],
    ]);
    expect(items[0]).toMatchObject({ recurrence: { kind: "weekdays" }, timeOfDay: "07:00", notes: "From every station\nBring them to the desk", warning: null });
    expect(items[1].recurrence).toEqual({ kind: "weekly", days: [2] });
  });

  it("imports unknown phrases as every day, with a warning", () => {
    const { items } = parseTodoistTemplate(csv, TODAY);
    expect(items[2].recurrence).toEqual({ kind: "daily" });
    expect(items[2].warning).toContain("every last fri");
    expect(items[3].warning).toContain("No date");
  });

  it("refuses a file that isn't a Todoist template", () => {
    expect(parseTodoistTemplate("name,qty\nflour,2", TODAY).error).toMatch(/Todoist/);
  });
});
