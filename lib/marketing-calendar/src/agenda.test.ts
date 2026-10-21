import { describe, expect, it } from "vitest";
import { agendaRange, buildAgenda, draftsOpen, sortDrafts, type AgendaRow } from "./agenda";
import { emailRowStatus, rowWantsApproval } from "./email-approvals";

type P = { id: number; startDate: string; endDate: string; title: string };
type E = { id: string; date: string | null; sendAt: string | null };
type Row = AgendaRow<P, E>;

const TODAY = "2026-10-21"; // Wednesday

function compact(rows: Row[]): string[] {
  return rows.map(r => {
    switch (r.kind) {
      case "week": return `W ${r.weekStart}${r.current ? " *" : ""}`;
      case "quiet": return `q ${r.from}..${r.to} [${r.phases.map(p => p.phase.id).join(",")}]`;
      case "day": return `${r.isToday ? "TODAY" : "d"} ${r.date} [${r.phases.map(p => p.phase.id).join(",")}] ${r.emails.map(e => e.id).join(",")}`
        + (r.starts.length ? ` +${r.starts.map(p => p.id).join(",")}` : "")
        + (r.ends.length ? ` -${r.ends.map(p => p.id).join(",")}` : "");
    }
  });
}

describe("agendaRange", () => {
  it("runs from 2 whole weeks back to 10 whole weeks ahead, Monday to Sunday", () => {
    expect(agendaRange(TODAY)).toEqual({ from: "2026-10-05", to: "2027-01-03" });
    expect(agendaRange(TODAY, 0, 0)).toEqual({ from: "2026-10-19", to: "2026-10-25" });
  });
});

describe("buildAgenda", () => {
  it("one continuous week: quiet runs, emails on their day, one Today row", () => {
    const { rows, laneCount } = buildAgenda<P, E>({
      from: "2026-10-19", to: "2026-10-25", today: TODAY, phases: [],
      emails: [
        { id: "late", date: "2026-10-23", sendAt: "2026-10-23T17:00:00Z" },
        { id: "early", date: "2026-10-23", sendAt: "2026-10-23T08:00:00Z" },
        { id: "outside", date: "2026-11-30", sendAt: null },
        { id: "undated", date: null, sendAt: null },
      ],
    });
    expect(laneCount).toBe(0);
    expect(compact(rows)).toEqual([
      "W 2026-10-19 *",
      "q 2026-10-19..2026-10-20 []",
      "TODAY 2026-10-21 [] ",
      "q 2026-10-22..2026-10-22 []",
      "d 2026-10-23 [] early,late",
      "q 2026-10-24..2026-10-25 []",
    ]);
  });

  it("today is ONE row carrying today's emails and phases — never a separate marker plus a day row (Graeme, 21 Oct)", () => {
    const halloween: P = { id: 1, startDate: "2026-10-21", endDate: "2026-10-31", title: "Halloween" };
    const { rows } = buildAgenda<P, E>({
      from: "2026-10-19", to: "2026-10-25", today: TODAY, phases: [halloween],
      emails: [{ id: "today-email", date: TODAY, sendAt: "2026-10-21T10:00:00Z" }],
    });
    const todays = rows.filter(r => r.kind === "day" && r.isToday);
    expect(todays).toHaveLength(1);
    expect(rows.filter(r => r.kind === "day" && r.date === TODAY)).toHaveLength(1);
    expect(compact(rows)).toContain("TODAY 2026-10-21 [1] today-email +1");
    // The day before today is quiet, not a "nothing sending today" row.
    expect(compact(rows)).toContain("q 2026-10-19..2026-10-20 []");
  });

  it("phases: start and end rows, a stripe on every day they cover, quiet runs split when the phases change", () => {
    const halloween: P = { id: 1, startDate: "2026-10-26", endDate: "2026-10-31", title: "Halloween Week" };
    const bonfire: P = { id: 2, startDate: "2026-10-29", endDate: "2026-11-05", title: "Bonfire" };
    const { rows, laneCount } = buildAgenda<P, E>({
      from: "2026-10-26", to: "2026-11-08", today: TODAY, phases: [bonfire, halloween],
      emails: [{ id: "e1", date: "2026-10-30", sendAt: null }],
    });
    expect(laneCount).toBe(2);
    expect(compact(rows)).toEqual([
      "W 2026-10-26",
      // today is before the range: no Today row at all
      "d 2026-10-26 [1]  +1",
      "q 2026-10-27..2026-10-28 [1]",
      "d 2026-10-29 [1,2]  +2",
      "d 2026-10-30 [1,2] e1",
      "d 2026-10-31 [1,2]  -1",
      "q 2026-11-01..2026-11-01 [2]",
      "W 2026-11-02",
      "q 2026-11-02..2026-11-04 [2]",
      "d 2026-11-05 [2]  -2",
      "q 2026-11-06..2026-11-08 []",
    ]);
    // Halloween keeps lane 0 on every row, Bonfire lane 1.
    const day30 = rows.find(r => r.kind === "day" && r.date === "2026-10-30") as Extract<Row, { kind: "day" }>;
    expect(day30.phases.map(p => [p.phase.id, p.lane])).toEqual([[1, 0], [2, 1]]);
  });

  it("a phase that started before the range shows its stripe but no start row", () => {
    const long: P = { id: 9, startDate: "2026-09-01", endDate: "2026-10-20", title: "Autumn" };
    const { rows } = buildAgenda<P, E>({ from: "2026-10-19", to: "2026-10-21", today: TODAY, phases: [long], emails: [] });
    expect(compact(rows)).toEqual([
      "W 2026-10-19 *",
      "q 2026-10-19..2026-10-19 [9]",
      "d 2026-10-20 [9]  -9",
      "TODAY 2026-10-21 [] ",
    ]);
  });

  it("a quiet run never straddles today", () => {
    const { rows } = buildAgenda<P, E>({ from: "2026-10-19", to: "2026-10-25", today: "2026-10-25", phases: [], emails: [] });
    expect(compact(rows)).toEqual(["W 2026-10-19 *", "q 2026-10-19..2026-10-24 []", "TODAY 2026-10-25 [] "]);
  });

  it("past rows are marked past; today and later are not", () => {
    const { rows } = buildAgenda<P, E>({
      from: "2026-10-19", to: "2026-10-23", today: TODAY, phases: [],
      emails: [{ id: "a", date: "2026-10-20", sendAt: null }, { id: "b", date: "2026-10-22", sendAt: null }],
    });
    const days = rows.filter(r => r.kind === "day") as Extract<Row, { kind: "day" }>[];
    expect(days.map(d => [d.date, d.isPast, d.isToday])).toEqual([
      ["2026-10-20", true, false], ["2026-10-21", false, true], ["2026-10-22", false, false],
    ]);
  });

  it("each dated email appears exactly once, and undated drafts never appear in the rows", () => {
    const emails: E[] = Array.from({ length: 12 }, (_, i) => ({ id: `e${i}`, date: `2026-10-${String(10 + i).padStart(2, "0")}`, sendAt: null }));
    const { rows } = buildAgenda<P, E>({ ...agendaRange(TODAY), today: TODAY, phases: [], emails: [...emails, { id: "u", date: null, sendAt: null }] });
    const seen = rows.flatMap(r => (r.kind === "day" ? r.emails : [])).map(e => e.id);
    expect(seen.sort()).toEqual(emails.map(e => e.id).sort());
    expect(rows.filter(r => r.kind === "day" && r.isToday)).toHaveLength(1);
  });

  it("an upside-down range is empty", () => {
    expect(buildAgenda<P, E>({ from: "2026-10-22", to: "2026-10-21", today: TODAY, phases: [], emails: [] }).rows).toEqual([]);
  });
});

