// AI Jane as the go-between for ADDING things (Graeme, 27 Nov 2026: "We don't
// want to change functionally how they actually end up getting into the
// system. We don't want to recreate the same recording. We just want AI Jane
// to be the go-between … and automate as much of it as we can").
//
// Jane never writes anything herself. Her two tools only send the chat
// panel an instruction:
//   - open_add_form: open the SAME Quick actions form the person would have
//     tapped, filled in from what they said. They finish and send it there,
//     with its photos, signatures and HACCP steps exactly as before.
//   - draft_new_item: for a personal to-do or a Wish List item, show a card
//     with exactly what will be added. Only the person's own "Add it" tap
//     creates it, through the existing endpoint, as them.
//
// Pure: who gets which tools, the tool definitions and checking what the
// model sent. Unit-tested in jane-add-actions.test.ts; the chat route
// (routes/recipe-designer.ts) streams the result to the panel.
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import type { Role } from "../page-access-rules";

/** Every Quick action that adds something (layout.tsx QuickActionsPanel). */
export const JANE_ADD_KINDS = ["improvement", "issue", "incident", "defect", "wish_list", "todo", "receipt", "kanban"] as const;
export type JaneAddKind = (typeof JANE_ADD_KINDS)[number];

/** The two kinds Jane may draft for a confirm tap; everything else is a form. */
export const JANE_DRAFT_KINDS = ["todo", "wish_list"] as const;
export type JaneDraftKind = (typeof JANE_DRAFT_KINDS)[number];

export interface JaneAddDestination {
  kind: JaneAddKind;
  /** The Quick actions button it opens, word for word. */
  formName: string;
  /** When Jane should send someone here — goes into the tool description. */
  when: string;
}

export const JANE_ADD_DESTINATIONS: JaneAddDestination[] = [
  { kind: "improvement", formName: "Improvement", when: "an improvement or idea to log: something they've made better, or an idea to make better (before and after photos)" },
  { kind: "issue", formName: "Report issue", when: "something wrong or unsafe that needs fixing: broken equipment, a hazard, or the app or iPad misbehaving" },
  { kind: "incident", formName: "Report accident / incident / foreign object", when: "an accident (someone hurt or nearly hurt), an incident, or a near miss, including any foreign object or foreign body found in food (a bone in the meat, plastic, glass, metal, hair), mould, pests or contamination. This is the HACCP Accident & Incident Diary" },
  { kind: "defect", formName: "Report defect / waste", when: "product that can't go out (mislabelled, wonky, damaged) or anything binned as waste" },
  { kind: "wish_list", formName: "Add to Wish List", when: "kit or equipment the team wants bought, especially from a shop link" },
  { kind: "todo", formName: "My to-dos", when: "their own to-do list" },
  { kind: "receipt", formName: "Add receipt or invoice", when: "a receipt or supplier invoice to send to the Finance Inbox (they take a photo of it)" },
  { kind: "kanban", formName: "Pull kanban", when: "pulling a kanban card because an item is running low and needs ordering. Put the item's name in text so the search is ready" },
];

export const destinationFor = (kind: JaneAddKind): JaneAddDestination =>
  JANE_ADD_DESTINATIONS.find(d => d.kind === kind)!;

export interface JaneAddRequester {
  role: Role;
  /** Finance accountants (isBookkeeper, not admin) get just Improvement and
   *  Report issue in Quick actions (layout.tsx), so the same here. */
  isBookkeeper: boolean;
  /** The "finance.add_receipt" grant (userCan), which the button and the
   *  /api/finance/invoices/quick-add endpoint are both behind. */
  canAddReceipt: boolean;
}

/** What this person may add through Jane: exactly the Quick actions they see. */
export function janeAddKindsFor(r: JaneAddRequester): JaneAddKind[] {
  if (r.isBookkeeper && r.role !== "admin") return ["improvement", "issue"];
  return JANE_ADD_KINDS.filter(k => k !== "receipt" || r.canAddReceipt);
}

export const OPEN_ADD_FORM = "open_add_form";
export const DRAFT_NEW_ITEM = "draft_new_item";
export const JANE_ADD_TOOL_NAMES = new Set([OPEN_ADD_FORM, DRAFT_NEW_ITEM]);

