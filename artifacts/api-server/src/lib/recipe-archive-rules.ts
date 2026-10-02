/**
 * Archiving a core-menu or special recipe (Graeme, 2026-10-02): never leave
 * an archived recipe ticked as Core menu (it would keep being added to new
 * plans) or as the current special. The person must choose: untick and
 * archive, or don't archive. Restoring never re-ticks either — it just
 * brings the recipe back, so it can't overwrite today's special. Pure.
 */
export type MenuFlags = { isCoreMenu: boolean; isCurrentSpecial: boolean };

export type ArchiveDecision =
  | { ok: true; clear: MenuFlags | null }
  | { ok: false; flags: MenuFlags; message: string };

export function decideArchive(flags: MenuFlags, clearMenuFlags: boolean): ArchiveDecision {
  if (!flags.isCoreMenu && !flags.isCurrentSpecial) return { ok: true, clear: null };
  if (clearMenuFlags) return { ok: true, clear: { isCoreMenu: false, isCurrentSpecial: false } };
  const what = [flags.isCoreMenu && "a core menu recipe", flags.isCurrentSpecial && "the current special"].filter(Boolean).join(" and ");
  return { ok: false, flags, message: `This is ${what}. Take it off first (or confirm "untick and archive") — an archived recipe can't stay on the menu.` };
}
