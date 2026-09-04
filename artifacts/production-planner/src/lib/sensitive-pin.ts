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
 */
export function shouldPromptForSensitivePin(input: {
  role: string;
  includeAdmins: boolean;
  msSinceUnlock: number;
  ttlMs: number;
}): boolean {
  if (input.role === "admin" && !input.includeAdmins) return false;
  return input.msSinceUnlock >= input.ttlMs;
}
