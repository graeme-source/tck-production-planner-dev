/**
 * Who may see HR records — contracts and starter forms (pay, bank details,
 * health answers). ONE place on purpose: when the finance director joins,
 * widening access happens here and nowhere else (Graeme, 2026-09-07).
 *
 * The gate is the ACCOUNT, not the role — admins and managers do NOT
 * qualify. Today that means the founder's account only.
 */
import type { NextFunction, Request, Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const HR_RECORD_EMAILS = new Set([
  "graeme@thecalzonekitchen.co.uk",
  // Finance director: add their account email here when they join.
]);

export async function hasHrRecordAccess(req: Request): Promise<boolean> {
  const userId = req.session.userId;
  if (!userId) return false;
  const rows = await db.execute<{ email: string }>(sql`SELECT email FROM app_users WHERE id = ${userId} LIMIT 1`);
  const email = rows.rows[0]?.email;
  return email != null && HR_RECORD_EMAILS.has(email);
}

export async function requireHrRecordAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!(await hasHrRecordAccess(req))) { res.status(403).json({ error: "Founder only" }); return; }
  next();
}
