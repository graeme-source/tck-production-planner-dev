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
 * straight back still asks (Graeme, 2026-09-07; restored 29 Oct 2026 after
 * the 5-minute window had crept back in). Moving between sections
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
/**
 * Is the page open yet, for the visit the gate is on? (Graeme, 29 Oct 2026:
 * the Employee Hub shows and loads NOTHING until the PIN for this entry is
 * in — the records never sit in the page behind the PIN pad.)
 *
 *   idle    — not asked yet (or the gate is off)
 *   asked   — the prompt was just raised; its flag may not have rendered yet
 *   showing — a PIN prompt is up
 *   open    — the prompt was answered, or none was needed
 *
 * "asked" waits for the prompt to SHOW before it can close, so the render
 * between raising the prompt and it appearing can't open the page.
 */
export type PinGatePhase = "idle" | "asked" | "showing" | "open";

export function nextPinGatePhase(phase: PinGatePhase, prompting: boolean): PinGatePhase {
  if (phase === "asked") return prompting ? "showing" : "asked";
  if (phase === "showing") return prompting ? "showing" : "open";
  return phase;
}

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

/** Which PIN a sensitive gate asks for. "people" = a People-section page
 *  (employee records, reviews, return-to-work, the Employee Hub). */
export type SensitiveScope = "general" | "people";

/**
 * What a People page's gate does (Graeme, 2026-09-24; compulsory 2026-09-25).
 *
 *   "setup"   — People access but no private PIN yet: show "Set your private
 *               PIN to open People". The station PIN never opens People for
 *               someone with access, so there is nothing to type yet.
 *   "private" — People access and a private PIN: ask for the private PIN.
 *   "normal"  — everything else (a non-People page, or someone without People
 *               access looking at their OWN hub/forms): the usual PIN.
 *
 * The server enforces the same rule on every People request (428 / 423);
 * this only decides what the person sees first.
 */
export type PeopleGateMode = "normal" | "private" | "setup";

export function peopleGateMode(
  scope: SensitiveScope,
  user: { hasPeopleAccess?: boolean; hasPrivatePin?: boolean },
): PeopleGateMode {
  if (scope !== "people" || !user.hasPeopleAccess) return "normal";
  return user.hasPrivatePin ? "private" : "setup";
}

/**
 * Does opening Finance ask for the private PIN? (Graeme, 2026-10-27: "in
 * case anyone gets access to it... just once when we're going into it".)
 * Yes for the founder and anyone with People access — they have a private
 * PIN. No for the accountants, who work from their own computers and have
 * no PIN to type (asking would lock them out).
 */
export function financePinGateEnabled(user: { isFounder: boolean; hasPeopleAccess?: boolean } | null): boolean {
  if (!user) return false;
  return user.isFounder || Boolean(user.hasPeopleAccess);
}

// ── People: PIN on the way in, then lock after 20 s idle (Graeme, 24 Nov 2026) ──
// "I always want a pin every time I enter the people page to start with. If
// I'm continuously active … I don't want the pin check to ask me again …
// a 20-second inactivity lockout." Moving from person to person rebuilds the
// People page (each route is its own mount), which used to count as a new
// entry and asked every time.

/** No touch, click, key or scroll for this long on a People page → locked. */
export const PEOPLE_IDLE_LOCK_MS = 20_000;
/** A People page that unmounts and another that mounts within this is one
 *  visit (a route change inside People), not leaving and coming back. */
export const PEOPLE_SAME_VISIT_MS = 2_000;

/**
 * Does opening a People page need the PIN? Yes, unless this is a move
 * INSIDE People (the previous People page closed a moment ago) and they've
 * been active within the idle limit. Coming in from anywhere else always
 * asks. Pure.
 */
export function peopleEntryNeedsPin(input: {
  now: number; leftPeopleAt: number | null; lastActiveAt: number | null;
  /** Another People page is still open — React builds the new page before
   *  it closes the old one, so a move inside People looks like this. */
  stillInside?: boolean;
  idleMs?: number; sameVisitMs?: number;
}): boolean {
  const idle = input.idleMs ?? PEOPLE_IDLE_LOCK_MS;
  const same = input.sameVisitMs ?? PEOPLE_SAME_VISIT_MS;
  const movingInside = input.stillInside === true || (input.leftPeopleAt != null && input.now - input.leftPeopleAt <= same);
  const activeRecently = input.lastActiveAt != null && input.now - input.lastActiveAt < idle;
  return !(movingInside && activeRecently);
}

/** Has a People page sat idle long enough to lock? Pure. */
export function peopleIdleExpired(lastActiveAt: number | null, now: number, idleMs = PEOPLE_IDLE_LOCK_MS): boolean {
  return lastActiveAt != null && now - lastActiveAt >= idleMs;
}
