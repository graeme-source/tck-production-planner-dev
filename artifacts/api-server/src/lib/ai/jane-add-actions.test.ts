import { describe, expect, it } from "vitest";
import {
  DRAFT_NEW_ITEM, JANE_ADD_DESTINATIONS, JANE_ADD_GUIDE, JANE_ADD_KINDS, OPEN_ADD_FORM,
  draftResult, janeAddKindsFor, janeAddTools, openFormResult, parseDraft, parseOpenForm,
} from "./jane-add-actions";

const ALL = [...JANE_ADD_KINDS];
const TODAY = "2026-11-27";

const NO_RECEIPT = ALL.filter(k => k !== "receipt");

describe("janeAddKindsFor", () => {
  it("gives everyone every Quick action, receipts only with the grant", () => {
    expect(janeAddKindsFor({ role: "viewer", isBookkeeper: false, canAddReceipt: false })).toEqual(NO_RECEIPT);
    expect(janeAddKindsFor({ role: "manager", isBookkeeper: false, canAddReceipt: false })).toEqual(NO_RECEIPT);
    expect(janeAddKindsFor({ role: "viewer", isBookkeeper: false, canAddReceipt: true })).toEqual(ALL);
  });
  it("covers every Quick action that adds something", () => {
    expect(ALL).toEqual(["improvement", "issue", "incident", "defect", "wish_list", "todo", "receipt", "kanban"]);
  });
  it("gives an accountant just Improvement and Report issue, like their Quick actions", () => {
    expect(janeAddKindsFor({ role: "viewer", isBookkeeper: true, canAddReceipt: true })).toEqual(["improvement", "issue"]);
  });
  it("treats an admin bookkeeper as an admin", () => {
    expect(janeAddKindsFor({ role: "admin", isBookkeeper: true, canAddReceipt: true })).toEqual(ALL);
  });
});

describe("janeAddTools", () => {
  it("offers both tools when to-dos and the Wish List are allowed", () => {
    const tools = janeAddTools(ALL);
    expect(tools.map(t => t.name)).toEqual([OPEN_ADD_FORM, DRAFT_NEW_ITEM]);
  });
  it("only lists the allowed forms, and drops drafting when neither draft kind is allowed", () => {
    const tools = janeAddTools(["improvement", "issue"]);
    expect(tools.map(t => t.name)).toEqual([OPEN_ADD_FORM]);
    const kindEnum = (tools[0].input_schema.properties as Record<string, { enum?: string[] }>).kind.enum;
    expect(kindEnum).toEqual(["improvement", "issue"]);
    expect(tools[0].description).not.toContain("incident");
  });
  it("offers nothing to someone who can add nothing", () => {
    expect(janeAddTools([])).toEqual([]);
  });
  it("sends foreign objects to the incident form", () => {
    expect(JANE_ADD_DESTINATIONS.find(d => d.kind === "incident")!.when).toMatch(/foreign object/);
    expect(JANE_ADD_GUIDE).toMatch(/foreign object.*incident/is);
  });
});

