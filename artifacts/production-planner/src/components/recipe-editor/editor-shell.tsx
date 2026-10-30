/**
 * The tabbed body of the recipe AND sub-recipe editors — one component, one
 * tab bar, one lines table, so a change to one editor is a change to both
 * (Graeme, 28 Oct 2026: "it should use exactly the same code, and user
 * interface for subrecipes and recipes. When we make changes to one we don't
 * fall behind on the other"). Objectives A and F.
 *
 * Drawn inside <EditorDialog> (editor-dialog.tsx): the tab bar sticks to the
 * top of the scrolling body, the save bar is pinned at the bottom, the card
 * is capped at 92dvh. Ingredients opens first. Tabs are finger-sized and
 * scroll sideways on a phone. A tab holding a validation error shows a red
 * count, a warning an amber dot; a refused save jumps to the first tab with
 * an error (lib/recipe-editor-tabs). Every tab stays mounted while hidden,
 * so nothing typed is lost moving between them.
 *
 * Each editor hands in, per tab, its form `fields` (drawn inside a <form>,
 * so Enter saves) and its self-saving `panels` (drawn outside the form, so
 * Enter in a panel's own box never saves the recipe). A tab the editor
 * leaves empty isn't shown. Never switched on page name.
 *
 * ── Where everything went (audit, 28 Oct 2026) ─────────────────────────────
 * Nothing was removed; this is where each part of the two old long forms
 * now lives. R = final product (pages/recipes.tsx), S = sub-recipe
 * (pages/sub-recipes.tsx). "edit" = needs a saved record, so only when
 * editing (create shows a one-line note on that tab instead).
 *
 * INGREDIENTS (opens first) — components/recipe-editor/lines-table.tsx
 *   R+S  one table of ingredient AND sub-recipe rows: picker (bigger, bold),
 *        #id ↗ open (ingredient record / stacked sub-recipe editor),
 *        supplier + UPF chip / sub-recipe UPF %, quantity with g/kg switch
 *        (bigger, bold), line cost, remove, missing-data chips, "+ add new
 *        ingredient" from the picker (quick add)
 *   R    Fill / Top / Prep ticks and Mix +g on every row, "Linked to …" +
 *        "add at cooking"
 *   S    hide from prep sheet, processing-ratio note, "Marinade for …" raw
 *        meat + "add at cooking"; sub-recipes that would loop are left out
 *   R+S  two Add buttons side by side (ingredient / sub-recipe), same row
 *   R+S  total cost of the lines at the foot (new: R per portion, S per batch)
 *   R    Declared weights tiles — total raw, after cooking, portion, pack
 *   S    weight tiles — total in, yield %, mix yield; yield sanity check;
 *        "add at least one line" message; saved cost summary + yield
 *        analysis (YieldComparison, edit)
 * DETAILS
 *   R    product name, category (+ add new, preset defaults note),
 *        description, tags; output / recipe size + unit, pack size,
 *        shelf life (sets the label use-by), cooking loss %; Pack & pricing
 *        (RRP, packaging, labour, overhead line); on the menu: Core menu,
 *        Calzone Club Special (+ who holds it now), Fridge product,
 *        Start as a draft (create); colours (main + second); notes
 *   S    name, description; mix yield (auto), yield %, yield unit, shelf
 *        life; notes
 * PRODUCTION
 *   R    portions per batch, target build time (admin/manager), builder
 *        filling trim, tin size, max batches per tin; dietary category,
 *        oven temperature + time overrides (+ explainer); SOP URL;
 *        Production route panel (edit, saves itself)
 *   S    base sub-recipe, show individual ingredients in prep, one tin per
 *        recipe in Main Prep, made on production day; standard prep time
 *        (edit, saves itself); cook and chill (edit, saves itself)
 * LABEL & NUTRITION
 *   R    QUID percentages (edit, saves itself); ingredient deck (edit);
 *        pack label link (edit); nutritional information (edit). The Label
 *        LIVE design box was removed 30 Oct 2026 — Label LIVE is no longer
 *        used; recipes.label_live_design_name is kept, just not shown.
 *   S    label declaration name, generated declaration preview + fix
 *        buttons, "On product labels" usage
 * MORE
 *   R    Shopify inventory link, barcodes (edit, save themselves); archive /
 *        move to draft (edit, admin/manager)
 *   S    — nothing yet, so the tab isn't shown
 * ALWAYS IN VIEW
 *   R+S  title (R: draft / archived badges), pinned save bar with "Unsaved
 *        changes", the unsaved-changes guard on close (editor-dialog.tsx)
 *   R    "this save puts the draft on the menu" + Keep it a draft — moved
 *        into the save bar so it's seen from any tab
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { FieldErrors, UseFormRegisterReturn } from "react-hook-form";
import { BookOpenText, ClipboardList, Factory, MoreHorizontal, Tag } from "lucide-react";
import {
  DEFAULT_EDITOR_TAB,
  EDITOR_TABS,
  errorCountsByTab,
  firstErrorTab,
  visibleTabs,
  type EditorTabId,
  type FieldTabs,
} from "@/lib/recipe-editor-tabs";
import { cn } from "@/lib/utils";
import { EditorSaveBar } from "./editor-dialog";
import { scrollToFirstError } from "./scroll-to-error";

const TAB_ICONS: Record<EditorTabId, typeof Tag> = {
  ingredients: ClipboardList,
  details: BookOpenText,
  production: Factory,
  label: Tag,
  more: MoreHorizontal,
};

export type EditorTabsState = {
  tab: EditorTabId;
  setTab: (t: EditorTabId) => void;
  /** react-hook-form's onInvalid: go to the first tab with an error, then to the error. */
  onInvalid: (errors: FieldErrors) => void;
};

