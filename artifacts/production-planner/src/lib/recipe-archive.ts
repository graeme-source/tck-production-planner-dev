/**
 * Recipe lifecycle — the pure half (Graeme, 2026-10-02; migrations 0141
 * archive, 0142 drafts). A recipe is in one of three stages:
 *
 *   Draft        being developed — might make it, not ready for anything.
 *   On the menu  ("active") what we actually make: core menu, specials,
 *                test products.
 *   Archived     made before, not any more; kept and restorable.
 *
 * Stage = archived if archivedAt is set; else draft if isDraft; else active.
 * Nothing is ever deleted: GET /api/recipes returns every recipe (with
 * archivedAt / isDraft) so plans, history, reports and stations that already
 * reference one keep its name and data.
 *
 * Which list a picker uses — never a hand-rolled filter:
 *   activeRecipes()       production pickers (plans, queued production,
 *                         stock, sales, cases, defects, surveys, bundles…):
 *                         on the menu only. Pass the ids already chosen as
 *                         `keepIds` so a saved selection never goes blank.
 *   notArchivedRecipes()  development tools where a draft must be usable
 *                         (Product Hub decks/nutrition/labels, Recipe P&L,
 *                         test boxes): on the menu + drafts — label drafts.
 *   draftRecipes() / archivedRecipes()  the Recipes page's other two views.
 */

export type ArchivableRecipe = { id: number; archivedAt?: string | Date | null; isDraft?: boolean | null };

export type RecipeStage = "draft" | "active" | "archived";

export function isArchived(r: { archivedAt?: string | Date | null } | null | undefined): boolean {
  return r?.archivedAt != null && r.archivedAt !== "";
}

export function recipeStage(r: { archivedAt?: string | Date | null; isDraft?: boolean | null } | null | undefined): RecipeStage {
  if (isArchived(r)) return "archived";
  if (r?.isDraft === true) return "draft";
  return "active";
}

/** A draft that isn't archived (an archived draft is shown as Archived). */
export function isDraftRecipe(r: { archivedAt?: string | Date | null; isDraft?: boolean | null } | null | undefined): boolean {
  return recipeStage(r) === "draft";
}

function keepSet(keepIds?: Iterable<number | null | undefined>): Set<number> {
  const keep = new Set<number>();
  for (const id of keepIds ?? []) if (typeof id === "number") keep.add(id);
  return keep;
}

/** The recipes a production picker should offer: on the menu only (not
 *  archived, not a draft), plus any recipe in `keepIds` (already chosen, so
 *  it must stay visible). */
export function activeRecipes<T extends ArchivableRecipe>(list: readonly T[] | null | undefined, keepIds?: Iterable<number | null | undefined>): T[] {
  const keep = keepSet(keepIds);
  return (list ?? []).filter(r => recipeStage(r) === "active" || keep.has(r.id));
}

/** On the menu + drafts: for the places a draft is developed and trialled
 *  (Product Hub, Recipe P&L, test boxes). Label the drafts. */
export function notArchivedRecipes<T extends ArchivableRecipe>(list: readonly T[] | null | undefined, keepIds?: Iterable<number | null | undefined>): T[] {
  const keep = keepSet(keepIds);
  return (list ?? []).filter(r => !isArchived(r) || keep.has(r.id));
}

export function draftRecipes<T extends ArchivableRecipe>(list: readonly T[] | null | undefined): T[] {
  return (list ?? []).filter(r => recipeStage(r) === "draft");
}

export function archivedRecipes<T extends ArchivableRecipe>(list: readonly T[] | null | undefined): T[] {
  return (list ?? []).filter(r => isArchived(r));
}

/** How many recipes are in each stage — the Recipes page switch. */
export function recipeStageCounts(list: readonly ArchivableRecipe[] | null | undefined): Record<RecipeStage, number> {
  const out: Record<RecipeStage, number> = { draft: 0, active: 0, archived: 0 };
  for (const r of list ?? []) out[recipeStage(r)] += 1;
  return out;
}

/** Ids of archived recipes — for filtering lists that carry recipeId rather
 *  than the recipe itself (plan suggestions, collections). */
export function archivedRecipeIds(list: readonly ArchivableRecipe[] | null | undefined): Set<number> {
  return new Set(archivedRecipes(list).map(r => r.id));
}

/** Ids of drafts (not archived) — same use as archivedRecipeIds. */
export function draftRecipeIds(list: readonly ArchivableRecipe[] | null | undefined): Set<number> {
  return new Set(draftRecipes(list).map(r => r.id));
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

/** "Draft since 2 Oct (Graeme)" — or just "Draft" when we don't know when
 *  (a recipe created before drafts existed). */
export function draftedLabel(draftedAt: string | Date | null | undefined, byName: string | null | undefined, now: Date = new Date()): string {
  if (draftedAt == null || draftedAt === "") return "Draft";
  const at = draftedAt instanceof Date ? draftedAt : new Date(draftedAt);
  if (Number.isNaN(at.getTime())) return "Draft";
  const first = (byName ?? "").trim().split(/\s+/)[0];
  return `Draft since ${shortDate(londonDay(at), londonDay(now))}${first ? ` (${first})` : ""}`;
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

/** The question asked before moving a core-menu or special recipe to
 *  Drafts — a draft can't be on the menu (Graeme, 2026-10-02). null when
 *  there's nothing to untick. */
export function draftMenuQuestion(check: Pick<ArchiveCheck, "isCoreMenu" | "isCurrentSpecial">): { message: string; confirmLabel: string } | null {
  const core = !!check.isCoreMenu, special = !!check.isCurrentSpecial;
  if (!core && !special) return null;
  const what = core && special ? "a core menu recipe and the current special" : core ? "a core menu recipe" : "the current special";
  return {
    message: `This is ${what}. A draft can't be on the menu. Take it off the menu and make it a draft? Putting it back on the menu later won't re-tick ${core && special ? "either" : core ? "Core menu" : "it as the special"}${special ? " or replace whatever is the special then" : ""}.`,
    confirmLabel: "Take it off the menu and make it a draft",
  };
}

/** What the Edit Recipe form says when Core menu / Special is ticked on a
 *  draft: saving will put it on the menu. null when there's nothing to say. */
export function draftMenuTickNotice(isDraft: boolean, wants: { isCoreMenu?: boolean; isCurrentSpecial?: boolean }): string | null {
  if (!isDraft) return null;
  const core = wants.isCoreMenu === true, special = wants.isCurrentSpecial === true;
  if (!core && !special) return null;
  const what = core && special ? "Core menu and Special are" : core ? "Core menu is" : "Special is";
  return `This recipe is a draft. ${what} ticked, so saving puts it on the menu — it'll be offered for plans, stock and sales. Untick to keep it a draft.`;
}
