/**
 * Current rate of pay and the last pay rise, from Planday, kept in the app
 * (Graeme, 26 Nov 2026). For everyone linked to Planday: their pay rates
 * (/pay/v1.0/payrates/employees/{id}, one per employee group) and two years
 * of paid shifts (payroll, in 28-day windows), whose rates give the last
 * rise (lib/pay-rate-history.ts). Runs after boot and once a day; "Refresh"
 * on the card runs it now. READ-ONLY towards Planday. People access only —
 * the table is read through routes/people-pay.ts. Objective H.
 */
import { db, peoplePayRatesTable, usersTable } from "@workspace/db";
import { and, eq, isNotNull } from "drizzle-orm";
import { getPlandayPayrollRows, isPlandayConfigured, plandayRead } from "./planday";
import { payHistory, type PaidShift } from "../lib/pay-rate-history";
import { londonDateString } from "../lib/london-time";

const HISTORY_DAYS = 730;
const WINDOW_DAYS = 28;
const EVERY_MS = 24 * 60 * 60 * 1000;

type Rate = { rate: number; wageType: string; salaryCode: string; employeeGroupId: number };

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

let running: Promise<{ people: number }> | null = null;

/** One run at a time; a second call gets the run in progress. */
export function syncPayRates(): Promise<{ people: number }> {
  running ??= run().finally(() => { running = null; });
  return running;
}

async function run(): Promise<{ people: number }> {
  if (!isPlandayConfigured()) return { people: 0 };
  const people = await db.select({ id: usersTable.id, plandayId: usersTable.plandayEmployeeId })
    .from(usersTable).where(and(eq(usersTable.isActive, true), isNotNull(usersTable.plandayEmployeeId)));
  if (!people.length) return { people: 0 };

  // Two years of paid shifts, everyone at once, a window at a time.
  const today = londonDateString(new Date());
  const historyFrom = addDays(today, -HISTORY_DAYS);
  const byEmployee = new Map<number, PaidShift[]>();
  let historyOk = true;
  for (let from = historyFrom; from <= today; from = addDays(from, WINDOW_DAYS)) {
    const end = addDays(from, WINDOW_DAYS - 1);
    const rows = await getPlandayPayrollRows(from, end < today ? end : today);
    if (!rows) { historyOk = false; continue; }
    for (const r of rows) {
      const list = byEmployee.get(r.employeeId) ?? [];
      list.push({ date: r.date, rate: Number(r.wage?.rate ?? 0), type: String(r.wage?.type ?? "") });
      byEmployee.set(r.employeeId, list);
    }
  }

  let done = 0;
  for (const p of people) {
    const eid = Number(p.plandayId);
    const res = await plandayRead<{ data?: Array<{ rate?: number; wageType?: string; salaryCode?: string; employeeGroupId?: number }> }>(
      `/pay/v1.0/payrates/employees/${eid}`,
    ).catch(() => null);
    const rates: Rate[] = (res?.data ?? [])
      .filter(r => Number(r.rate) > 0)
      .map(r => ({ rate: Number(r.rate), wageType: String(r.wageType ?? ""), salaryCode: String(r.salaryCode ?? ""), employeeGroupId: Number(r.employeeGroupId ?? 0) }));
    const hist = payHistory(byEmployee.get(eid) ?? []);
    const highestHourly = rates.filter(r => /hour/i.test(r.wageType)).sort((a, b) => b.rate - a.rate)[0] ?? null;
    const currentRate = hist.currentRate ?? highestHourly?.rate ?? null;
    if (!res && hist.currentRate == null) continue; // Planday didn't answer for them: keep what's saved
    const values: Partial<typeof peoplePayRatesTable.$inferInsert> = {
      plandayEmployeeId: eid,
      rates,
      currentRate: currentRate != null ? String(currentRate) : null,
      wageType: hist.currentRate != null ? "HourlyRate" : highestHourly?.wageType ?? rates[0]?.wageType ?? null,
      syncedAt: new Date(),
      // The history only when every window answered — never a half picture.
      ...(historyOk ? {
        lastChangeOn: hist.lastChangeOn,
        previousRate: hist.previousRate != null ? String(hist.previousRate) : null,
        changes: hist.changes,
        historyFrom,
      } : {}),
    };
    await db.insert(peoplePayRatesTable).values({ userId: p.id, ...values })
      .onConflictDoUpdate({ target: peoplePayRatesTable.userId, set: values });
    done++;
  }
  return { people: done };
}

export function startPayRateSync(): void {
  const go = () => syncPayRates().catch(err => console.warn("[pay-rates] sync failed (will retry tomorrow):", err instanceof Error ? err.message : err));
  setTimeout(go, 90_000).unref();
  setInterval(go, EVERY_MS).unref();
}