describe("Drafts section", () => {
  it("sorts drafts stably: any with a time first, then by id", () => {
    const out = sortDrafts<E>([
      { id: "b", date: null, sendAt: null },
      { id: "a", date: null, sendAt: null },
      { id: "z", date: null, sendAt: "2026-11-01T09:00:00Z" },
    ]);
    expect(out.map(e => e.id)).toEqual(["z", "a", "b"]);
  });

  it("opens by default only when a draft needs approval; this device's own choice wins", () => {
    expect(draftsOpen(null, true)).toBe(true);
    expect(draftsOpen(null, false)).toBe(false);
    expect(draftsOpen(undefined, false)).toBe(false);
    expect(draftsOpen("closed", true)).toBe(false);
    expect(draftsOpen("open", false)).toBe(true);
    expect(draftsOpen("rubbish", true)).toBe(true);
  });
});

describe("emailRowStatus", () => {
  const e = (status: string, approval: "approved" | "needs_approval", changed: string[] = []) =>
    emailRowStatus({ status, approval: { status: approval, changed } });
  it("names each state", () => {
    expect(e("Sent", "approved")).toBe("sent");
    expect(e("Sending", "needs_approval")).toBe("sent_unapproved");
    expect(e("Scheduled", "approved")).toBe("approved");
    expect(e("Draft", "needs_approval", ["subject line"])).toBe("changed");
    expect(e("Draft", "needs_approval")).toBe("needs_approval");
  });
  it("only unsent, unapproved emails offer Approve", () => {
    expect(rowWantsApproval("needs_approval")).toBe(true);
    expect(rowWantsApproval("changed")).toBe(true);
    expect(rowWantsApproval("approved")).toBe(false);
    expect(rowWantsApproval("sent_unapproved")).toBe(false);
  });
});
