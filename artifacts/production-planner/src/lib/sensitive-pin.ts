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
