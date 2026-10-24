/**
 * Smart add (Graeme, 2026-10-24): turns one typed or spoken line into a
 * placement — WHICH list it goes on and WHAT it says — for team lists,
 * personal to-dos and station checklists alike. Pure, so the rules are
 * tested; routes/smart-add.ts brings the database and the AI.
 *
 * Who decides what:
 *   - The fixed-form parts the rules read (p1, @Name, "every thursday",
 *     "next monday") always win — the AI can't override what you typed.
 *   - "@Jane Miles" always means Jane's own to-do list.
 *   - Otherwise the AI picks the destination from the ones you may add to;
 *     without the AI (or if it names one you can't use) it goes where the
 *     box is.
 */
import {
  describeRule, parseRecurrencePhrase, parseStartDate, WEEKDAY_LONG,
  type RecurrenceRule, type SmartAddParse, type Weekday,
} from "@workspace/recurrence";

export type ChecklistCategory = "opening" | "cleaning" | "closing";
export const CHECKLIST_CATEGORIES: ChecklistCategory[] = ["opening", "cleaning", "closing"];

export type Destination =
  | { kind: "todo"; assigneeId: number }
  | { kind: "team_list"; listId: number }
  | { kind: "checklist"; stationType: string; category: ChecklistCategory };

export interface Choices {
  /** People whose to-do list the caller may add to (just themselves unless a manager). */
  people: { id: number; name: string }[];
  /** Team lists the caller may add to. */
  teamLists: { id: number; name: string }[];
  /** Stations with checklists. */
  stations: { stationType: string; label: string }[];
}

export interface AiPlacement {
  destination?: Destination | null;
  title?: string | null;
  priority?: number | null;
  repeat?: string | null;
  date?: string | null;
  dateKind?: "on" | "by" | null;
  time?: string | null;
}

export interface Placement {
  destination: Destination;
  destinationLabel: string;
  title: string;
  priority: 1 | 2 | 3 | 4 | null;
  rule: RecurrenceRule | null;
  ruleLabel: string | null;
  date: string | null;
  dateKind: "on" | "by" | null;
  time: string | null;
  /** A checklist task for today only (the station's one-off item). */
  checklistToday: boolean;
  /** Why it can't be added as it stands, in plain English. */
  problem: string | null;
}

export function sameDestination(a: Destination, b: Destination): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "todo" && b.kind === "todo") return a.assigneeId === b.assigneeId;
  if (a.kind === "team_list" && b.kind === "team_list") return a.listId === b.listId;
  if (a.kind === "checklist" && b.kind === "checklist") return a.stationType === b.stationType && a.category === b.category;
  return false;
}

export function allowedDestination(d: Destination | null | undefined, c: Choices): Destination | null {
  if (!d) return null;
  if (d.kind === "todo") return c.people.some(p => p.id === d.assigneeId) ? d : null;
  if (d.kind === "team_list") return c.teamLists.some(l => l.id === d.listId) ? d : null;
  if (d.kind === "checklist") {
    return c.stations.some(s => s.stationType === d.stationType) && CHECKLIST_CATEGORIES.includes(d.category) ? d : null;
  }
  return null;
}

const CATEGORY_LABEL: Record<ChecklistCategory, string> = { opening: "opening check", cleaning: "cleaning check", closing: "closing check" };

export function destinationLabel(d: Destination, c: Choices, callerId: number): string {
  if (d.kind === "todo") {
    if (d.assigneeId === callerId) return "your to-do list";
    const p = c.people.find(x => x.id === d.assigneeId);
    return `${p?.name ?? "their"}’s to-do list`;
  }
  if (d.kind === "team_list") return `the ${c.teamLists.find(l => l.id === d.listId)?.name ?? "team"} list`;
  const s = c.stations.find(x => x.stationType === d.stationType);
  return `the ${s?.label ?? d.stationType} ${CATEGORY_LABEL[d.category]}`;
}

/**
 * Checklist schedules only know every day and set weekdays (the 4-weekly
 * "periodic" is set by hand in the editor). Returns null when the rule
 * can't be a checklist schedule.
 */
