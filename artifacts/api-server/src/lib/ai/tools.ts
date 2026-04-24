import {
  db,
  andonIssuesTable,
  ingredientsTable,
  kanbanItemsTable,
  productionPlansTable,
  productionPlanItemsTable,
  recipesTable,
  stockEntriesTable,
  stockItemsTable,
  suppliersTable,
  usersTable,
} from "@workspace/db";
import { and, desc, eq, ilike, isNull, sql } from "drizzle-orm";
import type Anthropic from "@anthropic-ai/sdk";
import { getPlandayShifts, isPlandayConfigured } from "../../services/planday";
import { isDueToday, getOrderDayLabel } from "../order-day-scheduler";

const MAC_CHEESE_CATEGORY = "Macaroni Cheese";

const STATION_LABELS: Record<string, string> = {
  dough_prep: "Dough Prep", dough_sheeting: "Dough Sheeting", prep: "Prep",
  main_prep: "Main Prep", prep_bases: "Bases & Sauces", prep_meat: "Raw Meat Prep",
  mixing: "Mixing & Cooking", building_1: "Building Table 1", building_2: "Building Table 2",
  ovens: "Ovens", wrapping: "Wrapping", packing: "Packing", general: "General / Other",
};

const ANDON_CATEGORY_LABELS: Record<string, string> = {
  equipment: "Equipment", safety: "Safety", production: "Production",
  product: "Product", other: "Other",
};

const SEVERITY_LABELS: Record<string, string> = {
  red: "Red (serious)", yellow: "Yellow (minor)", green: "Green (wish list)",
};

const LOCATION_LABELS: Record<string, string> = {
  production_fridge: "Production Fridge",
  production_freezer: "Production Freezer",
  prep_fridge: "Prep Fridge",
  raw_meat_fridge: "Raw Meat Fridge",
  raw_freezer: "Raw Freezer",
  dry_store: "Dry Store",
};

