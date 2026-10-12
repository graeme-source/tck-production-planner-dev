/**
 * "On product labels" — how a sub-recipe shows in the ingredients list of
 * every product that uses it (Graeme, 2026-10-12: "when we create new
 * sub-recipes, assess where this needs to happen and where it doesn't").
 * The verdict comes from the deck builder itself
 * (GET /api/sub-recipes/:id/label-usage), so it can't disagree with the
 * printed label. Each product name links to its label page.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loader2, Tag } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface LabelUsage {
  thresholdPct: number;
  usage: Array<{ recipeId: number; recipeName: string; isDraft: boolean; percentage: number; asCompound: boolean; reason: "quid" | "share" | "under-threshold"; printedAs: string }>;
  insideSubRecipes: Array<{ id: number; name: string }>;
}

function Bolded({ text }: { text: string }) {
  return <>{text.split("**").map((seg, i) => (i % 2 === 1 ? <strong key={i}>{seg}</strong> : <span key={i}>{seg}</span>))}</>;
}

/** The rule in one sentence — shown for a new sub-recipe and above the list. */
export function SubRecipeLabelRule({ thresholdPct = 25 }: { thresholdPct?: number }) {
  return (
    <p className="text-xs text-muted-foreground">
      On a product's label a sub-recipe that is {thresholdPct}% or more of the product (or has its percentage declared) shows
      under its own name with its ingredients in brackets — “Garlic Butter (Butter (<b>MILK</b>), Garlic, …)”. Under {thresholdPct}%,
      its ingredients are listed individually in the main list instead. Both are allowed by the labelling rules; every
      ingredient is always listed.
    </p>
  );
}

export function SubRecipeLabelUsage({ subRecipeId }: { subRecipeId: number | null }) {
  const { data, isLoading, error } = useQuery<LabelUsage>({
    queryKey: ["sub-recipe-label-usage", subRecipeId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/sub-recipes/${subRecipeId}/label-usage`, { credentials: "include" });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error ?? "Couldn't work out how this shows on labels");
      return d;
    },
    enabled: subRecipeId != null,
    staleTime: 0,
  });

  return (
    <div className="mt-3 rounded-xl border border-border bg-card px-3 py-3 space-y-2">
      <p className="text-sm font-semibold flex items-center gap-1.5"><Tag className="w-4 h-4 text-primary" /> On product labels</p>
      <SubRecipeLabelRule thresholdPct={data?.thresholdPct} />
      {subRecipeId == null ? (
        <p className="text-xs text-muted-foreground">Once this is saved and used in a recipe, each product's verdict shows here.</p>
      ) : isLoading ? (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking the products that use it…</p>
      ) : error ? (
        <p className="text-xs text-destructive">{error instanceof Error ? error.message : String(error)}</p>
      ) : data && data.usage.length === 0 && data.insideSubRecipes.length === 0 ? (
        <p className="text-xs text-muted-foreground">Not used in any product yet.</p>
      ) : data ? (
        <ul className="space-y-2">
          {data.usage.map(u => (
            <li key={u.recipeId} className="text-sm rounded-lg bg-muted/40 px-3 py-2">
              <Link href={`/labels/${u.recipeId}`} className="font-semibold text-primary underline-offset-2 hover:underline">{u.recipeName}</Link>
              {u.isDraft && <span className="ml-1 text-xs text-muted-foreground">(draft)</span>}
              <span className="text-muted-foreground"> — {u.percentage}% of the product</span>
              {u.asCompound ? (
                <p className="text-xs mt-0.5">
                  Shows as{u.reason === "quid" ? " (kept under its name because its percentage is declared)" : ""}: <Bolded text={u.printedAs} />
                </p>
              ) : (
                <p className="text-xs mt-0.5">
                  Its ingredients are listed individually because it's under {data.thresholdPct}% of the product: <Bolded text={u.printedAs} />
                </p>
              )}
            </li>
          ))}
          {data.insideSubRecipes.map(p => (
            <li key={`p${p.id}`} className="text-xs text-muted-foreground">
              Also used inside <b>{p.name}</b> — there its ingredients are always merged into {p.name}'s own list.
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
