// A month's revenue for the bonus (Graeme, 6 Nov 2026): the month's sales after
// refunds, the same orders and rules as Month to Date on Numbers. Pure, tested.
import { getNetRevenue, isCountableOrder } from "./order-revenue";

type RevenueOrder = Parameters<typeof getNetRevenue>[0] & Parameters<typeof isCountableOrder>[0] & { id: number };

/** London days of a month, stopping at today while it's running. */
export function monthDays(month: string, today: string): { from: string; to: string; complete: boolean } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
  return { from: `${month}-01`, to: last < today ? last : today, complete: last < today };
}

export function monthRevenue(orders: RevenueOrder[]): { total: number; orders: number } {
  const counted = [...new Map(orders.map(o => [o.id, o])).values()].filter(isCountableOrder);
  const pence = counted.reduce((sum, o) => sum + Math.round(getNetRevenue(o) * 100), 0);
  return { total: pence / 100, orders: counted.length };
}
