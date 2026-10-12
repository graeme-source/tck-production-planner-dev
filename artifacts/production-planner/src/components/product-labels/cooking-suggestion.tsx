/**
 * The weight-tier suggestion for one recipe's customer cooking times
 * (lib/product-labels cooking-tiers.ts): the tier, why, the times with
 * their halves either side of TURN OVER, and whether it's printing. Shown in
 * both modes; in Manual it offers to copy the suggestion in.
 */
import { Link } from "wouter";
import { Scale, Copy } from "lucide-react";
import type { HalvedRange } from "@workspace/product-labels";
import { cn } from "@/lib/utils";
import type { CookingTimesInfo } from "./api";

const range = (a: number | null, b: number | null) => (a == null || b == null ? "—" : a === b ? `${a}` : `${a}–${b}`);
const half = (h: HalvedRange | null) => (h ? `${h.first} min ➜ TURN OVER ➜ ${range(h.second[0], h.second[1])} min` : "—");

export function CookingSuggestion({ info, mode, canEdit, onCopy }: {
  info: CookingTimesInfo;
  mode: "suggested" | "manual";
  canEdit: boolean;
  onCopy: () => void;
}) {
  const s = info.suggestion;
  if (!s) {
    return (
      <p className="text-sm text-muted-foreground">
        No suggestion by weight — this recipe has no dough or no filling, so it isn't sorted into a calzone tier. The {mode === "manual" ? "values below" : "standard times"} print.
      </p>
    );
  }
  const p = info.profile;
  const c = s.cooking;
  const printing = mode === "suggested" && info.tiersOn;
  return (
    <div className={cn("rounded-2xl border-2 p-4 space-y-3", printing ? "border-primary bg-primary/5" : "border-border bg-secondary/40")}>
      <div className="flex flex-wrap items-center gap-2">
        <Scale className="w-5 h-5 text-primary" />
        <span className="text-base font-bold">Suggested by weight: {s.tierName}</span>
        <span className={cn("rounded-full px-3 py-1 text-xs font-bold", printing ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground")}>
          {printing ? "On the label" : mode === "manual" ? "Not used — Manual" : "Not printing yet"}
        </span>
      </div>
      <p className="text-sm">{s.reason}</p>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div><dt className="text-muted-foreground">Per calzone</dt><dd className="text-lg font-bold tabular-nums">{p.totalG} g</dd></div>
        <div><dt className="text-muted-foreground">Dough / filling</dt><dd className="text-lg font-bold tabular-nums">{p.doughG} / {p.fillingG} g</dd></div>
        <div><dt className="text-muted-foreground">Meat</dt><dd className="text-lg font-bold tabular-nums">{p.meatG} g</dd></div>
        <div><dt className="text-muted-foreground">Veg / cheese</dt><dd className="text-lg font-bold tabular-nums">{p.vegG} / {p.cheeseG} g</dd></div>
      </dl>
      <div className="grid sm:grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-card border border-border p-3">
          <p className="font-bold">Oven {c.ovenTempC ?? "—"}°C ({c.fanTempC ?? "—"}°C fan): {range(c.ovenMinMinutes, c.ovenMaxMinutes)} min</p>
          <p className="text-muted-foreground">{half(s.halves.oven)}</p>
        </div>
        <div className="rounded-xl bg-card border border-border p-3">
          <p className="font-bold">Air fryer {c.airFryerTempC ?? "—"}°C: {range(c.airFryerMinMinutes, c.airFryerMaxMinutes)} min</p>
          <p className="text-muted-foreground">{half(s.halves.airFryer)}</p>
        </div>
      </div>
      {mode === "suggested" && !info.tiersOn && (
        <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
          “Suggest cooking times by weight” is off in <Link href="/labels/settings" className="underline">Label design &amp; type</Link>, so the standard times print until a manager switches it on.
        </p>
      )}
      {canEdit && (
        <button type="button" onClick={onCopy}
          className="inline-flex h-11 items-center gap-2 rounded-full border-2 border-primary px-4 text-sm font-bold text-primary">
          <Copy className="w-4 h-4" /> {mode === "manual" ? "Copy the suggestion into the boxes" : "Copy into Manual to adjust"}
        </button>
      )}
    </div>
  );
}
