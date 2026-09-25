/**
 * The People section's private PIN (Graeme, 2026-09-24) — the rules, no I/O.
 *
 * A second, private PIN used ONLY to open the People section (employee
 * records, reviews, return-to-work forms), so the PIN someone types in front
 * of others at a station can't open it.
 *
 * COMPULSORY for anyone with People access (Graeme, 2026-09-25: "no one can
 * access the People section when I enable it for them without them setting
 * a private pin"). Until it is set, every People request is refused with
 * 428 + code "private_pin_required" and the app sends them to set it. There
 * is no falling back to the station PIN — that fallback is what made the
 * private PIN optional, and it is gone.
 *
 * Unlocking with the private PIN lasts PEOPLE_UNLOCK_TTL_MS and slides while
 * they keep using the People pages; walk away and it locks again.
 */
export const PEOPLE_UNLOCK_TTL_MS = 15 * 60 * 1000;

export function isPeopleUnlocked(unlockedAtIso: string | null | undefined, now: Date): boolean {
  if (!unlockedAtIso) return false;
  const at = new Date(unlockedAtIso).getTime();
  if (Number.isNaN(at)) return false;
  const age = now.getTime() - at;
  return age >= 0 && age < PEOPLE_UNLOCK_TTL_MS;
}

/** Exactly 4 digits — the same keypad as the station PIN (it submits on the
 *  fourth digit). Its strength is that it's only ever typed in private. */
export function isValidPrivatePin(pin: unknown): pin is string {
  return typeof pin === "string" && /^\d{4}$/.test(pin);
}

export type PeopleGateDecision = "pass" | "private_pin_required" | "locked";

/**
 * What the server does with a request to a People endpoint.
 *
 *   • No People access → pass. Nothing of anyone else's is reachable (the
 *     routes refuse that themselves); what's left is their OWN review record
 *     or return-to-work forms, which stay as open to them as ever.
 *   • Access, no private PIN yet → private_pin_required (428). Always —
 *     access without the PIN opens nothing.
 *   • Access + PIN, not unlocked recently → locked (423).
 *   • Otherwise pass.
 *
 * Access is looked up fresh on every request, so revoking it bites on the
 * very next request even for someone already unlocked.
 */
export function peopleGateDecision(f: { hasAccess: boolean; hasPrivatePin: boolean; unlocked: boolean }): PeopleGateDecision {
  if (!f.hasAccess) return "pass";
  if (!f.hasPrivatePin) return "private_pin_required";
  if (!f.unlocked) return "locked";
  return "pass";
}

export const PRIVATE_PIN_REQUIRED_CODE = "private_pin_required";
export const PEOPLE_PIN_LOCKED_CODE = "PEOPLE_PIN_REQUIRED";

/** The HTTP refusal for a gate decision, or null to let the request through. */
export function peopleGateRefusal(d: PeopleGateDecision): { status: number; body: { error: string; code: string } } | null {
  if (d === "private_pin_required") {
    return { status: 428, body: { error: "Set your private PIN to open People", code: PRIVATE_PIN_REQUIRED_CODE } };
  }
  if (d === "locked") {
    return { status: 423, body: { error: "Enter your private PIN to open People", code: PEOPLE_PIN_LOCKED_CODE } };
  }
  return null;
}

/** The ONLY hash the People unlock checks: the private PIN. Never the
 *  station PIN — null means "not set", and the caller refuses with 428. */
export function peoplePinHashFor(user: { privatePinHash: string | null; pinHash: string | null }): string | null {
  return user.privatePinHash ?? null;
}

export type PinCompare = (pin: string, hash: string) => Promise<boolean>;

/** Does `pin` match the OTHER PIN's hash? The station PIN and the private
 *  PIN must never be the same, checked in both directions. */
export async function pinClashes(pin: string, otherHash: string | null | undefined, compare: PinCompare): Promise<boolean> {
  if (!otherHash) return false;
  return compare(pin, otherHash);
}

export const PRIVATE_PIN_SAME_AS_STATION = "Choose a different PIN from the one you use at the stations";
export const STATION_PIN_SAME_AS_PRIVATE =
  "That's the same as your private People PIN — choose a different station PIN. The two must never match.";
