/**
 * SOP links, rendered where the work happens (2026-08-19).
 *
 * A linked SOP shows as an unmissable primary "Show me how" button on the
 * checklist item / prep row / wherever ("quite obvious, a primary-coloured
 * button" — Graeme, 2026-08-25); tapping opens the full Standards & SOPs
 * viewer on that SOP — which includes Edit, so a wrong SOP can be fixed on
 * the spot ("we want to scrutinise them" — Graeme). The + chip opens a
 * picker to attach another SOP; buttons expose a detach × while the picker
 * is open. Attach/detach is deliberately open to every signed-in user, same
 * as SOP editing itself.
 *
 * The picker also creates (2026-09-03). Standing at a station mid-checklist
 * is the moment you notice an SOP is missing, and it's the worst possible
 * moment to be sent off to the SOPs library to make one. So "Create new
 * SOP" names it — pre-filled from the task, because that is nearly always
 * what it should be called — creates it, attaches it, and offers the full
 * editor as an optional next step rather than a toll gate.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Plus, X, Loader2, Search, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { rankSops } from "@/lib/sop-search";
import { StandardsSopsDialog } from "@/components/standards-sops-dialog";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface SopLink {
  linkId: number;
  sopId: number;
  title: string;
  /** Present on recipe-scoped ingredient links. */
  recipeName?: string | null;
  /** How many steps the SOP has. 0 means it was created here and nobody has
   *  written it yet — the chip says so instead of promising a how-to. */
  stepCount?: number;
}

export interface SopAttachTarget {
  targetType: "checklist_template" | "ingredient" | "recipe_ingredient" | "recipe" | "sub_recipe" | "station";
  a?: number;
  b?: number;
  text?: string;
  /** The attach button's wording. On rows offering one target this is the
   *  name of the thing ("Switch on air vent switch"); on rows offering
   *  several it's the scope ("Everywhere", "Only The Don"). */
  label: string;
  /** The name of the thing the SOP would be about, used to pre-fill the
   *  title of a new one. Only needed where `label` is a scope name. */
  subject?: string;
  /** Station to file a newly created SOP under, so it shows on this
   *  station's filter in the library. Omitted = visible everywhere. */
  station?: string;
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
  // Set when someone asks to write the steps of a freshly created SOP, or
  // taps an SOP that has none yet. Brings its own dialog so no call site
  // has to wire an editor through.
  const [editSopId, setEditSopId] = useState<number | null>(null);
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
      {links.map(l => {
        // An attached SOP is a solid primary "Show me how" button — the one
        // affordance a new starter must never miss. With several SOPs on the
        // same row, each button carries its title so they stay tellable
        // apart; the full detail always lives in the tooltip.
        //
        // Unless it has no steps: an empty SOP promising a how-to and then
        // showing nothing is worse than no SOP at all, so it reads as the
        // to-do it is and opens straight into the editor.
        const isDraft = l.stepCount === 0;
        return (
          <span
            key={l.linkId}
            className={cn(chipCls, isDraft
              ? "border-dashed border-amber-500/70 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 font-semibold"
              : "border-primary bg-primary text-primary-foreground font-semibold shadow-sm")}
          >
            <button
              onClick={e => { e.stopPropagation(); if (isDraft) setEditSopId(l.sopId); else onOpen(l.sopId); }}
              className="inline-flex items-center gap-1.5 min-w-0"
              title={isDraft
                ? `${l.title} — no steps written yet`
                : l.recipeName ? `${l.title} (for ${l.recipeName})` : l.title}
            >
              <BookOpen className={cn("flex-shrink-0", size === "sm" ? "w-3.5 h-3.5" : "w-3 h-3")} />
              <span className="whitespace-nowrap">{isDraft ? "Write the steps" : "Show me how"}</span>
              {links.length > 1 && <span className="truncate opacity-80 font-normal">· {l.title}</span>}
            </button>
            {attach && pickerOpen && (
              <button
                onClick={e => { e.stopPropagation(); detach.mutate(l.linkId); }}
                className="flex-shrink-0 opacity-80 hover:opacity-100"
                title="Detach this SOP" aria-label={`Detach ${l.title}`}
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </span>
        );
      })}
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
          onInvalidate={invalidate}
          onEditSop={setEditSopId}
        />
      )}
      {editSopId != null && (
        <StandardsSopsDialog
          open
          onClose={() => { setEditSopId(null); invalidate(); }}
          initialEditSopId={editSopId}
        />
      )}
    </span>
  );
}

/** Station-level SOP rail — the catch-all anchor for processes that aren't
 *  keyed to a recipe or ingredient. Rendered once by StationLayout, so every
 *  station screen can attach and surface its own SOPs with no per-station
 *  wiring. Self-contained: brings its own viewer dialog. */
