/**
 * Who may use the packing screen's API — moved out of routes/fulfilment.ts
 * (2026-10-09) so the booking-issues routes share the one rule rather than
 * a copy.
 */
import type { Request, Response, NextFunction } from "express";
import { db, usersTable, pagePermissionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { userHasFeature } from "./feature-access";

export const ROLE_RANK: Record<string, number> = { viewer: 0, manager: 1, admin: 2 };

export async function resolveRole(req: Request): Promise<"admin" | "manager" | "viewer" | null> {
  if (req.session.userRole) return req.session.userRole as "admin" | "manager" | "viewer";
  if (!req.session.userId) return null;
  const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, req.session.userId));
  if (user) {
    req.session.userRole = user.role as "admin" | "manager" | "viewer";
    return req.session.userRole;
  }
  return null;
}

// Operational fulfilment endpoints (list orders, verify labels, complete)
// honour the "/fulfilment" page permission set in Settings → Page Access
// Control, so opening Order Packing Live to viewers there also opens the
// API the page needs — one knob, not two. No stored row falls back to
// "manager", matching the default the page-permissions route serves.
// Admin-only endpoints (config, barcode sync, probes) stay requireAdmin.
export async function requireFulfilmentAccess(req: Request, res: Response, next: NextFunction) {
  const role = await resolveRole(req);
  if (role) {
    const [row] = await db
      .select({ minRole: pagePermissionsTable.minRole })
      .from(pagePermissionsTable)
      .where(eq(pagePermissionsTable.pageKey, "/fulfilment"));
    const minRole = row?.minRole ?? "manager";
    if ((ROLE_RANK[role] ?? 0) >= (ROLE_RANK[minRole] ?? 1)) { next(); return; }
  }
  // Role too low — a per-user feature grant (optionally SOP-training gated)
  // can still open this page: the APC-label-printing pilot.
  if (req.session.userId && (await userHasFeature(req.session.userId, "apc_label_printing"))) {
    next(); return;
  }
  res.status(403).json({ error: "Your role doesn't have access to Order Packing Live — an admin can change this under Settings → Team & Access → Page Access" });
}
