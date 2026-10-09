/**
 * Today's APC booking issues — the database half (migration 0156). The
 * rules are pure, in apc-booking-issues.ts.
 *
 * Reading the report NEVER talks to APC: it is today's stored rows, with
 * the postcode lines re-read from APC's local postcode table and whatever
 * APC customer service has told us since (so recording "permanent — no
 * Saturday service" from the card moves it to the right scenario at once).
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { londonDateString } from "./london-time";
import { intArrayLiteral } from "./int-array-literal";
import { loadPostcodeContext } from "./apc-postcode-context";
import { postcodeServiceFor, postcodeServiceView, postcodeRefusalAdvice, type PostcodeServiceView } from "../services/apc-postinfo";
import {
  classifyBookingIssue, scenarioWording, issueState, issueActions, isIssueDone, parseActions, planIssueWrites,
  type IssueAction, type IssueScenario, type IssueState, type IssueActions, type RunResult,
} from "./apc-booking-issues";

export type IssueRow = {
  id: number;
  report_date: string;
  dispatch_tag: string;
  shopify_order_id: number | string;
  order_name: string;
  admin_url: string | null;
  customer_name: string | null;
  customer_first_name: string | null;
  customer_email: string | null;
  postcode: string | null;
  reason: string | null;
  used_service_code: string | null;
  suggested_retry_code: string | null;
  saturday_attempt: boolean;
  refused_no_service: boolean;
  data_fixable: boolean;
  postcode_service: unknown;
  postcode_check: string | null;
  scenario: string;
  attempts: number;
  first_failed_at: string;
  last_failed_at: string;
  first_failed_by: string | null;
  resolved_at: string | null;
  resolved_note: string | null;
  dealt_with_at: string | null;
  dealt_with_by: string | null;
  actions: unknown;
};

const ISO = (col: string) => sql.raw(`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS ${col}`);

const SELECT_COLUMNS = sql`
  id, report_date::text AS report_date, dispatch_tag, shopify_order_id, order_name, admin_url,
  customer_name, customer_first_name, customer_email, postcode, reason, used_service_code,
  suggested_retry_code, saturday_attempt, refused_no_service, data_fixable, postcode_service,
  postcode_check, scenario, attempts, ${ISO("first_failed_at")}, ${ISO("last_failed_at")}, first_failed_by,
  ${ISO("resolved_at")}, resolved_note, ${ISO("dealt_with_at")}, dealt_with_by, actions
`;

// ── Writing a booking run ───────────────────────────────────────────────────

/** A failed outcome from POST /batch-book with what the card needs. */
export interface FailedRunResult extends RunResult {
  orderName: string;
  adminUrl?: string;
  usedServiceCode?: string;
  suggestedRetryCode?: string;
  dataFixable?: boolean;
  postcodeService?: PostcodeServiceView;
  postcodeCheck?: string;
}

/** The order facts at booking time (Shopify, minutes old). */
export interface OrderFacts {
  customerName: string | null;
  customerFirstName: string | null;
  customerEmail: string | null;
  postcode: string | null;
}

/**
 * Fold one batch run into today's stored report. Called after the booking
 * response is built; a failure here is logged and reported to the caller,
 * never allowed to lose the booking outcome itself.
 */
