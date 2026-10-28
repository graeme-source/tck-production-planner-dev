import type { UseFormRegisterReturn } from "react-hook-form";
import { cn } from "@/lib/utils";

/** One quantity box for an editor row. Lines measured in kg are typed in
 *  grams by default with a g / kg switch (the stored value stays in kg);
 *  any other unit is typed as-is with the unit shown inside the box.
 *  "lg" is the lines table of the recipe editors: a big bold number and
 *  finger-sized g / kg buttons side by side (Graeme, 28 Oct 2026: "the
 *  quantity value and the name values should just be bigger and bolder"). */
export function QuantityInput({
  unit, storedValue, display, onDisplayChange, onKgChange, register, size = "sm", invalid,
}: {
  unit: string;
  storedValue: unknown;
  display: "g" | "kg";
  onDisplayChange: (d: "g" | "kg") => void;
  /** kg lines: the new value in kg. */
  onKgChange: (kg: number) => void;
  /** Non-kg lines: the field's register() props. */
  register: UseFormRegisterReturn;
  size?: "sm" | "lg";
  /** The row's quantity failed validation. */
  invalid?: boolean;
}) {
  const lg = size === "lg";
  const box = lg
    ? "h-12 px-3 text-xl font-bold tabular-nums border-2"
    : "py-2 px-2.5 text-sm border";
  if (unit !== "kg") {
    return (
      <div className="relative">
        <input
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          {...register}
          aria-invalid={invalid || undefined}
          className={cn("w-full bg-background border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30", box, unit && (lg ? "pr-12" : "pr-9"), invalid && "border-destructive")}
          placeholder="Qty"
        />
        {unit && (
          <span className={cn("absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none", lg ? "text-sm font-semibold" : "text-xs")}>{unit}</span>
        )}
      </div>
    );
  }
  const storedKg = Number(storedValue) || 0;
  return (
    <div className="flex items-stretch">
      <input
        type="number"
        inputMode="decimal"
        step="any"
        min="0"
        value={storedKg === 0 ? "" : display === "g" ? Math.round(storedKg * 1_000_000) / 1000 : storedKg}
        onChange={e => {
          const v = e.target.value === "" ? 0 : Number(e.target.value);
          onKgChange(display === "g" ? v / 1000 : v);
        }}
        aria-invalid={invalid || undefined}
        className={cn("min-w-0 flex-1 w-0 bg-background border-border rounded-l-lg focus:outline-none focus:ring-2 focus:ring-primary/30", box, invalid && "border-destructive")}
        placeholder={display === "g" ? "e.g. 250" : "0.000"}
      />
      <div className={cn(
        "flex shrink-0 font-semibold overflow-hidden border-border rounded-r-lg",
        lg ? "flex-row text-sm border-2 border-l-0" : "flex-col text-[10px] border border-l-0",
      )}>
        {(["g", "kg"] as const).map((u, i) => (
          <button
            key={u}
            type="button"
            onClick={() => onDisplayChange(u)}
            aria-pressed={display === u}
            className={cn(
              "transition-colors",
              lg ? "w-10 h-full" : "px-1.5 flex-1",
              i > 0 && (lg ? "border-l border-border" : "border-t border-border"),
              display === u ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary/60",
            )}
          >
            {u}
          </button>
        ))}
      </div>
    </div>
  );
}
