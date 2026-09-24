/**
 * Should entering a sensitive page prompt for the PIN right now?
 *
 * The scenario is a logged-in iPad left on a counter: whoever picks it up
 * must not walk into pay-adjacent or personal data without proving they're
 * the signed-in person. A successful PIN entry buys a short window
 * (SENSITIVE_UNLOCK_TTL_MS in auth-context) so hopping between sensitive
 * pages doesn't nag.
 *
 * `includeAdmins` exists because the default gate deliberately exempts
 * admins — fine for analytics, wrong for the Employee Hub's reviews and
 * recorded feedback, where an admin's iPad is the one holding EVERYONE's
 * records (Graeme, 2026-09-04). Pages that hold people-data pass true.
 *
 * `fresh` ignores the unlock window entirely: the Employee Hub asks for the
 * PIN on EVERY entry, however recently it was typed — leaving and coming
 * straight back still asks (Graeme, 2026-09-07). Moving between sections
 * inside the hub is one mount, so it never nags mid-visit; callers must ask
 * once per mount, or the prompt would re-fire the moment it's unlocked.
 */
export function shouldPromptForSensitivePin(input: {
  role: string;
  includeAdmins: boolean;
  msSinceUnlock: number;
  ttlMs: number;
  fresh?: boolean;
}): boolean {
  if (input.role === "admin" && !input.includeAdmins) return false;
  if (input.fresh) return true;
  return input.msSinceUnlock >= input.ttlMs;
}

/**
 * Has this page already demanded the PIN for the visit the user is on?
 *
 * The companion rule to the one above, and the reason it exists: the
 * `requireSensitivePin` callback changes identity whenever the lock state
 * changes, so a page effect that depends on it re-runs the instant the PIN
 * is accepted. Paired with `fresh` — which always prompts — that re-locks
 * the screen immediately and the page can never be opened at all. Graeme
 * hit that on People -> Employee Records and could only escape by signing
 * out (2026-09-17).
 *
 * `demandedFor` is what the page last asked for, `entryKey` is what it
 * wants now. Equal means "already asked on this visit, don't ask again";
 * different means a genuinely new entry (a new mount, or a move to another
 * sensitive tab) and the PIN is demanded afresh.
 */
export function shouldDemandPinOnEntry(input: {
  authenticated: boolean;
  enabled: boolean;
  demandedFor: string | null;
  entryKey: string;
}): boolean {
  if (!input.authenticated) return false;
  if (!input.enabled) return false;
  return input.demandedFor !== input.entryKey;
}

/** Which PIN a sensitive gate asks for (Graeme, 2026-09-24). The People
 *  section asks for the PRIVATE PIN when the person has set one — so the PIN
 *  they type in front of others at a station can't open employee records.
 *  Everything else (and anyone without a private PIN) uses the normal PIN. */
export type SensitiveScope = "general" | "people";

export function gateUsesPrivatePin(scope: SensitiveScope, hasPrivatePin: boolean | undefined): boolean {
  return scope === "people" && !!hasPrivatePin;
}