export async function recordBookingRun(input: {
  tag: string;
  results: readonly FailedRunResult[];
  orderFacts: ReadonlyMap<number, OrderFacts>;
  isSaturdayCode: (code: string | undefined) => boolean;
  isNoService: (reason: string | undefined) => boolean;
  bookedBy: string;
  now?: Date;
}): Promise<void> {
  const today = londonDateString(input.now ?? new Date());
  const ids = [...new Set(input.results.map(r => r.orderId))];
  if (ids.length === 0) return;
  const existing = await db.execute<{ id: number; shopify_order_id: number | string; resolved: boolean }>(sql`
    SELECT id, shopify_order_id, resolved_at IS NOT NULL AS resolved
    FROM apc_booking_issues
    WHERE report_date = ${today}::date AND shopify_order_id = ANY(${intArrayLiteral(ids)}::bigint[])
  `);
  const writes = planIssueWrites(
    existing.rows.map(r => ({ id: Number(r.id), orderId: Number(r.shopify_order_id), resolved: Boolean(r.resolved) })),
    input.results,
  );
  const byOrder = new Map(input.results.map(r => [r.orderId, r]));

  for (const w of writes) {
    if (w.op === "resolve") {
      await db.execute(sql`
        UPDATE apc_booking_issues SET resolved_at = NOW(), resolved_note = ${w.note}
        WHERE id = ${w.id} AND resolved_at IS NULL
      `);
      continue;
    }
    const r = byOrder.get(w.orderId)!;
    const facts = input.orderFacts.get(w.orderId) ?? { customerName: null, customerFirstName: null, customerEmail: null, postcode: null };
    const saturdayAttempt = input.isSaturdayCode(r.usedServiceCode);
    const refusedNoService = input.isNoService(r.reason);
    const scenario: IssueScenario = classifyBookingIssue({ refusedNoService, saturdayAttempt, postcode: r.postcodeService ?? null });
    const serviceJson = r.postcodeService ? JSON.stringify(r.postcodeService) : null;
    // INSERT … ON CONFLICT for both: two runs racing on one order still
    // end as one row, the later failure's facts winning.
    await db.execute(sql`
      INSERT INTO apc_booking_issues (
        report_date, dispatch_tag, shopify_order_id, order_name, admin_url,
        customer_name, customer_first_name, customer_email, postcode, reason,
        used_service_code, suggested_retry_code, saturday_attempt, refused_no_service, data_fixable,
        postcode_service, postcode_check, scenario, first_failed_by
      ) VALUES (
        ${today}::date, ${input.tag}, ${w.orderId}, ${r.orderName}, ${r.adminUrl ?? null},
        ${facts.customerName}, ${facts.customerFirstName}, ${facts.customerEmail}, ${facts.postcode}, ${r.reason ?? null},
        ${r.usedServiceCode ?? null}, ${r.suggestedRetryCode ?? null}, ${saturdayAttempt}, ${refusedNoService}, ${r.dataFixable ?? false},
        ${serviceJson}::jsonb, ${r.postcodeCheck ?? null}, ${scenario}, ${input.bookedBy}
      )
      ON CONFLICT (report_date, shopify_order_id) DO UPDATE SET
        dispatch_tag = EXCLUDED.dispatch_tag,
        order_name = EXCLUDED.order_name,
        admin_url = COALESCE(EXCLUDED.admin_url, apc_booking_issues.admin_url),
        customer_name = COALESCE(EXCLUDED.customer_name, apc_booking_issues.customer_name),
        customer_first_name = COALESCE(EXCLUDED.customer_first_name, apc_booking_issues.customer_first_name),
        customer_email = COALESCE(EXCLUDED.customer_email, apc_booking_issues.customer_email),
        postcode = COALESCE(EXCLUDED.postcode, apc_booking_issues.postcode),
        reason = EXCLUDED.reason,
        used_service_code = EXCLUDED.used_service_code,
        suggested_retry_code = EXCLUDED.suggested_retry_code,
        saturday_attempt = EXCLUDED.saturday_attempt,
        refused_no_service = EXCLUDED.refused_no_service,
        data_fixable = EXCLUDED.data_fixable,
        postcode_service = COALESCE(EXCLUDED.postcode_service, apc_booking_issues.postcode_service),
        postcode_check = COALESCE(EXCLUDED.postcode_check, apc_booking_issues.postcode_check),
        scenario = EXCLUDED.scenario,
        attempts = apc_booking_issues.attempts + 1,
        last_failed_at = NOW(),
        resolved_at = NULL,
        resolved_note = NULL
    `);
  }
}

// ── Reading today's report ──────────────────────────────────────────────────

