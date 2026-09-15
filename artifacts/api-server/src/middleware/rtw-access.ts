/**
 * Who may see return-to-work forms — sickness reasons are health data.
 * ONE place on purpose, same pattern as hr-access.ts: the colleague sees
 * their OWN forms; beyond that only the named RTW managers (Graeme,
 * 2026-09-14: the founder and Lorna Brown). Roles do NOT qualify — an
 * ordinary admin/manager account sees nothing.
 */
import type { Request } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const RTW_MANAGER_EMAILS = new Set([
  "graeme@thecalzonekitchen.co.uk",
  "lornabrown17@icloud.com",
  // Local test account — no such user exists on live.
  "claude-test@thecalzonekitchen.co.uk",
]);

export async function hasRtwManagerAccess(req: Request): Promise<boolean> {
  const userId = req.session.userId;
  if (!userId) return false;
  const rows = await db.execute<{ email: string }>(sql`SELECT email FROM app_users WHERE id = ${userId} LIMIT 1`);
  const email = rows.rows[0]?.email;
  return email != null && RTW_MANAGER_EMAILS.has(email);
}

/** The colleague themselves, or an RTW manager. */
export async function canAccessRtwUser(req: Request, subjectUserId: number): Promise<boolean> {
  if (req.session.userId === subjectUserId) return true;
  return hasRtwManagerAccess(req);
}

export async function rtwManagerUserIds(): Promise<number[]> {
  const rows = await db.execute<{ id: number }>(sql`
    SELECT id FROM app_users
    WHERE is_active = TRUE AND email IN (${sql.join([...RTW_MANAGER_EMAILS].map(e => sql`${e}`), sql`, `)})
  `);
  return rows.rows.map(r => Number(r.id));
}
