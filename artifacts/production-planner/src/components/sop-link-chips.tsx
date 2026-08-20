/**
 * SOP links, rendered where the work happens (2026-08-19).
 *
 * A linked SOP shows as a small book chip on the checklist item / prep row /
 * wherever; tapping opens the full Standards & SOPs viewer on that SOP —
 * which includes Edit, so a wrong SOP can be fixed on the spot ("we want to
 * scrutinise them" — Graeme). The + chip opens a picker to attach another
 * SOP; chips expose a detach × while the picker is open. Attach/detach is
 * deliberately open to every signed-in user, same as SOP editing itself.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Plus, X, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { StandardsSopsDialog } from "@/components/standards-sops-dialog";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface SopLink {
  linkId: number;
  sopId: number;
  title: string;
  /** Present on recipe-scoped ingredient links. */
  recipeName?: string | null;
}

export interface SopAttachTarget {
  targetType: "checklist_template" | "ingredient" | "recipe_ingredient" | "recipe" | "station";
  a?: number;
  b?: number;
  text?: string;
  /** Shown in the picker header, e.g. "Defrost the duck" or "Burger Beef". */
  label: string;
}

interface SopListEntry { id: number; title: string; stations: string[] }

/** One viewer per surface: `const sopViewer = useSopViewer()` then render
 *  `sopViewer.dialog` once and call `sopViewer.open(sopId)` from any chip. */
export function useSopViewer(currentStationType?: string | null) {
  const [sopId, setSopId] = useState<number | null>(null);
  return {
    open: (id: number) => setSopId(id),
    dialog: (
      <StandardsSopsDialog
        open={sopId != null}
        onClose={() => setSopId(null)}
        currentStationType={currentStationType}
        initialSopId={sopId ?? undefined}
      />
    ),
  };
}

export function SopChips({ links, onOpen, attach, size = "sm", queryKeysToInvalidate }: {
  links: SopLink[];
  onOpen: (sopId: number) => void;
  /** When provided, an "+ SOP" chip lets the user attach/detach. */
  attach?: SopAttachTarget | SopAttachTarget[];
  size?: "sm" | "xs";
  /** Query keys refetched after attach/detach so chips update in place. */
  queryKeysToInvalidate?: unknown[][];
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const queryClient = useQueryClient();

  const invalidate = () => {
    for (const key of queryKeysToInvalidate ?? []) queryClient.invalidateQueries({ queryKey: key });
  };

  const detach = useMutation({
    mutationFn: async (linkId: number) => {
      const res = await fetch(`${BASE}/api/standards/links/${linkId}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Failed to detach SOP");
    },
    onSuccess: invalidate,
    onError: () => toast({ title: "Couldn't detach the SOP", variant: "destructive" }),
  });

  if (links.length === 0 && !attach) return null;

  const chipCls = cn(
    "inline-flex items-center gap-1 rounded-md border font-medium transition-colors max-w-[190px]",
    size === "sm" ? "text-xs px-2 py-1" : "text-[11px] px-1.5 py-0.5",
  );

  return (
    <span className="inline-flex items-center gap-1 flex-wrap align-middle">
      {links.map(l => (
        <span key={l.linkId} className={cn(chipCls, "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300")}>
          <button
            onClick={e => { e.stopPropagation(); onOpen(l.sopId); }}
            className="inline-flex items-center gap-1 min-w-0 hover:underline"
            title={l.recipeName ? `${l.title} (for ${l.recipeName})` : l.title}
          >
            <BookOpen className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{l.title}</span>
            {l.recipeName && <span className="opacity-70 flex-shrink-0">· {l.recipeName}</span>}
          </button>
          {attach && pickerOpen && (
            <button
              onClick={e => { e.stopPropagation(); detach.mutate(l.linkId); }}
              className="flex-shrink-0 hover:text-destructive"
              title="Detach this SOP" aria-label={`Detach ${l.title}`}
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </span>
      ))}
      {attach && (
        <button
          onClick={e => { e.stopPropagation(); setPickerOpen(o => !o); }}
          className={cn(chipCls, pickerOpen
            ? "border-primary bg-primary/10 text-primary"
            : "border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary")}
          title="Attach an SOP here"
        >
          <Plus className="w-3 h-3" /> SOP
        </button>
      )}
      {attach && pickerOpen && (
        <SopPicker
          targets={Array.isArray(attach) ? attach : [attach]}
          existingSopIds={new Set(links.map(l => l.sopId))}
          onDone={() => { setPickerOpen(false); invalidate(); }}
        />
      )}
    </span>
  );
}

/** Inline SOP picker: search the library, tap to attach. When several
 *  targets are offered (e.g. "only in this recipe" vs "everywhere"), each
 *  SOP row shows one button per scope. */
function SopPicker({ targets, existingSopIds, onDone }: {
  targets: SopAttachTarget[];
  existingSopIds: Set<number>;
  onDone: () => void;
}) {
  const [search, setSearch] = useState("");

  const { data: sops, isLoading } = useQuery<SopListEntry[]>({
    queryKey: ["sop-library-picker"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/standards`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load SOPs");
      return res.json();
    },
  });

  const attach = useMutation({
    mutationFn: async ({ sopId, target }: { sopId: number; target: SopAttachTarget }) => {
      const res = await fetch(`${BASE}/api/standards/links`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sopId, targetType: target.targetType, a: target.a, b: target.b, text: target.text }),
      });
      if (!res.ok) throw new Error("Failed to attach SOP");
    },
    onSuccess: (_r, vars) => {
      toast({ title: "SOP attached", description: vars.target.label });
      onDone();
    },
    onError: () => toast({ title: "Couldn't attach the SOP", variant: "destructive" }),
  });

  const filtered = useMemo(() =>
    (sops ?? []).filter(s => s.title.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 12),
    [sops, search]);

  return (
    <span className="block w-full mt-1.5 rounded-lg border border-primary/30 bg-card p-2 space-y-1.5" onClick={e => e.stopPropagation()}>
      <span className="flex items-center gap-1.5">
        <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search SOPs…"
          autoFocus
          className="flex-1 min-w-0 px-1.5 py-1 rounded-md border border-border bg-background text-xs"
        />
      </span>
      {isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      <span className="block max-h-44 overflow-y-auto divide-y divide-border/50">
        {filtered.map(s => (
          <span key={s.id} className="flex items-center gap-2 py-1.5 text-xs">
            <span className="flex-1 min-w-0 truncate font-medium">{s.title}</span>
            {existingSopIds.has(s.id) ? (
              <span className="text-muted-foreground flex-shrink-0">attached</span>
            ) : targets.map((t, i) => (
              <button
                key={i}
                onClick={() => attach.mutate({ sopId: s.id, target: t })}
                disabled={attach.isPending}
                className="flex-shrink-0 px-2 py-0.5 rounded-md border border-primary/40 text-primary hover:bg-primary/10 disabled:opacity-50"
              >
                {targets.length > 1 ? t.label : "Attach"}
              </button>
            ))}
          </span>
        ))}
        {!isLoading && filtered.length === 0 && (
          <span className="block py-2 text-xs text-muted-foreground">No SOPs match "{search}"</span>
        )}
      </span>
    </span>
  );
}
