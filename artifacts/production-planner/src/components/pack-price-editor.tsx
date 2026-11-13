import { useEffect, useRef, useState } from "react";
import { Check, Loader2, LockOpen } from "lucide-react";
import { cn } from "@/lib/utils";

// Change a pack price from the Orders screen (Graeme, 13 Nov 2026): a small
// unlock icon beside the price opens it for editing, and it saves on Enter or
// when the box loses focus — no leaving the order being built. Escape puts it
// back. Saves the price for the supplier whose card the line is on.

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type SaveState = "idle" | "saving" | "saved" | "error";

export function PackPriceEditor({
  ingredientId, supplierId, costPerPack, perLabel, onSaved,
}: {
  ingredientId: number;
  supplierId: number;
  costPerPack: number;
  /** What the price is for: "pack", "box of 36", "kg" … */
  perLabel: string;
  onSaved: (price: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) input.current?.select(); }, [open]);
  useEffect(() => {
    if (state !== "saved") return;
    const t = setTimeout(() => setState("idle"), 2500);
    return () => clearTimeout(t);
  }, [state]);

  const start = () => { setText(costPerPack > 0 ? costPerPack.toFixed(2) : ""); setError(null); setOpen(true); };

  const save = async () => {
    const price = Number(text.replace(/[£,\s]/g, ""));
    if (!Number.isFinite(price) || price < 0) { setError("Type a price, e.g. 6.84"); setState("error"); return; }
    if (Math.abs(price - costPerPack) < 0.00005) { setOpen(false); return; }
    setState("saving");
    try {
      const r = await fetch(`${BASE}/api/ingredients/${ingredientId}/pack-price`, {
        method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierId, costPerPack: price }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      onSaved(price);
      setOpen(false);
      setState("saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
      setState("error");
    }
  };

  if (!open) {
    return (
      <span className="inline-flex items-center gap-1 justify-end">
        {state === "saved" && <span className="text-xs text-emerald-700 inline-flex items-center gap-0.5"><Check className="h-3 w-3" /> Saved</span>}
        <button
          type="button"
          onClick={start}
          className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60"
          aria-label={`Change the price per ${perLabel}`}
          title={`Change the price per ${perLabel}`}
        >
          <LockOpen className="h-4 w-4" />
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="inline-flex items-center gap-1">
        <span className="text-sm">£</span>
        <input
          ref={input}
          inputMode="decimal"
          value={text}
          disabled={state === "saving"}
          onChange={(e) => { setText(e.target.value); if (state === "error") setState("idle"); }}
          onBlur={() => { void save(); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); void save(); }
            if (e.key === "Escape") { setOpen(false); setState("idle"); }
          }}
          className={cn("h-9 w-24 rounded-md border bg-background px-2 text-right tabular-nums text-sm", state === "error" && "border-destructive")}
          aria-label={`Price per ${perLabel}`}
        />
        {state === "saving" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </span>
      <span className="text-xs text-muted-foreground">per {perLabel}</span>
      {error && <span className="text-xs text-destructive max-w-[14rem] text-right">{error}</span>}
    </span>
  );
}