export function StationSopRail({ stationType, stationLabel }: { stationType: string; stationLabel: string }) {
  const sopViewer = useSopViewer(stationType);
  const queryKey = ["sop-links-station", stationType];
  const { data: links = [] } = useQuery<SopLink[]>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/standards/links/for-station?station=${encodeURIComponent(stationType)}`, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
  });
  return (
    <div className="flex items-start gap-2 flex-wrap">
      <span className="text-xs font-medium text-muted-foreground pt-1.5 flex-shrink-0">This station:</span>
      <SopChips
        links={links}
        onOpen={sopViewer.open}
        attach={{ targetType: "station", text: stationType, label: stationLabel, subject: stationLabel, station: stationType }}
        queryKeysToInvalidate={[queryKey]}
      />
      {sopViewer.dialog}
    </div>
  );
}

/** Inline SOP picker: search the library, tap to attach, or make the one
 *  that's missing without leaving the screen. When several targets are
 *  offered (e.g. "only in this recipe" vs "everywhere"), each SOP row shows
 *  one button per scope.
 *
 *  Sizing is for a gloved hand on a 10.2" iPad: full-width create button,
 *  44px primary actions, and no autofocus on the search field so the
 *  keyboard doesn't cover the list before anyone has read it. */
function SopPicker({ targets, existingSopIds, onDone, onInvalidate, onEditSop }: {
  targets: SopAttachTarget[];
  existingSopIds: Set<number>;
  onDone: () => void;
  /** Refresh the chips behind the picker without closing it. */
  onInvalidate: () => void;
  onEditSop: (sopId: number) => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [naming, setNaming] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [created, setCreated] = useState<{ id: number; title: string } | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const { data: sops, isLoading } = useQuery<SopListEntry[]>({
    queryKey: ["sop-library-picker"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/standards`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load SOPs");
      return res.json();
    },
  });

  // What a new SOP should be called by default — the task, ingredient or
  // station the chips hang off. Rows offering several scopes put scope
  // names in `label`, so those sites pass `subject` instead.
  const subject = targets.find(t => t.subject)?.subject
    ?? (targets.length === 1 ? targets[0].label : "");
  const station = targets.find(t => t.station)?.station;

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

  // Create and attach in one go. If the link fails the SOP still exists, so
  // say so rather than leaving someone thinking nothing happened.
  const create = useMutation({
    mutationFn: async ({ title, target }: { title: string; target: SopAttachTarget }) => {
      const res = await fetch(`${BASE}/api/standards`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, stations: station ? [station] : [] }),
      });
      if (!res.ok) throw new Error("The SOP couldn't be created");
      const { id } = (await res.json()) as { id: number };
      const link = await fetch(`${BASE}/api/standards/links`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sopId: id, targetType: target.targetType, a: target.a, b: target.b, text: target.text }),
      });
      if (!link.ok) throw new Error(`"${title}" was created but couldn't be attached — it's in the SOPs library.`);
      return { id, title };
    },
    onSuccess: result => {
      queryClient.invalidateQueries({ queryKey: ["sop-library-picker"] });
      onInvalidate();
      setCreated(result);
    },
    onError: err => toast({
      title: "Couldn't create the SOP",
      description: err instanceof Error ? err.message : undefined,
      variant: "destructive",
    }),
  });

  const { matches, similar } = useMemo(() => rankSops(search, sops ?? []), [sops, search]);

  // Near-duplicates of the name being typed, so an existing SOP gets a
  // chance to be seen before a second one is made.
  const clashes = useMemo(() => {
    if (!naming || !newTitle.trim()) return [];
    const ranked = rankSops(newTitle, sops ?? [], { matchLimit: 3, similarLimit: 3 });
    return [...ranked.matches, ...ranked.similar].slice(0, 3);
  }, [naming, newTitle, sops]);

  useEffect(() => {
    if (naming) {
      titleRef.current?.focus();
      titleRef.current?.select();
    }
  }, [naming]);

  const panelCls = "block w-full mt-1.5 rounded-lg border border-primary/30 bg-card p-2.5 space-y-2";
  const canCreate = newTitle.trim().length > 0 && !create.isPending;

  // Created — the link is already made and the chip is showing behind this.
  // Writing the steps is offered, never demanded: there's a checklist to get
  // back to.
  if (created) {
    return (
      <span className={panelCls} onClick={e => e.stopPropagation()}>
        <span className="flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <span className="text-sm leading-snug">
            <span className="font-semibold">{created.title}</span> is attached here. It has no steps yet.
          </span>
        </span>
        <span className="flex gap-2">
          <button
            onClick={() => { onEditSop(created.id); onDone(); }}
            className="flex-1 min-h-[44px] rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90"
          >
            Write the steps now
          </button>
          <button
            onClick={onDone}
            className="px-4 min-h-[44px] rounded-md border border-border text-sm font-medium hover:bg-secondary"
          >
            Later
          </button>
        </span>
      </span>
    );
  }

  const sopRow = (s: SopListEntry) => (
    <span key={s.id} className="flex items-center gap-2 py-2 border-b border-border/50">
      <span className="flex-1 min-w-0 truncate text-sm font-medium">{s.title}</span>
      {existingSopIds.has(s.id) ? (
        <span className="text-xs text-muted-foreground flex-shrink-0">attached</span>
      ) : targets.map((t, i) => (
        <button
          key={i}
          onClick={() => attach.mutate({ sopId: s.id, target: t })}
          disabled={attach.isPending}
          className="flex-shrink-0 px-3 min-h-[36px] rounded-md border border-primary/40 text-primary text-xs font-semibold hover:bg-primary/10 disabled:opacity-50"
        >
          {targets.length > 1 ? t.label : "Attach"}
        </button>
      ))}
    </span>
  );

  return (
    <span className={panelCls} onClick={e => e.stopPropagation()}>
      <span className="flex items-center gap-1.5">
        <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search SOPs…"
          enterKeyHint="search"
          className="flex-1 min-w-0 px-2 py-2 rounded-md border border-border bg-background text-sm"
        />
      </span>

      {isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}

      <span className="block max-h-52 overflow-y-auto">
        {matches.map(sopRow)}
        {similar.length > 0 && (
          <>
            <span className="block pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Similar — check these before making a new one
            </span>
            {similar.map(sopRow)}
          </>
        )}
        {!isLoading && matches.length === 0 && similar.length === 0 && (
          <span className="block py-2 text-xs text-muted-foreground">
            {search.trim() ? `No SOPs match "${search.trim()}".` : "No SOPs yet."}
          </span>
        )}
      </span>

      {!naming ? (
        <button
          onClick={() => { setNewTitle(search.trim() || subject); setNaming(true); }}
          className="w-full flex items-center justify-center gap-1.5 min-h-[44px] rounded-md border border-dashed border-primary text-primary text-sm font-semibold hover:bg-primary/10"
        >
          <Plus className="w-4 h-4" /> Create new SOP
        </button>
      ) : (
        <span className="block rounded-md border border-primary/40 bg-primary/5 p-2 space-y-2">
          <label className="block text-xs font-semibold text-muted-foreground">Name the new SOP</label>
          <input
            ref={titleRef}
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            placeholder="What is this SOP called?"
            enterKeyHint="done"
            onKeyDown={e => {
              if (e.key === "Enter" && canCreate) {
                e.preventDefault();
                create.mutate({ title: newTitle.trim(), target: targets[0] });
              }
            }}
            className="w-full px-2 py-2 rounded-md border border-border bg-background text-sm"
          />
          {clashes.length > 0 && (
            <span className="block rounded-md bg-amber-50 dark:bg-amber-950/40 p-2 space-y-1.5">
              <span className="block text-[11px] font-semibold text-amber-900 dark:text-amber-200">
                These already exist — use one instead?
              </span>
              {clashes.map(c => (
                <span key={c.id} className="flex items-center gap-2">
                  <span className="flex-1 min-w-0 truncate text-xs">{c.title}</span>
                  {existingSopIds.has(c.id) ? (
                    <span className="text-[11px] text-muted-foreground flex-shrink-0">attached</span>
                  ) : targets.length === 1 ? (
                    <button
                      onClick={() => attach.mutate({ sopId: c.id, target: targets[0] })}
                      disabled={attach.isPending}
                      className="flex-shrink-0 px-3 min-h-[36px] rounded-md border border-amber-600/50 text-amber-900 dark:text-amber-200 text-xs font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-50"
                    >
                      Attach
                    </button>
                  ) : (
                    // Several scopes to choose from — send them back to the
                    // list row, which has a button for each.
                    <button
                      onClick={() => { setNaming(false); setSearch(c.title); }}
                      className="flex-shrink-0 px-3 min-h-[36px] rounded-md border border-amber-600/50 text-amber-900 dark:text-amber-200 text-xs font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/40"
                    >
                      Show it
                    </button>
                  )}
                </span>
              ))}
            </span>
          )}
          <span className="flex gap-2">
            {targets.map((t, i) => (
              <button
                key={i}
                onClick={() => create.mutate({ title: newTitle.trim(), target: t })}
                disabled={!canCreate}
                className="flex-1 min-h-[44px] px-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50"
              >
                {create.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                  : targets.length > 1 ? `Create · ${t.label}` : "Create & attach"}
              </button>
            ))}
            <button
              onClick={() => setNaming(false)}
              className="px-3 min-h-[44px] rounded-md border border-border text-sm font-medium hover:bg-secondary"
            >
              Cancel
            </button>
          </span>
        </span>
      )}
    </span>
  );
}
