/**
 * Who appears on the Leaner-board (Graeme, 2026-10-01: "take my name off
 * the top"). The board is for the team — the founder's own improvements
 * still count everywhere else (the feed, credits, his record), he just
 * isn't ranked against the people he's encouraging.
 */
import { isFounderEmail } from "./founder-email";

export function leanerBoardRows<T extends { email: string | null }>(rows: T[]): T[] {
  return rows.filter(r => !isFounderEmail(r.email));
}
