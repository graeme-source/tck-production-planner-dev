import { describe, expect, it } from "vitest";
import {
  freshSubtasksFrom, isSameIdSet, lastRunLabel, moveId, openNowLabel, parentTickDecision, processRuns, progressLabel,
  resolveParentTick, snapshotFromMaster, sourceLabel, subtaskCountLabel, subtaskProgress,
  type MasterItem, type MasterSubtask, type ProcessCopy,
} from "./index";

const sub = (id: number, done = false) => ({ id, doneAt: done ? "2026-11-25T09:00:00.000Z" : null });

describe("progress", () => {
  it("counts ticked of all", () => {
    expect(subtaskProgress([sub(1, true), sub(2), sub(3, true)])).toEqual({ total: 3, done: 2, left: 1 });
    expect(subtaskProgress([])).toEqual({ total: 0, done: 0, left: 0 });
    expect(subtaskProgress(null)).toEqual({ total: 0, done: 0, left: 0 });
  });
  it("labels: '3 of 7', nothing when there are none", () => {
    expect(progressLabel({ total: 7, done: 3, left: 4 })).toBe("3 of 7");
    expect(progressLabel({ total: 0, done: 0, left: 0 })).toBe("");
    expect(subtaskCountLabel(7)).toBe("7 sub-tasks");
    expect(subtaskCountLabel(1)).toBe("1 sub-task");
    expect(subtaskCountLabel(0)).toBe("");
  });
});

describe("ticking the parent with sub-tasks left (never silently lose them)", () => {
  it("no sub-tasks, or all ticked: tick straight through", () => {
    expect(parentTickDecision([])).toEqual({ kind: "tick" });
    expect(parentTickDecision(undefined)).toEqual({ kind: "tick" });
    expect(parentTickDecision([sub(1, true), sub(2, true)])).toEqual({ kind: "tick" });
  });
  it("some left: ask, with how many", () => {
    const d = parentTickDecision([sub(1, true), sub(2), sub(3), sub(4), sub(5)]);
    expect(d).toMatchObject({ kind: "ask", left: 4, question: "Tick the 4 left as well?", tickAllLabel: "Yes — tick all 4 and finish", leaveLabel: "Finish, leave 4 unticked" });
    expect(parentTickDecision([sub(1)])).toMatchObject({ kind: "ask", left: 1, question: "Tick the 1 left as well?" });
  });
  it("server: refuses without a choice when some are unticked", () => {
    const r = resolveParentTick([sub(1, true), sub(2), sub(3)], undefined);
    expect(r).toEqual({ ok: false, left: 2, error: "2 sub-tasks are still unticked — choose whether to tick them as well" });
  });
  it("server: tick_all ticks exactly the unticked ones", () => {
    const r = resolveParentTick([sub(1, true), sub(2), sub(3)], "tick_all");
    expect(r).toEqual({ ok: true, tickSubtaskIds: [2, 3], timelineNote: "Ticked the last 2 sub-tasks along with it" });
  });
  it("server: leave ticks none and says so on the timeline", () => {
    const r = resolveParentTick([sub(1, true), sub(2), sub(3)], "leave");
    expect(r).toEqual({ ok: true, tickSubtaskIds: [], timelineNote: "Finished with 2 of 3 sub-tasks not ticked" });
  });
  it("server: nothing left — any choice is fine and nothing is noted", () => {
    expect(resolveParentTick([sub(1, true)], undefined)).toEqual({ ok: true, tickSubtaskIds: [], timelineNote: null });
    expect(resolveParentTick([], "leave")).toEqual({ ok: true, tickSubtaskIds: [], timelineNote: null });
  });
});

describe("Start now: the snapshot copy", () => {
  const master: MasterItem = { id: 42, title: "Ads checklist", notes: "Before any new ad goes live", url: "/ads", priority: 4, timeOfDay: null };
  const subs: MasterSubtask[] = [
    { id: 7, title: "Check the link", notes: null, url: null, sortOrder: 2 },
    { id: 3, title: "Spell-check the copy", notes: "Read it out loud", url: null, sortOrder: 1 },
    { id: 9, title: "Pixel firing", notes: null, url: "https://business.facebook.com", sortOrder: 2 },
  ];
  it("copies the master and every sub-task, in order, unticked, for today", () => {
    expect(snapshotFromMaster(master, subs, "2026-11-25")).toEqual({
      title: "Ads checklist",
      notes: "Before any new ad goes live",
      url: "/ads",
      priority: "normal",
      scheduledFor: "2026-11-25",
      dueDate: "2026-11-25",
      timeOfDay: null,
      recurrence: null,
      sourceTeamListItemId: 42,
      subtasks: [
        { title: "Spell-check the copy", notes: "Read it out loud", url: null, sortOrder: 1 },
        { title: "Check the link", notes: null, url: null, sortOrder: 2 },
        { title: "Pixel firing", notes: null, url: "https://business.facebook.com", sortOrder: 3 },
      ],
    });
  });
  it("maps P1–P4 to to-do priorities (P4 = no priority = normal)", () => {
    expect(snapshotFromMaster({ ...master, priority: 1 }, [], "2026-11-25").priority).toBe("urgent");
    expect(snapshotFromMaster({ ...master, priority: 2 }, [], "2026-11-25").priority).toBe("high");
    expect(snapshotFromMaster({ ...master, priority: 3 }, [], "2026-11-25").priority).toBe("normal");
  });
  it("is a snapshot: changing the master afterwards doesn't change the copy", () => {
    const m = { ...master };
    const s = subs.map(x => ({ ...x }));
    const copy = snapshotFromMaster(m, s, "2026-11-25");
    m.title = "Renamed";
    s[1].title = "Changed step";
    s.push({ id: 10, title: "New step", notes: null, url: null, sortOrder: 9 });
    expect(copy.title).toBe("Ads checklist");
    expect(copy.subtasks.map(x => x.title)).toEqual(["Spell-check the copy", "Check the link", "Pixel firing"]);
  });
  it("a repeating to-do's next one gets fresh, unticked sub-tasks in order", () => {
    expect(freshSubtasksFrom(subs).map(s => [s.title, s.sortOrder])).toEqual([["Spell-check the copy", 1], ["Check the link", 2], ["Pixel firing", 3]]);
  });
  it("source label", () => {
    expect(sourceLabel("Marketing", "Ads checklist")).toBe("From Marketing → Ads checklist");
    expect(sourceLabel("Marketing", null)).toBe("From the Marketing list");
    expect(sourceLabel(null, null)).toBe("From a team list");
  });
});

