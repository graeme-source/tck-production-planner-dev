import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** The server refused because the People lock is shut: 428 = private PIN
 *  not set yet, 423 = set but not entered recently (middleware/people-unlock.ts). */
export class PeopleLockedError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "PeopleLockedError";
  }
}

/** GET a People endpoint for React Query. Throws PeopleLockedError on
 *  423/428 so the page can offer "unlock" rather than a dead error. */
export async function peopleFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, { credentials: "include" });
  if (res.status === 423 || res.status === 428) {
    const body = await res.json().catch(() => ({}));
    throw new PeopleLockedError(res.status, body?.error ?? "People is locked");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Something went wrong (${res.status})`);
  }
  return res.json();
}

/** Don't retry a locked answer — asking again won't unlock it. */
export function peopleRetry(failureCount: number, err: unknown): boolean {
  return !(err instanceof PeopleLockedError) && failureCount < 2;
}

/**
 * True once it's safe to fetch People data: the person has People access,
 * the page's PIN gate has had its first chance to ask (useSensitivePinGate
 * runs in an effect, so on the very first render nobody has been asked yet),
 * and no People PIN prompt or "set your private PIN" card is showing. Fetching
 * before that just earns a 423. Declare this AFTER useSensitivePinGate.
 */
export function usePeopleReady(enabled: boolean): boolean {
  const { peoplePinPrompt, peoplePinSetupPrompt } = useAuth();
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (enabled) setArmed(true); }, [enabled]);
  return enabled && armed && !peoplePinPrompt && !peoplePinSetupPrompt;
}