const draftKindsOf = (kinds: JaneAddKind[]): JaneDraftKind[] =>
  JANE_DRAFT_KINDS.filter(k => kinds.includes(k));

/** The tools for this person — none at all if they can add nothing. */
export function janeAddTools(kinds: JaneAddKind[]): Anthropic.Tool[] {
  if (kinds.length === 0) return [];
  const where = kinds.map(k => { const d = destinationFor(k); return `- ${k} ("${d.formName}"): ${d.when}`; }).join("\n");
  const tools: Anthropic.Tool[] = [{
    name: OPEN_ADD_FORM,
    description: `Open one of the app's own Quick actions forms for this person, filled in from what they told you. Nothing is saved: they check it, add photos, and send it themselves. Use it whenever they want to report, record or log something. The forms:\n${where}`,
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: [...kinds] },
        title: { type: "string", description: "A short title in their words (improvement, or the Wish List item's name). Leave out if they haven't said." },
        text: { type: "string", description: "What happened or what they want, in their own words, ready for the form's description box. Only what they said: never invent detail." },
        area: { type: "string", enum: ["factory", "system"], description: "issue only: factory = something physical on the floor; system = the app or iPad. Leave out if unclear." },
        safety: { type: "boolean", description: "issue only: true if it's a safety problem." },
        mode: { type: "string", enum: ["idea", "done"], description: "improvement only: idea = not done yet; done = they've already made the change. Leave out if unclear." },
        link: { type: "string", description: "wish_list only: the shop link they gave, so the form can read the name and price." },
      },
      required: ["kind"],
    },
  }];
  const drafts = draftKindsOf(kinds);
  if (drafts.length > 0) {
    tools.push({
      name: DRAFT_NEW_ITEM,
      description: "Draft a new item for this person to add with one tap: a to-do on their OWN list (todo) or a Wish List item with no shop link (wish_list). It shows them a card with exactly what will be added and an \"Add it\" button. Nothing is added until they tap it. Never say it's been added.",
      input_schema: {
        type: "object",
        properties: {
          kind: { type: "string", enum: drafts },
          title: { type: "string", description: "The to-do, or the thing they need, short and in their words." },
          notes: { type: "string", description: "Any extra detail they gave. Leave out if none." },
          priority: { type: "string", enum: ["urgent", "high", "normal", "low"], description: "todo only. normal unless they said otherwise." },
          dueDate: { type: "string", description: "todo only: YYYY-MM-DD if they gave a day it must be done by." },
          quantity: { type: "number", description: "wish_list only: how many, if they said." },
        },
        required: ["kind", "title"],
      },
    });
  }
  return tools;
}

/** What the chat panel is told to open. */
export interface JaneFormRequest {
  kind: JaneAddKind;
  title?: string;
  text?: string;
  area?: "factory" | "system";
  safety?: boolean;
  mode?: "idea" | "done";
  link?: string;
}

export type JaneDraft =
  | { kind: "todo"; title: string; notes: string | null; priority: "urgent" | "high" | "normal" | "low"; dueDate: string | null }
  | { kind: "wish_list"; title: string; notes: string | null; quantity: number };

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const optText = (max: number) => z.string().trim().max(max).optional().transform(v => (v ? v : undefined));

const formInput = z.object({
  kind: z.enum(JANE_ADD_KINDS),
  title: optText(300),
  text: optText(5000),
  area: z.enum(["factory", "system"]).optional(),
  safety: z.boolean().optional(),
  mode: z.enum(["idea", "done"]).optional(),
  link: z.string().trim().max(4000).optional(),
});

