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
}

export function IngredientCombobox({ value, onChange, options, placeholder, className, onCreateNew, emptyText }: Props) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find(o => o.id === Number(value));
  const filtered = options.filter(o => o.name.toLowerCase().includes(search.toLowerCase()));

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
          className="w-full px-2 py-1.5 bg-background border border-primary rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
          placeholder="Type to search…"
        />
      ) : (
        <button
          type="button"
          onClick={() => { setOpen(true); setSearch(""); }}
          className="w-full px-2 py-1.5 bg-background border border-border rounded-lg text-xs text-left focus:outline-none focus:ring-2 focus:ring-primary/30 truncate"
        >
          {selected
            ? <span>{selected.name} <span className="text-muted-foreground">({selected.unit})</span></span>
            : <span className="text-muted-foreground">{placeholder ?? "Select…"}</span>
          }
        </button>
      )}

      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-popover border border-border rounded-lg shadow-lg max-h-56 overflow-hidden flex flex-col">
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0
              ? <p className="text-xs text-muted-foreground p-2 text-center italic">{emptyText ?? "No ingredients found"}</p>
              : filtered.map(o => (
                <button
                  key={o.id}
                  type="button"
                  onMouseDown={e => { e.preventDefault(); onChange(o.id); setOpen(false); setSearch(""); }}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors ${Number(value) === o.id ? "bg-accent font-medium" : ""}`}
                >
                  {o.name} <span className="text-muted-foreground">({o.unit})</span>
                </button>
              ))
            }
          </div>
          {onCreateNew && (
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); setOpen(false); setSearch(""); onCreateNew(); }}
              className="w-full text-left px-3 py-1.5 text-xs font-medium text-primary border-t border-border hover:bg-primary/10 transition-colors"
            >
              + Add new ingredient to database
            </button>
          )}
        </div>
      )}
    </div>
  );
}
