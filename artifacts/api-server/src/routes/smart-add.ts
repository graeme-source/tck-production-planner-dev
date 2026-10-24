/**
 * POST /api/smart-add/interpret — the shared "add" box (Graeme, 2026-10-24).
 *
 * "We can very quickly, in all three of those areas, write something like
 * 'clean packing computer every Thursday', 'closing check', or 'cleaning
 * check', and it will add it ... It's got to be smart ... use AI to figure
 * out what we're trying to do, and then add that."
 *
 * This only WORKS OUT where the task goes and what it says
 * (lib/smart-add-plan.ts). The client then adds it through the normal
 * endpoint for that list — POST /api/todos, /api/team-lists/:id/items or
 * /api/checklists/templates — so every permission rule, notification and
 * timeline entry stays in one place. No AI configured, or the AI failing,
 * is not an error: the rules' reading and the box's own list are used.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { asc, eq, isNull, sql } from "drizzle-orm";
import { db, usersTable, teamListsTable } from "@workspace/db";
import { parseSmartAdd } from "@workspace/recurrence";
import { validate } from "../middleware/validate";
import { resolveRole } from "../middleware/roles";
import { londonDateString, londonWeekdayName } from "../lib/london-time";
import { canEditList } from "../lib/team-lists-day";
import { resolveChecklistStation } from "../lib/checklist-stations";
import { CLAUDE_MODELS, getClaudeClient, isClaudeConfigured } from "../lib/ai/claude";
import {
  CHECKLIST_CATEGORIES, placeTask,
  type AiPlacement, type ChecklistCategory, type Choices, type Destination,
} from "../lib/smart-add-plan";

const router: IRouter = Router();

const contextSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("todo"), assigneeId: z.number().int().optional() }),
  z.object({ kind: z.literal("team_list"), listId: z.number().int() }),
  z.object({
    kind: z.literal("checklist"), stationType: z.string().min(1).max(60),
    category: z.enum(["opening", "cleaning", "closing"]),
    /** Today's plan at that station — lets "today only" be a one-off item. */
    planId: z.number().int().optional(),
  }),
]);
const interpretBody = z.object({
  text: z.string().trim().min(1, "Type what needs doing").max(500),
  context: contextSchema,
});

function isManager(role: string): boolean {
  return role === "admin" || role === "manager";
}

function stationLabel(stationType: string): string {
  return stationType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

async function choicesFor(userId: number, role: string): Promise<{ choices: Choices; everyone: { id: number; name: string }[] }> {
  const everyone = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable)
    .where(eq(usersTable.isActive, true)).orderBy(asc(usersTable.name));
  const lists = await db.select().from(teamListsTable).where(isNull(teamListsTable.archivedAt)).orderBy(asc(teamListsTable.sortOrder));
  // Anyone at a station can already add to its checklist (the "Add one-off
  // task" form), so the same goes here.
  const stations = (await db.execute<{ station_type: string }>(sql`
    SELECT DISTINCT station_type FROM checklist_templates WHERE is_active = true ORDER BY station_type
  `)).rows.map(r => ({ stationType: r.station_type, label: stationLabel(r.station_type) }));
  return {
    everyone,
    choices: {
      people: isManager(role) ? everyone : everyone.filter(p => p.id === userId),
      teamLists: lists.filter(l => canEditList({ id: userId, role }, l)).map(l => ({ id: l.id, name: l.name })),
      stations,
    },
  };
}

const PLACE_TOOL = {
  name: "place_task",
  description: "Say where the new task goes and what it says.",
  input_schema: {
    type: "object" as const,
    properties: {
      destination_kind: { type: "string", enum: ["todo", "team_list", "checklist"] },
      assignee_id: { type: ["integer", "null"], description: "For todo: whose personal to-do list." },
      team_list_id: { type: ["integer", "null"] },
      station_type: { type: ["string", "null"] },
      checklist_category: { type: ["string", "null"], enum: ["opening", "cleaning", "closing", null] },
      title: { type: "string", description: "The task itself, short, in the writer's words, sentence case. Leave out the repeat, date, priority, @name and any words that only say which list it goes on." },
      priority: { type: ["integer", "null"], description: "1 (most urgent) to 4, only if the wording asks for it." },
      repeat: { type: ["string", "null"], description: "The repeat in plain words, e.g. 'every thursday', 'every mon, wed at 9am', 'fortnightly on friday', 'every 3 months'. null if it doesn't repeat." },
      date: { type: ["string", "null"], description: "A one-off day as YYYY-MM-DD, null if none." },
      date_kind: { type: ["string", "null"], enum: ["on", "by", null] },
      time: { type: ["string", "null"], description: "HH:MM 24h if a time of day is given." },
    },
    required: ["destination_kind", "title"],
  },
};