export interface ApiIssue {
  id: number;
  orderId: number;
  orderName: string;
  adminUrl: string | null;
  dispatchTag: string;
  customerName: string | null;
  customerEmail: string | null;
  postcode: string | null;
  reason: string | null;
  usedServiceCode: string | null;
  saturdayAttempt: boolean;
  refusedNoService: boolean;
  dataFixable: boolean;
  attempts: number;
  firstFailedAt: string;
  lastFailedAt: string;
  firstFailedBy: string | null;
  resolvedAt: string | null;
  resolvedNote: string | null;
  dealtWithAt: string | null;
  dealtWithBy: string | null;
  scenario: IssueScenario;
  wording: { title: string; explain: string; whatToDo: string };
  postcodeService: PostcodeServiceView | null;
  postcodeCheck: string | null;
  postcodeAdvice: { text: string; kind: string; service: "saturday" | "weekday"; call?: { outward: string; depot: string; contactName: string | null; phone: string | null } } | null;
  state: IssueState;
  done: boolean;
  actions: IssueActions;
  log: IssueAction[];
}

export interface TodayReport {
  date: string;
  canCourier: boolean;
  open: number;
  total: number;
  issues: ApiIssue[];
}

type Context = Awaited<ReturnType<typeof loadPostcodeContext>>;

export function toApiIssue(r: IssueRow, ctx: Context, canCourier: boolean, now: Date): ApiIssue {
  // Re-read the postcode lines (local table + recorded APC answers); fall
  // back to the snapshot only if the postcode has gone missing.
  const lookup = r.postcode ? postcodeServiceFor(r.postcode, ctx.overrides, now) : null;
  const view: PostcodeServiceView | null = lookup?.service
    ? postcodeServiceView(lookup.service)
    : (r.postcode_service && typeof r.postcode_service === "object" ? r.postcode_service as PostcodeServiceView : null);
  const scenario = classifyBookingIssue({ refusedNoService: r.refused_no_service, saturdayAttempt: r.saturday_attempt, postcode: view });
  const log = parseActions(r.actions);
  const state = issueState(log);
  const resolved = r.resolved_at != null;
  const dealtWith = r.dealt_with_at != null;
  const advice = view
    ? postcodeRefusalAdvice(view, { saturdayDelivery: r.saturday_attempt, refusedNoService: r.refused_no_service }, ctx.contact)
    : null;
  return {
    id: Number(r.id),
    orderId: Number(r.shopify_order_id),
    orderName: r.order_name,
    adminUrl: r.admin_url,
    dispatchTag: r.dispatch_tag,
    customerName: r.customer_name,
    customerEmail: r.customer_email,
    postcode: r.postcode,
    reason: r.reason,
    usedServiceCode: r.used_service_code,
    saturdayAttempt: r.saturday_attempt,
    refusedNoService: r.refused_no_service,
    dataFixable: r.data_fixable,
    attempts: Number(r.attempts),
    firstFailedAt: r.first_failed_at,
    lastFailedAt: r.last_failed_at,
    firstFailedBy: r.first_failed_by,
    resolvedAt: r.resolved_at,
    resolvedNote: r.resolved_note,
    dealtWithAt: r.dealt_with_at,
    dealtWithBy: r.dealt_with_by,
    scenario,
    wording: scenarioWording(scenario, view, { dataFixable: r.data_fixable, refusedNoService: r.refused_no_service }),
    postcodeService: view,
    postcodeCheck: lookup?.summary ?? r.postcode_check,
    postcodeAdvice: advice ? { text: advice.text, kind: advice.kind, service: advice.service, ...(advice.call ? { call: advice.call } : {}) } : null,
    state,
    done: isIssueDone(scenario, state, { resolved, dealtWith }),
    actions: issueActions({
      scenario, state, resolved, dealtWith, canCourier,
      hasEmail: !!r.customer_email,
      suggestedRetryCode: r.suggested_retry_code,
      refusedNoService: r.refused_no_service,
      saturdayAttempt: r.saturday_attempt,
    }),
    log,
  };
}

