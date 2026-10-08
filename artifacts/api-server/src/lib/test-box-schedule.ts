/**
 * Test-box scheduling (Graeme; memory project_test_box_tool; reworked
 * 2026-10-02). Pure — no database — so every rule is unit-tested
 * (test-box-schedule.test.ts).
 *
 * A box has:
 *   - a LAUNCH DATE: always the VIP Calzoney Club launch, its first sale.
 *     VIPs get a guaranteed VIP_GUARANTEE_HOURS of selling before anything
 *     is cut off ("VIP-only until …").
 *   - an optional PUBLIC LAUNCH date.
 *   - one or more DELIVERY DATES, added over time. Orders for a delivery
 *     close BY HAND; this file works out the LATEST day they can close.
 *   - a one-off LAUNCH CHECKLIST (template: test-box-launch-checklist.ts).
 *
 * Each delivery date is walked BACKWARDS:
 *
 *   delivery      the chosen day (deliveries run Tue–Sat)
 *   despatch      the working day before delivery
 *   production    the working day before despatch (produce, despatch, deliver)
 *   prep / dough  the working day before production
 *   ingredients   in by prep day minus bufferDays working days (the
 *                 test-box safety buffer)
 *   order-by      only for NEW ingredients (see "specialist" below), each
 *                 one: arrive-by minus its supplier's lead time plus
 *                 SPECIALIST_EXTRA_WORKING_DAYS in working days, rolled back
 *                 to one of the supplier's order days when it only takes
 *                 orders on set days. Every other ingredient is ordered the
 *                 normal way (kanban / Orders page) once production is on a
 *                 plan, so it gets no step here (Graeme, 2026-10-08).
 *   close orders  the LATEST day orders can close: the earliest specialist
 *                 order-by (orders must be in before they're ordered), or
 *                 production minus ordersCloseDays working days if that is
 *                 earlier / there are no specialist ingredients.
 *   after close   (only once someone has closed orders) turn the date off
 *                 in Zapiet and decide test-only or test + normal. The
 *                 production itself is queued AUTOMATICALLY from the box's
 *                 sales when orders close (test-box-production.ts).
 *
 * SPECIALIST ("new") ingredient: used by the box's recipes, NOT used by any
 * core-menu recipe, and NOT on a kanban — normal ordering would never pick it
 * up. Worked out in test-box-data.ts (loadSpecialistIngredients).
 *
 * TO-DO OR MILESTONE (Graeme, 2026-10-08: "a simple to-do list of things
 * that happen OUTSIDE the norm"). Only the launch checklist and, per
 * delivery, close orders / order the new ingredients / Zapiet off / the
 * test-or-normal decision go on the owner's to-do list (becomesTodo). The
 * rest — ingredients in, prep & dough, production, despatch, delivery — are
 * dated MILESTONES shown on the box and calendar for reference: prep and
 * dough follow automatically once production is on the plan.
 *
 * Working days are Monday–Friday. Bank holidays are not known to the system
 * yet, so a deadline landing on one needs a human eye (the page says so).
 *
 * Launch-checklist due dates are never set before the day the box was
 * planned (`plannedOn`): a step whose normal date has already gone when the
 * box is set up (a same-day launch) is due that day instead, and the box is
 * flagged "tight timeline". The floor is the planning day, not "today", so
 * an unticked step still goes overdue rather than drifting forward forever.
 */
import { isDeliveryDay } from "./production-cutoff";
import { LAUNCH_CHECKLIST, launchTaskKey, type LaunchAction } from "./test-box-launch-checklist";

/** VIP Calzoney Club members always get this long to buy from launch. */
export const VIP_GUARANTEE_HOURS = 48;
/** Extra lead time on ingredients no menu recipe uses. */
export const SPECIALIST_EXTRA_WORKING_DAYS = 2;
/** Queued production can be set up to this many days before production. */
export const QUEUE_AHEAD_DAYS = 7;
/** Used when an ingredient has no supplier: a cautious guess, flagged. */
export const DEFAULT_LEAD_DAYS = 3;

