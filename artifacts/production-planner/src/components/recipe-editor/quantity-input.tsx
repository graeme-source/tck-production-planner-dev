import type { UseFormRegisterReturn } from "react-hook-form";
import { cn } from "@/lib/utils";

/** One quantity box for an editor row. Lines measured in kg are typed in
 *  grams by default with a g / kg switch (the stored value stays in kg);
 *  any other unit is typed as-is with the unit shown inside the box. */
export function QuantityInput({
  unit, storedValue, display, onDisplayChange, onKgChange, register,
}: {
  unit: string;
  storedValue: unknown;
  display: "g" | "kg";
  onDisplayChange: (d: "g" | "kg") => void;
  /** kg lines: the new value in kg. */
  onKgChange: (kg: number) => void;
  /** Non-kg lines: the field's register() props. */
  register: UseFormRegisterReturn;
}) {
  if (unit !== "kg") {
    return (
      <div className="relative">
        <input
          type="number"
          step="any"
          min="0"
          {...register}
          className={cn("w-full px-2.5 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30", unit && "pr-9")}
          placeholder="Qty"
        />
        {unit && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">{unit}</span>
        )}
      </div>
    );
  }
  const storedKg = Number(storedValue) || 0;
  return (
    <div className="flex items-stretch">
      <input
        type="number"
        step="any"
        min="0"
        value={storedKg === 0 ? "" : display === "g" ? Math.round(storedKg * 1_000_000) / 1000 : storedKg}
        onChange={e => {
          const v = e.target.value === "" ? 0 : Number(e.target.value);
          onKgChange(display === "g" ? v / 1000 : v);
        }}
        className="min-w-0 flex-1 w-0 px-2.5 py-2 bg-background border border-border rounded-l-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        placeholder={display === "g" ? "e.g. 250" : "0.000"}
      />
      <div className="flex flex-col shrink-0 text-[10px] font-semibold overflow-hidden border border-l-0 border-border rounded-r-lg">
        {(["g", "kg"] as const).map((u, i) => (
          <button
            key={u}
            type="button"
            onClick={() => onDisplayChange(u)}
            className={cn("px-1.5 flex-1 transition-colors", i > 0 && "border-t border-border", display === u ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary/60")}
          >
            {u}
          </button>
        ))}
      </div>
    </div>
  );
}
