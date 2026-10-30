import { describe, expect, it } from "vitest";
import {
  whatHappened, whatHappenedText, meetingWrittenUp, meetingNotesRows, actionTodos, tickedActionTodos, recordTodo,
  SUMMARY_TITLE, ACTIONS_TITLE, defaultMeetingClassification, heldByNotes, linkOnly, linkPastedMessage, isWisprFlowLink, cleanSourceLink,
  WISPR_LOGIN_MESSAGE, LINK_ONLY_MESSAGE, AGREEMENT_TITLE, meetingNotesSaveParts, type MeetingNotesDraft,
} from "./index";

describe("one write-up per meeting", () => {
  const note = (id: number, kind: string, body: string, title: string | null = null) => ({ id, kind, title, body });

  it("shows the entry's own notes first, then the write-up, losing nothing", () => {
    const w = whatHappened({ notes: "Typed at booking", writeUp: [note(1, "feedback", "Going well"), note(2, "objective", "Hours", "Return")] });
    expect(w.recordNotes).toBe("Typed at booking");
    expect(w.parts.map(p => p.id)).toEqual([1, 2]);
    expect(w.hasContent).toBe(true);
  });
  it("blank notes are no content", () => {
    expect(whatHappened({ notes: "  ", writeUp: [] })).toEqual({ recordNotes: null, parts: [], hasContent: false });
  });
  it("everything already written goes to the AI as one text, notes first", () => {
    const t = whatHappenedText({ notes: "Mine", writeUp: [note(1, "objective", "Back 3 days a week", "Return to work")] });
    expect(t).toBe("Mine\n\nObjective: Return to work\nBack 3 days a week");
  });
  it("notes typed in the entry count as written up — never asked twice", () => {
    const base = { meetingStatus: "held" as const, outcome: null, status: "closed", writeUpCount: 0 };
    expect(meetingWrittenUp({ ...base, notes: "We talked about leave dates" })).toBe(true);
    expect(meetingWrittenUp({ ...base, notes: "   " })).toBe(false);
  });
});

describe("notes are pasted, links are only kept for reference", () => {
  it("spots a pasted link that is all there is", () => {
    expect(linkOnly("  https://notes.wisprflow.ai/shared/abc123 ")).toBe("https://notes.wisprflow.ai/shared/abc123");
    expect(linkOnly("We met. See https://notes.wisprflow.ai/shared/abc123")).toBeNull();
    expect(linkOnly("Notes from the meeting")).toBeNull();
    expect(linkOnly("")).toBeNull();
  });
  it("a Wispr Flow link says it needs a login; any other link says paste the notes", () => {
    expect(linkPastedMessage("https://notes.wisprflow.ai/shared/abc")).toBe(WISPR_LOGIN_MESSAGE);
    expect(linkPastedMessage("https://example.com/notes")).toBe(LINK_ONLY_MESSAGE);
    expect(isWisprFlowLink("https://notes.wisprflow.ai.example.com/x")).toBe(false);
  });
  it("keeps only a real web link as the source reference", () => {
    expect(cleanSourceLink(" https://notes.wisprflow.ai/shared/abc ")).toBe("https://notes.wisprflow.ai/shared/abc");
    expect(cleanSourceLink("javascript:alert(1)")).toBeNull();
    expect(cleanSourceLink("not a link")).toBeNull();
    expect(cleanSourceLink("")).toBeNull();
  });
});

describe("notes mark a meeting held", () => {
  const booked = { meetingStatus: "booked" as const, meetingDate: "2026-10-12", entryDate: "2026-10-12" };
  it("on or after its day", () => {
    expect(heldByNotes(booked, "We met", "2026-10-12")).toBe(true);
    expect(heldByNotes(booked, "We met", "2026-10-20")).toBe(true);
  });
  it("not before its day — that's prep", () => expect(heldByNotes(booked, "Agenda", "2026-10-11")).toBe(false));
  it("not for empty notes, or a meeting already held or cancelled", () => {
    expect(heldByNotes(booked, "  ", "2026-10-12")).toBe(false);
    expect(heldByNotes({ ...booked, meetingStatus: "cancelled" }, "x", "2026-10-12")).toBe(false);
    expect(heldByNotes({ ...booked, meetingStatus: "held" }, "x", "2026-10-12")).toBe(false);
  });
});

