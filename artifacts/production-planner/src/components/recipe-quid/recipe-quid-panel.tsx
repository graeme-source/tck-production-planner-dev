/**
 * The recipe editor's QUID panel (Automatic QUID, Graeme 2026-10-10).
 * Objectives A and D.
 *
 * Every line of the SAVED recipe with its percentage tick and who decided:
 * "Auto — named in 'Chicken and Chorizo'" or "Set by you". Ticking or
 * unticking saves straight away and is a person's decision — the automatic
 * rule never changes it again ("Back to automatic" hands it back).
 * Questions about flavour words ("Should 'BBQ' show a percentage?") sit at
 * the top with Yes / No. The deck underneath is what the label prints now,
 * with the percentages worked out from the current weights.
 */
import { Link } from "wouter";
import { AlertTriangle, Check, HelpCircle, Loader2, Percent, RotateCcw, Settings2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { deckRuns, useRecipeQuid, useSetQuid, type QuidViewItem } from "./api";

export function RecipeQuidPanel({ recipeId }: { recipeId: number }) {
  const { state } = useAuth();
  const role = state.status === "authenticated" ? state.user.role : "viewer";
  const canEdit = role === "admin" || role === "manager";
  const { data, isLoading, error } = useRecipeQuid(recipeId);
  const setQuid = useSetQuid(recipeId);
  const busyKey = setQuid.isPending ? setQuid.variables?.key : null;

  const answer = (key: string, quid: boolean | null) => setQuid.mutate({ key, quid });

  return (
    <section className="mt-4 border-t border-border pt-4 space-y-3" aria-label="Percentages on the label">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Percent className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-[14rem]">
          <h4 className="text-base font-bold leading-tight">Percentages on the label (QUID)</h4>
          <p className="text-sm text-muted-foreground">
            Anything the recipe's name names shows its percentage automatically, worked out from the weights. Your ticks always win.
          </p>
        </div>
        <SaveState pending={setQuid.isPending} error={setQuid.error as Error | null} saved={setQuid.isSuccess} />
        <Link href="/labels/quid" className="inline-flex items-center gap-1.5 h-10 px-3 rounded-xl border-2 border-border text-sm font-semibold hover:bg-secondary">
          <Settings2 className="w-4 h-4" /> QUID words
        </Link>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Checking the name…</div>
      ) : error ? (
        <p className="text-sm text-destructive">Couldn't load the percentages — {(error as Error).message}</p>
      ) : data ? (
        <>
          {data.suggestions.map(s => (
            <div key={s.key} className="rounded-2xl border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 flex items-center gap-3 flex-wrap">
              <HelpCircle className="w-5 h-5 text-amber-600 shrink-0" />
              <p className="flex-1 min-w-[12rem] text-sm">
                <span className="font-bold">Should “{s.term}” show a percentage?</span>{" "}
                <span className="text-muted-foreground">It would go on {s.label}.</span>
              </p>
              {canEdit && (
                <div className="flex gap-2">
                  <button type="button" disabled={busyKey === s.key} onClick={() => answer(s.key, true)} className="h-10 px-4 rounded-xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-50">Yes</button>
                  <button type="button" disabled={busyKey === s.key} onClick={() => answer(s.key, false)} className="h-10 px-4 rounded-xl border-2 border-border font-bold text-sm disabled:opacity-50">No</button>
                </div>
              )}
            </div>
          ))}

          {data.unmatched.map(u => (
            <p key={u} className="text-sm flex items-start gap-2 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              “{u}” is in the name but no line below matches it — tick the line by hand if it's in there under another name.
            </p>
          ))}
          {data.unwrapped.map(u => (
            <p key={u} className="text-sm flex items-start gap-2 text-rose-700 dark:text-rose-400">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              {u}: its label declaration is a bare list, not “Name (…)”, so the percentage reads wrong until the ingredient's declaration is fixed.
            </p>
          ))}

          <ul className="rounded-2xl border border-border divide-y divide-border">
            {data.items.map(item => (
              <QuidRow key={item.key} item={item} recipeName={data.recipeName} canEdit={canEdit} busy={busyKey === item.key} onAnswer={answer} />
            ))}
          </ul>

          <div className="rounded-2xl bg-secondary/50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Ingredients on the label now</p>
            <p className="text-sm leading-relaxed">
              {deckRuns(data.deckText).map((r, i) => r.bold ? <strong key={i}>{r.text}</strong> : <span key={i}>{r.text}</span>)}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">This is the saved recipe — after changing the name or lines above, save and reopen to see it rechecked.</p>
        </>
      ) : null}
    </section>
  );
}

function QuidRow({ item, recipeName, canEdit, busy, onAnswer }: {
  item: QuidViewItem; recipeName: string; canEdit: boolean; busy: boolean;
  onAnswer: (key: string, quid: boolean | null) => void;
}) {
  const id = `quid-${item.key}`;
  return (
    <li className={cn("flex items-center gap-3 px-3 py-2 min-h-[3rem]", item.kind === "component" && "pl-8 bg-secondary/20")}>
      <input
        id={id}
        type="checkbox"
        checked={item.quid}
        disabled={!canEdit || busy}
        onChange={e => onAnswer(item.key, e.target.checked)}
        className="w-6 h-6 rounded border-border accent-primary cursor-pointer disabled:cursor-default shrink-0"
      />
      <label htmlFor={id} className="flex-1 min-w-0 text-sm">
        <span className={cn("font-medium", item.quid && "font-bold")}>{item.label}</span>
        {item.kind === "component" && <span className="text-muted-foreground"> (inside)</span>}
      </label>
      {busy ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /> : <SourceBadge item={item} recipeName={recipeName} />}
      {canEdit && item.source === "manual" && !busy && (
        <button type="button" onClick={() => onAnswer(item.key, null)} title="Forget my choice and let the name decide" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <RotateCcw className="w-3.5 h-3.5" /> Back to automatic
        </button>
      )}
    </li>
  );
}

function SourceBadge({ item, recipeName }: { item: QuidViewItem; recipeName: string }) {
  if (item.source === "manual") {
    return <span className="text-xs font-semibold rounded-full px-2.5 py-1 bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200 whitespace-nowrap">Set by you</span>;
  }
  if (item.source === "auto" && item.quid) {
    return (
      <span className="text-xs font-semibold rounded-full px-2.5 py-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200 text-right" title={item.match?.isCategory ? "A category — every matching line shows its own percentage" : undefined}>
        Auto — “{item.match?.term ?? "named"}” in ‘{recipeName.trim()}’
      </span>
    );
  }
  if (item.match?.level === "suggest") {
    return <span className="text-xs text-amber-700 dark:text-amber-400 whitespace-nowrap">Question above</span>;
  }
  return null;
}

function SaveState({ pending, error, saved }: { pending: boolean; error: Error | null; saved: boolean }) {
  if (pending) return <span className="inline-flex items-center gap-1 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Saving…</span>;
  if (error) return <span className="inline-flex items-center gap-1 text-sm font-semibold text-destructive"><X className="w-4 h-4" /> Not saved — {error.message}</span>;
  if (saved) return <span className="inline-flex items-center gap-1 text-sm text-emerald-700 dark:text-emerald-400"><Check className="w-4 h-4" /> Saved</span>;
  return null;
}
