/**
 * Pick a phase's offers (2026-10-20): the chosen ones as big chips with an X,
 * and a box to type in. Typing shows matching offers from the library — tap
 * one to add it — or press Enter / "Add" to add exactly what you typed (the
 * server then adds it to the library too). Pure matching:
 * offerSuggestions() in @workspace/marketing-calendar.
 */
import { useMemo, useState } from "react";
import { Plus, Tag, X } from "lucide-react";
import { cleanOfferText, dedupeOffers, offerKey, offerSuggestions } from "@workspace/marketing-calendar";
import { useOffers } from "./api";

export function OfferPicker({ value, onChange, disabled }: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [typed, setTyped] = useState("");
  const [focused, setFocused] = useState(false);
  const offersQ = useOffers();
  const library = offersQ.data?.offers ?? [];
  const suggestions = useMemo(() => offerSuggestions(library, typed, value, 8), [library, typed, value]);
  const clean = cleanOfferText(typed);
  const exact = library.find(o => offerKey(o.text) === offerKey(clean));
  const already = value.some(v => offerKey(v) === offerKey(clean));

  const add = (text: string) => {
    const next = dedupeOffers([...value, text]);
    if (next.length !== value.length) onChange(next);
    setTyped("");
  };
  const remove = (text: string) => onChange(value.filter(v => v !== text));

  return (
    <div className="space-y-2">
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {value.map(o => (
            <li key={o} className="inline-flex items-center gap-1.5 rounded-xl border-2 border-violet-500/40 bg-violet-500/10 pl-3 pr-1 py-1.5 text-base font-semibold text-violet-900 dark:text-violet-100">
              <Tag className="w-4 h-4 flex-shrink-0" />
              <span className="break-words">{o}</span>
              {!disabled && (
                <button type="button" onClick={() => remove(o)} className="p-1.5 rounded-lg hover:bg-violet-500/20" aria-label={`Remove “${o}”`}>
                  <X className="w-4 h-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No offer on this phase.</p>
      )}

      {!disabled && (
        <div className="relative">
          <div className="flex gap-2">
            <input
              value={typed}
              onChange={e => setTyped(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setTimeout(() => setFocused(false), 150)}
              onKeyDown={e => {
                if (e.key === "Enter" && clean) { e.preventDefault(); add(exact?.text ?? clean); }
              }}
              maxLength={300}
              placeholder="Type or pick an offer, e.g. Free pack on orders over £39.95"
              className="flex-1 min-w-0 px-4 py-2.5 rounded-xl border-2 border-border bg-background text-base focus:outline-none focus:border-primary"
              aria-label="Add an offer"
            />
            <button
              type="button"
              onClick={() => clean && add(exact?.text ?? clean)}
              disabled={!clean || already}
              className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold flex items-center gap-1.5 disabled:opacity-40"
            >
              <Plus className="w-4 h-4" /> Add
            </button>
          </div>
          {focused && (suggestions.length > 0 || (clean && !exact && !already)) && (
            <ul className="absolute z-10 left-0 right-0 mt-1 rounded-xl border-2 border-border bg-card shadow-xl max-h-72 overflow-y-auto">
              {suggestions.map(o => (
                <li key={o.id}>
                  <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => add(o.text)}
                    className="w-full text-left px-4 py-3 text-base hover:bg-secondary/60 flex items-start gap-2">
                    <Tag className="w-4 h-4 mt-1 flex-shrink-0 text-violet-600" />
                    <span className="min-w-0">
                      <span className="block font-semibold break-words">{o.text}</span>
                      {o.notes && <span className="block text-sm text-muted-foreground break-words">{o.notes}</span>}
                    </span>
                  </button>
                </li>
              ))}
              {clean && !exact && !already && (
                <li>
                  <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => add(clean)}
                    className="w-full text-left px-4 py-3 text-base hover:bg-secondary/60 flex items-start gap-2 border-t border-border">
                    <Plus className="w-4 h-4 mt-1 flex-shrink-0 text-primary" />
                    <span className="min-w-0 break-words">Add “<b>{clean}</b>” as a new offer</span>
                  </button>
                </li>
              )}
            </ul>
          )}
          {offersQ.isError && <p className="text-sm text-destructive mt-1">Couldn't load the offer list: {(offersQ.error as Error).message}</p>}
        </div>
      )}
    </div>
  );
}
