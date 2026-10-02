/**
 * Recipe lifecycle rules — draft → on the menu → archived (Graeme,
 * 2026-10-02; migrations 0141 archive, 0142 drafts). Pure, unit-tested.
 *
 *   Stage = archived if archived_at is set; else draft if is_draft; else
 *   "active" (on the menu). is_draft survives archiving, so restoring an
 *   archived draft puts it back in Drafts.
 *
 * Neither an archived recipe nor a draft may be ticked Core menu (it would
 * keep being added to new plans) or be the current special. Moving a
 * core-menu / special recipe to Archived or Drafts is refused until the
 * person chooses "take it off the menu" — never silently unticked. Restoring
 * never re-ticks either, so it can't overwrite today's special. Ticking Core
 * menu or Special on a draft is refused unless the same save puts it on the
 * menu (the Edit Recipe form says so before saving).
 */
export type MenuFlags = { isCoreMenu: boolean; isCurrentSpecial: boolean };

export type RecipeStage = "draft" | "active" | "archived";

export function recipeStage(r: { archivedAt?: Date | string | null; isDraft?: boolean | null }): RecipeStage {
  if (r.archivedAt != null && r.archivedAt !== "") return "archived";
  if (r.isDraft === true) return "draft";
  return "active";
}

/** Offered by production pickers (plans, defects, stock …): on the menu only. */
export function isOnMenu(r: { archivedAt?: Date | string | null; isDraft?: boolean | null }): boolean {
  return recipeStage(r) === "active";
}

export type ArchiveDecision =
  | { ok: true; clear: MenuFlags | null }
  | { ok: false; flags: MenuFlags; message: string };

function menuWhat(flags: MenuFlags): string {
  return [flags.isCoreMenu && "a core menu recipe", flags.isCurrentSpecial && "the current special"].filter(Boolean).join(" and ");
}

function decideOffMenu(flags: MenuFlags, clearMenuFlags: boolean, message: (what: string) => string): ArchiveDecision {
  if (!flags.isCoreMenu && !flags.isCurrentSpecial) return { ok: true, clear: null };
  if (clearMenuFlags) return { ok: true, clear: { isCoreMenu: false, isCurrentSpecial: false } };
  return { ok: false, flags, message: message(menuWhat(flags)) };
}

export function decideArchive(flags: MenuFlags, clearMenuFlags: boolean): ArchiveDecision {
  return decideOffMenu(flags, clearMenuFlags, what =>
    `This is ${what}. Take it off first (or confirm "untick and archive") — an archived recipe can't stay on the menu.`);
}

/** Moving a recipe to Drafts: same question as archiving. */
export function decideMoveToDraft(flags: MenuFlags, clearMenuFlags: boolean): ArchiveDecision {
  return decideOffMenu(flags, clearMenuFlags, what =>
    `This is ${what}. Take it off the menu first (or confirm "take it off the menu and make it a draft") — a draft can't be on the menu.`);
}

export type MenuTickDecision = { ok: true; publish: boolean } | { ok: false; message: string };

/** Saving a recipe with Core menu / Special ticked. On a draft that's only
 *  allowed when the same save puts it on the menu (publishDraft). */
export function decideMenuTick(isDraft: boolean, wants: Partial<MenuFlags>, publishDraft: boolean): MenuTickDecision {
  const onMenu = wants.isCoreMenu === true || wants.isCurrentSpecial === true;
  if (!isDraft || !onMenu) return { ok: true, publish: false };
  if (publishDraft) return { ok: true, publish: true };
  const what = wants.isCoreMenu && wants.isCurrentSpecial ? "Core menu or Special" : wants.isCoreMenu ? "Core menu" : "Special";
  return { ok: false, message: `This recipe is a draft, so it can't be ticked ${what}. Put it on the menu first (or untick ${what} to keep it a draft).` };
}

export type CreateStageDecision = { ok: true; isDraft: boolean } | { ok: false; message: string };

/** A new recipe. Omitting isDraft keeps the old behaviour (on the menu) for
 *  any caller that doesn't know about drafts. A draft can't start ticked
 *  Core menu or Special. */
export function decideCreateStage(isDraft: boolean | undefined, wants: Partial<MenuFlags>): CreateStageDecision {
  if (isDraft !== true) return { ok: true, isDraft: false };
  if (wants.isCoreMenu === true || wants.isCurrentSpecial === true) {
    return { ok: false, message: "A draft can't be Core menu or the special. Untick them, or don't start it as a draft." };
  }
  return { ok: true, isDraft: true };
}
