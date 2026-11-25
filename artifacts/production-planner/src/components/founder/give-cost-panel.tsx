// "Give <item> a cost" — opened from a "No cost" item in an Order Analysis
// order's contents (Graeme, 25 Nov 2026: "click on this product and set the
// price in our system … if we should have mapping and we haven't, we can set
// the mapping from here, so I can go through this list and get rid of these
// items"). Three ways: it's one of our recipes (main, F2F or wonky), it's a
// supply we buy in, or a cost typed in (optionally Shopify's too).
// Server: api-server routes/variant-costs.ts. Objective I.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChefHat, Loader2, Package, PoundSterling, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatUnitCost, matchesSearch, perItemFromPack, positiveNumber } from "@/lib/give-cost";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface CostableProduct { name: string; title: string; variantId: string }

interface RecipeOption {
  id: number; name: string; isDraft: boolean;
  f2f: { variantId: string; title: string | null } | null;
  mains: Array<{ id: number; variantId: string; title: string | null; wonky: { variantId: string; title: string | null } | null }>;
}
interface SupplyOption {
  id: number; name: string; unit: string; category: string | null; costPerPack: number | null;
  shopify: { variantId: string; title: string | null; unitsPerPack: number | null } | null;
}
interface Options { recipes: RecipeOption[]; supplies: SupplyOption[] }
interface Status {
  variantId: string;
  manual: { cost: number; category: string; setByName: string | null; setAt: string } | null;
  shopifyCost: number | null;
  shopifyReadFailed: boolean;
  shopifyTickDefault: boolean;
  shopifyWritesAllowed: boolean;
}
type ShopifyOutcome = { status: "not-asked" } | { status: "written"; cost: string } | { status: "blocked" | "failed" | "skipped"; message: string };

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api/variant-costs${path}`, {
    method, credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j as { error?: string }).error ?? "Couldn't save");
  return j as T;
}

type Mode = "choose" | "recipe" | "supply" | "manual";

export function GiveCostPanel({ product, onClose }: { product: CostableProduct; onClose: () => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>("choose");
  const [done, setDone] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const options = useQuery({ queryKey: ["variant-cost-options"], queryFn: () => send<Options>("GET", "/options"), staleTime: 5 * 60_000 });
  const status = useQuery({ queryKey: ["variant-cost-status", product.variantId], queryFn: () => send<Status>("GET", `/${product.variantId}`) });

  /** After any save: the order table and this pop-up recost from the new link. */
  const saved = (message: string, shopifyWarning?: string | null) => {
    setDone(message);
    setWarning(shopifyWarning ?? null);
    void qc.invalidateQueries({ queryKey: ["pnl-tracker-predict"] });
    void qc.invalidateQueries({ queryKey: ["variant-cost-options"] });
    void qc.invalidateQueries({ queryKey: ["variant-cost-status", product.variantId] });
    void qc.invalidateQueries({ queryKey: ["recipe-f2f"] });
  };

  return (
    <div className="mt-2 rounded-xl border-2 border-primary/40 bg-primary/5 p-3 space-y-3">
      <div className="flex items-start gap-2">
        {mode !== "choose" && !done && (
          <button onClick={() => setMode("choose")} className="h-11 w-11 shrink-0 rounded-lg border border-border bg-background flex items-center justify-center hover:bg-secondary" aria-label="Back">
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <p className="flex-1 min-w-0 font-semibold leading-snug pt-2">Give {product.name} a cost</p>
        <button onClick={onClose} className="h-11 w-11 shrink-0 rounded-lg border border-border bg-background flex items-center justify-center hover:bg-secondary" aria-label="Close">
          <X className="w-5 h-5" />
        </button>
      </div>

      {done ? (
        <div className="space-y-2">
          <p className="rounded-lg bg-emerald-100 dark:bg-emerald-900/40 px-3 py-2 text-sm font-medium text-emerald-900 dark:text-emerald-200">{done}</p>
          {warning && <p className="rounded-lg bg-amber-100 dark:bg-amber-900/40 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">{warning}</p>}
          <button onClick={onClose} className="h-12 w-full rounded-xl bg-primary text-primary-foreground font-semibold">Done</button>
        </div>
      ) : mode === "choose" ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <BigChoice icon={<ChefHat className="w-6 h-6" />} label="It's one of our recipes" hint="Its main, F2F or wonky product" onClick={() => setMode("recipe")} />
          <BigChoice icon={<Package className="w-6 h-6" />} label="It's a supply we buy in" hint="Costed from the supply's pack price" onClick={() => setMode("supply")} />
          <BigChoice icon={<PoundSterling className="w-6 h-6" />} label="Set a cost myself" hint="£ per item" onClick={() => setMode("manual")} />
        </div>
      ) : options.isLoading || status.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>
      ) : options.error || status.error ? (
        <p className="text-sm text-red-600">{((options.error ?? status.error) as Error).message}</p>
      ) : mode === "recipe" ? (
        <RecipeLink product={product} recipes={options.data!.recipes} onSaved={saved} />
      ) : mode === "supply" ? (
        <SupplyLink product={product} supplies={options.data!.supplies} onSaved={saved} />
      ) : (
        <ManualCost product={product} status={status.data!} onSaved={saved} />
      )}
    </div>
  );
}

function BigChoice({ icon, label, hint, onClick }: { icon: React.ReactNode; label: string; hint: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="min-h-[5.5rem] rounded-xl border-2 border-border bg-background p-3 text-left hover:border-primary hover:bg-secondary flex flex-col gap-1">
      <span className="text-primary">{icon}</span>
      <span className="font-semibold leading-tight">{label}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </button>
  );
}

function SaveButton({ pending, disabled, onClick, children }: { pending: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={pending || disabled}
      className="h-12 w-full rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
      {pending && <Loader2 className="w-4 h-4 animate-spin" />} {children}
    </button>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input autoFocus value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className="h-12 w-full rounded-lg border border-border bg-background px-3 text-base" />
  );
}

function ErrorLine({ error }: { error: Error | null }) {
  return error ? <p className="text-sm font-medium text-red-600">{error.message}</p> : null;
}

// ── It's one of our recipes ─────────────────────────────────────────────

function RecipeLink({ product, recipes, onSaved }: { product: CostableProduct; recipes: RecipeOption[]; onSaved: (m: string) => void }) {
  const [q, setQ] = useState("");
  const [recipe, setRecipe] = useState<RecipeOption | null>(null);
  const [kind, setKind] = useState<"main" | "f2f" | "wonky" | null>(null);
  const [mappingId, setMappingId] = useState<number | null>(null);
  const list = useMemo(() => recipes.filter(r => matchesSearch(r.name, q)).slice(0, 40), [recipes, q]);
  const save = useMutation({
    mutationFn: () => send<{ recipeName: string }>("POST", `/${product.variantId}/recipe`, { recipeId: recipe!.id, kind, mappingId, title: product.title }),
    onSuccess: r => onSaved(`Linked to ${r.recipeName}${kind === "main" ? "" : kind === "f2f" ? " as its F2F product" : " as its wonky product"}. It's now costed as the recipe.`),
  });

  if (!recipe) {
    return (
      <div className="space-y-2">
        <SearchBox value={q} onChange={setQ} placeholder="Search recipes" />
        <ul className="max-h-72 overflow-y-auto rounded-lg border border-border divide-y divide-border bg-background">
          {list.map(r => (
            <li key={r.id}>
              <button onClick={() => { setRecipe(r); setKind(null); setMappingId(null); }} className="w-full min-h-12 px-3 py-2 text-left hover:bg-secondary">
                {r.name}{r.isDraft && <span className="ml-2 text-xs text-muted-foreground">draft</span>}
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">No recipes match.</li>}
        </ul>
      </div>
    );
  }

  const otherF2f = recipe.f2f && recipe.f2f.variantId !== product.variantId ? recipe.f2f : null;
  const mainsFree = recipe.mains.filter(m => !m.wonky || m.wonky.variantId === product.variantId);
  const kinds: Array<{ k: "main" | "f2f" | "wonky"; label: string; note?: string; disabled?: boolean }> = [
    { k: "main", label: "The main product" },
    { k: "f2f", label: "Its F2F (frozen) product", disabled: !!otherF2f, note: otherF2f ? `Already has one: ${otherF2f.title ?? otherF2f.variantId}` : undefined },
    {
      k: "wonky", label: "Its Wonky product",
      disabled: recipe.mains.length === 0 || mainsFree.length === 0,
      note: recipe.mains.length === 0 ? "Link its main product first" : mainsFree.length === 0 ? "Already has a wonky product" : undefined,
    },
  ];
  const needsMappingChoice = kind === "wonky" && recipe.mains.length > 1;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 rounded-lg bg-background border border-border px-3 py-2">
        <span className="font-semibold">{recipe.name}</span>
        <button onClick={() => setRecipe(null)} className="h-10 px-3 rounded-lg text-sm font-medium hover:bg-secondary">Change</button>
      </div>
      <p className="text-sm text-muted-foreground">Which version of {recipe.name} is {product.name}?</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {kinds.map(o => (
          <button key={o.k} disabled={o.disabled} onClick={() => { setKind(o.k); setMappingId(null); }}
            className={cn("min-h-14 rounded-xl border-2 px-3 py-2 text-left font-semibold disabled:opacity-50",
              kind === o.k ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-secondary")}>
            {o.label}
            {o.note && <span className="block text-xs font-normal">{o.note}</span>}
          </button>
        ))}
      </div>
      {needsMappingChoice && (
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{recipe.name} has more than one Shopify product. Which one is this the wonky version of?</p>
          {recipe.mains.map(m => {
            const taken = !!m.wonky && m.wonky.variantId !== product.variantId;
            return (
              <button key={m.id} disabled={taken} onClick={() => setMappingId(m.id)}
                className={cn("w-full min-h-12 rounded-lg border-2 px-3 py-2 text-left text-sm disabled:opacity-50",
                  mappingId === m.id ? "border-primary bg-primary/10 font-semibold" : "border-border bg-background hover:bg-secondary")}>
                {m.title ?? m.variantId}{taken && <span className="block text-xs">Already has a wonky product</span>}
              </button>
            );
          })}
        </div>
      )}
      <ErrorLine error={save.error} />
      <SaveButton pending={save.isPending} disabled={!kind || (needsMappingChoice && mappingId == null)} onClick={() => save.mutate()}>
        Link to {recipe.name}
      </SaveButton>
    </div>
  );
}

// ── It's a supply we buy in ─────────────────────────────────────────────

function SupplyLink({ product, supplies, onSaved }: { product: CostableProduct; supplies: SupplyOption[]; onSaved: (m: string) => void }) {
  const [q, setQ] = useState("");
  const [supply, setSupply] = useState<SupplyOption | null>(null);
  const [units, setUnits] = useState("1");
  const [packCost, setPackCost] = useState("");
  const list = useMemo(() => supplies.filter(s => matchesSearch(s.name, q)).slice(0, 40), [supplies, q]);
  const unitsN = positiveNumber(units);
  const typedCost = positiveNumber(packCost);
  const cost = supply?.costPerPack ?? typedCost;
  const perItem = perItemFromPack(cost, unitsN);
  const save = useMutation({
    mutationFn: () => send<{ supplyName: string }>("POST", `/${product.variantId}/supply`, {
      ingredientId: supply!.id, unitsPerPack: unitsN, costPerPack: supply!.costPerPack ? null : typedCost, title: product.title,
    }),
    onSuccess: r => onSaved(`Linked to ${r.supplyName}${perItem != null ? ` — ${formatUnitCost(perItem)} per item` : ""}.`),
  });

  if (!supply) {
    return (
      <div className="space-y-2">
        <SearchBox value={q} onChange={setQ} placeholder="Search supplies" />
        <ul className="max-h-72 overflow-y-auto rounded-lg border border-border divide-y divide-border bg-background">
          {list.map(s => {
            const linkedElsewhere = !!s.shopify && s.shopify.variantId !== product.variantId;
            return (
              <li key={s.id}>
                <button disabled={linkedElsewhere} onClick={() => { setSupply(s); setUnits(String(s.shopify?.unitsPerPack ?? 1)); setPackCost(""); }}
                  className="w-full min-h-12 px-3 py-2 text-left hover:bg-secondary disabled:opacity-50 disabled:hover:bg-transparent">
                  <span className="block">{s.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {s.costPerPack != null ? `£${s.costPerPack.toFixed(2)} a pack` : "No cost per pack yet"}
                    {linkedElsewhere ? ` · already linked to ${s.shopify!.title ?? "another Shopify product"}` : ""}
                  </span>
                </button>
              </li>
            );
          })}
          {list.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">No supplies match.</li>}
        </ul>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 rounded-lg bg-background border border-border px-3 py-2">
        <span>
          <span className="block font-semibold">{supply.name}</span>
          <span className="block text-xs text-muted-foreground">{supply.costPerPack != null ? `£${supply.costPerPack.toFixed(2)} a pack` : "No cost per pack yet"}</span>
        </span>
        <button onClick={() => setSupply(null)} className="h-10 px-3 rounded-lg text-sm font-medium hover:bg-secondary">Change</button>
      </div>
      <label className="block">
        <span className="text-sm font-medium">How many of {product.name} are in one pack of {supply.name}?</span>
        <input inputMode="decimal" value={units} onChange={e => setUnits(e.target.value)}
          className="mt-1 h-12 w-full rounded-lg border border-border bg-background px-3 text-base tabular-nums" />
      </label>
      {supply.costPerPack == null && (
        <label className="block">
          <span className="text-sm font-medium">{supply.name} has no cost per pack yet. What does one pack cost? (£, ex VAT)</span>
          <input inputMode="decimal" value={packCost} onChange={e => setPackCost(e.target.value)} placeholder="0.00"
            className="mt-1 h-12 w-full rounded-lg border border-border bg-background px-3 text-base tabular-nums" />
        </label>
      )}
      {perItem != null && <p className="text-sm">That's <span className="font-semibold">{formatUnitCost(perItem)}</span> per item{(supply.category ?? "").toLowerCase() === "packaging" ? ", as packaging" : ", as food"}.</p>}
      <p className="text-xs text-muted-foreground">
        From now on, when {supply.name} is booked in at goods-in, the stock received is added to this product in Shopify as well.
      </p>
      <ErrorLine error={save.error} />
      <SaveButton pending={save.isPending} disabled={!unitsN || !cost} onClick={() => save.mutate()}>
        Link to {supply.name}
      </SaveButton>
    </div>
  );
}

// ── Set a cost myself ───────────────────────────────────────────────────

function ManualCost({ product, status, onSaved }: { product: CostableProduct; status: Status; onSaved: (m: string, warning?: string | null) => void }) {
  const [cost, setCost] = useState(status.manual ? String(status.manual.cost) : "");
  const [category, setCategory] = useState<"food" | "packaging">(status.manual?.category === "packaging" ? "packaging" : "food");
  const [alsoShopify, setAlsoShopify] = useState(status.shopifyWritesAllowed && status.shopifyTickDefault);
  const n = positiveNumber(cost);
  const save = useMutation({
    mutationFn: () => send<{ shopify: ShopifyOutcome }>("PUT", `/${product.variantId}/manual`, { cost: n, category, title: product.title, alsoShopify }),
    onSuccess: r => {
      const s = r.shopify;
      onSaved(
        `Saved: ${formatUnitCost(n!)} per item, as ${category}${s.status === "written" ? `, and Shopify's cost per item is now £${s.cost}` : ""}.`,
        s.status === "blocked" || s.status === "failed" || s.status === "skipped" ? s.message : null,
      );
    },
  });
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-sm font-medium">What does one {product.name} cost us? (£ per item, ex VAT)</span>
        <input autoFocus inputMode="decimal" value={cost} onChange={e => setCost(e.target.value)} placeholder="0.00"
          className="mt-1 h-12 w-full rounded-lg border border-border bg-background px-3 text-base tabular-nums" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        {(["food", "packaging"] as const).map(c => (
          <button key={c} onClick={() => setCategory(c)}
            className={cn("h-12 rounded-xl border-2 font-semibold", category === c ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-secondary")}>
            {c === "food" ? "Food" : "Packaging"}
          </button>
        ))}
      </div>
      <label className={cn("flex items-start gap-3 rounded-xl border border-border bg-background p-3", !status.shopifyWritesAllowed && "opacity-60")}>
        <input type="checkbox" className="mt-0.5 h-6 w-6 shrink-0" checked={alsoShopify} disabled={!status.shopifyWritesAllowed}
          onChange={e => setAlsoShopify(e.target.checked)} />
        <span className="text-sm">
          <span className="block font-medium">Also set this as the cost per item in Shopify</span>
          <span className="block text-xs text-muted-foreground">
            {!status.shopifyWritesAllowed
              ? "Shopify writes only happen on the live app, so this one is saved in the app only."
              : status.shopifyReadFailed ? "Couldn't read Shopify's cost just now."
              : status.shopifyCost != null ? `Shopify has £${status.shopifyCost.toFixed(2)} at the moment.` : "Shopify has no cost for it."}
          </span>
        </span>
      </label>
      <ErrorLine error={save.error} />
      <SaveButton pending={save.isPending} disabled={!n} onClick={() => save.mutate()}>Save the cost</SaveButton>
    </div>
  );
}
