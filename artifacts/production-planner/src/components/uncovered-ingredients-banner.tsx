/**
 * Orders page warning: ingredients this plan needs that nothing would ever
 * order (Graeme, 23 Nov 2026 — 10.5 kg of chestnut mushrooms for 17 batches
 * never showed, because the stock check was off and there was no kanban).
 * Each is named with how much the plan needs. A manager can switch its stock
 * check on, which puts it on the order below, or say it's never ordered
 * (tap water), which stops it being named; those can be put back.
 * Rules: api-server lib/uncovered-ingredients-rules.ts.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, ClipboardCheck, Loader2, Undo2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface UncoveredIngredient {
  ingredientId: number;
  name: string;
  reason: "no_kanban_no_stock_check" | "no_supplier";
  requiredLabel: string;
  supplierName: string | null;
}

type Action = { ingredient: UncoveredIngredient; path: "stock-check" | "not-ordered"; method: "POST" | "DELETE" };

async function send({ ingredient, path, method }: Action): Promise<void> {
  const res = await fetch(`${BASE}/api/uncovered-ingredients/${ingredient.ingredientId}/${path}`, {
    method, credentials: "include", headers: { "Content-Type": "application/json" }, body: method === "POST" ? "{}" : undefined,
  });
  if (!res.ok) {
    const failed = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(failed.error ?? `HTTP ${res.status}`);
  }
}

const DONE: Record<string, (name: string) => { title: string; description: string }> = {
  "POST stock-check": name => ({ title: `Stock check is on for ${name}`, description: "It's on the order below now. Count it so the amount is right." }),
  "POST not-ordered": name => ({ title: `${name} won't be flagged again`, description: "You can put it back from the line under the warning." }),
  "DELETE not-ordered": name => ({ title: `${name} is back on the warning`, description: "" }),
};

export function UncoveredIngredientsBanner({ uncovered, notOrdered, canManage, onChanged }: {
  uncovered: UncoveredIngredient[];
  notOrdered: UncoveredIngredient[];
  /** Managers and admins can act on it; everyone else is asked to tell one. */
  canManage: boolean;
  /** Reload the order calculation after a change. */
  onChanged: () => unknown;
}) {
  const [showNotOrdered, setShowNotOrdered] = useState(false);
  const action = useMutation({
    mutationFn: send,
    onSuccess: (_r, a) => { toast(DONE[`${a.method} ${a.path}`](a.ingredient.name)); return onChanged(); },
    onError: (e: Error) => toast({ title: "Not done", description: e.message, variant: "destructive" }),
  });
  const running = (i: UncoveredIngredient, path: Action["path"]) =>
    action.isPending && action.variables?.ingredient.ingredientId === i.ingredientId && action.variables.path === path;

  if (uncovered.length === 0 && notOrdered.length === 0) return null;
  const count = uncovered.length;

  return (
    <div className="space-y-2">
      {count > 0 && (
        <div role="alert" className="rounded-2xl border-2 border-red-500 bg-red-50 dark:bg-red-950/30 p-4 space-y-3">
          <div>
            <p className="flex items-center gap-2 text-lg font-display font-bold text-red-800 dark:text-red-200">
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
              {count === 1 ? "This plan needs 1 ingredient that isn't on any order" : `This plan needs ${count} ingredients that aren't on any order`}
            </p>
            <p className="text-sm text-muted-foreground">
              Nothing below will order these. Check you have enough, and order by hand if you don't.
              {!canManage && " Tell a manager so they can fix it."}
            </p>
          </div>
          <ul className="space-y-2">
            {uncovered.map(i => (
              <li key={i.ingredientId} className="rounded-xl border border-border bg-card p-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1 basis-64">
                  <p className="text-base">
                    <b>{i.name}</b> · this plan needs <b>{i.requiredLabel}</b>
                    {i.supplierName ? <span className="text-muted-foreground"> · {i.supplierName}</span> : null}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {i.reason === "no_kanban_no_stock_check"
                      ? "There's no kanban for it and its stock check is off, so it never comes up to be ordered."
                      : "It has no supplier set, so it can't go on an order. Set one on the ingredient."}
                  </p>
                </div>
                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    {i.reason === "no_kanban_no_stock_check" && (
                      <button type="button" disabled={action.isPending}
                        onClick={() => action.mutate({ ingredient: i, path: "stock-check", method: "POST" })}
                        className="h-11 px-4 rounded-xl bg-primary text-primary-foreground font-bold flex items-center gap-2 disabled:opacity-50">
                        {running(i, "stock-check") ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardCheck className="w-4 h-4" />} Turn on stock check
                      </button>
                    )}
                    <button type="button" disabled={action.isPending}
                      onClick={() => action.mutate({ ingredient: i, path: "not-ordered", method: "POST" })}
                      className="h-11 px-4 rounded-xl border-2 border-border bg-card font-bold flex items-center gap-2 disabled:opacity-50">
                      {running(i, "not-ordered") && <Loader2 className="w-4 h-4 animate-spin" />} We don't order this
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {notOrdered.length > 0 && (
        <div className="rounded-xl bg-secondary/60 px-4 py-2 text-sm text-muted-foreground">
          <button type="button" className="underline" onClick={() => setShowNotOrdered(v => !v)}>
            {notOrdered.length === 1 ? "1 ingredient on this plan is marked as never ordered" : `${notOrdered.length} ingredients on this plan are marked as never ordered`}
          </button>
          {showNotOrdered && (
            <ul className="mt-2 space-y-1">
              {notOrdered.map(i => (
                <li key={i.ingredientId} className="flex flex-wrap items-center gap-2">
                  <span><b className="text-foreground">{i.name}</b> · this plan needs {i.requiredLabel}</span>
                  {canManage && (
                    <button type="button" disabled={action.isPending}
                      onClick={() => action.mutate({ ingredient: i, path: "not-ordered", method: "DELETE" })}
                      className="h-9 px-3 rounded-lg border border-border bg-card font-medium text-foreground flex items-center gap-1 disabled:opacity-50">
                      <Undo2 className="w-3.5 h-3.5" /> Put back
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
