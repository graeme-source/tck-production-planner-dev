/**
 * What of an app_users row may leave the server in the Users API.
 *
 * Never the password hash, and never either PIN hash. A PIN is 4 digits, so
 * its bcrypt hash can be cracked offline in minutes by trying all 10,000 —
 * sending the private People PIN's hash to a browser would make the private
 * PIN worthless (found 2026-09-25: GET /api/users sent both PIN hashes to
 * any signed-in account).
 */
export function toSafeUserRow<T extends { passwordHash: unknown; pinHash: unknown; privatePinHash: unknown }>(
  r: T,
): Omit<T, "passwordHash" | "pinHash" | "privatePinHash"> {
  const { passwordHash: _ph, pinHash: _pin, privatePinHash: _ppin, ...safe } = r;
  return safe;
}
