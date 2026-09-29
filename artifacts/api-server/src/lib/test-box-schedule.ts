/**
 * Test-box back-scheduling (Graeme; memory project_test_box_tool). Pure — no
 * database — so every rule is unit-tested (test-box-schedule.test.ts).
 *
 * Start from the day the box reaches the customer and walk BACKWARDS:
 *
 *   delivery      the chosen day (deliveries run Tue–Sat)
 *   despatch      the working day before delivery (lib/production-cutoff:
 *                 "despatch the day before")
 *   production    the working day before despatch (produce day 1, despatch
 *                 day 2, deliver day 3 — the normal rhythm)
 *   prep / dough  the working day before production (dough and main prep
 *                 always happen the day before — station planning rules)
 *   ingredients   must be IN by prep day minus the safety buffer (bufferDays
 *                 working days early — the "bigger buffer than a normal plan";
 *                 a normal plan has ingredients land for prep day itself)
 *   order-by      per supplier: arrive-by minus the supplier's lead time in
 *                 working days, placed before its cut-off time, and rolled
 *                 back to one of its order days when it only takes orders on
 *                 set days. Same meaning as the orders page's
 *                 calcExpectedDeliveryDate (lead time = working days after an
 *                 order placed before cut-off).
 *   orders close  ordersCloseDays working days before production, so there is
 *                 time to count orders and set quantities
 *   selling       starts sellingDays calendar days before orders close; for
 *                 "VIP then public" the public opens vipHeadStartDays later.
 *
 * Working days are Monday–Friday. Bank holidays are not known to the system
 * yet, so a deadline landing on one needs a human eye (the page says so).
 */
import { isDeliveryDay } from "./production-cutoff";

export type Audience = "vip" | "vip_then_public" | "public";

export interface SupplierLead {
  /** null = these ingredients have no supplier set. */
  supplierId: number | null;
  name: string;
  leadTimeDays: number | null;
  cutoffTime: string | null;
  orderFrequency: string | null;
  /** "Monday,Thursday" when the supplier only takes orders on set days. */
  orderDays: string | null;
  items: string[];
}

export interface ScheduleInput {
  deliveryDate: string;
  audience: Audience;
  sellingDays: number;
  ordersCloseDays: number;
  bufferDays: number;
  vipHeadStartDays: number;
  bufferPct: number;
  expectedBoxes: number | null;
  recipes: string[];
  suppliers: SupplierLead[];
  today: string;
}

export type TaskKind = "marketing" | "orders" | "ingredients" | "prep" | "production" | "despatch" | "delivery";

export interface ScheduleTask {
  /** Stable across recalculations — ticks are stored against it. */
  key: string;
  date: string;
  /** Wall-clock deadline on that day, when there is one (supplier cut-off). */
  time?: string;
  kind: TaskKind;
  label: string;
  detail?: string;
  items?: string[];
  /** The date rests on an assumption (no supplier set / default lead time). */
  assumed?: boolean;
  /** Needs ordering before orders close — order on forecast + buffer. */
  beforeOrdersClose?: boolean;
  /** The date is already behind us. */
  past: boolean;
}

export interface TestBoxSchedule {
  deliveryDate: string;
  despatchDate: string;
  productionDate: string;
  prepDate: string;
  ingredientsInBy: string;
  ordersClose: string;
  sellingStart: string;
  publicStart: string | null;
  /** Packs of EACH recipe to make: expected boxes + buffer, one pack of each recipe per box. */
  packsPerRecipe: number | null;
  tasks: ScheduleTask[];
  warnings: string[];
}

/** Used when an ingredient has no supplier: a cautious guess, flagged. */
export const DEFAULT_LEAD_DAYS = 3;

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}
function weekday(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}
export function isWorkingDay(iso: string): boolean {
  const w = weekday(iso);
  return w >= 1 && w <= 5;
}
/** The working day before `iso`. */
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

/** Latest date on or before `iso` whose weekday is one of the supplier's order days. */
export function latestOrderDay(iso: string, orderDays: string | null): string {
  const allowed = new Set((orderDays ?? "").split(",").map(s => WEEKDAYS.indexOf(s.trim())).filter(n => n >= 0));
  if (allowed.size === 0) return iso;
  let d = iso;
  for (let i = 0; i < 7 && !allowed.has(weekday(d)); i++) d = addDays(d, -1);
  return d;
}

/** When to order from one supplier so the goods are in by `arriveBy`. */
export function supplierOrderBy(arriveBy: string, s: Pick<SupplierLead, "leadTimeDays" | "orderFrequency" | "orderDays">): { date: string; assumed: boolean } {
  const assumed = s.leadTimeDays == null;
  const lead = s.leadTimeDays ?? DEFAULT_LEAD_DAYS;
  let date = subtractWorkingDays(arriveBy, lead);
  if (s.orderFrequency === "weekly" && s.orderDays) date = latestOrderDay(date, s.orderDays);
  return { date, assumed };
}

