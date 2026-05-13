/**
 * Type-to-search ingredient picker. Replaces a plain <select> with a
 * filterable list — used on both the Recipes and Sub-Recipes edit
 * dialogs so the operator doesn't have to scroll past 200 ingredients
 * to find the one they want. Filter is a case-insensitive substring
 * match on the ingredient name.
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
}

export function IngredientCombobox({ value, onChange, options, placeholder, className }: Props) {
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

  return (
    <div ref={ref} className={`relative flex-1 min-w-0 ${className ?? ""}`}>
      {open ? (
        <input
          ref={inputRef}
          value={search}
          onChange={e => setSearch(e.target.value)}
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
        <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-popover border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {filtered.length === 0
            ? <p className="text-xs text-muted-foreground p-2 text-center italic">No ingredients found</p>
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
      )}
    </div>
  );
}
