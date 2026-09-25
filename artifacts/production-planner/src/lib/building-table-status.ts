/**
 * Who is ON a building table, and what the dashboard chooser should say —
 * the rule, no I/O. Facts come from GET /api/building-tables/:planId.
 *
 * Fri 25 Sep 2026 the chooser read "Started by Tommy" (Table 1) and "Started
 * by Grant" (Table 2): the name was whoever first OPENED the table screen
 * that day. Tommy only works ovens; Kerri-Leigh did all 64 Table-1 batches.
 * Opening a screen must not make someone "the" builder. So:
 *
 *  1. Whoever recorded the most recent building batch on the table is the
 *     builder — "Kerri-Leigh — last batch 10:19".
 *  2. If nobody has recorded a batch in the last ACTIVE_WINDOW_MS, the most
 *     recent thing we know wins: a later open reads "Opened by X at 06:03",
 *     an earlier-than-the-last-batch open is ignored.
 *  3. The HOLDER (used by the optional building lock and the amber
 *     "someone's here" styling) exists only while that fact is fresh:
 *     a batch in the last 30 minutes, or an open in the last 30 minutes
 *     with no batch since. Otherwise the table is free to take.
 */

export const ACTIVE_WINDOW_MS = 30 * 60 * 1000;

type Person = { userId: number; userName: string };
export type BuildingTableFacts = {
  claim: (Person & { openedAt: string }) | null;
  lastBatch: (Person & { completedAt: string }) | null;
};

export type BuildingTableStatus = {
  /** The person working the table right now, or null when it's free to take. */
  holder: (Person & { via: "batch" | "opened" }) | null;
  /** What the chooser shows under "Table N" — null means "Free". */
  label: string | null;
  /** The label is about the person looking at it. */
  isMe: boolean;
};

const TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function ms(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

export function buildingTableStatus(
  facts: BuildingTableFacts | null | undefined,
  now: number,
  currentUserId: number,
): BuildingTableStatus {
  const batch = facts?.lastBatch ?? null;
  const claim = facts?.claim ?? null;
  const batchAt = batch ? ms(batch.completedAt) : null;
  const claimAt = claim ? ms(claim.openedAt) : null;

  const batchIsFresh = batch != null && batchAt != null && now - batchAt < ACTIVE_WINDOW_MS;
  const claimIsNewer = claim != null && claimAt != null && (batchAt == null || claimAt > batchAt);
  const claimIsFresh = claimIsNewer && now - claimAt! < ACTIVE_WINDOW_MS;

  const holder: BuildingTableStatus["holder"] = batchIsFresh
    ? { userId: batch!.userId, userName: batch!.userName, via: "batch" }
    : claimIsFresh
      ? { userId: claim!.userId, userName: claim!.userName, via: "opened" }
      : null;

  // What to say: a fresh batch always; otherwise the most recent fact.
  const sayBatch = batch != null && batchAt != null && (batchIsFresh || !claimIsNewer);
  if (sayBatch) {
    const isMe = batch!.userId === currentUserId;
    const time = TIME_FMT.format(batchAt!);
    return { holder, isMe, label: isMe ? `You — last batch ${time}` : `${firstName(batch!.userName)} — last batch ${time}` };
  }
  if (claimIsNewer) {
    const isMe = claim!.userId === currentUserId;
    const time = TIME_FMT.format(claimAt!);
    return { holder, isMe, label: isMe ? `You opened this at ${time}` : `Opened by ${firstName(claim!.userName)} at ${time}` };
  }
  return { holder, isMe: false, label: null };
}

/**
 * Should opening this table record the viewer as its opener? Only when
 * nobody is working it right now, the standing open isn't already theirs,
 * and they aren't actively building on the other table (one person, one
 * table — as before). Opening a screen is a hint for the chooser, nothing
 * more; the builder is whoever records batches.
 */
export function shouldRecordOpen(
  viewed: { facts: BuildingTableFacts | null | undefined; status: BuildingTableStatus },
  other: BuildingTableStatus,
  currentUserId: number,
): boolean {
  if (currentUserId <= 0) return false;
  if (viewed.status.holder) return false;
  if (viewed.facts?.claim?.userId === currentUserId) return false;
  if (other.holder?.userId === currentUserId) return false;
  return true;
}

/** The optional building lock: someone else is working this table now. */
export function blockedBy(status: BuildingTableStatus, currentUserId: number): string | null {
  if (!status.holder || status.holder.userId === currentUserId) return null;
  return status.holder.userName;
}
