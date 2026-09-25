/**
 * Who may see return-to-work forms — sickness reasons are health data.
 * ONE place on purpose, same pattern as hr-access.ts: the colleague sees
 * their OWN forms; beyond that only people with People access (Graeme,
 * 2026-09-14: the founder and Lorna Brown). Roles do NOT qualify — an
 * ordinary admin/manager account sees nothing.
 *
 * "RTW manager" and "looks after people-data" are one question with one
 * answer: the founder's per-person People access switch, stored in the
 * database since 2026-09-25 (lib/people-access.ts — it replaced the
 * hard-coded PEOPLE_DATA_EMAILS list).
 */
import type { Request } from "express";
import { hasPeopleAccess, peopleAccessUserIds } from "../lib/people-access";

export async function hasRtwManagerAccess(req: Request): Promise<boolean> {
  return hasPeopleAccess(req.session.userId);
}

/** The colleague themselves, or an RTW manager. */
export async function canAccessRtwUser(req: Request, subjectUserId: number): Promise<boolean> {
  if (req.session.userId === subjectUserId) return true;
  return hasRtwManagerAccess(req);
}

export async function rtwManagerUserIds(): Promise<number[]> {
  return peopleAccessUserIds();
}