export const DELIVERY_STATUSES = ["open", "closed", "queued", "made", "delivered", "cancelled"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export const PRODUCTION_MIXES = ["test_only", "test_plus_normal"] as const;
export type ProductionMix = (typeof PRODUCTION_MIXES)[number];

/** A NEW ingredient the box needs ordering specially (see the header). */
export interface SpecialistIngredient {
  ingredientId: number;
  name: string;
  /** null = no supplier set on the ingredient. */
  supplierId: number | null;
  supplierName: string | null;
  leadTimeDays: number | null;
  cutoffTime: string | null;
  orderFrequency: string | null;
  /** "Monday,Thursday" when the supplier only takes orders on set days. */
  orderDays: string | null;
  /** Where to order it: the ingredient's ordering link, else the supplier's website. */
  orderingUrl: string | null;
}

export interface DeliveryInput {
  id: number;
  deliveryDate: string;
  expectedBoxes: number | null;
  status: DeliveryStatus;
  /** The London day it was added — the Zapiet step for it isn't due before. */
  addedOn: string;
  /** The London day orders were closed, once they have been. */
  closedOn: string | null;
  productionMix: ProductionMix | null;
}

export interface ScheduleInput {
  boxName: string;
  launchDate: string;
  publicLaunchDate: string | null;
  /** The London day the box was set up — launch steps are never due before it. */
  plannedOn: string;
  ordersCloseDays: number;
  bufferDays: number;
  bufferPct: number;
  recipes: string[];
  specialists: SpecialistIngredient[];
  deliveries: DeliveryInput[];
  /** Task keys already ticked (for the "deadlines behind us" warning). */
  doneKeys?: readonly string[];
  today: string;
}

export type TaskKind = "launch" | "orders" | "ingredients" | "prep" | "production" | "despatch" | "delivery";

/** One ingredient line inside "Order the new ingredients for …" — ticked on
 *  its own (key "d12:order-new-i300"); never a to-do by itself. */
export interface OrderSubItem {
  key: string;
  ingredientId: number;
  name: string;
  supplier: string | null;
  orderBy: string;
  /** The supplier's cut-off on that day. */
  time?: string;
  /** Where to order it (ingredient ordering link, else supplier website). */
  link: string | null;
  /** No supplier / no lead time set — DEFAULT_LEAD_DAYS assumed. */
  assumed: boolean;
  past: boolean;
}

export interface ScheduleTask {
  /** Stable across recalculations — ticks and to-dos are stored against it. */
  key: string;
  /** true = on the owner's to-do list and ticked; false = a dated milestone
   *  shown for reference only (becomesTodo). */
  todo: boolean;
  date: string;
  /** Wall-clock deadline on that day, when there is one (supplier cut-off). */
  time?: string;
  kind: TaskKind;
  label: string;
  detail?: string;
  /** Launch checklist: a short "how". */
  how?: string;
  /** In-app page that does the job ("/plans/queued?date=…"). */
  link?: string;
  /** The button text for `link` (default "Open Queued production"). */
  linkLabel?: string;
  items?: string[];
  /** "Order the new ingredients": one tickable line per ingredient. */
  subItems?: OrderSubItem[];
  /** The date rests on an assumption (no supplier set / default lead time). */
  assumed?: boolean;
  /** Specialist ingredients (extra lead time). */
  specialist?: boolean;
  /** Due the planning day because its normal date had already gone. */
  clamped?: boolean;
  /** Done by the app rather than a person (launch checklist). */
  automated?: boolean;
  /** The app's button for this launch step (test-box-launch-checklist.ts). */
  action?: LaunchAction;
  /** Belongs to this delivery (absent = launch checklist). */
  deliveryId?: number;
  /** The date is already behind us. */
  past: boolean;
}

export interface CloseDriver {
  /** "specialist" = an ingredient's order-by; "standard" = production − ordersCloseDays. */
  reason: "specialist" | "standard";
  supplier?: string;
  items?: string[];
}

export interface DeliverySchedule {
  id: number;
  deliveryDate: string;
  status: DeliveryStatus;
  despatchDate: string;
  productionDate: string;
  prepDate: string;
  ingredientsInBy: string;
  /** The latest day orders for this delivery can close. */
  latestClose: string;
  closeDriver: CloseDriver;
  closedOn: string | null;
  productionMix: ProductionMix | null;
  expectedBoxes: number | null;
  /** Packs of EACH recipe to make: expected boxes + buffer, one of each per box. */
  packsPerRecipe: number | null;
  tasks: ScheduleTask[];
  /** What unlocks once orders are closed (shown greyed until then). */
  afterClose: string[];
  warnings: string[];
}

export interface TestBoxSchedule {
  launchDate: string;
  publicLaunchDate: string | null;
  /** End of the VIP guarantee: launch + VIP_GUARANTEE_HOURS. */
  vipWindowEnds: string;
  launchTasks: ScheduleTask[];
  /** Some launch steps had to be squeezed onto the planning day. */
  tightTimeline: boolean;
  deliveries: DeliverySchedule[];
  /** Box-level warnings (recipes, public launch, no deliveries). */
  warnings: string[];
}

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}
function weekday(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}
/** "Fri 16 Oct". */
export function shortDay(iso: string): string {
  return `${SHORT_DAYS[weekday(iso)]} ${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
}
/** "16 Oct" — how a delivery is named in titles ("Close orders for 16 Oct"). */
export function dayMonth(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
}
export function isWorkingDay(iso: string): boolean {
  const w = weekday(iso);
  return w >= 1 && w <= 5;
}
/** The working day before `iso`. */
/** `n` working days after `iso`. */
export function addWorkingDays(iso: string, n: number): string {
  let d = iso;
  for (let i = 0; i < n; i++) {
    d = addDays(d, 1);
    while (!isWorkingDay(d)) d = addDays(d, 1);
  }
  return d;
}

export function prevWorkingDay(iso: string): string {
  let d = addDays(iso, -1);
  while (!isWorkingDay(d)) d = addDays(d, -1);
  return d;
}
/** `n` working days before `iso` (n = 0 → iso itself, or the Friday before a weekend). */
export function subtractWorkingDays(iso: string, n: number): string {
  let d = iso;
  while (!isWorkingDay(d)) d = addDays(d, -1);
  for (let i = 0; i < n; i++) d = prevWorkingDay(d);
  return d;
}
const maxDate = (a: string, b: string) => (a > b ? a : b);
const minDate = (a: string, b: string) => (a < b ? a : b);

/** Latest date on or before `iso` whose weekday is one of the supplier's order days. */
export function latestOrderDay(iso: string, orderDays: string | null): string {
  const allowed = new Set((orderDays ?? "").split(",").map(s => WEEKDAYS.indexOf(s.trim())).filter(n => n >= 0));
  if (allowed.size === 0) return iso;
  let d = iso;
  for (let i = 0; i < 7 && !allowed.has(weekday(d)); i++) d = addDays(d, -1);
  return d;
}

/** When to order from one supplier so the goods are in by `arriveBy`. */
export function supplierOrderBy(
  arriveBy: string,
  s: Pick<SpecialistIngredient, "leadTimeDays" | "orderFrequency" | "orderDays">,
  extraWorkingDays = 0,
): { date: string; assumed: boolean } {
  const assumed = s.leadTimeDays == null;
  const lead = (s.leadTimeDays ?? DEFAULT_LEAD_DAYS) + extraWorkingDays;
  let date = subtractWorkingDays(arriveBy, lead);
  if (s.orderFrequency === "weekly" && s.orderDays) date = latestOrderDay(date, s.orderDays);
  return { date, assumed };
}

/** End of the VIP guarantee for a launch day. */
export function vipWindowEnd(launchDate: string): string {
  return addDays(launchDate, Math.ceil(VIP_GUARANTEE_HOURS / 24));
}

/** "d12:close-orders". */
export function deliveryTaskKey(deliveryId: number, step: string): string {
  return `d${deliveryId}:${step}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The delivery steps that go on the owner's to-do list — everything else
 *  on a delivery is a milestone. */
export const TODO_DELIVERY_STEPS = ["close-orders", "order-new", "zapiet-off", "decide-mix"] as const;

/**
 * Does this task become a to-do (and a tickable row)? The launch checklist
 * always does; on a delivery only the out-of-the-norm steps do.
 */
export function becomesTodo(t: Pick<ScheduleTask, "kind" | "key">): boolean {
  if (t.kind === "launch") return true;
  const step = t.key.slice(t.key.indexOf(":") + 1);
  return (TODO_DELIVERY_STEPS as readonly string[]).includes(step);
}

/** "d12:order-new-i300" → the parent "d12:order-new"; null if not a sub-line. */
export function orderSubParent(key: string): string | null {
  const m = /^(d\d+:order-new)-i\d+$/.exec(key);
  return m ? m[1] : null;
}

// ── The launch checklist ────────────────────────────────────────────────────
export function buildLaunchTasks(input: Pick<ScheduleInput, "boxName" | "launchDate" | "publicLaunchDate" | "plannedOn" | "deliveries" | "today"> & { recipes?: string[] }): { tasks: ScheduleTask[]; tightTimeline: boolean } {
  const tasks: ScheduleTask[] = [];
  let tight = false;
  const windowEnd = vipWindowEnd(input.launchDate);
  const live = input.deliveries.filter(d => d.status !== "cancelled");
  const firstDelivery = live.map(d => d.deliveryDate).sort()[0] ?? null;
  for (const step of LAUNCH_CHECKLIST) {
    if (step.onlyWithPublicLaunch && !input.publicLaunchDate) continue;
    if ((step.from === "first-production" || step.from === "first-delivery") && !firstDelivery) continue;
    const base = step.from === "public-launch" ? input.publicLaunchDate!
      : step.from === "vip-window-end" ? windowEnd
      : step.from === "first-delivery" ? firstDelivery!
      : step.from === "first-production" ? prevWorkingDay(prevWorkingDay(firstDelivery!))
      : input.launchDate;
    const normal = step.workingDaysAfter ? addWorkingDays(base, step.workingDaysAfter)
      : step.workingDaysBefore === 0 ? base : subtractWorkingDays(base, step.workingDaysBefore);
    const instances = step.perDelivery
      ? live.map(d => ({ key: launchTaskKey(step.key, d.id), deliveryLabel: dayMonth(d.deliveryDate), addedOn: d.addedOn as string | null }))
      : [{ key: launchTaskKey(step.key), deliveryLabel: undefined, addedOn: null as string | null }];
    for (const inst of instances) {
      const clamped = normal < input.plannedOn;
      if (clamped) tight = true;
      let date = clamped ? input.plannedOn : normal;
      // A delivery added later can't have been switched on before it existed.
      if (inst.addedOn) date = maxDate(date, inst.addedOn);
      const ctx = { boxName: input.boxName, deliveryLabel: inst.deliveryLabel, recipeCount: input.recipes?.length ?? 0 };
      const hint = step.hint?.(ctx);
      const link = step.link?.(ctx);
      tasks.push({
        key: inst.key, todo: true, date, kind: "launch",
        label: step.title(ctx), how: step.how(ctx),
        ...(hint ? { detail: hint } : {}),
        ...(clamped ? { clamped: true } : {}),
        automated: step.automated,
        ...(step.action ? { action: step.action } : {}),
        ...(link ? { link: link.href, linkLabel: link.label } : {}),
        past: date < input.today,
      });
    }
  }
  // Keep the template's order within a day; earlier days first.
  const order = new Map(tasks.map((t, i) => [t.key, i]));
  tasks.sort((a, b) => a.date.localeCompare(b.date) || order.get(a.key)! - order.get(b.key)!);
  return { tasks, tightTimeline: tight };
}

// ── One delivery's chain ────────────────────────────────────────────────────
export function buildDeliverySchedule(
  d: DeliveryInput,
  input: Pick<ScheduleInput, "boxName" | "launchDate" | "ordersCloseDays" | "bufferDays" | "bufferPct" | "recipes" | "specialists" | "doneKeys" | "today">,
): DeliverySchedule {
  const warnings: string[] = [];
  const delivery = d.deliveryDate;
  const despatch = prevWorkingDay(delivery);
  const production = prevWorkingDay(despatch);
  const prep = prevWorkingDay(production);
  const inBy = subtractWorkingDays(prep, input.bufferDays);
  const standardClose = subtractWorkingDays(production, input.ordersCloseDays);
  const expected = d.expectedBoxes;
  const packsPerRecipe = expected != null ? Math.ceil(expected * (1 + input.bufferPct / 100)) : null;
  const past = (x: string) => x < input.today;
  const cancelled = d.status === "cancelled";
  const isOpen = d.status === "open";

  // Only NEW ingredients are ordered from here, each on its own order-by.
  const label = dayMonth(delivery);
  const subs: OrderSubItem[] = input.specialists.map(i => {
    const o = supplierOrderBy(inBy, i, SPECIALIST_EXTRA_WORKING_DAYS);
    return {
      key: deliveryTaskKey(d.id, `order-new-i${i.ingredientId}`),
      ingredientId: i.ingredientId, name: i.name, supplier: i.supplierName,
      orderBy: o.date, ...(i.supplierId != null && i.cutoffTime ? { time: i.cutoffTime } : {}),
      link: i.orderingUrl, assumed: o.assumed || i.supplierId == null, past: past(o.date),
    };
  }).sort((a, b) => a.orderBy.localeCompare(b.orderBy) || a.name.localeCompare(b.name));
  const firstSub = subs[0];
  const latestClose = firstSub ? minDate(firstSub.orderBy, standardClose) : standardClose;
  const firstItems = firstSub ? subs.filter(x => x.orderBy === firstSub.orderBy) : [];
  const closeDriver: CloseDriver = firstSub && firstSub.orderBy <= standardClose
    ? { reason: "specialist", supplier: firstSub.supplier ?? "no supplier set", items: firstItems.map(x => x.name) }
    : { reason: "standard" };

  const tasks: ScheduleTask[] = [];
  const add = (step: string, t: Omit<ScheduleTask, "key" | "past" | "deliveryId" | "todo">) => {
    const key = deliveryTaskKey(d.id, step);
    tasks.push({ key, todo: becomesTodo({ kind: t.kind, key }), deliveryId: d.id, past: past(t.date), ...t });
  };

  if (!cancelled) {
    add("close-orders", {
      date: latestClose, kind: "orders",
      label: `Close orders for ${label} (latest)`,
      detail: closeDriver.reason === "specialist"
        ? `Latest day, because ${closeDriver.items!.join(", ")} ${closeDriver.items!.length === 1 ? "is a new ingredient" : "are new ingredients"} (+${SPECIALIST_EXTRA_WORKING_DAYS} working days' lead time) and must be ordered from the orders. Closing queues the production from the box's sales.`
        : `Latest day: ${plural(input.ordersCloseDays, "working day")} before production, to count the orders. Closing queues the production from the box's sales.`,
    });

    if (subs.length > 0) {
      add("order-new", {
        date: firstSub.orderBy,
        ...(firstSub.time ? { time: firstSub.time } : {}),
        kind: "ingredients",
        label: `Order the new ingredients for ${label}: ${subs.map(x => x.name).join(", ")}`,
        detail: `No core-menu recipe uses ${subs.length === 1 ? "it" : "them"} and ${subs.length === 1 ? "it isn't" : "they aren't"} on a kanban, so normal ordering won't. Each has its supplier's lead time + ${SPECIALIST_EXTRA_WORKING_DAYS} working days in case the supplier doesn't stock ${subs.length === 1 ? "it" : "them"}. Order on the forecast + buffer if orders are still open.`,
        subItems: subs,
        specialist: true,
        ...(subs.some(x => x.assumed) ? { assumed: true } : {}),
      });
    }

    add("ingredients-in", {
      date: inBy, kind: "ingredients", label: "All ingredients in",
      detail: `${plural(input.bufferDays, "working day")} before prep — the test-box safety buffer.`,
    });

    if (!isOpen) {
      const closedOn = d.closedOn ?? latestClose;
      add("zapiet-off", {
        date: closedOn, kind: "orders",
        label: `Turn off ${label} in Zapiet for '${input.boxName}'`,
        detail: "Orders are closed — stop customers picking this date.",
      });
      add("decide-mix", {
        date: maxDate(closedOn, addDays(production, -QUEUE_AHEAD_DAYS)), kind: "production",
        label: `Decide for ${shortDay(production)}: test batches only, or test + normal production?`,
        detail: "Choose on the delivery card — it ticks this off.",
      });
    }

    add("prep", { date: prep, kind: "prep", label: "Prep & dough", detail: "Follows the plan automatically once the production is on it." });
    add("production", {
      date: production, kind: "production", label: "Production",
      detail: [
        input.recipes.length ? `Make: ${input.recipes.join(", ")}.` : "",
        isOpen ? "Queued from the box's sales when orders close." : "",
      ].filter(Boolean).join(" ") || undefined,
    });
    add("despatch", { date: despatch, kind: "despatch", label: "Despatch" });
    add("delivery", { date: delivery, kind: "delivery", label: "Delivery" });
  }

  const order: TaskKind[] = ["launch", "orders", "ingredients", "prep", "production", "despatch", "delivery"];
  tasks.sort((a, b) => a.date.localeCompare(b.date) || order.indexOf(a.kind) - order.indexOf(b.kind) || a.key.localeCompare(b.key));

  if (!cancelled) {
    if (!isDeliveryDay(delivery)) warnings.push("Deliveries run Tuesday to Saturday — this delivery day isn't one of them.");
    const windowEnd = vipWindowEnd(input.launchDate);
    if (latestClose < windowEnd) {
      warnings.push(`Orders would have to close by ${shortDay(latestClose)}, before VIPs' guaranteed ${VIP_GUARANTEE_HOURS} hours are up (${shortDay(windowEnd)}) — pick a later delivery date.`);
    }
    if (isOpen && past(latestClose)) {
      warnings.push(`Still open after its latest close date (${shortDay(latestClose)}) — close orders now${closeDriver.reason === "specialist" ? ", or the new ingredients may not arrive in time" : ""}.`);
    }
    const done = new Set(input.doneKeys ?? []);
    // Only to-dos can be "not ticked" — milestones just happen.
    const late = tasks.filter(t => t.todo && t.past && !done.has(t.key));
    if (late.length > 0 && !past(delivery)) {
      warnings.push(`${plural(late.length, "deadline")} ${late.length === 1 ? "is" : "are"} already behind us and not ticked — check they were done, or move the delivery date.`);
    }
    if (input.specialists.some(s => s.supplierId == null)) {
      warnings.push(`A new ingredient has no supplier set — ${DEFAULT_LEAD_DAYS} working days' lead time assumed.`);
    }
    if (input.recipes.length === 0) {
      warnings.push("No recipes yet — any new ingredients to order, and their deadline for closing orders, appear once recipes are added.");
    }
  }

  return {
    id: d.id, deliveryDate: delivery, status: d.status,
    despatchDate: despatch, productionDate: production, prepDate: prep, ingredientsInBy: inBy,
    latestClose, closeDriver, closedOn: d.closedOn, productionMix: d.productionMix,
    expectedBoxes: expected, packsPerRecipe, tasks,
    afterClose: isOpen
      ? [`Production for ${shortDay(production)} is queued from the box's sales, automatically`, `Turn off ${label} in Zapiet`, "Decide: test only, or test + normal production"]
      : [],
    warnings,
  };
}

// ── The whole box ───────────────────────────────────────────────────────────
export function buildTestBoxSchedule(input: ScheduleInput): TestBoxSchedule {
  const warnings: string[] = [];
  const windowEnd = vipWindowEnd(input.launchDate);
  const { tasks: launchTasks, tightTimeline } = buildLaunchTasks(input);
  const deliveries = [...input.deliveries]
    .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate) || a.id - b.id)
    .map(d => buildDeliverySchedule(d, input));

  if (tightTimeline) warnings.push("Tight timeline — some launch steps were due before this box was planned, so they're due straight away.");
  if (input.publicLaunchDate && input.publicLaunchDate < windowEnd) {
    warnings.push(`The public launch is before VIPs' guaranteed ${VIP_GUARANTEE_HOURS} hours are up (${shortDay(windowEnd)}).`);
  }
  // No recipes at all: the recipe picker itself prompts (and each delivery
  // says what's missing), so no third copy of the message here.
  if (input.recipes.length > 0 && (input.recipes.length < 2 || input.recipes.length > 4)) warnings.push("A test box works best with 2–4 recipes.");
  if (deliveries.length === 0) warnings.push("Add a delivery date to see its production chain.");

  return {
    launchDate: input.launchDate, publicLaunchDate: input.publicLaunchDate, vipWindowEnds: windowEnd,
    launchTasks, tightTimeline, deliveries, warnings,
  };
}

