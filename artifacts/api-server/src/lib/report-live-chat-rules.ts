/**
 * Pure rules for talking a problem through with AI Jane BEFORE it's reported
 * (Graeme, 20 Nov 2026: "force people to have the conversation with AI Jane
 * first, to see if she can fix it without it coming to my desk"). The chat
 * itself is lib/report-live-chat.ts.
 */

export type LiveTurn = { role: "user" | "assistant"; text: string };
export type ReportArea = "factory" | "system";

/** Most turns sent to Claude; the opening message is always kept. */
export const MAX_LIVE_TURNS = 24;

/** The opening message (what happened) plus the latest turns. */
export function trimLiveHistory(h: readonly LiveTurn[]): LiveTurn[] {
  if (h.length <= MAX_LIVE_TURNS) return [...h];
  const tail = h.slice(-(MAX_LIVE_TURNS - 1));
  // Keep turns alternating: the tail must start with the person.
  const start = tail.findIndex(t => t.role === "user");
  return [h[0], ...tail.slice(Math.max(0, start === 0 ? 1 : start))].filter((t, i, a) => i === 0 || t.role !== a[i - 1].role);
}

/** What goes in the report when Jane can't write it: their own words, in order. */
export function draftFromTheirWords(h: readonly LiveTurn[]): string {
  return h.filter(t => t.role === "user").map(t => t.text.trim()).filter(Boolean).join("\n\n");
}

/** SOP ids Jane names must be ones her searches actually returned. */
export function keepKnownSops(ids: unknown, seen: ReadonlyMap<number, string>): Array<{ id: number; title: string }> {
  if (!Array.isArray(ids)) return [];
  const out: Array<{ id: number; title: string }> = [];
  for (const raw of ids) {
    const id = Number(raw);
    const title = seen.get(id);
    if (Number.isInteger(id) && title && !out.some(s => s.id === id)) out.push({ id, title });
  }
  return out.slice(0, 3);
}

/** An in-app path Jane names must have come from the app guide or a report. */
export function keepKnownPath(path: unknown, seen: ReadonlySet<string>): string | null {
  return typeof path === "string" && seen.has(path) ? path : null;
}