describe("parseOpenForm", () => {
  it("keeps the fields each form can use", () => {
    expect(parseOpenForm({ kind: "issue", text: "Mixer grinding", area: "factory", safety: true, title: "x" }, ALL))
      .toEqual({ ok: true, value: { kind: "issue", text: "Mixer grinding", area: "factory", safety: true } });
    expect(parseOpenForm({ kind: "improvement", title: "Labels by the door", text: "Moved them", mode: "done", area: "factory" }, ALL))
      .toEqual({ ok: true, value: { kind: "improvement", title: "Labels by the door", text: "Moved them", mode: "done" } });
    expect(parseOpenForm({ kind: "incident", text: "Bone in the duck", title: "Bone" }, ALL))
      .toEqual({ ok: true, value: { kind: "incident", text: "Bone in the duck" } });
  });
  it("opens the to-do list, the defect form and the receipt camera with nothing filled in", () => {
    expect(parseOpenForm({ kind: "todo", text: "ring the butcher" }, ALL)).toEqual({ ok: true, value: { kind: "todo" } });
    expect(parseOpenForm({ kind: "defect", text: "wonky" }, ALL)).toEqual({ ok: true, value: { kind: "defect" } });
    expect(parseOpenForm({ kind: "receipt", text: "Booker" }, ALL)).toEqual({ ok: true, value: { kind: "receipt" } });
  });
  it("puts the kanban item in the search", () => {
    expect(parseOpenForm({ kind: "kanban", text: "mozzarella", title: "x" }, ALL)).toEqual({ ok: true, value: { kind: "kanban", text: "mozzarella" } });
  });
  it("refuses the receipt camera without the grant", () => {
    expect(parseOpenForm({ kind: "receipt" }, NO_RECEIPT).ok).toBe(false);
  });
  it("calls the incident form by its new name", () => {
    expect(JANE_ADD_DESTINATIONS.find(d => d.kind === "incident")!.formName).toBe("Report accident / incident / foreign object");
  });
  it("keeps a Wish List link only if it's a web link", () => {
    expect(parseOpenForm({ kind: "wish_list", link: "https://shop.example/item" }, ALL))
      .toEqual({ ok: true, value: { kind: "wish_list", link: "https://shop.example/item" } });
    expect(parseOpenForm({ kind: "wish_list", link: "javascript:alert(1)", title: "Scales" }, ALL))
      .toEqual({ ok: true, value: { kind: "wish_list", title: "Scales" } });
  });
  it("drops blank text and a false safety flag", () => {
    expect(parseOpenForm({ kind: "issue", text: "   ", safety: false }, ALL)).toEqual({ ok: true, value: { kind: "issue" } });
  });
  it("refuses a form this person can't use", () => {
    const r = parseOpenForm({ kind: "incident", text: "x" }, ["improvement", "issue"]);
    expect(r.ok).toBe(false);
  });
  it("refuses an unknown form", () => {
    expect(parseOpenForm({ kind: "payroll" }, ALL).ok).toBe(false);
    expect(parseOpenForm(null, ALL).ok).toBe(false);
  });
});

describe("parseDraft", () => {
  it("drafts a to-do with defaults", () => {
    expect(parseDraft({ kind: "todo", title: " Ring the butcher " }, ALL, TODAY))
      .toEqual({ ok: true, value: { kind: "todo", title: "Ring the butcher", notes: null, priority: "normal", dueDate: null } });
  });
  it("keeps a real future due date and drops a past or malformed one", () => {
    const ok = parseDraft({ kind: "todo", title: "A", dueDate: "2026-11-30", priority: "high" }, ALL, TODAY);
    expect(ok).toEqual({ ok: true, value: { kind: "todo", title: "A", notes: null, priority: "high", dueDate: "2026-11-30" } });
    for (const dueDate of ["2026-11-01", "tomorrow", "2026-13-45"]) {
      const r = parseDraft({ kind: "todo", title: "A", dueDate }, ALL, TODAY);
      expect(r.ok && r.value.kind === "todo" && r.value.dueDate).toBe(null);
    }
  });
  it("drafts a Wish List item with a sensible quantity", () => {
    expect(parseDraft({ kind: "wish_list", title: "Label printer", quantity: 2.4, notes: "for prep" }, ALL, TODAY))
      .toEqual({ ok: true, value: { kind: "wish_list", title: "Label printer", notes: "for prep", quantity: 2 } });
    const r = parseDraft({ kind: "wish_list", title: "Mops", quantity: -3 }, ALL, TODAY);
    expect(r.ok && r.value.kind === "wish_list" && r.value.quantity).toBe(1);
  });
  it("only drafts to-dos and Wish List items", () => {
    expect(parseDraft({ kind: "incident", title: "Bone" }, ALL, TODAY).ok).toBe(false);
    expect(parseDraft({ kind: "improvement", title: "x" }, ALL, TODAY).ok).toBe(false);
  });
  it("needs a title", () => {
    expect(parseDraft({ kind: "todo", title: "  " }, ALL, TODAY).ok).toBe(false);
  });
  it("refuses a kind this person can't add", () => {
    expect(parseDraft({ kind: "todo", title: "x" }, ["improvement", "issue"], TODAY).ok).toBe(false);
  });
});

describe("tool results", () => {
  it("never tells Jane something was saved", () => {
    expect(openFormResult({ kind: "incident", text: "x" })).toMatch(/Nothing has been sent/);
    expect(draftResult({ kind: "todo", title: "x", notes: null, priority: "normal", dueDate: null })).toMatch(/Nothing has been added/);
  });
});