async function askAi(text: string, context: Destination, choices: Choices, callerId: number, today: string): Promise<AiPlacement | null> {
  if (!isClaudeConfigured()) return null;
  const lines = [
    `Today is ${londonWeekdayName()} ${today} (London). The person adding is user ${callerId}.`,
    `The box they typed in belongs to: ${JSON.stringify(context)}. Use it unless the words point somewhere else.`,
    `Personal to-do lists (id · name): ${choices.people.map(p => `${p.id} · ${p.name}`).join("; ") || "none"}`,
    `Team lists (id · name): ${choices.teamLists.map(l => `${l.id} · ${l.name}`).join("; ") || "none"}`,
    choices.stations.length
      ? `Station checklists — station_type (label), each with an opening, cleaning and closing check: ${choices.stations.map(s => `${s.stationType} (${s.label})`).join("; ")}`
      : "Station checklists: none available to this person.",
  ];
  try {
    const response = await getClaudeClient().messages.create({
      model: CLAUDE_MODELS.haiku,
      max_tokens: 400,
      system: [
        "You file one new task for The Calzone Kitchen, a food factory, into the right list.",
        "Station checklists are for routine factory jobs at a station (e.g. 'cleaning check' or 'closing check' at packing); team lists are shared routines; personal to-do lists belong to one person.",
        "Words like 'cleaning check', 'closing check', 'opening check', or a list's name say where it goes — leave them out of the title.",
        "Only choose destinations from the lists given. When unsure, keep the box's own list.",
        "'Today only' or 'just today' means date = today with no repeat.",
      ].join(" "),
      messages: [{ role: "user", content: `${lines.join("\n")}\n\nNew task: ${text}` }],
      tools: [PLACE_TOOL],
      tool_choice: { type: "tool", name: "place_task" },
    });
    const use = response.content.find(c => c.type === "tool_use");
    if (!use || use.type !== "tool_use") return null;
    const o = use.input as Record<string, unknown>;
    let destination: Destination | null = null;
    if (o.destination_kind === "todo" && typeof o.assignee_id === "number") destination = { kind: "todo", assigneeId: o.assignee_id };
    if (o.destination_kind === "team_list" && typeof o.team_list_id === "number") destination = { kind: "team_list", listId: o.team_list_id };
    if (o.destination_kind === "checklist" && typeof o.station_type === "string" && CHECKLIST_CATEGORIES.includes(o.checklist_category as ChecklistCategory)) {
      destination = { kind: "checklist", stationType: resolveChecklistStation(o.station_type), category: o.checklist_category as ChecklistCategory };
    }
    return {
      destination,
      title: typeof o.title === "string" ? o.title : null,
      priority: typeof o.priority === "number" ? o.priority : null,
      repeat: typeof o.repeat === "string" ? o.repeat : null,
      date: typeof o.date === "string" ? o.date : null,
      dateKind: o.date_kind === "by" ? "by" : o.date_kind === "on" ? "on" : null,
      time: typeof o.time === "string" ? o.time : null,
    };
  } catch (err) {
    console.error("[smart-add] AI error:", err instanceof Error ? err.message : err);
    return null;
  }
}

// The people the box can @, for the live preview while typing.
router.get("/people", async (req: Request, res: Response) => {
  const rows = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable)
    .where(eq(usersTable.isActive, true)).orderBy(asc(usersTable.name));
  res.json(rows);
});

router.post("/interpret", validate(interpretBody), async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const role = (await resolveRole(req)) ?? "viewer";
  const { text, context: ctx } = req.body as z.infer<typeof interpretBody>;
  const today = londonDateString();
  const context: Destination = ctx.kind === "todo"
    ? { kind: "todo", assigneeId: ctx.assigneeId ?? userId }
    : ctx.kind === "checklist" ? { kind: "checklist", stationType: resolveChecklistStation(ctx.stationType), category: ctx.category }
    : ctx;
  try {
    const { choices, everyone } = await choicesFor(userId, role);
    const parse = parseSmartAdd(text, today, everyone);
    const ai = await askAi(text, context, choices, userId, today);
    const placement = placeTask({
      parse, ai, context, choices, callerId: userId, today, text,
      checklistPlanToday: ctx.kind === "checklist" && ctx.planId != null,
    });
    res.json({ ...placement, ai: ai != null });
  } catch (err) {
    console.error("[smart-add] interpret error:", err);
    res.status(500).json({ error: "Couldn't work that out — try again" });
  }
});

export default router;
