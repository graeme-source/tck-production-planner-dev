// Who appears on the Leanerboard (the improvements-per-person tally at the
// top of the Improvement Centre and the meeting slide). The founder is left
// off — it's the team's board, not a race against the boss (Graeme,
// 2026-09-30). His improvements still count everywhere else; only this
// tally hides him. Pure, so it's tested without a database.

import { isFounderEmail } from "@workspace/feature-registry";

export function leanerboardRows<T extends { email: string | null }>(rows: T[]): T[] {
  return rows.filter(r => !isFounderEmail(r.email));
}