function todayInUK(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function humanizeAge(date: Date): string {
  const ms = Date.now() - date.getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

// ─── Tool: create_andon_issue (write) ──────────────────────────────────────

const ANDON_STATIONS = [
  "dough_prep", "dough_sheeting", "prep", "main_prep", "prep_bases",
  "prep_meat", "mixing", "building_1", "building_2", "ovens",
  "wrapping", "packing", "general",
] as const;

interface CreateAndonInput {
  category: string;
  severity: string;
  station: string;
  description: string;
}

async function createAndonIssue(
  input: CreateAndonInput,
  ctx: ToolContext,
): Promise<string> {
  const [row] = await db
    .insert(andonIssuesTable)
    .values({
      category: input.category as "equipment" | "safety" | "production" | "product" | "other",
      severity: input.severity as "red" | "yellow" | "green",
      description: input.description,
      station: input.station,
      reportedBy: ctx.userId ?? null,
      reportedByName: ctx.userName,
      reportContext: "ai_chat",
    })
    .returning();

  if (!row) throw new Error("Insert returned no row");
  const stationLabel = STATION_LABELS[input.station] ?? input.station;
  return `Issue #${row.id} created. Station: ${stationLabel}. Severity: ${SEVERITY_LABELS[input.severity] ?? input.severity}. Managers will see it now.`;
}

// ─── Tool: get_todays_production_plan ──────────────────────────────────────

async function getTodaysProductionPlan(): Promise<string> {
  const today = todayInUK();

  const [plan] = await db
    .select()
    .from(productionPlansTable)
    .where(eq(productionPlansTable.planDate, today))
    .orderBy(desc(productionPlansTable.createdAt))
    .limit(1);

  if (!plan) {
    return `No production plan found for today (${today}).`;
  }

  const items = await db
    .select({
      batchesTarget: productionPlanItemsTable.batchesTarget,
      batchesComplete: productionPlanItemsTable.batchesComplete,
      recipeName: recipesTable.name,
      recipeCategory: recipesTable.category,
      packSize: recipesTable.packSize,
    })
    .from(productionPlanItemsTable)
    .leftJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(eq(productionPlanItemsTable.planId, plan.id));

  if (items.length === 0) {
    return `Plan exists for today (${today}) but has no items.`;
  }

  const calzones = items.filter(i => i.recipeCategory !== MAC_CHEESE_CATEGORY);
  const macCheese = items.filter(i => i.recipeCategory === MAC_CHEESE_CATEGORY);

  const calzoneBatches = calzones.reduce((sum, i) => sum + i.batchesTarget, 0);
  const calzoneComplete = calzones.reduce((sum, i) => sum + i.batchesComplete, 0);
  // Mac cheese is tracked in packs rather than batches: packSize × batchesTarget.
  const macCheesePacks = macCheese.reduce((sum, i) => sum + i.batchesTarget * (i.packSize ?? 1), 0);
  const macCheesePacksComplete = macCheese.reduce((sum, i) => sum + i.batchesComplete * (i.packSize ?? 1), 0);

  const topProducts = [...items]
    .sort((a, b) => b.batchesTarget - a.batchesTarget)
    .slice(0, 8)
    .map(i => {
      const unit = i.recipeCategory === MAC_CHEESE_CATEGORY ? "packs" : "batches";
      const qty = i.recipeCategory === MAC_CHEESE_CATEGORY ? i.batchesTarget * (i.packSize ?? 1) : i.batchesTarget;
      const done = i.recipeCategory === MAC_CHEESE_CATEGORY ? i.batchesComplete * (i.packSize ?? 1) : i.batchesComplete;
      return `  - ${i.recipeName ?? "Unknown"}: ${qty} ${unit}${done > 0 ? ` (${done} complete)` : ""}`;
    })
    .join("\n");

  const lines = [
    `Production plan for ${today} (status: ${plan.status}, name: ${plan.name}):`,
  ];
  if (calzones.length > 0) {
    lines.push(`- Calzones: ${calzoneBatches} batches across ${calzones.length} product${calzones.length === 1 ? "" : "s"}${calzoneComplete > 0 ? ` — ${calzoneComplete} batches complete so far` : ""}.`);
  }
  if (macCheese.length > 0) {
    lines.push(`- Macaroni Cheese: ${macCheesePacks} packs across ${macCheese.length} product${macCheese.length === 1 ? "" : "s"}${macCheesePacksComplete > 0 ? ` — ${macCheesePacksComplete} packs complete so far` : ""}.`);
  }
  lines.push(`Products:\n${topProducts}`);
  return lines.join("\n");
}

// ─── Tool: get_open_andon_issues ───────────────────────────────────────────

async function getOpenAndonIssues(input: { limit?: number; severity?: string }): Promise<string> {
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 25);
  const conditions = [isNull(andonIssuesTable.resolvedAt)];
  if (input.severity && ["red", "yellow", "green"].includes(input.severity)) {
    conditions.push(eq(andonIssuesTable.severity, input.severity as "red" | "yellow" | "green"));
  }

  // Severity rank: red first, yellow, green.
  const rows = await db
    .select()
    .from(andonIssuesTable)
    .where(and(...conditions))
    .orderBy(
      sql`CASE ${andonIssuesTable.severity} WHEN 'red' THEN 0 WHEN 'yellow' THEN 1 ELSE 2 END`,
      desc(andonIssuesTable.createdAt),
    )
    .limit(limit);

  if (rows.length === 0) {
    return input.severity
      ? `No open ${SEVERITY_LABELS[input.severity] ?? input.severity} issues.`
      : "No open issues. All clear.";
  }

  const lines = rows.map(r => {
    const sev = SEVERITY_LABELS[r.severity] ?? r.severity;
    const cat = ANDON_CATEGORY_LABELS[r.category] ?? r.category;
    const station = STATION_LABELS[r.station] ?? r.station;
    const age = r.createdAt ? humanizeAge(new Date(r.createdAt)) : "?";
    const who = r.reportedByName ?? "Unknown";
    const ack = r.acknowledgedAt ? " [acknowledged]" : "";
    const desc = r.description?.trim() || "(no description)";
    return `- #${r.id} — ${sev} ${cat} at ${station} (${who}, ${age})${ack}\n    ${desc}`;
  });

  return `${rows.length} open issue${rows.length === 1 ? "" : "s"}:\n${lines.join("\n")}`;
}

// ─── Tool: get_ingredient_stock ────────────────────────────────────────────

async function getIngredientStock(input: { name: string }): Promise<string> {
  const query = input.name.trim();
  if (!query) return "Please provide an ingredient name to look up.";

  // Fuzzy match against ingredient name, cap at a few candidates.
  const candidates = await db
    .select({ id: ingredientsTable.id, name: ingredientsTable.name, unit: ingredientsTable.unit })
    .from(ingredientsTable)
    .where(ilike(ingredientsTable.name, `%${query}%`))
    .orderBy(ingredientsTable.name)
    .limit(5);

  // Also check named stock items (non-ingredient stock — e.g. packaging).
  const stockItemCandidates = await db
    .select({ id: stockItemsTable.id, name: stockItemsTable.name, unit: stockItemsTable.unit })
    .from(stockItemsTable)
    .where(ilike(stockItemsTable.name, `%${query}%`))
    .orderBy(stockItemsTable.name)
    .limit(5);

  if (candidates.length === 0 && stockItemCandidates.length === 0) {
    return `No ingredient or stock item found matching "${query}".`;
  }

  const blocks: string[] = [];

  for (const ing of candidates) {
    const entries = await db
      .select({
        quantity: stockEntriesTable.quantity,
        unit: stockEntriesTable.unit,
        location: stockEntriesTable.location,
        checkedAt: stockEntriesTable.checkedAt,
      })
      .from(stockEntriesTable)
      .where(and(
        eq(stockEntriesTable.ingredientId, ing.id),
        eq(stockEntriesTable.itemType, "ingredient"),
      ))
      .orderBy(desc(stockEntriesTable.checkedAt))
      .limit(20);

    // Take latest entry per location.
    const latestByLocation: Record<string, { quantity: number; unit: string; checkedAt: Date }> = {};
    for (const e of entries) {
      if (!latestByLocation[e.location]) {
        latestByLocation[e.location] = {
          quantity: Number(e.quantity),
          unit: e.unit,
          checkedAt: e.checkedAt,
        };
      }
    }

    if (Object.keys(latestByLocation).length === 0) {
      blocks.push(`${ing.name}: no stock records found.`);
      continue;
    }

    const rows = Object.entries(latestByLocation)
      .map(([loc, d]) => `  - ${LOCATION_LABELS[loc] ?? loc}: ${d.quantity} ${d.unit} (checked ${humanizeAge(new Date(d.checkedAt))})`)
      .join("\n");
    blocks.push(`${ing.name}:\n${rows}`);
  }

  for (const si of stockItemCandidates) {
    const entries = await db
      .select({
        quantity: stockEntriesTable.quantity,
        unit: stockEntriesTable.unit,
        location: stockEntriesTable.location,
        checkedAt: stockEntriesTable.checkedAt,
      })
      .from(stockEntriesTable)
      .where(and(
        eq(stockEntriesTable.stockItemId, si.id),
        eq(stockEntriesTable.itemType, "stock_item"),
      ))
      .orderBy(desc(stockEntriesTable.checkedAt))
      .limit(5);

    if (entries.length === 0) {
      blocks.push(`${si.name} (stock item): no records found.`);
    } else {
      const latest = entries[0];
      blocks.push(`${si.name} (stock item): ${Number(latest.quantity)} ${latest.unit} at ${LOCATION_LABELS[latest.location] ?? latest.location} (checked ${humanizeAge(new Date(latest.checkedAt))})`);
    }
  }

  return blocks.join("\n\n");
}

// ─── Tool: get_kanbans_due_today ───────────────────────────────────────────

async function getKanbansDueToday(): Promise<string> {
  const rows = await db
    .select({
      id: kanbanItemsTable.id,
      ingredientName: ingredientsTable.name,
      kanbanQuantity: ingredientsTable.kanbanQuantity,
      kanbanUnit: ingredientsTable.kanbanUnit,
      supplierName: suppliersTable.name,
      orderFrequency: suppliersTable.orderFrequency,
      orderDayTarget: kanbanItemsTable.orderDayTarget,
      status: kanbanItemsTable.status,
    })
    .from(kanbanItemsTable)
    .leftJoin(ingredientsTable, eq(kanbanItemsTable.ingredientId, ingredientsTable.id))
    .leftJoin(suppliersTable, eq(kanbanItemsTable.supplierId, suppliersTable.id))
    .where(eq(kanbanItemsTable.status, "active"));

  const due = rows.filter(r => isDueToday(r.orderDayTarget, r.orderFrequency ?? "daily"));

  if (due.length === 0) {
    return "No active kanbans are due to be ordered today.";
  }

  const lines = due.map(k => {
    const qty = k.kanbanQuantity != null ? `${Number(k.kanbanQuantity)} ${k.kanbanUnit ?? ""}`.trim() : "?";
    const supplier = k.supplierName ?? "(no supplier)";
    const label = getOrderDayLabel(k.orderDayTarget, k.orderFrequency ?? "daily");
    return `  - ${k.ingredientName ?? "Unknown"}: ${qty} — ${supplier} (${label})`;
  });

  return `${due.length} kanban${due.length === 1 ? "" : "s"} due today:\n${lines.join("\n")}`;
}

// ─── Tool: get_todays_schedule ─────────────────────────────────────────────

async function getTodaysSchedule(): Promise<string> {
  if (!isPlandayConfigured()) {
    return "Schedule integration (Planday) is not configured on this environment. I can't pull today's schedule.";
  }

  const today = todayInUK();
  const shifts = await getPlandayShifts(today, today);

  if (shifts.length === 0) {
    return `No shifts scheduled for today (${today}).`;
  }

  // Match planday employee IDs to app users.
  const employeeIds = Array.from(new Set(shifts.map(s => s.employeeId).filter((id): id is number => id != null)));
  const userRows = employeeIds.length > 0
    ? await db
        .select({ name: usersTable.name, plandayEmployeeId: usersTable.plandayEmployeeId })
        .from(usersTable)
    : [];
  const nameByPlandayId = new Map<number, string>();
  for (const u of userRows) {
    if (u.plandayEmployeeId != null) nameByPlandayId.set(u.plandayEmployeeId, u.name);
  }

  const lines = shifts
    .filter(s => s.date === today)
    .sort((a, b) => (a.startDateTime ?? "").localeCompare(b.startDateTime ?? ""))
    .map(s => {
      const name = s.employeeId ? (nameByPlandayId.get(s.employeeId) ?? `Employee #${s.employeeId}`) : "(unassigned)";
      const start = s.startDateTime ? new Date(s.startDateTime).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : "?";
      const end = s.endDateTime ? new Date(s.endDateTime).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : "?";
      return `  - ${name}: ${start} – ${end}`;
    });

  if (lines.length === 0) return `No shifts scheduled for today (${today}).`;
  return `Schedule for ${today} (${lines.length} shift${lines.length === 1 ? "" : "s"}):\n${lines.join("\n")}`;
}

// ─── Tool registry + dispatch ──────────────────────────────────────────────

export interface ToolContext {
  userId: number | null;
  userName: string | null;
  userRole: string | null;
  /** The station the user was on when they opened the chat, if any. */
  station: string | null;
}

export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: "create_andon_issue",
    description: "Report a production floor issue (andon). Creates a new issue that managers will see immediately. Only call this after the user has confirmed the details.",
    input_schema: {
      type: "object" as const,
      properties: {
        category: { type: "string", enum: ["equipment", "safety", "production", "product", "other"], description: "The type of issue." },
        severity: { type: "string", enum: ["red", "yellow", "green"], description: "red = serious/production impacted, yellow = minor, green = wish list." },
        station: { type: "string", enum: [...ANDON_STATIONS], description: "The station where the issue is occurring." },
        description: { type: "string", description: "Brief description of the issue in the user's own words." },
      },
      required: ["category", "severity", "station", "description"],
    },
  },
  {
    name: "get_todays_production_plan",
    description: "Read today's production plan. Returns a summary of batches scheduled today, split between calzones and macaroni cheese, with a list of products.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_open_andon_issues",
    description: "List unresolved (open) andon issues on the floor right now. Use when the user asks about current problems, outstanding issues, or what's broken. Results ordered by severity (red first), then most recent.",
    input_schema: {
      type: "object" as const,
      properties: {
        severity: { type: "string", enum: ["red", "yellow", "green"], description: "Optional: filter to only issues of this severity." },
        limit: { type: "number", description: "Max number of issues to return. Default 10, max 25." },
      },
      required: [],
    },
  },
  {
    name: "get_ingredient_stock",
    description: "Look up current stock levels for an ingredient or named stock item by name (fuzzy match). Returns quantity per storage location and how recently it was checked.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Ingredient or stock item name (or part of it — e.g. 'cheese', 'pepperoni', 'flour')." },
      },
      required: ["name"],
    },
  },
  {
    name: "get_kanbans_due_today",
    description: "List kanban cards that are due to be ordered today, with supplier and quantity. Use when asked about ordering, deliveries, or what needs to be reordered.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_todays_schedule",
    description: "Look up today's shift schedule from Planday. Returns who is on today and their start/end times. Use when asked about who's working, who's in, rotas, or scheduling.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
];

export async function executeTool(
  name: string,
  input: unknown,
  ctx: ToolContext,
): Promise<{ success: boolean; content: string; summary?: string }> {
  try {
    switch (name) {
      case "create_andon_issue": {
        const content = await createAndonIssue(input as CreateAndonInput, ctx);
        return { success: true, content, summary: content.split(".")[0] };
      }
      case "get_todays_production_plan": {
        const content = await getTodaysProductionPlan();
        return { success: true, content };
      }
      case "get_open_andon_issues": {
        const content = await getOpenAndonIssues(input as { limit?: number; severity?: string });
        return { success: true, content };
      }
      case "get_ingredient_stock": {
        const content = await getIngredientStock(input as { name: string });
        return { success: true, content };
      }
      case "get_kanbans_due_today": {
        const content = await getKanbansDueToday();
        return { success: true, content };
      }
      case "get_todays_schedule": {
        const content = await getTodaysSchedule();
        return { success: true, content };
      }
      default:
        return { success: false, content: `Unknown tool: ${name}` };
    }
  } catch (err) {
    console.error(`[ai/tools] ${name} failed:`, err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { success: false, content: `Tool "${name}" failed: ${msg}` };
  }
}
