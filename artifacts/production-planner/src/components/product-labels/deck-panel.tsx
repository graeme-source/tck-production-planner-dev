/**
 * A recipe's ingredient deck: the deck text (copy / copy for Label Live),
 * push to the Shopify website, declaration problems with fix buttons,
 * allergens and the breakdown by weight. Moved unchanged from the old
 * Product Hub (12 Oct 2026) — it now sits on the Ingredient deck tab of
 * /labels/:id. Objective F.
 */
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Loader2, AlertTriangle, Copy, Check, UploadCloud } from "lucide-react";
import { DeclarationFixButtons, type DeclarationIssue } from "@/components/declaration-fix";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Only the id is used; the name rides along for callers that have it. */
export type PanelRecipe = { id: number; name: string };

export type DeckData = {
  recipeName: string;
  deckText: string;
  allergens: string[];
  // Allergen words found in an ingredient's declaration text that aren't
  // ticked on the ingredient record — the deck bolds them anyway, but the
  // recipe-level allergen list won't include them until the record is fixed.
  allergenMismatches?: { ingredientId: number; name: string; missing: string[] }[];
  mayContainStatement: string | null;
  isComplete: boolean;
  missingDeclarations: string[];
  // Compound ingredients whose declaration lists components without naming the
  // ingredient itself — e.g. "Pork, Salt" instead of "Chorizo (Pork, Salt)".
  unwrappedDeclarations?: string[];
  // Both of the above with the ingredient behind each, for the fix buttons.
  declarationIssues?: DeclarationIssue[];
  ingredients: {
    type?: "ingredient" | "compound";
    name: string;
    declaration: string;
    percentage: number;
    allergens: string[];
    isQuid?: boolean;
    subIngredients?: { name: string; declaration: string; percentage: number; allergens: string[] }[];
  }[];
};