/** Every task of the box (to-dos and milestones), launch checklist first. */
export function allTasks(s: TestBoxSchedule): ScheduleTask[] {
  return [...s.launchTasks, ...s.deliveries.flatMap(d => d.tasks)];
}

/** Only the tasks that are to-dos (tickable). */
export function todoTasks(s: TestBoxSchedule): ScheduleTask[] {
  return allTasks(s).filter(t => t.todo);
}

/** The box's calendar bar: launch → its last live delivery (or the end of
 *  the VIP window / public launch, whichever is later). */
export function calendarSpan(s: TestBoxSchedule): { startDate: string; endDate: string } {
  let end = maxDate(s.launchDate, s.vipWindowEnds);
  if (s.publicLaunchDate) end = maxDate(end, s.publicLaunchDate);
  for (const d of s.deliveries) if (d.status !== "cancelled") end = maxDate(end, d.deliveryDate);
  return { startDate: s.launchDate, endDate: end };
}

/** The key dates shown on the marketing calendar as diamonds. */
export function calendarMilestones(s: TestBoxSchedule): Array<{ date: string; label: string; kind: TaskKind }> {
  const out: Array<{ date: string; label: string; kind: TaskKind }> = [
    { date: s.launchDate, label: "VIP launch", kind: "launch" },
    { date: s.vipWindowEnds, label: "VIP-only window ends", kind: "launch" },
  ];
  if (s.publicLaunchDate) out.push({ date: s.publicLaunchDate, label: "Public launch", kind: "launch" });
  const live = s.deliveries.filter(d => d.status !== "cancelled");
  const suffix = (d: DeliverySchedule) => (live.length > 1 ? ` (${dayMonth(d.deliveryDate)} delivery)` : "");
  for (const d of live) {
    out.push(d.closedOn
      ? { date: d.closedOn, label: `Orders closed${suffix(d)}`, kind: "orders" }
      : { date: d.latestClose, label: `Close orders by${suffix(d)}`, kind: "orders" });
    out.push({ date: d.prepDate, label: `Prep & dough${suffix(d)}`, kind: "prep" });
    out.push({ date: d.productionDate, label: `Production${suffix(d)}`, kind: "production" });
    out.push({ date: d.deliveryDate, label: `Delivery${suffix(d)}`, kind: "delivery" });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
