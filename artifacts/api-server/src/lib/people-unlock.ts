/**
 * The People section's private PIN (Graeme, 2026-09-24) — the rules, no I/O.
 *
 * A person may set a second, private PIN used ONLY to open the People
 * section (employee records, reviews, return-to-work forms), so the PIN they
 * type in front of others at a station can't open it. Opt-in: someone with
 * no private PIN is unaffected everywhere.
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