export function DeckPanel({ recipe }: { recipe: PanelRecipe }) {
  const [data, setData] = useState<DeckData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<null | "plain" | "label">(null);
  // Shopify push: dry-run first so the founder sees exactly which website
  // products will be overwritten, then a confirm click does the real write.
  const [pushState, setPushState] = useState<
    | { phase: "idle" }
    | { phase: "checking" }
    | { phase: "confirm"; products: string[] }
    | { phase: "pushing"; products: string[] }
    | { phase: "done"; products: string[] }
    | { phase: "error"; message: string }
  >({ phase: "idle" });

  async function pushToShopify(confirm: boolean) {
    setPushState(confirm ? { phase: "pushing", products: pushState.phase === "confirm" ? pushState.products : [] } : { phase: "checking" });
    try {
      const res = await fetch(`${BASE}/api/recipes/${recipe.id}/push-ingredient-deck${confirm ? "" : "?dryRun=1"}`, {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json();
      if (!res.ok) {
        const detail = [body.error, ...(body.missingDeclarations ?? []), ...(body.unwrappedDeclarations ?? [])]
          .filter(Boolean).join(" — ");
        throw new Error(detail || `HTTP ${res.status}`);
      }
      if (body.dryRun) setPushState({ phase: "confirm", products: body.wouldPush });
      else setPushState({ phase: "done", products: body.pushed });
    } catch (e) {
      setPushState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  // Bumped after a declaration is fixed from the buttons below, so the
  // deck (and the push button's readiness) re-runs without a reload.
  const [reload, setReload] = useState(0);
  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${BASE}/api/recipes/${recipe.id}/ingredient-deck`, { credentials: "include" })
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setData(d); })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [recipe.id, reload]);

  const copyDeck = () => {
    if (!data) return;
    const plain = data.deckText.replace(/\*\*/g, "");
    navigator.clipboard.writeText(plain);
    setCopied("plain");
    setTimeout(() => setCopied(null), 2000);
  };

  // Label Live (the back-label printing software) renders <b> tags, so this
  // variant keeps the allergen emphasis: the server marks every allergen as
  // **X** in deckText, which goes onto the clipboard as <b>X</b>.
  const copyForLabelLive = () => {
    if (!data) return;
    const tagged = data.deckText.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    navigator.clipboard.writeText(tagged);
    setCopied("label");
    setTimeout(() => setCopied(null), 2000);
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (error) return <p className="text-destructive text-sm py-4">{error}</p>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="bg-secondary/20 rounded-lg p-4 border border-border">
        <p className="text-sm leading-relaxed" dangerouslySetInnerHTML={{
          __html: data.deckText
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
            .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        }} />
        <div className="mt-2 flex items-center gap-4">
          <button onClick={copyDeck} className="text-xs text-primary hover:underline flex items-center gap-1">
            {copied === "plain" ? <><Check className="w-3 h-3" /> Copied!</> : <><Copy className="w-3 h-3" /> Copy to clipboard</>}
          </button>
          <button onClick={copyForLabelLive} className="text-xs text-primary hover:underline flex items-center gap-1" title="Copies the deck with <b> tags around allergens, ready to paste into Label Live">
            {copied === "label" ? <><Check className="w-3 h-3" /> Copied!</> : <><Copy className="w-3 h-3" /> Copy for Label Live</>}
          </button>
        </div>
      </div>

      {/* ── Push to the Shopify website (custom.ingredient_deck) ─────────── */}
      <div className="bg-secondary/20 rounded-lg p-4 border border-border space-y-2">
        <p className="text-sm font-medium flex items-center gap-1.5">
          <UploadCloud className="w-4 h-4 text-primary" /> Website ingredient deck
        </p>
        <p className="text-xs text-muted-foreground">
          Publishes this deck — with the allergen statement and legal disclaimer — to the
          ingredient-deck field on every Shopify product linked to this recipe.
        </p>
        {pushState.phase === "confirm" ? (
          <div className="space-y-2">
            <p className="text-sm">
              This will overwrite the website deck on:{" "}
              <b>{pushState.products.join(", ")}</b>
            </p>
            <div className="flex gap-2">
              <button onClick={() => pushToShopify(true)}
                className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90">
                Confirm — publish to website
              </button>
              <button onClick={() => setPushState({ phase: "idle" })}
                className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-secondary/50">
                Cancel
              </button>
            </div>
          </div>
        ) : pushState.phase === "done" ? (
          <p className="text-sm text-primary flex items-center gap-1.5">
            <Check className="w-4 h-4" /> Published to {pushState.products.join(", ")}.
          </p>
        ) : (
          <div className="space-y-1.5">
            <button
              onClick={() => pushToShopify(false)}
              disabled={pushState.phase === "checking" || pushState.phase === "pushing" || !data.isComplete}
              title={!data.isComplete ? "Fix the flagged declarations below before publishing." : undefined}
              className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-secondary/50 disabled:opacity-50 flex items-center gap-1.5"
            >
              {pushState.phase === "checking" || pushState.phase === "pushing"
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <UploadCloud className="w-3.5 h-3.5" />}
              {pushState.phase === "checking" ? "Checking…" : pushState.phase === "pushing" ? "Publishing…" : "Push to Shopify…"}
            </button>
            {pushState.phase === "error" && (
              <p className="text-xs text-destructive">{pushState.message}</p>
            )}
          </div>
        )}
      </div>

      {data.allergenMismatches && data.allergenMismatches.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
          <p className="text-sm font-medium text-red-800 dark:text-red-200 flex items-center gap-1">
            <AlertTriangle className="w-4 h-4" /> Allergens in declarations but not tagged
          </p>
          <p className="text-xs text-red-700 dark:text-red-300 mt-1">
            {data.allergenMismatches.map(m => `${m.name} (${m.missing.join(", ")})`).join(" · ")}
          </p>
          <p className="text-xs text-red-700 dark:text-red-300 mt-1">
            The deck above already bolds these words, but they're missing from this recipe's
            allergen list until the ingredient records are fixed. Re-saving each ingredient's
            declaration ticks them automatically.
          </p>
        </div>
      )}

      {data.declarationIssues && data.declarationIssues.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 space-y-1">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200 flex items-center gap-1">
            <AlertTriangle className="w-4 h-4" /> Fix these before pushing to Shopify
          </p>
          <DeclarationFixButtons issues={data.declarationIssues} onFixed={() => { setPushState({ phase: "idle" }); setReload(n => n + 1); }} className="text-xs text-amber-800 dark:text-amber-200" />
        </div>
      )}

      {!data.declarationIssues && data.missingDeclarations && data.missingDeclarations.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200 flex items-center gap-1">
            <AlertTriangle className="w-4 h-4" /> Missing label declarations
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">{data.missingDeclarations.join(", ")}</p>
        </div>
      )}

      {!data.declarationIssues && data.unwrappedDeclarations && data.unwrappedDeclarations.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200 flex items-center gap-1">
            <AlertTriangle className="w-4 h-4" /> Compound ingredients not named
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
            {data.unwrappedDeclarations.join(", ")} — {data.unwrappedDeclarations.length === 1 ? "this declaration lists" : "these declarations list"}
            {" "}components without naming the ingredient they belong to, so they run together in the deck above.
            Edit to the form <span className="font-mono">Chorizo (Pork, Salt, Paprika…)</span>.
          </p>
        </div>
      )}

      {data.allergens.length > 0 && (
        <div>
          <p className="text-sm font-semibold mb-1">Allergens Present</p>
          <div className="flex flex-wrap gap-1.5">
            {data.allergens.map(a => (
              <span key={a} className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">{a}</span>
            ))}
          </div>
        </div>
      )}

      {data.mayContainStatement && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
          <p className="text-xs font-medium text-amber-800 dark:text-amber-200">{data.mayContainStatement}</p>
        </div>
      )}

      <div>
        <p className="text-sm font-semibold mb-1">Breakdown by Weight</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-1">Ingredient</th>
              <th className="text-right py-1">%</th>
              <th className="text-right py-1">Allergens</th>
            </tr>
          </thead>
          <tbody>
            {data.ingredients.flatMap((ing, idx) => {
              const rows = [
                <tr key={`ing-${idx}`} className={cn("border-b border-border/30", ing.type === "compound" && "bg-primary/5")}>
                  <td className={cn("py-1", ing.type === "compound" && "font-semibold")}>{ing.name}{ing.type === "compound" ? " (compound)" : ""}</td>
                  <td className="text-right py-1 font-medium">{ing.percentage}%</td>
                  <td className="text-right py-1 text-xs">{ing.allergens.length > 0 ? ing.allergens.join(", ") : "—"}</td>
                </tr>
              ];
              ing.subIngredients?.forEach((sub, si) => {
                rows.push(
                  <tr key={`ing-${idx}-sub-${si}`} className="border-b border-border/20">
                    <td className="py-0.5 pl-6 text-xs text-muted-foreground">{sub.name}</td>
                    <td className="text-right py-0.5 text-xs text-muted-foreground">{sub.percentage}%</td>
                    <td className="text-right py-0.5 text-xs text-muted-foreground">{sub.allergens.length > 0 ? sub.allergens.join(", ") : ""}</td>
                  </tr>
                );
              });
              return rows;
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