export function checklistScheduleFor(rule: RecurrenceRule | null):
  { schedule: "daily" } | { schedule: "specific_days"; scheduleDays: string[] } | null {
  if (!rule || rule.kind === "daily") return { schedule: "daily" };
  if (rule.kind === "weekdays") return { schedule: "specific_days", scheduleDays: ["monday", "tuesday", "wednesday", "thursday", "friday"] };
  if (rule.kind === "weekly" && (rule.interval ?? 1) === 1 && rule.days.length) {
    return { schedule: "specific_days", scheduleDays: rule.days.map((d: Weekday) => WEEKDAY_LONG[d].toLowerCase()) };
  }
  return null;
}

export function namesStation(text: string, stationType: string, c: Choices): boolean {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const label = c.stations.find(s => s.stationType === stationType)?.label ?? stationType;
  const words = new Set([stationType.replace(/_/g, " "), label.toLowerCase(), label.toLowerCase().split(" ")[0], stationType.split("_")[0]]);
  return [...words].some(w => w.length > 2 && t.includes(` ${w} `));
}

function cleanPriority(p: number | null | undefined): 1 | 2 | 3 | 4 | null {
  return p === 1 || p === 2 || p === 3 || p === 4 ? p : null;
}

/** Merge the rules' reading, the AI's suggestion and the box's context. */
export function placeTask(args: {
  parse: SmartAddParse;
  ai: AiPlacement | null;
  context: Destination;
  choices: Choices;
  callerId: number;
  today: string;
  /** The box is on a station checklist for today's plan, so "today" can be a one-off. */
  checklistPlanToday?: boolean;
  /** What was typed — to check a station was actually named. */
  text?: string;
}): Placement {
  const { parse, ai, context, choices, callerId, today, checklistPlanToday = false, text = "" } = args;

  let destination: Destination;
  let problem: string | null = null;
  const mention = parse.mentions[0];
  if (mention) {
    const allowed = allowedDestination({ kind: "todo", assigneeId: mention.id }, choices);
    if (!allowed) problem = `Only managers can add to ${mention.name}’s list.`;
    destination = allowed ?? context;
  } else {
    destination = allowedDestination(ai?.destination, choices) ?? allowedDestination(context, choices) ?? context;
    if (parse.unknownMentions.length) {
      problem = `I don’t know who @${parse.unknownMentions[0]} is — use their full name (e.g. @Jane Miles).`;
    }
  }

  let rule = parse.rule;
  let time = parse.time;
  if (!rule && ai?.repeat) {
    const r = parseRecurrencePhrase(ai.repeat.toLowerCase(), today);
    if (r) { rule = r.rule; time = time ?? r.time; }
  }
  let date = parse.date;
  let dateKind = parse.dateKind;
  if (!rule && !date && ai?.date) {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(ai.date) ? (ai.date >= today ? ai.date : null) : parseStartDate(ai.date, today);
    if (d) { date = d; dateKind = ai.dateKind === "by" ? "by" : "on"; }
  }
  if (!time && ai?.time && /^\d{2}:\d{2}$/.test(ai.time)) time = ai.time;

  const aiTitle = ai?.title?.trim();
  const title = (aiTitle || parse.title).replace(/\s+/g, " ").trim().slice(0, 300);
  const priority = parse.priority ?? cleanPriority(ai?.priority);

  if (!title) problem = problem ?? "Type what needs doing.";
  // Filed onto a station's checklist from somewhere that isn't a station:
  // only if the words name the station — never the AI's guess (2026-10-24:
  // "closing check: wipe the scales" from a to-do list went to Prep).
  if (!problem && destination.kind === "checklist" && context.kind !== "checklist" && !namesStation(text, destination.stationType, choices)) {
    problem = "Which station’s checklist? Say it — e.g. “packing closing check”.";
  }
  const checklistToday = destination.kind === "checklist" && !rule && date === today && checklistPlanToday;
  if (!problem && destination.kind === "checklist" && !checklistToday) {
    if (date && !rule) problem = "Checklist tasks repeat — say which days (e.g. “every Thursday”), or add it to a to-do list instead.";
    else if (!checklistScheduleFor(rule)) problem = "Checklists repeat every day or on set weekdays — try “every Thursday”.";
  }

  return {
    destination,
    destinationLabel: destinationLabel(destination, choices, callerId),
    title, priority, rule,
    ruleLabel: rule ? describeRule(rule) : null,
    date, dateKind, time, checklistToday, problem,
  };
}