export function buildTestBoxSchedule(input: ScheduleInput): TestBoxSchedule {
  const warnings: string[] = [];
  const delivery = input.deliveryDate;
  if (!isDeliveryDay(delivery)) warnings.push("Deliveries run Tuesday to Saturday — this delivery day isn't one of them.");

  const despatch = prevWorkingDay(delivery);
  const production = prevWorkingDay(despatch);
  const prep = prevWorkingDay(production);
  const inBy = subtractWorkingDays(prep, input.bufferDays);
  const ordersClose = subtractWorkingDays(production, input.ordersCloseDays);
  const sellingStart = addDays(ordersClose, -input.sellingDays);
  const publicStart = input.audience === "vip_then_public"
    ? (() => {
      const p = addDays(sellingStart, input.vipHeadStartDays);
      return p > ordersClose ? ordersClose : p;
    })()
    : null;
  const packsPerRecipe = input.expectedBoxes != null
    ? Math.ceil(input.expectedBoxes * (1 + input.bufferPct / 100))
    : null;

  const past = (d: string) => d < input.today;
  const tasks: ScheduleTask[] = [];

  tasks.push({
    key: "sell-start", date: sellingStart, kind: "marketing",
    label: input.audience === "public" ? "Start selling the test box" : "Start selling — announce it to VIPs",
    detail: input.audience === "vip" ? "VIP customers only for this box." : undefined,
    past: past(sellingStart),
  });
  if (publicStart) {
    tasks.push({ key: "public-launch", date: publicStart, kind: "marketing", label: "Open it to everyone (public launch)", past: past(publicStart) });
  }
  tasks.push({
    key: "orders-close", date: ordersClose, kind: "orders",
    label: "Orders close for this delivery",
    detail: `Count the orders and set quantities: orders + ${input.bufferPct}% buffer${packsPerRecipe != null ? ` (plan: ${packsPerRecipe} packs of each recipe)` : ""}.`,
    past: past(ordersClose),
  });

  for (const s of input.suppliers) {
    const { date, assumed } = supplierOrderBy(inBy, s);
    const lead = s.leadTimeDays ?? DEFAULT_LEAD_DAYS;
    tasks.push({
      key: `order-supplier-${s.supplierId ?? "none"}`,
      date,
      time: s.supplierId != null ? (s.cutoffTime ?? undefined) : undefined,
      kind: "ingredients",
      label: s.supplierId == null ? "Order ingredients with no supplier set" : `Order from ${s.name}`,
      detail: s.supplierId == null
        ? `No supplier is set on these ingredients, so ${DEFAULT_LEAD_DAYS} working days' lead time is assumed — set their supplier to firm this up.`
        : `${lead} working day${lead === 1 ? "" : "s"} lead time${s.orderFrequency === "weekly" && s.orderDays ? `; takes orders ${s.orderDays.split(",").join(", ")}` : ""}.`,
      items: s.items,
      assumed,
      beforeOrdersClose: date < ordersClose,
      past: past(date),
    });
  }

  tasks.push({
    key: "ingredients-in", date: inBy, kind: "ingredients",
    label: "All ingredients in",
    detail: `${input.bufferDays} working day${input.bufferDays === 1 ? "" : "s"} before prep — the test-box safety buffer.`,
    past: past(inBy),
  });
  tasks.push({ key: "prep", date: prep, kind: "prep", label: "Prep & dough day", detail: "Dough and main prep the day before production.", past: past(prep) });
  tasks.push({
    key: "production", date: production, kind: "production",
    label: "Production day",
    detail: [
      input.recipes.length ? `Make: ${input.recipes.join(", ")}.` : "",
      packsPerRecipe != null ? `${packsPerRecipe} packs of each (${input.expectedBoxes} boxes + ${input.bufferPct}% buffer).` : "",
    ].filter(Boolean).join(" ") || undefined,
    past: past(production),
  });
  tasks.push({ key: "despatch", date: despatch, kind: "despatch", label: "Despatch", past: past(despatch) });
  tasks.push({ key: "delivery", date: delivery, kind: "delivery", label: "Delivery day", past: past(delivery) });

  const order: TaskKind[] = ["marketing", "orders", "ingredients", "prep", "production", "despatch", "delivery"];
  tasks.sort((a, b) => a.date.localeCompare(b.date) || order.indexOf(a.kind) - order.indexOf(b.kind) || a.key.localeCompare(b.key));

  const late = tasks.filter(t => t.past && t.kind !== "delivery");
  if (late.length > 0 && !past(delivery)) {
    warnings.push(`${late.length} deadline${late.length === 1 ? " is" : "s are"} already behind us — check they were done, or move the delivery date.`);
  }
  if (input.recipes.length > 0 && (input.recipes.length < 2 || input.recipes.length > 4)) {
    warnings.push("A test box works best with 2–4 recipes.");
  }
  if (input.suppliers.some(s => s.supplierId == null)) {
    warnings.push(`Some ingredients have no supplier set — ${DEFAULT_LEAD_DAYS} working days' lead time assumed.`);
  }
  if (input.recipes.length === 0) warnings.push("Add the recipes in this box to see what to order and when.");

  return {
    deliveryDate: delivery, despatchDate: despatch, productionDate: production, prepDate: prep,
    ingredientsInBy: inBy, ordersClose, sellingStart, publicStart, packsPerRecipe, tasks, warnings,
  };
}

/** The key deadlines shown on the marketing calendar as milestones. */
export function calendarMilestones(s: TestBoxSchedule): Array<{ date: string; label: string; kind: TaskKind }> {
  const out: Array<{ date: string; label: string; kind: TaskKind }> = [];
  if (s.publicStart) out.push({ date: s.publicStart, label: "Public launch", kind: "marketing" });
  out.push({ date: s.ordersClose, label: "Orders close", kind: "orders" });
  const firstOrder = s.tasks.filter(t => t.key.startsWith("order-supplier-")).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (firstOrder) out.push({ date: firstOrder.date, label: `First ingredient order (${firstOrder.label.replace(/^Order from /, "")})`, kind: "ingredients" });
  out.push({ date: s.prepDate, label: "Prep & dough", kind: "prep" });
  out.push({ date: s.productionDate, label: "Production", kind: "production" });
  out.push({ date: s.deliveryDate, label: "Delivery", kind: "delivery" });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
