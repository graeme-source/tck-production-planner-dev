/**
 * Orders with no delivery date, for the managers' dashboard (rules:
 * undated-orders-rules.ts). Reads Shopify's unfulfilled orders, remembers
 * which ones a manager marked as fine (app_settings, one list), and writes
 * the delivery-date tag when a manager picks a date.
 */
import { db, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  addTagsToOrder, getOrderForReschedule, getRecentUnfulfilledOrders, shopifyAdminOrderUrl,
  updateOrderTagsAndAttributes, type ShopifyOrder,
} from "../services/shopify";
import { ensureFreshDisputes, loadOpenDisputes } from "./order-disputes-store";
import { DISPUTE_ON_DEMAND_MIN_AGE_MS, isHeldForChargeback } from "./order-disputes";
import { londonDateString } from "./london-time";
import { suggestDeliveryDateFromNote } from "./note-delivery-date";
import { withDeliveryDate } from "./order-reschedule";
import { earliestTagOnlyDeliveryDay } from "./production-cutoff";
import {
  deliveryDayOptions, suggestedDeliveryDate, tagsWithDeliveryDate, undatedOrders, withDismissed,
  type DismissedOrder, type UndatedOrder,
} from "./undated-orders-rules";

const KEY = "undated_orders_dismissed";
/** Older than this and an undated order is history, not something to send. */
const SCAN_DAYS_BACK = 14;
/** About three weeks of Tue–Sat delivery days to pick from. */
const DATE_OPTIONS = 15;
/** Every manager's dashboard asks once a minute; Shopify is read at most this often. */
const ORDERS_TTL_MS = 60_000;

let ordersCache: { at: number; orders: ShopifyOrder[] } | null = null;

async function unfulfilledOrders(): Promise<ShopifyOrder[]> {
  if (ordersCache && Date.now() - ordersCache.at < ORDERS_TTL_MS) return ordersCache.orders;
  // An order held for a chargeback is off the pack list on purpose.
  await ensureFreshDisputes(DISPUTE_ON_DEMAND_MIN_AGE_MS);
  const held = new Set((await loadOpenDisputes()).keys());
  const orders = (await getRecentUnfulfilledOrders(SCAN_DAYS_BACK)).filter(o => !isHeldForChargeback(o, held));
  ordersCache = { at: Date.now(), orders };
  return orders;
}

async function readDismissed(): Promise<DismissedOrder[]> {
  const [row] = await db.select({ value: appSettingsTable.value }).from(appSettingsTable).where(eq(appSettingsTable.key, KEY));
  if (!row?.value) return [];
  try {
    const list = JSON.parse(row.value) as unknown;
    return Array.isArray(list) ? (list as DismissedOrder[]) : [];
  } catch { return []; }
}

async function writeDismissed(list: DismissedOrder[]): Promise<void> {
  const value = JSON.stringify(list);
  await db.insert(appSettingsTable).values({ key: KEY, value })
    .onConflictDoUpdate({ target: appSettingsTable.key, set: { value, updatedAt: new Date() } });
}

export interface UndatedOrderRow extends UndatedOrder {
  adminUrl: string;
  /** The date offered first in the picker. */
  suggestedDate: string | null;
}

export interface UndatedOrdersPayload {
  orders: UndatedOrderRow[];
  /** Delivery days that can still be despatched for, earliest first. */
  deliveryDates: string[];
}

function dateOptions(now: Date): string[] {
  return deliveryDayOptions(earliestTagOnlyDeliveryDay(now), DATE_OPTIONS);
}

export async function listUndatedOrders(now: Date = new Date()): Promise<UndatedOrdersPayload> {
  const [orders, dismissed] = await Promise.all([unfulfilledOrders(), readDismissed()]);
  const deliveryDates = dateOptions(now);
  const today = londonDateString(now);
  const rows = undatedOrders(orders, now, new Set(dismissed.map(d => d.id))).map(o => {
    const noteDate = suggestDeliveryDateFromNote(o.note, londonDateString(new Date(o.placedAt)), today)?.date ?? null;
    return { ...o, adminUrl: shopifyAdminOrderUrl(o.id), suggestedDate: suggestedDeliveryDate(o.bookedDate, noteDate, deliveryDates) };
  });
  return { orders: rows, deliveryDates };
}

/** A manager is happy this one doesn't need sending: off the list for good.
 *  Returns the order's name for the log. */
export async function markUndatedOrderFine(orderId: number, by: string | null, now: Date = new Date()): Promise<string> {
  const name = ordersCache?.orders.find(o => o.id === orderId)?.name ?? `order ${orderId}`;
  await writeDismissed(withDismissed(await readDismissed(), { id: orderId, name, by, at: now.toISOString() }, now));
  return name;
}

/** Why a delivery date couldn't be set — `status` is the HTTP status to answer with. */
export class UndatedOrderError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Give the order its delivery date: the date tag is added in Shopify, and
 *  if the customer booked a different day at checkout that booking is moved
 *  to match, so the planner and the customer see the same date. */
export async function setUndatedOrderDeliveryDate(orderId: number, deliveryDate: string, now: Date = new Date()): Promise<{ name: string; previousBookedDate: string | null }> {
  if (!dateOptions(now).includes(deliveryDate)) {
    throw new UndatedOrderError(400, "That day can't be delivered any more. Pick another day.");
  }
  const order = await getOrderForReschedule(orderId);
  if (!order) throw new UndatedOrderError(502, "Couldn't read that order from Shopify. Try again in a moment.");
  const tags = tagsWithDeliveryDate(order.tags, deliveryDate);
  if (tags == null) throw new UndatedOrderError(409, `${order.name} already has a delivery date. Nothing was changed.`);

  const hasBooking = order.noteAttributes.some(a => a.name === "Delivery-Date");
  const booking = hasBooking ? withDeliveryDate(order.noteAttributes, deliveryDate) : null;
  if (booking?.changed) {
    await updateOrderTagsAndAttributes(orderId, tags, booking.attributes);
  } else {
    await addTagsToOrder(orderId, order.tags, [deliveryDate]);
  }
  ordersCache = null;
  return { name: order.name, previousBookedDate: booking?.changed ? booking.previous : null };
}
