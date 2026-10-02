/**
 * Recipe archive — the pure half (Graeme, 2026-10-02; migration 0141).
 *
 * An archived recipe is switched off, not deleted: it disappears from the
 * Recipes list and from every "choose a recipe" picker, but GET /api/recipes
 * still returns it (with `archivedAt` set) so plans, history, reports and
 * stations that already reference it keep its name and data. Every picker
 * runs its list through `activeRecipes()` — never a hand-rolled filter — and
 * passes the ids it is already showing as `keepIds`, so a saved selection
 * that points at an archived recipe never goes blank.
 */

export type ArchivableRecipe = { id: number; archivedAt?: string | Date | null };

export function isArchived(r: { archivedAt?: string | Date | null } | null | undefined): boolean {
  return r?.archivedAt != null && r.archivedAt !== "";
}

/** The recipes a picker should offer: everything not archived, plus any
 *  archived recipe in `keepIds` (already chosen, so it must stay visible). */
export function activeRecipes<T extends ArchivableRecipe>(list: readonly T[] | null | undefined, keepIds?: Iterable<number | null | undefined>): T[] {
  const keep = new Set<number>();
  for (const id of keepIds ?? []) if (typeof id === "number") keep.add(id);
  return (list ?? []).filter(r => !isArchived(r) || keep.has(r.id));
}

export function archivedRecipes<T extends ArchivableRecipe>(list: readonly T[] | null | undefined): T[] {
  return (list ?? []).filter(r => isArchived(r));
}

/** Ids of archived recipes — for filtering lists that carry recipeId rather
 *  than the recipe itself (plan suggestions, collections). */
export function archivedRecipeIds(list: readonly ArchivableRecipe[] | null | undefined): Set<number> {
  return new Set(archivedRecipes(list).map(r => r.id));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** London calendar day (YYYY-MM-DD) of an instant. */
export function londonDay(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function parseDay(day: string): { y: number; m: number; d: number; ms: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  return { y, m: mo, d, ms: Date.UTC(y, mo - 1, d) };
}

function shortDate(day: string, today: string): string {
  const p = parseDay(day);
  if (!p) return day;
  const t = parseDay(today);
  return `${p.d} ${MONTHS[p.m - 1]}${t && t.y !== p.y ? ` ${p.y}` : ""}`;
}

/** "Archived 2 Oct by Graeme" — first name only; no name → just the date. */
export function archivedLabel(archivedAt: string | Date | null | undefined, byName: string | null | undefined, now: Date = new Date()): string {
  if (archivedAt == null || archivedAt === "") return "";
  const at = archivedAt instanceof Date ? archivedAt : new Date(archivedAt);
  if (Number.isNaN(at.getTime())) return "Archived";
  const first = (byName ?? "").trim().split(/\s+/)[0];
  return `Archived ${shortDate(londonDay(at), londonDay(now))}${first ? ` by ${first}` : ""}`;
}

/** How a plan day reads next to today: "today's plan", "tomorrow's plan",
 *  "Friday's plan" (within the coming week), else "the plan for 14 Oct". */
export function planDayPhrase(planDate: string, today: string): string {
  const p = parseDay(planDate), t = parseDay(today);
  if (!p || !t) return `the plan for ${planDate}`;
  const diff = Math.round((p.ms - t.ms) / 86_400_000);
  if (diff === 0) return "today's plan";
  if (diff === 1) return "tomorrow's plan";
  if (diff > 1 && diff < 7) return `${WEEKDAYS[new Date(p.ms).getUTCDay()]}'s plan`;
  return `the plan for ${shortDate(planDate, today)}`;
}

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export type ArchiveCheck = {
  upcomingPlans: Array<{ planDate: string }>;
  isCoreMenu?: boolean;
  isCurrentSpecial?: boolean;
};

/** Plain-English heads-ups shown in the Archive confirm. None of them block
 *  archiving — it only stops the recipe being OFFERED; nothing already
 *  planned changes. */
export function archiveWarnings(check: ArchiveCheck, today: string): string[] {
  const out: string[] = [];
  const days = [...new Set(check.upcomingPlans.map(p => p.planDate.slice(0, 10)))].sort();
  if (days.length > 0) {
    const shown = days.slice(0, 3).map(d => planDayPhrase(d, today));
    if (days.length > 3) shown.push(`${days.length - 3} more`);
    out.push(`It's on ${joinAnd(shown)} — it'll still be made; it just won't be offered for new plans.`);
  }
  return out;
}

/** The question asked before archiving a core-menu or special recipe — an
 *  archived recipe can't stay on the menu (Graeme, 2026-10-02). null when
 *  there's nothing to untick. */
export function menuFlagQuestion(check: Pick<ArchiveCheck, "isCoreMenu" | "isCurrentSpecial">): { message: string; confirmLabel: string } | null {
  const core = !!check.isCoreMenu, special = !!check.isCurrentSpecial;
  if (!core && !special) return null;
  const what = core && special ? "a core menu recipe and the current special" : core ? "a core menu recipe" : "the current special";
  const untick = core && special ? "Take it off the core menu and as the special" : core ? "Take it off the core menu" : "Stop it being the special";
  return {
    message: `This is ${what}. It can't stay on the menu once archived. ${untick}, and archive it? If you restore it later it comes back off the menu${special ? " and won't replace whatever is the special then" : ""}.`,
    confirmLabel: core && special ? "Untick both and archive" : core ? "Untick core menu and archive" : "Remove as special and archive",
  };
}
