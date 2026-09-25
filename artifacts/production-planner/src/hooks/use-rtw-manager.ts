import { useAuth } from "@/contexts/auth-context";

/**
 * Does the signed-in person have People access — employee records, reviews,
 * return-to-work forms for everyone? (The name is historical: RTW managers
 * and People access are the same switch.)
 *
 * The founder turns it on per person in Settings → Team & Access; the server
 * stores it (people_access_grants, migration 0126 — roles do NOT qualify)
 * and reports it on /api/auth/me, which the app re-checks every 5 minutes.
 * This only drives what the UI shows: every People request is enforced on
 * the server, including the compulsory private PIN.
 */
export function useIsRtwManager(): boolean {
  const { state } = useAuth();
  return state.status === "authenticated" && state.user.hasPeopleAccess === true;
}
