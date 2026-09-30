/**
 * Page Access — who can open each page, as a three-column board (Graeme,
 * 2026-09-30). Replaced the "Page Access Control" table and its Save
 * Changes button: tap a page, pick its new level, it saves there and then.
 *
 * Same data and endpoint as before (page_permissions via
 * GET/PUT /api/page-permissions, admin only). Collapsed by default to a
 * one-line summary. A page's level is also the baseline every person's
 * "What they can open" list reads, so a move refreshes that too.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, ChevronUp, Loader2, Lock } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { usePagePermissions, useSavePagePermissions, type PagePermission } from "@/hooks/use-page-permissions";
import { FEATURES_KEY } from "@/hooks/use-team-access";
import { PAGE_LEVELS, groupPagesByLevel, pageBoardSummary } from "@/lib/team-access";
import { cn } from "@/lib/utils";
import type { Role } from "@workspace/feature-registry";

type Save = { pageKey: string; status: "saving" | "saved" | "error"; error?: string };

const COLUMN_TONE: Record<Role, string> = {
  viewer: "border-blue-200 dark:border-blue-900",
  manager: "border-amber-200 dark:border-amber-900",
  admin: "border-red-200 dark:border-red-900",
};

export function PageAccessBoard() {
  const { permissions, isLoading } = usePagePermissions();
  const savePermissions = useSavePagePermissions();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [openChip, setOpenChip] = useState<string | null>(null);
  const [save, setSave] = useState<Save | null>(null);
  // Shown in its new column while the save is in flight.
  const [moving, setMoving] = useState<{ pageKey: string; minRole: Role } | null>(null);

  const pages: PagePermission[] = permissions.map(p =>
    moving && p.pageKey === moving.pageKey ? { ...p, minRole: moving.minRole } : p);
  const columns = groupPagesByLevel(pages);

  const move = (p: PagePermission, minRole: Role) => {
    setOpenChip(null);
    if (p.minRole === minRole) return;
    setMoving({ pageKey: p.pageKey, minRole });
    setSave({ pageKey: p.pageKey, status: "saving" });
    savePermissions.mutate([{ pageKey: p.pageKey, minRole }], {
      onSuccess: () => {
        setSave({ pageKey: p.pageKey, status: "saved" });
        void qc.invalidateQueries({ queryKey: FEATURES_KEY });
      },
      onError: (e: Error) => setSave({ pageKey: p.pageKey, status: "error", error: e.message }),
      onSettled: () => setMoving(null),
    });
  };

  const labelOf = (key: string) => permissions.find(p => p.pageKey === key)?.label ?? key;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Lock className="w-4 h-4 text-primary" /> Page Access
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isLoading ? "Loading…" : pageBoardSummary(permissions)}. Admins can always open everything.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 h-11 px-4 rounded-xl border-2 border-border text-sm font-semibold hover:bg-secondary/50"
        >
          {open ? <>Hide <ChevronUp className="w-4 h-4" /></> : <>Show pages <ChevronDown className="w-4 h-4" /></>}
        </button>
      </div>

      {save && (
        <div className="text-sm" aria-live="polite">
          {save.status === "saving" && <span className="flex items-center gap-1.5 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Saving {labelOf(save.pageKey)}…</span>}
          {save.status === "saved" && <span className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400"><Check className="w-4 h-4" /> Saved — {labelOf(save.pageKey)} is now {PAGE_LEVELS.find(l => l.level === permissions.find(p => p.pageKey === save.pageKey)?.minRole)?.title.toLowerCase()}</span>}
          {save.status === "error" && <span className="flex items-center gap-1.5 font-medium text-destructive"><AlertTriangle className="w-4 h-4" /> Couldn't save {labelOf(save.pageKey)} — {save.error}. It's back where it was; try again.</span>}
        </div>
      )}

      {open && (
        isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Tap a page to move it to another level. It saves straight away.</p>
            <div className="grid gap-3 md:grid-cols-3">
              {PAGE_LEVELS.map(col => (
                <div key={col.level} className={cn("rounded-2xl border-2 bg-card p-3 sm:p-4", COLUMN_TONE[col.level])}>
                  <p className="font-semibold mb-3 flex items-center justify-between gap-2">
                    {col.title}
                    <span className="text-sm font-normal text-muted-foreground">{columns[col.level].length}</span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {columns[col.level].map(p => (
                      <Popover key={p.pageKey} open={openChip === p.pageKey} onOpenChange={v => setOpenChip(v ? p.pageKey : null)}>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            disabled={save?.status === "saving"}
                            className={cn(
                              "min-h-[44px] px-3 py-2 rounded-xl border-2 border-border bg-background text-sm font-medium text-left hover:border-primary/60 disabled:opacity-60",
                              save?.pageKey === p.pageKey && save.status === "saving" && "border-primary",
                            )}
                          >
                            {save?.pageKey === p.pageKey && save.status === "saving" && <Loader2 className="inline w-3.5 h-3.5 mr-1 animate-spin" />}
                            {/* Labels can carry an admin hint in brackets; the chip keeps it short. */}
                            {p.label.replace(/\s*\(.*\)$/, "")}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 p-2 rounded-xl">
                          <p className="px-2 pt-1 pb-2 text-sm font-semibold">{p.label}</p>
                          {PAGE_LEVELS.map(l => (
                            <button
                              key={l.level}
                              type="button"
                              onClick={() => move(p, l.level)}
                              className={cn(
                                "w-full flex items-center justify-between gap-2 min-h-[44px] px-3 rounded-lg text-sm text-left hover:bg-secondary",
                                p.minRole === l.level && "font-semibold text-primary",
                              )}
                            >
                              {l.title}
                              {p.minRole === l.level && <Check className="w-4 h-4" />}
                            </button>
                          ))}
                        </PopoverContent>
                      </Popover>
                    ))}
                    {columns[col.level].length === 0 && <p className="text-sm text-muted-foreground">No pages</p>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )
      )}
    </div>
  );
}
