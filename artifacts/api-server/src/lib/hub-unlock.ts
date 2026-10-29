/**
 * Your own HR records — the Employee Hub's record, contract, documents,
 * letters and starter forms — behind a PIN typed moments ago (Graeme,
 * 29 Oct 2026: "if someone picks up someone else's iPad without entering
 * their PIN" they must not get in). The rules, no I/O.
 *
 * The app asks for the PIN every time the hub is opened; the server makes
 * that real: these reads answer only if a PIN was typed within
 * HUB_UNLOCK_TTL_MS, and the window slides while the hub is in use, so a
 * long read never locks mid-way but a walked-away iPad does.
 *
 *   • People access → the private-PIN rules (lib/people-unlock.ts) — their
 *     hub asks for the private PIN, and the station PIN never opens it.
 *   • Still onboarding → pass: the onboarding screens read and sign the
 *     contract and starter forms straight after sign-in, before anything
 *     else in the app opens.
 *   • No station PIN set → pass: there is nothing they could type (the app
 *     skips the prompt for them too).
 *   • Otherwise → unlocked within the window, or 423 HUB_PIN_REQUIRED.
 */
export const HUB_UNLOCK_TTL_MS = 15 * 60 * 1000;
export const HUB_PIN_LOCKED_CODE = "HUB_PIN_REQUIRED";

export function isHubUnlocked(unlockedAtIso: string | null | undefined, now: Date): boolean {
  if (!unlockedAtIso) return false;
  const at = new Date(unlockedAtIso).getTime();
  if (Number.isNaN(at)) return false;
  const age = now.getTime() - at;
  return age >= 0 && age < HUB_UNLOCK_TTL_MS;
}

export type HubGateDecision = "people" | "pass" | "locked";

export function hubGateDecision(f: {
  hasPeopleAccess: boolean;
  onboarding: boolean;
  hasStationPin: boolean;
  unlocked: boolean;
}): HubGateDecision {
  if (f.hasPeopleAccess) return "people";
  if (f.onboarding || !f.hasStationPin) return "pass";
  return f.unlocked ? "pass" : "locked";
}

export const HUB_PIN_REFUSAL = {
  status: 423,
  body: { error: "Enter your PIN to open your Employee Hub", code: HUB_PIN_LOCKED_CODE },
} as const;