/** Check what the model sent, and keep only the fields that form can use. */
export function parseOpenForm(input: unknown, allowed: JaneAddKind[]): Parsed<JaneFormRequest> {
  const p = formInput.safeParse(input);
  if (!p.success) return { ok: false, error: "That form request wasn't valid. Send kind as one of the listed forms." };
  const v = p.data;
  if (!allowed.includes(v.kind)) return { ok: false, error: `This person can't use the ${destinationFor(v.kind).formName} form. Tell them it isn't available to them.` };
  const out: JaneFormRequest = { kind: v.kind };
  if (v.text) out.text = v.text;
  if (v.kind === "improvement") {
    if (v.title) out.title = v.title;
    if (v.mode) out.mode = v.mode;
  } else if (v.kind === "issue") {
    if (v.area) out.area = v.area;
    if (v.safety) out.safety = true;
  } else if (v.kind === "wish_list") {
    if (v.title) out.title = v.title;
    if (v.link && /^https?:\/\//i.test(v.link)) out.link = v.link;
  } else if (v.kind === "incident") {
    // Their words go in the "What happened?" box; that's all it takes.
  } else if (v.kind === "kanban") {
    // The item's name, ready in the kanban search; text is all it takes.
    if (out.text) out.text = out.text.slice(0, 100);
  } else {
    // The to-do list, the defect form and the receipt camera open as they
    // are: they take no fill-in.
    delete out.text;
  }
  return { ok: true, value: out };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const draftInput = z.object({
  kind: z.enum(JANE_DRAFT_KINDS),
  title: z.string().trim().min(1).max(300),
  notes: optText(2000),
  priority: z.enum(["urgent", "high", "normal", "low"]).optional(),
  dueDate: z.string().trim().optional(),
  quantity: z.number().optional(),
});

/** Check a draft. `today` (YYYY-MM-DD, London) keeps a past due date off it. */
export function parseDraft(input: unknown, allowed: JaneAddKind[], today: string): Parsed<JaneDraft> {
  const p = draftInput.safeParse(input);
  if (!p.success) return { ok: false, error: "That draft wasn't valid: it needs kind (todo or wish_list) and a title." };
  const v = p.data;
  if (!allowed.includes(v.kind)) return { ok: false, error: "This person can't add that. Tell them it isn't available to them." };
  if (v.kind === "todo") {
    const due = v.dueDate && DATE_RE.test(v.dueDate) && !Number.isNaN(Date.parse(v.dueDate)) && v.dueDate >= today ? v.dueDate : null;
    return { ok: true, value: { kind: "todo", title: v.title, notes: v.notes ?? null, priority: v.priority ?? "normal", dueDate: due } };
  }
  const qty = v.quantity != null && Number.isFinite(v.quantity) ? Math.min(1000, Math.max(1, Math.round(v.quantity))) : 1;
  return { ok: true, value: { kind: "wish_list", title: v.title, notes: v.notes ?? null, quantity: qty } };
}

/** What Jane is told after each tool, so she says the right thing next. */
export function openFormResult(req: JaneFormRequest): string {
  const d = destinationFor(req.kind);
  return `The "${d.formName}" form is now open for them${req.text || req.title ? ", filled in from what they said" : ""}. Nothing has been sent yet. In one short line, tell them to check it and finish it there.`;
}

export function draftResult(draft: JaneDraft): string {
  const where = draft.kind === "todo" ? "their to-do list" : "the Wish List";
  return `A card showing "${draft.title}" for ${where} is on their screen with an "Add it" button. Nothing has been added yet. In one short line, tell them to check it and tap Add it.`;
}

/** Both versions of Jane's prompt carry this when she has the tools. */
export const JANE_ADD_GUIDE = `## Adding things for people

You are the go-between for adding things, so nobody has to remember where each form lives. When someone wants to report, record, log or add something, use your tools straight away rather than telling them where to go:
- A to-do for themselves, or a Wish List item with no shop link: draft_new_item. They see exactly what will be added and tap "Add it".
- Anything else (an improvement, an issue, an accident or incident, a foreign object or foreign body found in food, a defect or waste, a Wish List item with a link, a receipt or invoice, pulling a kanban): open_add_form, filled in with their words. A foreign object, bone, glass, plastic, mould or pest is an incident: open the incident form. Accident and incident reports, improvements and issues always go through their form, because they need photos, signatures and food-safety steps. A receipt needs its photo, and a kanban pull is confirmed in its own screen.
You never add, send or save anything yourself, so never say something has been added, reported or sent. Fill in only what they actually said; never invent details. If you're unsure which they mean, ask one short question first. To-dos go on their own list only: for anyone else's list, open their to-dos and say so. If a form isn't in your tools, it isn't available to them.`;
