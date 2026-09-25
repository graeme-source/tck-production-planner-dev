/**
 * Holiday and employment facts from Planday, shaped for a person's record
 * (Graeme, 2026-09-25: "we should have their holiday balance and stuff like
 * that in their record as well"). Pure — services/planday-employment.ts
 * makes the calls; these functions only read the responses, whose real
 * shapes (checked against TCK's Planday, 2026-09-25) are:
 *
 *   GET /absence/v1.0/accounts?employeeId=N
 *     { data: [{ id, name: "Standard Hourly Accrual", status: "Active"|"Inactive",
 *                validityPeriod: { start: "2026-01-01", end: "2026-12-31" } }] }
 *     — one account per holiday year; the current one is "Active".
 *   GET /absence/v1.0/accounts/{id}/balance[?balanceDate=YYYY-MM-DD]
 *     { data: { balance: [{ value: -2.81, unit: { type: "Hours" } }] } }
 *     — with balanceDate=today: accrued so far minus taken so far (what they
 *       can book now); with no date: the balance at the END of the holiday
 *       year, after every booked day and the rota'd shifts' accrual.
 *   GET /absence/v1.0/accounts/{id}/transactions
 *     { data: [{ type: "Entry", date: "2026-11-06", costs: [{ value: -8.25, unit: { type: "Hours" } }] }] }
 *     — holiday TAKEN or BOOKED (negative costs), never holiday earned.
 *       Future-dated entries are booked holiday.
 *   GET /hr/v1.0/employees/N
 *     { data: { hiredFrom: "2022-03-23", employeeTypeId: 2362, contractRulesRuleId: 2179, … } }
 */
import { isAbsenceReasonName } from "../services/attendance-classify";

export interface PdAccount {
  id: number;
  name: string;
  status?: string | null;
  validityPeriod?: { start?: string | null; end?: string | null } | null;
}

export interface PdAmount { value: number; unit?: { type?: string | null } | null }

export interface PdBalanceResponse { data?: { balance?: PdAmount[] | null } | null }

export interface PdTransaction {
  date?: string | null;
  type?: string | null;
  costs?: PdAmount[] | null;
}

export interface PdEmployee {
  hiredFrom?: string | null;
  employeeTypeId?: number | null;
  contractRulesRuleId?: number | null;
  isDeactivated?: boolean | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The holiday accounts that matter today: Active, a holiday account (not a
 * sickness / leave account — the absence classifier decides), and valid on
 * today's date. Falls back to any Active holiday account if none covers today.
 */
export function currentHolidayAccounts(accounts: readonly PdAccount[], todayIso: string): PdAccount[] {
  const holiday = accounts.filter(a => (a.status ?? "").toLowerCase() === "active" && !isAbsenceReasonName(a.name));
  const covering = holiday.filter(a => {
    const s = a.validityPeriod?.start ?? null;
    const e = a.validityPeriod?.end ?? null;
    return (!s || s <= todayIso) && (!e || e >= todayIso);
  });
  return covering.length > 0 ? covering : holiday;
}

/** The first balance figure in a /balance response (value + unit). */
export function balanceAmount(resp: PdBalanceResponse | null | undefined): { value: number; unit: string } | null {
  const b = resp?.data?.balance?.[0];
  if (!b || typeof b.value !== "number" || !Number.isFinite(b.value)) return null;
  return { value: b.value, unit: b.unit?.type || "Hours" };
}

export interface HolidayAccountData {
  account: PdAccount;
  balanceNow: PdBalanceResponse | null;
  balanceYearEnd: PdBalanceResponse | null;
  transactions: readonly PdTransaction[];
}

export interface HolidaySummary {
  accountNames: string[];
  yearStart: string | null;
  yearEnd: string | null;
  unit: string;
  /** What they have available now (accrued so far − taken so far). */
  balanceNow: number | null;
  /** Projected balance at the end of the holiday year, after booked holiday. */
  balanceAfterBooked: number | null;
  /** Taken so far this holiday year. */
  takenThisYear: number;
  /** Booked, still to come. */
  upcoming: Array<{ date: string; amount: number }>;
  upcomingTotal: number;
}

/** Sum the current holiday accounts into one picture, in the first
 *  account's unit (TCK's are all hours; other units are left out rather
 *  than added to hours). */
export function summariseHoliday(data: readonly HolidayAccountData[], todayIso: string): HolidaySummary | null {
  if (data.length === 0) return null;
  const unit = balanceAmount(data[0].balanceNow)?.unit
    ?? data[0].transactions.find(t => t.costs?.[0])?.costs?.[0]?.unit?.type
    ?? "Hours";

  let balanceNow: number | null = null;
  let balanceAfterBooked: number | null = null;
  let taken = 0;
  const upcoming: Array<{ date: string; amount: number }> = [];
  const starts: string[] = [];
  const ends: string[] = [];

  for (const d of data) {
    const now = balanceAmount(d.balanceNow);
    if (now && now.unit === unit) balanceNow = (balanceNow ?? 0) + now.value;
    const end = balanceAmount(d.balanceYearEnd);
    if (end && end.unit === unit) balanceAfterBooked = (balanceAfterBooked ?? 0) + end.value;
    if (d.account.validityPeriod?.start) starts.push(d.account.validityPeriod.start);
    if (d.account.validityPeriod?.end) ends.push(d.account.validityPeriod.end);
    for (const t of d.transactions) {
      const date = (t.date ?? "").slice(0, 10);
      if (!date) continue;
      let amount = 0;
      for (const c of t.costs ?? []) {
        if ((c.unit?.type || "Hours") !== unit || typeof c.value !== "number") continue;
        if (c.value < 0) amount += -c.value; // negative cost = holiday used
      }
      if (amount <= 0) continue;
      if (date <= todayIso) taken += amount;
      else upcoming.push({ date, amount: round2(amount) });
    }
  }

  upcoming.sort((a, b) => a.date.localeCompare(b.date));
  return {
    accountNames: [...new Set(data.map(d => d.account.name))],
    yearStart: starts.sort()[0] ?? null,
    yearEnd: ends.sort().at(-1) ?? null,
    unit,
    balanceNow: balanceNow == null ? null : round2(balanceNow),
    balanceAfterBooked: balanceAfterBooked == null ? null : round2(balanceAfterBooked),
    takenThisYear: round2(taken),
    upcoming,
    upcomingTotal: round2(upcoming.reduce((s, u) => s + u.amount, 0)),
  };
}

export interface EmploymentSummary {
  hiredFrom: string | null;
  employeeType: string | null;
  /** The Planday contract rule, e.g. "16.5 Hours per week"; null = none assigned. */
  contractRule: string | null;
  contractRuleNote: string | null;
}

export function summariseEmployment(
  employee: PdEmployee | null,
  employeeTypes: ReadonlyArray<{ id: number; name: string }>,
  contractRules: ReadonlyArray<{ id: number; name: string; description?: string | null }>,
): EmploymentSummary {
  const type = employee?.employeeTypeId != null ? employeeTypes.find(t => t.id === employee.employeeTypeId) : undefined;
  const ruleId = employee?.contractRulesRuleId ?? null;
  const rule = ruleId != null ? contractRules.find(r => r.id === ruleId) : undefined;
  return {
    hiredFrom: employee?.hiredFrom ? employee.hiredFrom.slice(0, 10) : null,
    employeeType: type?.name ?? null,
    contractRule: rule?.name ?? (ruleId != null ? "Set in Planday" : null),
    contractRuleNote: rule?.description ? rule.description : null,
  };
}
