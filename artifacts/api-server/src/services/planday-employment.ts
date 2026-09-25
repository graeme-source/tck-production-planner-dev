/**
 * Employment & holiday facts for one person's record, straight from Planday
 * (Graeme, 2026-09-25). Read-only GETs, cached per Planday employee for 10
 * minutes so flicking between records doesn't hammer the API. A failure is
 * never cached and never blocks the rest of the record — the route answers
 * status "unreachable" and the panel offers "try again".
 *
 * Shaping is pure and tested: lib/holiday-summary.ts.
 */
import {
  isPlandayConfigured, plandayRead, plandayReadAll,
  getPlandayEmployeeTypes, getPlandayContractRules,
} from "./planday";
import {
  currentHolidayAccounts, summariseHoliday, summariseEmployment,
  type PdAccount, type PdBalanceResponse, type PdTransaction, type PdEmployee,
  type HolidaySummary, type EmploymentSummary,
} from "../lib/holiday-summary";

export type EmploymentFacts =
  | { status: "ok"; employment: EmploymentSummary; holiday: HolidaySummary | null; fetchedAt: string }
  | { status: "not_configured" | "unreachable" };

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<number, { facts: EmploymentFacts; expiresAt: number }>();

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function fetchFacts(plandayId: number): Promise<EmploymentFacts> {
  const today = todayIso();
  const [employeeResp, accountsResp, employeeTypes, contractRules] = await Promise.all([
    plandayRead<{ data?: PdEmployee }>(`/hr/v1.0/employees/${plandayId}`),
    plandayRead<{ data?: PdAccount[] }>(`/absence/v1.0/accounts?employeeId=${plandayId}`),
    getPlandayEmployeeTypes(),
    getPlandayContractRules(),
  ]);
  // The HR record is the one call that must work: without it we can't
  // tell "no contract rule" from "Planday didn't answer".
  if (!employeeResp?.data) return { status: "unreachable" };

  let holiday: HolidaySummary | null = null;
  if (accountsResp?.data) {
    const current = currentHolidayAccounts(accountsResp.data, today);
    const perAccount = await Promise.all(current.map(async account => {
      const [balanceNow, balanceYearEnd, transactions] = await Promise.all([
        plandayRead<PdBalanceResponse>(`/absence/v1.0/accounts/${account.id}/balance?balanceDate=${today}`),
        plandayRead<PdBalanceResponse>(`/absence/v1.0/accounts/${account.id}/balance`),
        plandayReadAll<PdTransaction>(`/absence/v1.0/accounts/${account.id}/transactions`),
      ]);
      return { account, balanceNow, balanceYearEnd, transactions };
    }));
    holiday = summariseHoliday(perAccount, today);
  }

  return {
    status: "ok",
    employment: summariseEmployment(employeeResp.data, employeeTypes, contractRules),
    holiday,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Just the contract rule and start date — the "Hours worked" report and the
 * team's "Hours vs contract" view need these for everyone, without the
 * holiday balance calls. Answers from the full employment cache when that's
 * warm; otherwise one HR call, cached for the same 10 minutes.
 */
export type ContractRuleFacts =
  | { status: "ok"; contractRule: string | null; hiredFrom: string | null }
  | { status: "not_configured" | "unreachable" };

const ruleCache = new Map<number, { facts: ContractRuleFacts; expiresAt: number }>();

export async function getContractRuleFacts(plandayId: number): Promise<ContractRuleFacts> {
  if (!isPlandayConfigured()) return { status: "not_configured" };
  const full = cache.get(plandayId);
  if (full && Date.now() < full.expiresAt && full.facts.status === "ok") {
    return { status: "ok", contractRule: full.facts.employment.contractRule, hiredFrom: full.facts.employment.hiredFrom };
  }
  const hit = ruleCache.get(plandayId);
  if (hit && Date.now() < hit.expiresAt) return hit.facts;
  try {
    const [employeeResp, employeeTypes, contractRules] = await Promise.all([
      plandayRead<{ data?: PdEmployee }>(`/hr/v1.0/employees/${plandayId}`),
      getPlandayEmployeeTypes(),
      getPlandayContractRules(),
    ]);
    if (!employeeResp?.data) return { status: "unreachable" };
    const e = summariseEmployment(employeeResp.data, employeeTypes, contractRules);
    const facts: ContractRuleFacts = { status: "ok", contractRule: e.contractRule, hiredFrom: e.hiredFrom };
    ruleCache.set(plandayId, { facts, expiresAt: Date.now() + TTL_MS });
    return facts;
  } catch (err) {
    console.warn(`[planday-employment] contract rule for ${plandayId} failed:`, err instanceof Error ? err.message : err);
    return { status: "unreachable" };
  }
}

export async function getEmploymentFacts(plandayId: number, opts: { fresh?: boolean } = {}): Promise<EmploymentFacts> {
  if (!isPlandayConfigured()) return { status: "not_configured" };
  const hit = cache.get(plandayId);
  if (!opts.fresh && hit && Date.now() < hit.expiresAt) return hit.facts;
  try {
    const facts = await fetchFacts(plandayId);
    if (facts.status === "ok") cache.set(plandayId, { facts, expiresAt: Date.now() + TTL_MS });
    return facts;
  } catch (err) {
    console.warn(`[planday-employment] employee ${plandayId} failed:`, err instanceof Error ? err.message : err);
    return { status: "unreachable" };
  }
}
