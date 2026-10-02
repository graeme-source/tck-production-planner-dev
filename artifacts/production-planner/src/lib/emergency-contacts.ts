/**
 * Staff emergency contacts — the app's pure rules (Graeme, 2026-10-02).
 *
 * WHEN the "Add your emergency contact" card shows. The server says whether
 * the person needs asking (nothing usable on file — api-server
 * services/staff-emergency-contacts.ts promptNeeded); this decides the
 * moment, so it never lands on top of production:
 *   • at a SIGN-IN — the app opening signed in, a password sign-in, the
 *     morning PIN unlock, or someone PIN-switching onto a shared iPad.
 *     That's the natural pause before work starts, the same moment the
 *     PIN pad already takes;
 *   • never over the PIN pad or the People PIN prompts, and never on the
 *     full-screen kiosk / meeting / print pages;
 *   • "Not now" (or the X) puts it away until their NEXT sign-in — it
 *     can't be put off for good, but it can never trap anyone mid-shift.
 */

/** Full-screen pages the card never covers: the meeting slideshow, the
 *  visitor kiosk, the scan pages and print layouts. */
export const PROMPT_HIDDEN_PAGES = ["/meeting", "/visitor-check-in", "/scan", "/print"] as const;

export function promptHiddenOnPath(path: string): boolean {
  return PROMPT_HIDDEN_PAGES.some(p => path === p || path.startsWith(`${p}/`));
}

/** Counts sign-ins on this device while the app is open. */
export interface SignInTracker {
  userId: number | null;
  pinLocked: boolean;
  /** Bumped at every sign-in; a "Not now" lasts for one value of it. */
  epoch: number;
}

export const INITIAL_SIGN_IN: SignInTracker = { userId: null, pinLocked: false, epoch: 0 };

/**
 * Next tracker state. A sign-in is: a different person (or the first
 * person) now signed in, or the PIN pad being cleared (lock → unlocked).
 */
export function nextSignIn(prev: SignInTracker, now: { userId: number | null; pinLocked: boolean }): SignInTracker {
  const personChanged = now.userId != null && now.userId !== prev.userId;
  const unlocked = prev.pinLocked && !now.pinLocked;
  const epoch = personChanged || unlocked ? prev.epoch + 1 : prev.epoch;
  if (epoch === prev.epoch && prev.userId === now.userId && prev.pinLocked === now.pinLocked) return prev;
  return { userId: now.userId, pinLocked: now.pinLocked, epoch };
}

export interface PromptFacts {
  /** From the server: nothing usable on file for this person. */
  promptNeeded: boolean;
  pinLocked: boolean;
  /** Another must-answer prompt is up (People PIN, set-your-PIN). */
  otherPromptShowing: boolean;
  path: string;
  /** The sign-in epoch "Not now" was tapped in, or null. */
  deferredInEpoch: number | null;
  epoch: number;
}

export function shouldShowEmergencyPrompt(f: PromptFacts): boolean {
  if (!f.promptNeeded) return false;
  if (f.pinLocked || f.otherPromptShowing) return false;
  if (promptHiddenOnPath(f.path)) return false;
  return f.deferredInEpoch !== f.epoch;
}

// ── The team list (managers/admins) ────────────────────────────────────────

export interface TeamListPerson { userId: number; name: string; jobTitle: string | null; hasContact: boolean }

/** Search by name or job title. Everyone stays in name order — nobody
 *  should have to hunt for a person in an emergency. */
export function filterTeam<T extends TeamListPerson>(people: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  const list = q ? people.filter(p => p.name.toLowerCase().includes(q) || (p.jobTitle ?? "").toLowerCase().includes(q)) : [...people];
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

/** "3 of 17 on file" for the section header. */
export function onFileSummary(people: readonly Pick<TeamListPerson, "hasContact">[]): string {
  const n = people.filter(p => p.hasContact).length;
  return `${n} of ${people.length} on file`;
}
