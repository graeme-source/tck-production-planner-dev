import { describe, it, expect } from "vitest";
import {
  SEED_STAGES, SEED_CLASSIFICATIONS, type Stage, type Classification, type LetterTemplate, type LetterContext,
  templatesForEntry, letterMergeValues, fillTemplate, letterGaps, checkLetterAction, letterStatusLabel, letterWaitingEmail,
  COMPANION_RIGHT, FOUNDER_SIGNATURE_MARKER, hrEmailIdentity, checkHrEmailSettings,
} from "./index";

const stages: Stage[] = SEED_STAGES.map((s, i) => ({ ...s, id: i + 1 }));
const [, PLAN, VERBAL, FIRST, , DISMISSAL] = stages;
const classes: Classification[] = SEED_CLASSIFICATIONS.map((c, i) => ({ ...c, id: i + 1 }));
const cls = (l: string) => classes.find(c => c.label.startsWith(l))!.id;

const tpl = (id: number, over: Partial<LetterTemplate>): LetterTemplate => ({
  id, key: `t${id}`, title: `T${id}`, body: "", fieldSet: null, stageId: null, stageType: null, probationOutcome: null,
  requiresMeeting: false, requiresPay: false, sortOrder: id, active: true, ...over,
});
const templates = [
  tpl(1, { key: "invite", fieldSet: "stage", requiresMeeting: true }),
  tpl(2, { key: "verbal", fieldSet: "stage", stageId: VERBAL.id }),
  tpl(3, { key: "first", fieldSet: "stage", stageId: FIRST.id }),
  tpl(4, { key: "plan", fieldSet: "stage", stageType: "plan" }),
  tpl(5, { key: "dismissal", fieldSet: "stage", stageType: "outcome" }),
  tpl(6, { key: "probation_passed", fieldSet: "probation", probationOutcome: "passed" }),
  tpl(7, { key: "probation_extended", fieldSet: "probation", probationOutcome: "extended" }),
  tpl(8, { key: "pay", fieldSet: "pay", requiresPay: true }),
  tpl(9, { key: "general" }),
  tpl(10, { key: "retired", active: false }),
];
const keys = (e: Parameters<typeof templatesForEntry>[0]) => templatesForEntry(e, classes, stages, templates).map(t => t.key);
const facts = { stageId: null, probationOutcome: null, meetingDate: null, payTo: null };

describe("which letters are offered", () => {
  it("a verbal warning on attendance with a meeting: invite + verbal + general", () => {
    expect(keys({ ...facts, classificationId: cls("Attendance"), stageId: VERBAL.id, meetingDate: "2026-10-20" })).toEqual(["invite", "verbal", "general"]);
  });
  it("stage letters follow the stage", () => {
    expect(keys({ ...facts, classificationId: cls("Disciplinary"), stageId: FIRST.id })).toEqual(["first", "general"]);
    expect(keys({ ...facts, classificationId: cls("Timekeeping"), stageId: PLAN.id })).toEqual(["plan", "general"]);
    expect(keys({ ...facts, classificationId: cls("Disciplinary"), stageId: DISMISSAL.id })).toEqual(["dismissal", "general"]);
  });
  it("probation letters follow the probation outcome; the pay letter needs a new pay", () => {
    expect(keys({ ...facts, classificationId: cls("Probation"), probationOutcome: "extended" })).toEqual(["probation_extended", "general"]);
    expect(keys({ ...facts, classificationId: cls("Probation"), probationOutcome: "passed", payTo: "£12.50/hr" })).toEqual(["probation_passed", "pay", "general"]);
    expect(keys({ ...facts, classificationId: cls("Performance appraisal"), payTo: "  " })).toEqual(["general"]);
  });
  it("nothing stage-based once reclassified away from stages (values kept but hidden)", () => {
    expect(keys({ ...facts, classificationId: cls("Praise"), stageId: FIRST.id, meetingDate: "2026-10-20" })).toEqual(["general"]);
  });
});

const ctx: LetterContext = {
  todayIso: "2026-10-12", personName: "Test Person", classificationLabel: "Timekeeping",
  entry: {
    title: "Late six times since August", outcome: "Arrive by 7:00 every shift", stageLabel: "First written warning",
    warningExpiresOn: "2027-10-11", nextReviewDate: "2026-11-12", meetingType: "disciplinary", meetingDate: "2026-10-20",
    meetingTime: "10:30", payFrom: null, payTo: null, payEffectiveOn: null, probationOutcome: null, probationNewEnd: null,
  },
  signatoryName: "Graeme Carter", signatoryIsFounder: true,
};

