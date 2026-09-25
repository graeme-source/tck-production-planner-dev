/**
 * Server-side PIN lock for writes that put a PERSON'S NAME on work — the
 * rules, with the one I/O dependency (the kill switch) injected so the whole
 * middleware can be tested without a database.
 *
 * Why (Fri 25 Sep 2026, plan 180): the daily PIN cutover (lib/pin-cutover.ts)
 * was only ever enforced on screen. A session signed in as Grant the night
 * before woke up on a building iPad and recorded 16 batches under his name
 * before he'd arrived; the server happily accepted them. Now, if the
 * session's PIN is due, these writes are refused with 423 PIN_REQUIRED and
 * the app puts the PIN pad up — whoever is actually there signs in (or
 * switches user) and taps again.
 *
 * Deliberately narrow: only writes that RECORD WHO DID SOMETHING (batches,
 * table claims, checklist ticks, temperature/HACCP logs, packing and wrapping
 * records, prep ticks, stock counts, training sign-offs). Reads, auth routes,
 * undo/delete actions, oven-out (a food-safety timer must never be blocked),
 * Andon safety alerts, the visitor kiosk and planning/admin edits are not
 * touched. Kill switch: app_settings feature_server_pin_enforce = 'false'.
 */
import type { Request, Response, NextFunction } from "express";
import { isPinRequired } from "./pin-cutover";

export const PIN_ENFORCE_SETTING_KEY = "feature_server_pin_enforce";

type Rule = { method: "POST" | "PUT" | "PATCH"; pattern: RegExp; what: string };

// Paths are relative to the /api router (req.path as the middleware sees it).
const ID = "\\d+";
const PLAN = `^/production-plans/${ID}`;
export const ATTRIBUTING_WRITES: readonly Rule[] = [
  // Production-plan station writes
  { method: "POST", pattern: new RegExp(`${PLAN}/batch-completions/?$`), what: "batch completion" },
  { method: "POST", pattern: new RegExp(`${PLAN}/batch-completions/bulk/?$`), what: "bulk batch completions" },
  { method: "POST", pattern: new RegExp(`${PLAN}/station-changeovers/?$`), what: "station changeover" },
  { method: "POST", pattern: new RegExp(`${PLAN}/station-breaks/?$`), what: "station break" },
  { method: "POST", pattern: new RegExp(`${PLAN}/building-finished/?$`), what: "building finished" },
  { method: "POST", pattern: new RegExp(`${PLAN}/items/${ID}/mark-chilled/?$`), what: "mark chilled" },
  { method: "POST", pattern: new RegExp(`${PLAN}/items/${ID}/manual-batch/?$`), what: "manual batch" },
  { method: "PATCH", pattern: new RegExp(`${PLAN}/items/${ID}/wrapping-complete/?$`), what: "wrapping complete" },
  { method: "POST", pattern: new RegExp(`${PLAN}/items/${ID}/fridge/?$`), what: "packs into fridge" },
  { method: "POST", pattern: new RegExp(`${PLAN}/prep-completions/?$`), what: "prep tick" },
  { method: "POST", pattern: new RegExp(`${PLAN}/prep-deferrals/?$`), what: "prep deferral" },
  { method: "POST", pattern: new RegExp(`${PLAN}/sub-recipe-completions/?$`), what: "sub-recipe tick" },
  { method: "POST", pattern: /^\/production-plans\/stock-checks\/?$/, what: "daily stock check" },
  // Building-table claims and per-person station checklist flags
  { method: "PUT", pattern: /^\/app-settings\/(station_assignment_|checklist_done_|mozz_load_confirmed_)/, what: "station claim" },
  // Checklists and the HACCP records filed through them
  { method: "POST", pattern: /^\/checklists\/completions\/?$/, what: "checklist tick" },
  { method: "PUT", pattern: new RegExp(`^/checklists/oneoff/${ID}/?$`), what: "one-off checklist tick" },
  { method: "POST", pattern: /^\/checklists\/(location-temperature-record|packing-batch-record|closing-fridge-freeze)\/?$/, what: "HACCP record" },
  { method: "POST", pattern: /^\/temperature-records\/?$/, what: "temperature record" },
  { method: "POST", pattern: /^\/oven-events\/oven-in\/?$/, what: "oven in" },
  { method: "POST", pattern: new RegExp(`^/prep-linked-completions/${ID}/?$`), what: "prep tick" },
  { method: "POST", pattern: new RegExp(`^/fried-chicken/plans/${ID}/(count|prep-tick)/?$`), what: "fried chicken record" },
  { method: "POST", pattern: new RegExp(`^/compliance-actions/${ID}/complete/?$`), what: "compliance action" },
  // Wrapping / packing / goods-in / stock
  { method: "POST", pattern: new RegExp(`^/case-orders/plan-items/${ID}/freezer-bags/?$`), what: "freezer bag count" },
  { method: "POST", pattern: /^\/fulfilment\/verify-label-scan\/?$/, what: "packing label check" },
  { method: "POST", pattern: new RegExp(`^/deliveries/${ID}/receive/?$`), what: "goods-in" },
  { method: "POST", pattern: /^\/kanbans\/scan\/?$/, what: "kanban scan" },
  { method: "POST", pattern: new RegExp(`^/kanbans/${ID}/pull/?$`), what: "kanban pull" },
  { method: "POST", pattern: /^\/stock-entries\/?$/, what: "stock count" },
  { method: "POST", pattern: /^\/print-jobs\/?$/, what: "prep label" },
  // Training sign-offs
  { method: "POST", pattern: /^\/station-training\/reviews\/?$/, what: "SOP review" },
  { method: "POST", pattern: /^\/training-ack\/confirm\/?$/, what: "read-and-understood" },
];

