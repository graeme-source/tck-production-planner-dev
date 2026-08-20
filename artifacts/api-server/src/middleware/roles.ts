import type { NextFunction, Request, Response } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Role guards, shared across route files. Session-first with a DB fallback for
// sessions created before userRole was written into the session (same pattern
// as routes/index.ts). Roles: admin > manager > viewer.

async function resolveRole(req: Request): Promise<string | undefined> {
  if (req.session.userRole) return req.session.userRole;
  if (req.session.userId) {
    const [user] = await db
      .select({ role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, req.session.userId));
    if (user) {
      req.session.userRole = user.role as "admin" | "manager" | "viewer";
      return user.role;
    }
  }
  return undefined;
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const role = await resolveRole(req);
  if (role === "admin") { next(); return; }
  res.status(403).json({ error: "Admin access required" });
}

export async function requireManagerOrAdmin(req: Request, res: Response, next: NextFunction) {
  const role = await resolveRole(req);
  if (role === "admin" || role === "manager") { next(); return; }
  res.status(403).json({ error: "Manager access required" });
}