describe("merge fields", () => {
  it("fills every field from the entry", () => {
    expect(letterMergeValues(ctx)).toMatchObject({
      date: "12 Oct 2026", firstName: "Test", fullName: "Test Person", reason: "Late six times since August",
      outcome: "Arrive by 7:00 every shift", stage: "first written warning", expiryDate: "11 Oct 2027", reviewDate: "12 Nov 2026",
      meetingType: "disciplinary hearing", meetingDate: "20 Oct 2026", meetingTime: "10:30", appealBy: "19 Oct 2026",
      companionRight: COMPANION_RIGHT, signatoryName: "Graeme Carter", signature: FOUNDER_SIGNATURE_MARKER,
    });
  });
  it("leaves visible gaps for missing values, unknown braces alone, no signature unless the founder signs", () => {
    const v = letterMergeValues({ ...ctx, signatoryIsFounder: false, signatoryName: "Lorna" });
    const r = fillTemplate("Dear {firstName}, pay {payFrom} to {payTo}. {notAField}\n{signature}\n{signatoryName}", v);
    expect(r.text).toBe("Dear Test, pay [payFrom] to [payTo]. {notAField}\n\nLorna");
    expect(r.gaps).toEqual(["payFrom", "payTo"]);
    expect(letterGaps(r.text)).toEqual(["payFrom", "payTo"]);
    expect(letterGaps("[not a merge field] fine")).toEqual([]);
  });
});

describe("who letter emails come from", () => {
  const FROM = "noreply@notify.thecalzonekitchen.co.uk";
  const FOUNDER = "graeme@thecalzonekitchen.co.uk";
  it("defaults: HR name, hr@ on the verified notify domain, replies to the founder", () => {
    expect(hrEmailIdentity({ fromName: null, fromLocal: null, replyTo: null }, FROM, FOUNDER)).toEqual({
      fromName: "The Calzone Kitchen HR", fromEmail: "hr@notify.thecalzonekitchen.co.uk", replyTo: FOUNDER,
      line: "From: The Calzone Kitchen HR <hr@notify.thecalzonekitchen.co.uk> · Replies go to: graeme@thecalzonekitchen.co.uk",
    });
  });
  it("only the part before the @ changes — never the verified domain", () => {
    const r = hrEmailIdentity({ fromName: "TCK People", fromLocal: "People.Team", replyTo: "lorna@example.com" }, FROM, FOUNDER);
    expect(r.fromEmail).toBe("people.team@notify.thecalzonekitchen.co.uk");
    expect(r.replyTo).toBe("lorna@example.com");
    expect(hrEmailIdentity({ fromName: null, fromLocal: "evil@other.com", replyTo: "not an email" }, FROM, FOUNDER))
      .toMatchObject({ fromEmail: "hr@notify.thecalzonekitchen.co.uk", replyTo: FOUNDER });
  });
  it("checks what's typed", () => {
    expect(checkHrEmailSettings({ fromLocal: "hr" })).toBeNull();
    expect(checkHrEmailSettings({ fromLocal: "hr@x.com" })).toMatch(/only use letters/);
    expect(checkHrEmailSettings({ replyTo: "nope" })).toMatch(/email address/);
    expect(checkHrEmailSettings({ replyTo: "" })).toBeNull();
    expect(checkHrEmailSettings({ fromName: "HR <x>" })).toMatch(/can't contain/);
  });
});

describe("send and acknowledge lifecycle", () => {
  const draft = { status: "draft" as const, acknowledgedAt: null };
  const filed = { status: "filed" as const, acknowledgedAt: null };
  const sent = { status: "sent" as const, acknowledgedAt: null };
  it("only a draft can be edited or filed", () => {
    expect(checkLetterAction(draft, "edit").ok).toBe(true);
    expect(checkLetterAction(filed, "edit").ok).toBe(false);
    expect(checkLetterAction(sent, "file").ok).toBe(false);
  });
  it("send once, from draft or filed", () => {
    expect(checkLetterAction(draft, "send").ok).toBe(true);
    expect(checkLetterAction(filed, "send").ok).toBe(true);
    expect(checkLetterAction(sent, "send").ok).toBe(false);
  });
  it("the employee can only read/acknowledge a sent letter, acknowledging once", () => {
    expect(checkLetterAction(filed, "read").ok).toBe(false);
    expect(checkLetterAction(sent, "acknowledge").ok).toBe(true);
    expect(checkLetterAction({ ...sent, acknowledgedAt: "2026-10-13" }, "acknowledge").ok).toBe(false);
  });
  it("says where it's at", () => {
    expect(letterStatusLabel({ status: "sent", sentAt: "2026-10-12T09:00:00Z", readAt: null, acknowledgedAt: null })).toBe("Sent 12 Oct 2026 — not opened yet");
    expect(letterStatusLabel({ status: "sent", sentAt: "x", readAt: "2026-10-13T09:00:00Z", acknowledgedAt: "2026-10-13T09:01:00Z" })).toBe("Read and acknowledged 13 Oct 2026");
  });
  it("the email only says a letter is waiting — no letter content", () => {
    const m = letterWaitingEmail("Test Person", "https://app.example/");
    expect(m.text).toContain("https://app.example/hub?section=documents");
    expect(`${m.subject} ${m.text}`).not.toMatch(/warning|disciplinary|dismiss/i);
  });
});