describe("last run (from the copies)", () => {
  const copy = (over: Partial<ProcessCopy>): ProcessCopy => ({
    assigneeId: 1, assigneeName: "Graeme Carter", status: "done", createdAt: "2026-11-20T09:00:00.000Z", completedAt: "2026-11-20T10:00:00.000Z", ...over,
  });
  it("never run", () => {
    const r = processRuns([], 1);
    expect(r).toEqual({ openCount: 0, openMine: 0, openNames: [], lastDone: null, doneCount: 0 });
    expect(lastRunLabel(r, "2026-11-25")).toBe("Not run yet");
    expect(openNowLabel(r)).toBe("");
  });
  it("the latest finished copy, and who has one open", () => {
    const r = processRuns([
      copy({ completedAt: "2026-11-20T10:00:00.000Z", assigneeName: "Lorna Smith", assigneeId: 2 }),
      copy({ completedAt: "2026-11-25T11:00:00.000Z" }),
      copy({ status: "open", completedAt: null, createdAt: "2026-11-25T12:00:00.000Z" }),
      copy({ status: "open", completedAt: null, assigneeId: 2, assigneeName: "Lorna Smith", createdAt: "2026-11-25T13:00:00.000Z" }),
      copy({ status: "open", completedAt: null, createdAt: "2026-11-25T14:00:00.000Z" }),
    ], 1);
    expect(r.openCount).toBe(3);
    expect(r.openMine).toBe(2);
    expect(r.openNames).toEqual(["Graeme", "Lorna"]);
    expect(r.doneCount).toBe(2);
    expect(r.lastDone).toEqual({ at: "2026-11-25T11:00:00.000Z", byName: "Graeme Carter" });
    expect(lastRunLabel(r, "2026-11-25")).toBe("Last run 25 Nov by Graeme");
    expect(openNowLabel(r)).toBe("Open now: Graeme, Lorna");
  });
  it("London date, and the year when it isn't this year", () => {
    const late = processRuns([copy({ completedAt: "2026-11-25T23:30:00.000Z" })], 1);
    expect(lastRunLabel(late, "2026-11-25")).toBe("Last run 25 Nov by Graeme"); // GMT in November
    const summer = processRuns([copy({ completedAt: "2026-07-01T23:30:00.000Z" })], 1);
    expect(lastRunLabel(summer, "2026-11-25")).toBe("Last run 2 Jul by Graeme"); // BST: already the 2nd
    const old = processRuns([copy({ completedAt: "2025-12-01T10:00:00.000Z" })], 1);
    expect(lastRunLabel(old, "2026-11-25")).toBe("Last run 1 Dec 2025 by Graeme");
  });
});

describe("ordering", () => {
  it("moves one id up or down, never off the ends", () => {
    expect(moveId([1, 2, 3], 2, -1)).toEqual([2, 1, 3]);
    expect(moveId([1, 2, 3], 2, 1)).toEqual([1, 3, 2]);
    expect(moveId([1, 2, 3], 1, -1)).toEqual([1, 2, 3]);
    expect(moveId([1, 2, 3], 3, 1)).toEqual([1, 2, 3]);
    expect(moveId([1, 2, 3], 9, 1)).toEqual([1, 2, 3]);
  });
  it("a reorder must be the same ids, no more, no fewer, no repeats", () => {
    expect(isSameIdSet([1, 2, 3], [3, 1, 2])).toBe(true);
    expect(isSameIdSet([1, 2, 3], [1, 2])).toBe(false);
    expect(isSameIdSet([1, 2, 3], [1, 2, 2])).toBe(false);
    expect(isSameIdSet([1, 2, 3], [1, 2, 4])).toBe(false);
  });
});
