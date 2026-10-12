/**
 * The server-side lock on changing anyone's employment record (Graeme,
 * 2026-10-12). Every route that creates, changes or removes something on a
 * person's record puts `employmentRecordWrite(...)` in front of its handler;
 * the rule itself is lib/people-write-access.ts (pure, tested).
 *
 *   employmentRecordWrite({ subject: fromParam("userId") })
 *   employmentRecordWrite({ subject: req => …row's user id…, selfService: "own_rtw_form" })
 *
 * `subject` says whose record the request touches (from the URL, the body,
 * or the row being changed). It may answer null when there is no such
 * person/row — the handler then answers its own 400/404 as before.
 *
 * On a pass, res.locals.employmentRecordRight is "editor" or "self", so a
 * handler can give the employee's powers rather than the manager's on their
 * own record (return-to-work forms). The People PIN, People access and the
 * founder-only HR gates stay exactly where they were — this is on top.
 *
 * Every guard made here is remembered (isEmploymentRecordWriteGuard), so a
 * test can walk each router and prove no write route is missing one.
 * A DB failure is a 500, never a pass.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  EMPLOYMENT_RECORD_WRITE_REFUSAL, mayWriteEmploymentRecord, recordWriteView,
  type RecordActor, type RecordSubject, type SelfServiceKind,
} from "../lib/people-write-access";

type SubjectResolver = (req: Request) => Promise<number | null> | number | null;

export interface EmploymentRecordWriteOptions {
  subject: SubjectResolver;
  /** The self-service write this route is, if any (see SELF_SERVICE_KINDS). */
  selfService?: SelfServiceKind;
  /** Answer a refusal as 404 — for by-id routes that never confirm an id exists. */
  refuseAs404?: boolean;
}

const guards = new WeakMap<Function, EmploymentRecordWriteOptions>();

/** Is this handler an employment-record write guard? (For the route tests.) */
export function isEmploymentRecordWriteGuard(fn: unknown): boolean {
  return typeof fn === "function" && guards.has(fn);
}

/** The options a guard was made with — e.g. which self-service kind. */
export function employmentRecordGuardOptions(fn: unknown): EmploymentRecordWriteOptions | undefined {
  return typeof fn === "function" ? guards.get(fn) : undefined;
}

// ── Lookups ────────────────────────────────────────────────────────────────

/** The signed-in person as the rule needs them; null if unknown or inactive. */
export async function loadRecordActor(userId: number | null | undefined): Promise<RecordActor | null> {
  if (!userId) return null;
  const rows = await db.execute<{ id: number; email: string | null; planday_employee_id: number | null; is_active: boolean; granted: boolean }>(sql`
    SELECT u.id, u.email, u.planday_employee_id, u.is_active, (g.user_id IS NOT NULL) AS granted
      FROM app_users u
      LEFT JOIN people_access_grants g ON g.user_id = u.id
     WHERE u.id = ${userId}
     LIMIT 1
  `);
  const r = rows.rows[0];
  if (!r || r.is_active !== true) return null;
  return {
    id: Number(r.id),
    email: r.email,
    plandayEmployeeId: r.planday_employee_id == null ? null : Number(r.planday_employee_id),
    hasPeopleAccess: r.granted === true,
  };
}

/** The person whose record it is; null if there's no such account. */
export async function loadRecordSubject(userId: number): Promise<RecordSubject | null> {
  const rows = await db.execute<{ id: number; email: string | null; planday_employee_id: number | null }>(sql`
    SELECT id, email, planday_employee_id FROM app_users WHERE id = ${userId} LIMIT 1
  `);
  const r = rows.rows[0];
  if (!r) return null;
  return { id: Number(r.id), email: r.email, plandayEmployeeId: r.planday_employee_id == null ? null : Number(r.planday_employee_id) };
}

/** For screens: may the signed-in person change this record, and if not, why.
 *  Fails closed (read-only) on a lookup error. */
