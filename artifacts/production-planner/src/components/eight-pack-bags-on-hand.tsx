import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { bagShortfall } from "@/lib/eight-pack-shortfall";

// 8-pack bags in the production fridge (Graeme, 2026-10-07): wrapping adds
// them, despatch takes them out, Stock Control sets the counted number.
// Planning screens show the number beside "bags needed" so only the
// shortfall gets made — display only, it never changes a plan.

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface BagsOnHandResponse {
  bags: Array<{ recipeId: number; bags: number; checkedAt: string }>;
}

async function fetchBagsOnHand(): Promise<BagsOnHandResponse> {
  const res = await fetch(`${BASE}/api/eight-pack-stock`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load 8-pack bags in the fridge");
  return res.json();
}

/** recipeId → bags in the production fridge (missing = 0). */
export function useEightPackBagsOnHand() {
  const q = useQuery({
    queryKey: ["eight-pack-stock"],
    queryFn: fetchBagsOnHand,
    staleTime: 30_000,
  });
  const map = new Map<number, number>();
  for (const b of q.data?.bags ?? []) map.set(b.recipeId, b.bags);
  return { bagsOnHand: map, isLoading: q.isLoading, isError: q.isError };
}

/**
 * "N in fridge" under a bag count. With `needed`, also "make M" — the
 * suggested shortfall. Renders nothing when there are no bags in the fridge
 * and none needed, so plain rows stay clean.
 */
export function BagsInFridgeNote({
  recipeId,
  needed,
  className,
}: {
  recipeId: number;
  needed?: number;
  className?: string;
}) {
  const { bagsOnHand, isError } = useEightPackBagsOnHand();
  if (isError) return null;
  const onHand = bagsOnHand.get(recipeId) ?? 0;
  if (onHand <= 0 && !(needed && needed > 0)) return null;
  const toMake = needed != null ? bagShortfall(needed, onHand) : null;
  return (
    <Link
      href="/stock-control"
      onClick={e => e.stopPropagation()}
      className={cn("block text-[10px] leading-tight tabular-nums text-indigo-600 dark:text-indigo-400 hover:underline", className)}
      title="8-pack bags already in the production fridge (Stock Control). A suggestion only — the plan isn't changed."
    >
      {onHand} in fridge{toMake != null && needed! > 0 ? ` · make ${toMake}` : ""}
    </Link>
  );
}
