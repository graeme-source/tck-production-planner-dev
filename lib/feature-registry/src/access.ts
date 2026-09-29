import { featureByKey } from "./registry";
import { roleMeets, type Role } from "./types";

/**
 * The one access rule, shared by the server and the screen.
 *
 * Access = the role clears the baseline, OR the person has been handed this
 * one thing. Grants only ever ADD (Graeme, 2026-09-04): role sets the general
 * level everyone comes in on, grants top individuals up. Nothing takes access
 * away, so there is never a second answer to hunt for when someone asks why
 * they can't see something.
 *
 * `baselineMinRole` is passed in rather than read here because a page's
 * baseline lives in the access-level selector (page_permissions), which an
 * admin can change at any time; the registry only carries the fallback.
 */
export function decideAccess(input: {
  userRole: string;
  /** Feature keys this person has been granted (already SOP-gated). */
  grantedKeys: readonly string[];
  featureKey: string;
  /** Overrides the registry's minRole — used for pages. */
  baselineMinRole?: Role;
  /** Is this the founder's account? Only founder-only features read it. */
  isFounder?: boolean;
}): boolean {
  const { userRole, grantedKeys, featureKey, baselineMinRole } = input;
  // The Business: founder or an explicit grant, and nothing else — this
  // check comes BEFORE the admin line so an admin doesn't sail through.
  if (featureByKey(featureKey)?.founderOnly) {
    return input.isFounder === true || grantedKeys.includes(featureKey);
  }
  // Otherwise an admin runs the place; nothing else can lock them out.
  if (userRole === "admin") return true;
  if (grantedKeys.includes(featureKey)) return true;
  const minRole = baselineMinRole ?? featureByKey(featureKey)?.minRole;
  // An unknown key is not a free pass — better a locked door than an open one.
  if (!minRole) return false;
  return roleMeets(userRole, minRole);
}
