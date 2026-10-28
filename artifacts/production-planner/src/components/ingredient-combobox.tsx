/**
 * Type-to-search ingredient picker. Replaces a plain <select> with a
 * filterable list — used on both the Recipes and Sub-Recipes edit
 * dialogs so the operator doesn't have to scroll past 200 ingredients
 * to find the one they want. Filter is a case-insensitive substring
 * match on the ingredient name.
 *
 * Also the sub-recipe picker on both dialogs (Graeme, 2026-09-29: "search
 * as a string like I can with ingredients") — pass `emptyText`.
 * Enter picks the top match; Escape closes.
 *
 * Option shape is intentionally minimal so any caller with at least
 * {id, name, unit} can pass its own list straight in.
 */
import { useState, useRef, useEffect } from "react";

export interface IngredientComboboxOption {
  id: number;
  name: string;
  unit: string;
  /** Extra line to tell look-alikes apart, e.g. "Brakes · #319" when two
   *  ingredients share a name (lib/ingredient-duplicates sharedNameDetail). */
  detail?: string | null;
}

interface Props {
  value: number;
  onChange: (id: number) => void;
  options: IngredientComboboxOption[];
  placeholder?: string;
  className?: string;
  /** Optional pinned footer action — typically "Add new ingredient to database". */
  onCreateNew?: () => void;
  /** Shown when nothing matches. Defaults to "No ingredients found". */
  emptyText?: string;
  /** "lg": the recipe editors' lines table — big bold name, finger-sized
   *  list rows (Graeme, 28 Oct 2026: name and quantity "bigger and bolder"). */
  size?: "sm" | "lg";
  /** Open the search straight away (a row just added with an Add button). */
  autoOpen?: boolean;
}

export function IngredientCombobox({ value, onChange, options, placeholder, className, onCreateNew, emptyText, size = "sm", autoOpen = false }: Props) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(autoOpen);
  const lg = size === "lg";
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find(o => o.id === Number(value));
  // "#320" finds ingredient 320 — the id shown on editor rows.
  const q = search.toLowerCase();
  const idQ = q.trim();
  const filtered = options.filter(o => o.name.toLowerCase().includes(q) || (idQ.startsWith("#") && `#${o.id}` === idQ));

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  // Escape closes the LIST, never the dialog around it. The dialog listens for
  // Escape on the document in the capture phase — before this input ever sees
  // the key — so catch it earlier still, on window, while the list is open.
  // Without this, Escape here threw away the whole unsaved recipe edit.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      setOpen(false);
      setSearch("");
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [open]);

  return (
    <div ref={ref} className={`relative flex-1 min-w-0 ${className ?? ""}`}>
      {open ? (
        <input
          ref={inputRef}
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") {
              e.preventDefault(); // never submit the surrounding form
              if (filtered[0]) { onChange(filtered[0].id); setOpen(false); setSearch(""); }
            }
          }}
          className={lg
            ? "w-full min-h-12 px-3 py-2 bg-background border-2 border-primary rounded-xl text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-primary/30"
            : "w-full px-2 py-1.5 bg-background border border-primary rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"}
          placeholder="Type to search…"
        />
      ) : (
        <button
          type="button"
          onClick={() => { setOpen(true); setSearch(""); }}
          className={lg
            ? "w-full min-h-12 px-3 py-2 bg-transparent border-2 border-transparent hover:border-border rounded-xl text-left focus:outline-none focus:ring-2 focus:ring-primary/30 whitespace-normal break-words transition-colors"
            : "w-full px-2 py-1.5 bg-background border border-border rounded-lg text-xs text-left focus:outline-none focus:ring-2 focus:ring-primary/30 whitespace-normal break-words"}
        >
          {selected
            ? lg
              ? <span className="block"><span className="text-lg sm:text-xl font-semibold leading-snug text-foreground">{selected.name}</span> <span className="text-sm font-normal text-muted-foreground">({selected.unit})</span>{selected.detail && <span className="block text-xs text-amber-700 dark:text-amber-300">{selected.detail}</span>}</span>
              : <span>{selected.name} <span className="text-muted-foreground">({selected.unit})</span>{selected.detail && <span className="text-muted-foreground"> · {selected.detail}</span>}</span>
            : <span className={lg ? "text-lg text-muted-foreground" : "text-muted-foreground"}>{placeholder ?? "Select…"}</span>
          }
        </button>
      )}

      {open && (
        <div className={`absolute z-50 top-full left-0 right-0 mt-0.5 bg-popover border border-border rounded-lg shadow-lg overflow-hidden flex flex-col ${lg ? "max-h-72" : "max-h-56"}`}>
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0
              ? <p className={`${lg ? "text-sm p-3" : "text-xs p-2"} text-muted-foreground text-center italic`}>{emptyText ?? "No ingredients found"}</p>
              : filtered.map(o => (
                <button
                  key={o.id}
                  type="button"
                  onMouseDown={e => { e.preventDefault(); onChange(o.id); setOpen(false); setSearch(""); }}
                  className={`w-full text-left px-3 hover:bg-accent transition-colors ${lg ? "py-2.5 text-base min-h-11" : "py-1.5 text-xs"} ${Number(value) === o.id ? "bg-accent font-medium" : ""}`}
                >
                  {o.name} <span className="text-muted-foreground">({o.unit})</span>
                  {o.detail && <span className="block text-[10px] text-amber-700 dark:text-amber-300">{o.detail}</span>}
                </button>
              ))
            }
          </div>
          {onCreateNew && (
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); setOpen(false); setSearch(""); onCreateNew(); }}
              className={`w-full text-left px-3 font-medium text-primary border-t border-border hover:bg-primary/10 transition-colors ${lg ? "py-3 text-sm" : "py-1.5 text-xs"}`}
            >
              + Add new ingredient to database
            </button>
          )}
        </div>
      )}
    </div>
  );
}