/** Today's report from stored rows. No APC call — by design and by test. */
export async function loadTodayReport(canCourier: boolean, now: Date = new Date()): Promise<TodayReport> {
  const today = londonDateString(now);
  const rows = await db.execute<IssueRow>(sql`
    SELECT ${SELECT_COLUMNS} FROM apc_booking_issues
    WHERE report_date = ${today}::date
    ORDER BY first_failed_at, id
  `);
  const ctx = rows.rows.length ? await loadPostcodeContext() : { overrides: [], contact: null };
  const issues = rows.rows.map(r => toApiIssue(r, ctx, canCourier, now));
  return { date: today, canCourier, open: issues.filter(i => !i.done).length, total: issues.length, issues };
}

/** Just the count, for the "Booking issues today (N open)" button. */
export async function todayOpenCount(now: Date = new Date()): Promise<{ date: string; open: number; total: number }> {
  const r = await loadTodayReport(false, now);
  return { date: r.date, open: r.open, total: r.total };
}

export async function issueById(id: number): Promise<IssueRow | null> {
  const r = await db.execute<IssueRow>(sql`SELECT ${SELECT_COLUMNS} FROM apc_booking_issues WHERE id = ${id}`);
  return r.rows[0] ?? null;
}

/** Today's open card for an order, if any — the reschedule guard. */
export async function todaysIssueForOrder(orderId: number, now: Date = new Date()): Promise<IssueRow | null> {
  const r = await db.execute<IssueRow>(sql`
    SELECT ${SELECT_COLUMNS} FROM apc_booking_issues
    WHERE report_date = ${londonDateString(now)}::date AND shopify_order_id = ${orderId}
  `);
  return r.rows[0] ?? null;
}

/** What today's card (if any) says about rescheduling this order — used by
 *  both reschedule endpoints so the rule holds however the order is moved.
 *  An open "can't deliver" card blocks it; "no Saturdays" means weekdays
 *  only and the permanent-Saturday email. A card someone marked dealt with
 *  (e.g. a manager investigated and APC can deliver after all) no longer
 *  blocks. */
export interface RescheduleRules {
  issueId: number | null;
  scenario: IssueScenario | null;
  blocked: string | null;
  weekdaysOnly: boolean;
  emailVariant: "temporary_saturday" | "permanent_saturday";
}

const NO_RULES: RescheduleRules = { issueId: null, scenario: null, blocked: null, weekdaysOnly: false, emailVariant: "temporary_saturday" };

export async function rescheduleRulesForOrder(orderId: number, now: Date = new Date()): Promise<RescheduleRules> {
  // A database hiccup must not stop a reschedule outright — it falls back
  // to the pop-up's own date warnings, and says so in the log.
  let row: IssueRow | null;
  try {
    row = await todaysIssueForOrder(orderId, now);
  } catch (err) {
    console.warn("[apc-booking-issues] could not read today's card for order", orderId, err instanceof Error ? err.message : err);
    return NO_RULES;
  }
  if (!row || row.resolved_at) return { ...NO_RULES, issueId: row ? Number(row.id) : null };
  const issue = toApiIssue(row, await loadPostcodeContext(), true, now);
  const r = issue.actions.reschedule;
  return {
    issueId: issue.id,
    scenario: issue.scenario,
    blocked: row.dealt_with_at == null && issue.scenario === "cant_deliver" ? (r.reason ?? "APC can't deliver here on any day.") : null,
    weekdaysOnly: r.weekdaysOnly,
    emailVariant: r.emailVariant,
  };
}

export async function appendIssueAction(id: number, action: IssueAction): Promise<void> {
  await db.execute(sql`
    UPDATE apc_booking_issues SET actions = actions || ${JSON.stringify([action])}::jsonb WHERE id = ${id}
  `);
}

export async function setDealtWith(id: number, done: boolean, action: IssueAction): Promise<void> {
  await db.execute(sql`
    UPDATE apc_booking_issues
    SET dealt_with_at = ${done ? sql`NOW()` : sql`NULL`},
        dealt_with_by = ${done ? action.byName : null},
        actions = actions || ${JSON.stringify([action])}::jsonb
    WHERE id = ${id}
  `);
}