/** The open tab, and the jump to the first error on a refused save. */
export function useEditorTabs(fieldTabs: FieldTabs): EditorTabsState {
  const [tab, setTab] = useState<EditorTabId>(DEFAULT_EDITOR_TAB);
  const onInvalid = useCallback((errors: FieldErrors) => {
    const t = firstErrorTab(errors as Record<string, unknown>, fieldTabs);
    if (t) setTab(t);
    scrollToFirstError();
  }, [fieldTabs]);
  return { tab, setTab, onInvalid };
}

export type EditorTabContent = {
  /** Form fields — drawn inside the form. */
  fields?: ReactNode;
  /** Panels that save themselves — drawn after the fields, outside the form. */
  panels?: ReactNode;
  /** A few words under the tab's name on a wide screen (what's in it). */
  hint?: string;
};

export function RecipeEditorShell({
  tabs, content, errors, fieldTabs, warnings, onSubmit, save,
}: {
  tabs: EditorTabsState;
  content: Partial<Record<EditorTabId, EditorTabContent>>;
  /** formState.errors — the count on each tab. */
  errors: FieldErrors;
  fieldTabs: FieldTabs;
  /** Amber dot on a tab (something worth a look, not blocking the save). */
  warnings?: Partial<Record<EditorTabId, boolean>>;
  /** The form's save (Enter in a field). */
  onSubmit: (e?: React.BaseSyntheticEvent) => void;
  save: Parameters<typeof EditorSaveBar>[0];
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const shown = visibleTabs(Object.fromEntries(
    Object.entries(content).map(([id, c]) => [id, c != null && (c.fields != null || c.panels != null)]),
  ) as Partial<Record<EditorTabId, boolean>>);
  const active = shown.includes(tabs.tab) ? tabs.tab : DEFAULT_EDITOR_TAB;
  const errorCounts = errorCountsByTab(errors as Record<string, unknown>, fieldTabs);

  // On a phone the bar scrolls sideways: keep the open tab in sight (e.g.
  // after a refused save jumped to the tab with the error).
  useEffect(() => {
    const el = rootRef.current?.querySelector<HTMLElement>(`#editor-tab-${active}`);
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [active]);

  function choose(t: EditorTabId) {
    tabs.setTab(t);
    // Start the new tab at its top (the bar is sticky, so it stays put).
    const body = rootRef.current?.closest('[data-testid="editor-body"]');
    if (body) body.scrollTop = 0;
  }

  // A submit from a form drawn in a pop-up on top (a sub-recipe opened from
  // a row) bubbles here through React's tree — it isn't this editor's save.
  function submitOwn(e: FormEvent<HTMLFormElement>) {
    if (e.target !== e.currentTarget) return;
    onSubmit(e);
  }

  return (
    <div ref={rootRef} data-testid="recipe-editor-shell">
      <div
        role="tablist"
        aria-label="Editor sections"
        className="sticky top-0 z-30 -mx-5 sm:-mx-6 px-5 sm:px-6 pt-3 pb-3 bg-card border-b border-border flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {shown.map(id => {
          const def = EDITOR_TABS.find(t => t.id === id)!;
          const Icon = TAB_ICONS[id];
          const isActive = id === active;
          const nErr = errorCounts[id] ?? 0;
          const warn = !nErr && warnings?.[id];
          const hint = content[id]?.hint;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`editor-tab-${id}`}
              aria-selected={isActive}
              aria-controls={`editor-panel-${id}`}
              onClick={() => choose(id)}
              title={hint}
              data-testid={`editor-tab-${id}`}
              className={cn(
                "relative shrink-0 md:flex-1 min-h-12 px-4 py-2 rounded-xl text-base font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap",
                isActive ? "bg-primary text-primary-foreground shadow-sm" : "bg-secondary/40 text-foreground hover:bg-secondary/70",
              )}
            >
              <Icon className="w-5 h-5 shrink-0" />
              <span className="flex flex-col items-start leading-tight">
                <span>{def.label}</span>
                {hint && <span className={cn("hidden xl:block text-[11px] font-normal", isActive ? "text-primary-foreground/85" : "text-muted-foreground")}>{hint}</span>}
              </span>
              {nErr > 0 && (
                <span
                  className="min-w-6 h-6 px-1.5 rounded-full bg-destructive text-white text-xs font-bold flex items-center justify-center"
                  aria-label={`${nErr} problem${nErr !== 1 ? "s" : ""} to fix`}
                >
                  {nErr}
                </span>
              )}
              {warn && <span className="w-2.5 h-2.5 rounded-full bg-amber-500" aria-label="Worth a look" />}
            </button>
          );
        })}
      </div>

      {shown.map(id => {
        const c = content[id];
        return (
          <div
            key={id}
            role="tabpanel"
            id={`editor-panel-${id}`}
            aria-labelledby={`editor-tab-${id}`}
            hidden={id !== active}
            // The panels draw their own top rule and gap — not needed when one opens the tab.
            className="pt-5 space-y-5 [&>*:first-child]:mt-0 [&>*:first-child]:border-t-0 [&>*:first-child]:pt-0"
            data-testid={`editor-panel-${id}`}
          >
            {c?.fields != null && (
              <form onSubmit={submitOwn} className="space-y-5">
                {c.fields}
              </form>
            )}
            {c?.panels}
          </div>
        );
      })}

      <EditorSaveBar {...save} />
    </div>
  );
}