export async function recordWriteViewFor(viewerId: number | null | undefined, subjectUserId: number) {
  try {
    const [actor, subject] = await Promise.all([loadRecordActor(viewerId), loadRecordSubject(subjectUserId)]);
    if (!actor || !subject) return { canWrite: false, readOnlyNote: EMPLOYMENT_RECORD_WRITE_REFUSAL };
    return recordWriteView(actor, subject);
  } catch (err) {
    console.error("[employment-record-write] view lookup failed:", err instanceof Error ? err.message : String(err));
    return { canWrite: false, readOnlyNote: EMPLOYMENT_RECORD_WRITE_REFUSAL };
  }
}

/** True when the signed-in person is an EDITOR of this record (not just its owner). */
export async function isRecordEditor(viewerId: number | null | undefined, subjectUserId: number): Promise<boolean> {
  return (await recordWriteViewFor(viewerId, subjectUserId)).canWrite;
}

// ── Subject resolvers ──────────────────────────────────────────────────────

function positiveInt(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** The record is the person named in the URL, e.g. /:userId. */
export function fromParam(name: string): SubjectResolver {
  return req => positiveInt(req.params[name]);
}

/** The record is the person named in the body (falls back to the caller's own). */
export function fromBody(name: string, fallbackToSelf = false): SubjectResolver {
  return req => {
    const raw = (req.body as Record<string, unknown> | undefined)?.[name];
    if (raw == null || raw === "") return fallbackToSelf ? (req.session.userId ?? null) : null;
    return positiveInt(raw);
  };
}

/** The record is the caller's own (the /me and /mine routes). */
export const fromSession: SubjectResolver = req => req.session.userId ?? null;

/** The record is whoever owns a row: `query` gets the row id from the URL
 *  and returns the owner's user id (or null if there's no such row). */
export function fromRow(param: string, owner: (id: number) => Promise<number | null>): SubjectResolver {
  return async req => {
    const id = positiveInt(req.params[param]);
    return id == null ? null : owner(id);
  };
}

/** One-line owner lookup: `SELECT <column> FROM <table> WHERE id = $1`. */
export function ownerOf(table: string, column = "user_id"): (id: number) => Promise<number | null> {
  return async id => {
    const rows = await db.execute<{ owner: number | null }>(
      sql`SELECT ${sql.identifier(column)} AS owner FROM ${sql.identifier(table)} WHERE id = ${id} LIMIT 1`,
    );
    const v = rows.rows[0]?.owner;
    return v == null ? null : Number(v);
  };
}

// ── The guard ──────────────────────────────────────────────────────────────

export function employmentRecordWrite(opts: EmploymentRecordWriteOptions): RequestHandler {
  const guard = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.session.userId;
    if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
    try {
      const subjectId = await opts.subject(req);
      // No such person/row: let the handler give its own 400/404.
      if (subjectId == null) { next(); return; }
      const [actor, found] = await Promise.all([loadRecordActor(userId), loadRecordSubject(subjectId)]);
      // A row whose account has gone is still judged by the rule (by id).
      const subject: RecordSubject = found ?? { id: subjectId, email: null, plandayEmployeeId: null };
      const check = actor ? mayWriteEmploymentRecord(actor, subject, opts.selfService) : { ok: false as const };
      if (!check.ok) {
        if (opts.refuseAs404) { res.status(404).json({ error: "Not found" }); return; }
        res.status(403).json({ error: EMPLOYMENT_RECORD_WRITE_REFUSAL, code: "EMPLOYMENT_RECORD_READ_ONLY" });
        return;
      }
      res.locals["employmentRecordRight"] = check.right;
      next();
    } catch (err) {
      console.error("[employment-record-write] check failed:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: "Internal server error" });
    }
  };
  guards.set(guard, opts);
  return guard;
}

/** The right a passed guard recorded: "editor" or "self". */
export function employmentRecordRightOf(res: Response): "editor" | "self" | undefined {
  const r = res.locals["employmentRecordRight"];
  return r === "editor" || r === "self" ? r : undefined;
}