describe("what a scheduled meeting starts as", () => {
  const c = (id: number, sortOrder: number, extra: Partial<{ active: boolean; defaultForMeetings: boolean }> = {}) =>
    ({ id, sortOrder, label: `C${id}`, active: true, ...extra });
  it("the flagged one", () => expect(defaultMeetingClassification([c(1, 10), c(2, 20, { defaultForMeetings: true })])?.id).toBe(2));
  it("never a switched-off one", () => expect(defaultMeetingClassification([c(1, 10), c(2, 5, { defaultForMeetings: true, active: false })])?.id).toBe(1));
  it("else the first in the list's order", () => expect(defaultMeetingClassification([c(1, 30), c(2, 20)])?.id).toBe(2));
  it("none when the list is empty", () => expect(defaultMeetingClassification([])).toBeNull());
});

describe("saving an AI draft", () => {
  const draft: MeetingNotesDraft = {
    title: "Maternity review meeting",
    summary: "  Talked through leave and return.  ",
    agreements: [
      "Back on 4 May 2027, 24 hours a week",
      "Two keeping-in-touch days",
      "  ",
    ],
    objectives: [
      { title: "Wrapping speed", detail: "240 packs an hour", date: "2027-01-01" },
      { title: " ", detail: "", date: null },
    ],
    actions: [
      { what: "Send the leave letter", owner: "me", ownerName: null, date: "2026-10-19" },
      { what: "Confirm the dates", owner: "colleague", ownerName: null, date: null },
      { what: "Update the rota", owner: "other", ownerName: "Sam", date: null },
      { what: "  ", owner: "me", ownerName: null, date: null },
    ],
    classificationId: null,
  };

  it("summary, then ONE agreed list, then real objectives, then the actions as one note", () => {
    const rows = meetingNotesRows(draft, { me: "Alex", colleague: "Jo" });
    expect(rows).toEqual([
      { kind: "note", title: SUMMARY_TITLE, body: "Talked through leave and return.", dueDate: null },
      { kind: "agreement", title: AGREEMENT_TITLE, body: "• Back on 4 May 2027, 24 hours a week\n• Two keeping-in-touch days", dueDate: null },
      { kind: "objective", title: "Wrapping speed", body: "240 packs an hour", dueDate: "2027-01-01" },
      { kind: "note", title: ACTIONS_TITLE, body: "• Send the leave letter — Alex (by 19 Oct 2026)\n• Confirm the dates — Jo\n• Update the rota — Sam", dueDate: null },
    ]);
  });
  it("agreed points never become objectives", () => {
    const rows = meetingNotesRows({ summary: "", agreements: ["A", "B", "C"], objectives: [], actions: [] }, { me: "A", colleague: "B" });
    expect(rows.filter(r => r.kind === "objective")).toEqual([]);
    expect(rows.filter(r => r.kind === "agreement")).toHaveLength(1);
  });
  it("what the checked draft sends: trimmed bullets, filled-in objectives only", () => {
    expect(meetingNotesSaveParts({
      agreements: ["  Back  on 4 May ", "", "  "],
      objectives: [{ title: " Speed ", detail: " ", date: "" }, { title: "", detail: null, date: null }],
    })).toEqual({ agreements: ["Back on 4 May"], objectives: [{ title: "Speed", detail: null, date: null }] });
  });
  it("an empty draft saves nothing", () => {
    expect(meetingNotesRows({ summary: "", agreements: [], actions: [] }, { me: "A", colleague: "B" })).toEqual([]);
  });
  it("only my own actions become to-dos; no date sits a week out", () => {
    expect(actionTodos(draft.actions, "2026-10-12")).toEqual([{ date: "2026-10-19" }]);
    expect(actionTodos([{ what: "Book a room", owner: "me", ownerName: null, date: null }], "2026-12-28")).toEqual([{ date: "2027-01-04" }]);
  });
  it("no to-do unless ticked — 'HR action due' kept appearing for meetings already done (30 Oct 2026)", () => {
    const mine = { what: "Send the letter", owner: "me" as const, ownerName: null, date: "2026-11-05" };
    expect(tickedActionTodos([mine], "2026-10-30")).toEqual([]);
    expect(tickedActionTodos([{ ...mine, todo: false }], "2026-10-30")).toEqual([]);
    expect(tickedActionTodos([{ ...mine, todo: true }], "2026-10-30")).toEqual([{ date: "2026-11-05" }]);
    expect(tickedActionTodos([{ ...mine, owner: "colleague" as const, todo: true }], "2026-10-30")).toEqual([]);
  });
  it("an action to-do is generic — no name, no subject", () => {
    const t = recordTodo({ kind: "action", ownerId: 3, ownerName: "Test Owner", subjectUserId: 41, subjectName: "Test Person", entryId: 9, date: "2026-10-19" });
    expect(t.title).toBe("HR action due — tap here");
    expect(`${t.title} ${t.notes}`).not.toMatch(/Test|Person|Owner|maternity|leave/i);
    expect(t.url).toBe("/people/41?entry=9");
  });
});
