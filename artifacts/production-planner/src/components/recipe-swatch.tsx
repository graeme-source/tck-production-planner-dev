/**
 * Recipe identity colours on screen (Objectives A and F). Every place that
 * shows a recipe's colour goes through here so the optional secondary colour
 * (migration 0185) is drawn the same way everywhere:
 *
 *   <RecipeSwatch recipeId color className="w-3 h-3 rounded-full" />
 *       a dot / chip / small square — split diagonally when there is a
 *       secondary colour (shape="band" for tall bars: two stacked bands)
 *   const style = useRecipeColourStyle(recipeId, color, "text")
 *       recipe name in its colour — secondary shown as an underline
 *
 * Station and plan payloads carry only the primary colour; the secondary is
 * looked up by recipe id from GET /api/recipes/colours, fetched once and
 * cached. No secondary set → exactly the same style as before.
 */
import type { CSSProperties, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { recipeColourStyle, type RecipeColourShape } from "@/lib/recipe-colour-style";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export const RECIPE_COLOURS_QUERY_KEY = ["recipe-colours"] as const;

type RecipeColourRow = { id: number; color: string | null; secondaryColor: string | null };

async function fetchRecipeColours(): Promise<Map<number, RecipeColourRow>> {
  const res = await fetch(`${BASE}/api/recipes/colours`, { credentials: "include" });
  if (!res.ok) throw new Error(`Couldn't load recipe colours (${res.status})`);
  const rows = (await res.json()) as RecipeColourRow[];
  return new Map(rows.map(r => [r.id, r]));
}

/** id → { color, secondaryColor } for every recipe, cached for the session. */
export function useRecipeColours() {
  return useQuery({
    queryKey: RECIPE_COLOURS_QUERY_KEY,
    queryFn: fetchRecipeColours,
    staleTime: 5 * 60_000,
  });
}

/** The recipe's secondary colour, or null (none set, unknown id, still loading). */
export function useRecipeSecondaryColour(recipeId: number | null | undefined): string | null {
  const { data } = useRecipeColours();
  if (recipeId == null || !data) return null;
  return data.get(recipeId)?.secondaryColor ?? null;
}

/** For lists: one hook call at the top of a component, then
 *  `colourStyle(recipeId, color, "text")` inside a .map(). */
export function useRecipeColourLookup(): (
  recipeId: number | null | undefined,
  color: string | null | undefined,
  shape: RecipeColourShape,
) => CSSProperties {
  const { data } = useRecipeColours();
  return (recipeId, color, shape) =>
    recipeColourStyle(color, recipeId != null ? data?.get(recipeId)?.secondaryColor ?? null : null, shape) as CSSProperties;
}

/** Inline style for a recipe's colours in one shape. `color` is the primary
 *  the screen already has; pass `secondaryColor` when the screen has it too
 *  (e.g. the recipe itself), otherwise it is looked up by id. */
export function useRecipeColourStyle(
  recipeId: number | null | undefined,
  color: string | null | undefined,
  shape: RecipeColourShape,
  secondaryColor?: string | null,
): CSSProperties {
  const looked = useRecipeSecondaryColour(secondaryColor === undefined ? recipeId : null);
  return recipeColourStyle(color, secondaryColor === undefined ? looked : secondaryColor, shape) as CSSProperties;
}

export function RecipeSwatch({
  recipeId, color, secondaryColor, shape = "dot", className, style, fallback,
}: {
  recipeId?: number | null;
  color: string | null | undefined;
  /** Known secondary colour; omit to look it up by recipeId. */
  secondaryColor?: string | null;
  shape?: "dot" | "band";
  className?: string;
  style?: CSSProperties;
  /** Background when the recipe has no colour at all (e.g. "transparent"). */
  fallback?: string;
}) {
  const s = useRecipeColourStyle(recipeId, color, shape, secondaryColor);
  const merged: CSSProperties = Object.keys(s).length ? { ...style, ...s } : { ...style, backgroundColor: fallback };
  return <span className={className} style={merged} aria-hidden />;
}

/** A recipe name drawn in its colour (secondary as underline). Renders a
 *  plain span; extra props pass through. */
export function RecipeColourText({
  recipeId, color, secondaryColor, className, children, as: Tag = "span", title,
}: {
  recipeId?: number | null;
  color: string | null | undefined;
  secondaryColor?: string | null;
  className?: string;
  children: ReactNode;
  as?: "span" | "p" | "h2" | "h3" | "td";
  title?: string;
}) {
  const s = useRecipeColourStyle(recipeId, color, "text", secondaryColor);
  return <Tag className={className} style={Object.keys(s).length ? s : undefined} title={title}>{children}</Tag>;
}