/** A titled card grouping fields inside a tab — the same look in both editors. */
export function EditorSection({ title, icon, description, children, className }: {
  title: ReactNode;
  icon?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-2xl border border-border bg-secondary/10 p-4 sm:p-5 space-y-4", className)}>
      <div>
        <h3 className="text-base font-bold flex items-center gap-2">{icon}{title}</h3>
        {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** Live read-out tiles above the lines table (weights, yield). */
export function EditorTotals({ tiles, footnote }: {
  tiles: Array<{ label: string; value: ReactNode; sub?: ReactNode; highlight?: boolean }>;
  footnote?: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        {tiles.map(t => (
          <div
            key={t.label}
            className={cn(
              "rounded-xl p-3 border",
              t.highlight
                ? "bg-emerald-100/70 dark:bg-emerald-900/30 border-emerald-300/70 dark:border-emerald-700/60"
                : "bg-card border-border",
            )}
          >
            <p className={cn("text-[11px] uppercase tracking-wide font-semibold", t.highlight ? "text-emerald-800 dark:text-emerald-300" : "text-muted-foreground")}>{t.label}</p>
            <p className={cn("text-xl font-bold tabular-nums mt-0.5", t.highlight && "text-emerald-900 dark:text-emerald-100")}>{t.value}</p>
            {t.sub && <p className={cn("text-xs", t.highlight ? "text-emerald-800/70 dark:text-emerald-300/70" : "text-muted-foreground")}>{t.sub}</p>}
          </div>
        ))}
      </div>
      {footnote && <p className="text-xs text-muted-foreground">{footnote}</p>}
    </div>
  );
}

/** The text box / select look in both editors — finger-sized for the iPad. */
export const EDITOR_INPUT =
  "w-full min-h-11 px-3 py-2 bg-background border border-border rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-primary/30";

/** A labelled field: label, the input, a hint line, its error. */
export function EditorField({ label, hint, error, children, className }: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <label className="text-sm font-semibold mb-1 block">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
      {error}
    </div>
  );
}

/** A yes/no setting: a big tick box with its name and what it does. */
export function EditorTick({ id, register, label, hint }: {
  id: string;
  register: UseFormRegisterReturn;
  label: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label htmlFor={id} className="flex items-start gap-3 min-h-12 rounded-xl border border-border bg-card px-3 py-2.5 cursor-pointer hover:bg-secondary/30 transition-colors">
      <input type="checkbox" id={id} {...register} className="mt-0.5 w-6 h-6 shrink-0 rounded border-border accent-primary cursor-pointer" />
      <span className="flex-1 min-w-0">
        <span className="text-base font-semibold block">{label}</span>
        {hint && <span className="text-sm text-muted-foreground block mt-0.5">{hint}</span>}
      </span>
    </label>
  );
}

/** "Available once it's saved" — a tab whose parts need a saved record. */
export function AfterFirstSaveNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-2xl border-2 border-dashed border-border px-4 py-6 text-center text-base text-muted-foreground">
      {children}
    </p>
  );
}

export function NotesField({ register }: { register: UseFormRegisterReturn }) {
  return (
    <div>
      <label className="text-sm font-medium mb-1 block">Notes (optional)</label>
      <textarea
        {...register}
        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[80px] resize-y"
        placeholder="Allergens, method notes, anything the team should know…"
      />
    </div>
  );
}