/** The rule a request falls under, or null when it isn't an attributing write. */
export function matchAttributingWrite(method: string, path: string): Rule | null {
  const m = method.toUpperCase();
  for (const rule of ATTRIBUTING_WRITES) {
    if (rule.method === m && rule.pattern.test(path)) return rule;
  }
  return null;
}

/** The kill switch is ON unless the setting is exactly 'false'. */
export function enforcementEnabled(settingValue: string | null | undefined): boolean {
  return (settingValue ?? "").trim().toLowerCase() !== "false";
}

export const PIN_REQUIRED_BODY = {
  error: "Enter your PIN, then tap again",
  code: "PIN_REQUIRED",
} as const;

export type PinEnforceDeps = {
  /** Reads app_settings.feature_server_pin_enforce (null when unset). */
  readSetting: () => Promise<string | null>;
  now?: () => Date;
  log?: (msg: string) => void;
};

/**
 * The middleware. Order of checks keeps it cheap: the kill switch is only
 * read on the rare path where a refusal is actually on the cards.
 * A failed settings read lets the write through (logged) — a database blip
 * must never lock a station mid-shift.
 */
export function createPinEnforceMiddleware(deps: PinEnforceDeps) {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((msg: string) => console.warn(msg));
  return async function requireFreshPinForAttributingWrites(req: Request, res: Response, next: NextFunction): Promise<void> {
    const rule = matchAttributingWrite(req.method, req.path);
    if (!rule) { next(); return; }
    // No session → the app-wide guard (or a route's own token auth) answers.
    if (!req.session?.userId) { next(); return; }
    if (!isPinRequired(req.session.pinVerifiedAt, now())) { next(); return; }
    let setting: string | null = null;
    try {
      setting = await deps.readSetting();
    } catch (err) {
      log(`[pin-enforce] kill-switch read failed, allowing ${rule.what}: ${err instanceof Error ? err.message : String(err)}`);
      next();
      return;
    }
    if (!enforcementEnabled(setting)) { next(); return; }
    log(`[pin-enforce] refused ${rule.what} (${req.method} ${req.path}) for user ${req.session.userId}: PIN due`);
    res.status(423).json(PIN_REQUIRED_BODY);
  };
}
