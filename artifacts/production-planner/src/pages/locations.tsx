/**
 * Bin Locations — the fridge map (Graeme, 2026-09-11).
 *
 * The unit drawn as it stands: vertical fridge doors and freezer doors,
 * five shelves each (A at the top), a number for the door and a letter for
 * the shelf — "3B" is door 3, shelf B. Products are chips you drag onto a
 * shelf; several products can share a shelf. The zone cards themselves
 * reorder by drag, and that IS the pick walk on Order Packing Live: zones
 * in card order, then door by door, shelf by shelf. One source of truth —
 * this map informs the picking order, nothing else does.
 *
 * Legacy free-text locations (pre-map rows with no door/shelf) surface in
 * a "needs re-filing" tray so they can be dragged into a real bin.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { toast } from "@/hooks/use-toast";
import {
  MapPin, Loader2, AlertCircle, RefreshCw, PackageSearch, Barcode,
  GripVertical, X, Plus, Footprints, Snowflake, Refrigerator, Package, Settings2,
} from "lucide-react";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, closestCenter,
} from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, horizontalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type ZoneValue = "fridge" | "freezer" | "ambient";

interface SkuLocation {
  sku: string;
  zone: ZoneValue;
  locationLabel: string;
  door: number | null;
  shelf: string | null;
  updatedAt: string;
}

interface RecentSku {
  sku: string;
  title: string;
  orderCount: number;
  location: SkuLocation | null;
}

interface PickConfig {
  zoneOrder: ZoneValue[];
  layout: Record<string, { doors: number; shelves: number; firstDoor: number }>;
}

interface BarcodeRow {
  variantId: string;
  sku: string | null;
  barcode: string;
  productTitle: string | null;
  variantTitle: string | null;
  updatedAt: string;
}

interface BarcodeSyncResult {
  synced: number;
  skippedNoBarcode: number;
  skippedNoSku: number;
  totalProducts: number;
}

const ZONE_META: Record<ZoneValue, { label: string; icon: typeof Refrigerator; chip: string; cell: string }> = {
  fridge: {
    label: "Fridge",
    icon: Refrigerator,
    chip: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
    cell: "bg-blue-50/60 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900",
  },
  freezer: {
    label: "Freezer",
    icon: Snowflake,
    chip: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200",
    cell: "bg-purple-50/60 dark:bg-purple-950/20 border-purple-200 dark:border-purple-900",
  },
  ambient: {
    label: "Ambient",
    icon: Package,
    chip: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
    cell: "bg-amber-50/60 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900",
  },
};

const shelfLetter = (i: number) => String.fromCharCode(65 + i); // 0 → A

export default function Locations() {
  const queryClient = useQueryClient();

  const { data: locations = [], isLoading } = useQuery<SkuLocation[]>({
    queryKey: ["sku-locations"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/fulfilment/sku-locations`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch locations");
      return res.json();
    },
    staleTime: 60_000,
  });

  const { data: recentSkus = [] } = useQuery<RecentSku[]>({
    queryKey: ["sku-locations-recent"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/fulfilment/sku-locations/recent-skus`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to fetch recent SKUs");
      return res.json();
    },
    staleTime: 2 * 60_000,
  });

  const { data: barcodes = [] } = useQuery<BarcodeRow[]>({
    queryKey: ["sku-barcodes"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/fulfilment/sku-barcodes`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch barcodes");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  const { data: config } = useQuery<PickConfig>({
    queryKey: ["fulfilment-pick-config"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/fulfilment/pick-config`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load pick config");
      return res.json();
    },
    staleTime: 60_000,
  });

  // Product names per SKU. Several products legitimately share a shelf-label
  // SKU (BBQ Sauce and Buffalo Hot Sauce are both "3d"; the buttermilk
  // chicken variants are all "1"), so the chip joins EVERY distinct product
  // title on the SKU — showing just one name made the others look missing
  // from the map (Graeme, 2026-09-11).
  const titlesBySku = useMemo(() => {
    const sets = new Map<string, Set<string>>();
    const add = (sku: string | null, title: string | null) => {
      if (!sku || !title) return;
      const s = sets.get(sku) ?? new Set<string>();
      s.add(title);
      sets.set(sku, s);
    };
    for (const s of recentSkus) add(s.sku, s.title);
    for (const b of barcodes) add(b.sku, b.productTitle);
    const m = new Map<string, string>();
    for (const [sku, s] of sets) m.set(sku, [...s].join(" · "));
    return m;
  }, [recentSkus, barcodes]);

  const [saving, setSaving] = useState<Set<string>>(new Set());
  const markSaving = (sku: string, on: boolean) => setSaving(prev => {
    const next = new Set(prev);
    if (on) next.add(sku); else next.delete(sku);
    return next;
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["sku-locations"] });
    queryClient.invalidateQueries({ queryKey: ["sku-locations-recent"] });
  };

  const moveMutation = useMutation({
    mutationFn: async (input: { sku: string; zone: ZoneValue; door?: number; shelf?: string }) => {
      const body = input.zone === "ambient"
        ? { zone: "ambient", locationLabel: "Ambient" }
        : { zone: input.zone, door: input.door, shelf: input.shelf };
      const res = await fetch(`${BASE}/api/fulfilment/sku-locations/${encodeURIComponent(input.sku)}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to save");
      return res.json();
    },
    onMutate: ({ sku }) => markSaving(sku, true),
    onSettled: (_d, _e, { sku }) => markSaving(sku, false),
    onSuccess: invalidate,
    onError: (e) => toast({ title: "Couldn't move that product", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: async (sku: string) => {
      const res = await fetch(`${BASE}/api/fulfilment/sku-locations/${encodeURIComponent(sku)}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Failed to remove");
    },
    onMutate: (sku) => markSaving(sku, true),
    onSettled: (_d, _e, sku) => markSaving(sku, false),
    onSuccess: invalidate,
    onError: (e) => toast({ title: "Couldn't remove that", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
  });

  const configMutation = useMutation({
    mutationFn: async (patch: Partial<PickConfig>) => {
      const res = await fetch(`${BASE}/api/fulfilment/pick-config`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to save");
      return res.json();
    },
    onSuccess: (next: PickConfig) => {
      queryClient.setQueryData(["fulfilment-pick-config"], next);
      queryClient.invalidateQueries({ queryKey: ["fulfilment-pick-config"] });
      toast({ title: "Pick order saved", description: "Order Packing Live now walks in this order." });
    },
    onError: (e) => toast({ title: "Couldn't save", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
  });

  // ── Drag state ──────────────────────────────────────────────────────
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [dragSku, setDragSku] = useState<string | null>(null);

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    if (id.startsWith("sku:")) setDragSku(id.slice(4));
  };

  const onDragEnd = (e: DragEndEvent) => {
    setDragSku(null);
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    if (!activeId.startsWith("sku:")) return;
    const sku = activeId.slice(4);
    const target = String(over.id);
    if (target === "ambient") {
      moveMutation.mutate({ sku, zone: "ambient" });
      return;
    }
    const m = /^bin:(fridge|freezer):(\d+):([A-Z])$/.exec(target);
    if (m) {
      moveMutation.mutate({ sku, zone: m[1] as ZoneValue, door: Number(m[2]), shelf: m[3] });
    }
  };

  // ── Derived data ───────────────────────────────────────────────────
  const zoneOrder = config?.zoneOrder ?? ["fridge", "freezer", "ambient"];
  const layout = config?.layout ?? {
    fridge: { doors: 7, shelves: 5, firstDoor: 1 },
    freezer: { doors: 2, shelves: 5, firstDoor: 8 },
  };

  const locationsBySku = useMemo(() => new Map(locations.map(l => [l.sku, l])), [locations]);
  const binned = useMemo(() => {
    const m = new Map<string, SkuLocation[]>();
    for (const l of locations) {
      if (l.door == null || !l.shelf) continue;
      const key = `${l.zone}:${l.door}:${l.shelf}`;
      const list = m.get(key) ?? [];
      list.push(l);
      m.set(key, list);
    }
    for (const list of m.values()) list.sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true }));
    return m;
  }, [locations]);

  const ambientRows = useMemo(
    () => locations.filter(l => l.zone === "ambient").sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true })),
    [locations],
  );
  // Pre-map rows: a zone but no door/shelf — drag them into a real bin.
  const needsRefiling = useMemo(
    () => locations.filter(l => l.zone !== "ambient" && (l.door == null || !l.shelf)).sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true })),
    [locations],
  );
  const unassigned = useMemo(
    () => recentSkus.filter(s => !locationsBySku.has(s.sku)).sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true })),
    [recentSkus, locationsBySku],
  );
  // The rest of the catalogue: SKUs the Shopify barcode cache knows about
  // that have no bin yet and no recent order — so the tray shows every
  // mappable product, not just what happened to be ordered in the last
  // fortnight. (Variants with NO SKU in Shopify can't appear anywhere on
  // this page — a bin is keyed by SKU; give them one in Shopify and
  // re-sync.)
  const catalogueUnassigned = useMemo(() => {
    const seen = new Set(unassigned.map(u => u.sku));
    const out: string[] = [];
    for (const b of barcodes) {
      if (!b.sku || seen.has(b.sku) || locationsBySku.has(b.sku) || out.includes(b.sku)) continue;
      out.push(b.sku);
    }
    return out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [barcodes, unassigned, locationsBySku]);

  // Extra SKU typed by hand (not on any recent order) — joins the tray.
  const [extraSkus, setExtraSkus] = useState<string[]>([]);
  const [newSku, setNewSku] = useState("");
  const trayExtra = extraSkus.filter(s => !locationsBySku.has(s) && !unassigned.some(u => u.sku === s));

  // The flattened walk — exactly the order Order Packing Live will pick in.
  const walkOrder = useMemo(() => {
    const rows: Array<{ label: string; zone: ZoneValue; sku: string }> = [];
    for (const zone of zoneOrder) {
      if (zone === "ambient") {
        for (const l of ambientRows) rows.push({ label: "Ambient", zone, sku: l.sku });
        continue;
      }
      const zl = layout[zone];
      if (!zl) continue;
      for (let d = 0; d < zl.doors; d++) {
        const door = zl.firstDoor + d;
        for (let s = 0; s < zl.shelves; s++) {
          const shelf = shelfLetter(s);
          for (const l of binned.get(`${zone}:${door}:${shelf}`) ?? []) {
            rows.push({ label: `${door}${shelf}`, zone, sku: l.sku });
          }
        }
      }
      // Legacy free-text rows in this zone walk after its bins (same rule
      // as the pick sort: no door sorts last within the zone).
      for (const l of needsRefiling.filter(r => r.zone === zone)) rows.push({ label: l.locationLabel, zone, sku: l.sku });
    }
    return rows;
  }, [zoneOrder, layout, binned, ambientRows, needsRefiling]);

  const chipTitle = (sku: string) => titlesBySku.get(sku) ?? null;
  const isSaving = (sku: string) => saving.has(sku);

  // ── Layout editor (doors/shelves counts) ───────────────────────────
  const [editingLayout, setEditingLayout] = useState(false);
  const [layoutForm, setLayoutForm] = useState({ fridgeDoors: 7, freezerDoors: 2, shelves: 5 });
  const openLayoutEditor = () => {
    setLayoutForm({
      fridgeDoors: layout.fridge?.doors ?? 7,
      freezerDoors: layout.freezer?.doors ?? 2,
      shelves: layout.fridge?.shelves ?? 5,
    });
    setEditingLayout(true);
  };
  const saveLayout = () => {
    // Freezer doors number on from the fridge so every door number in the
    // unit is unique — "8A" can only mean one place.
    configMutation.mutate({
      layout: {
        fridge: { doors: layoutForm.fridgeDoors, shelves: layoutForm.shelves, firstDoor: 1 },
        freezer: { doors: layoutForm.freezerDoors, shelves: layoutForm.shelves, firstDoor: layoutForm.fridgeDoors + 1 },
      },
    });
    setEditingLayout(false);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bin Locations"
        description="The fridge map — drag products onto shelves, drag the zones into walk order. This map IS the picking order on Order Packing Live."
      />

      <BarcodesCard />

      {/* Pick walk order — drag the zone pills. */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Footprints className="w-4 h-4 text-primary" /> Pick walk order
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Drag to choose which zone gets picked first. Within a zone the walk is door 1 → {(layout.fridge?.doors ?? 7) + (layout.freezer?.doors ?? 2)}, shelf A → {shelfLetter((layout.fridge?.shelves ?? 5) - 1)}.
            </p>
          </div>
          <button onClick={openLayoutEditor} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <Settings2 className="w-3.5 h-3.5" /> Edit layout
          </button>
        </div>
        <ZoneOrderStrip
          zoneOrder={zoneOrder}
          saving={configMutation.isPending}
          onReorder={(next) => configMutation.mutate({ zoneOrder: next })}
        />
        {editingLayout && (
          <div className="rounded-xl border border-border bg-secondary/20 p-3 flex items-end gap-3 flex-wrap">
            {([
              ["Fridge doors", "fridgeDoors"],
              ["Freezer doors", "freezerDoors"],
              ["Shelves per door", "shelves"],
            ] as const).map(([label, key]) => (
              <label key={key} className="text-xs font-medium text-muted-foreground">
                {label}
                <input
                  type="number" min={1} max={key === "shelves" ? 10 : 20}
                  value={layoutForm[key]}
                  onChange={e => setLayoutForm(f => ({ ...f, [key]: Math.max(1, Number(e.target.value) || 1) }))}
                  className="mt-1 block w-24 px-2 py-1.5 bg-background border border-border rounded-lg text-sm"
                />
              </label>
            ))}
            <div className="flex gap-2">
              <button onClick={saveLayout} className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold">Save layout</button>
              <button onClick={() => setEditingLayout(false)} className="px-3 py-1.5 rounded-lg border border-border text-xs">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          {/* The maps, in walk order. */}
          {zoneOrder.map(zone => {
            if (zone === "ambient") {
              return (
                <AmbientTray key="ambient" rows={ambientRows} chipTitle={chipTitle} isSaving={isSaving} onRemove={(sku) => removeMutation.mutate(sku)} />
              );
            }
            const zl = layout[zone];
            if (!zl) return null;
            return (
              <ZoneMap
                key={zone}
                zone={zone}
                layout={zl}
                binned={binned}
                chipTitle={chipTitle}
                isSaving={isSaving}
                onRemove={(sku) => removeMutation.mutate(sku)}
              />
            );
          })}

          {/* Trays: legacy rows to re-file + unassigned SKUs from orders. */}
          {needsRefiling.length > 0 && (
            <div className="rounded-2xl border-2 border-amber-400/60 bg-amber-500/5 p-5 space-y-2">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <MapPin className="w-4 h-4 text-amber-600" /> Needs re-filing
              </h2>
              <p className="text-xs text-muted-foreground">
                These have an old written location but no shelf on the map — drag each onto its real shelf.
              </p>
              <div className="flex flex-wrap gap-2">
                {needsRefiling.map(l => (
                  <ProductChip key={l.sku} sku={l.sku} title={chipTitle(l.sku)} note={`${ZONE_META[l.zone].label} · “${l.locationLabel}”`} saving={isSaving(l.sku)} />
                ))}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-border bg-card p-5 space-y-3 sticky bottom-2 z-20 shadow-lg">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <PackageSearch className="w-4 h-4 text-primary" /> Not on the map yet
                <span className="text-xs font-normal text-muted-foreground">({unassigned.length + catalogueUnassigned.length + trayExtra.length}) — drag onto a shelf</span>
              </h2>
              <div className="flex items-center gap-1.5">
                <input
                  value={newSku}
                  onChange={e => setNewSku(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && newSku.trim()) { setExtraSkus(x => [...x, newSku.trim()]); setNewSku(""); } }}
                  placeholder="Add a SKU by hand"
                  className="px-2.5 py-1.5 bg-background border border-border rounded-lg text-xs font-mono w-36"
                />
                <button
                  onClick={() => { if (newSku.trim()) { setExtraSkus(x => [...x, newSku.trim()]); setNewSku(""); } }}
                  className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground"
                  aria-label="Add SKU"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            {unassigned.length + catalogueUnassigned.length + trayExtra.length === 0 ? (
              <p className="text-xs text-muted-foreground">Every SKU Shopify knows about is on the map. 🎉</p>
            ) : (
              <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
                {unassigned.map(s => (
                  <ProductChip key={s.sku} sku={s.sku} title={chipTitle(s.sku) ?? s.title} note={`${s.orderCount} order${s.orderCount === 1 ? "" : "s"}`} saving={isSaving(s.sku)} />
                ))}
                {catalogueUnassigned.map(sku => (
                  <ProductChip key={sku} sku={sku} title={chipTitle(sku)} saving={isSaving(sku)} />
                ))}
                {trayExtra.map(sku => (
                  <ProductChip key={sku} sku={sku} title={chipTitle(sku)} note="added by hand" saving={isSaving(sku)} />
                ))}
              </div>
            )}
          </div>

          <DragOverlay>
            {dragSku && <ChipBody sku={dragSku} title={chipTitle(dragSku)} dragging />}
          </DragOverlay>
        </DndContext>
      )}

      {/* The flattened walk — exactly what Order Packing Live will do. */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Footprints className="w-4 h-4 text-primary" /> The pick walk, flattened
        </h2>
        <p className="text-xs text-muted-foreground">
          Order Packing Live sorts every order's items exactly like this — zone by zone in the order above, then door, then shelf.
        </p>
        {walkOrder.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing on the map yet.</p>
        ) : (
          <ol className="space-y-1">
            {walkOrder.map((r, i) => (
              <li key={r.sku} className="flex items-center gap-3 text-sm px-3 py-1.5 rounded-lg bg-secondary/20">
                <span className="w-6 text-right tabular-nums text-muted-foreground">{i + 1}.</span>
                <span className={cn("px-2 py-0.5 rounded-full text-xs font-semibold tabular-nums", ZONE_META[r.zone].chip)}>{r.label}</span>
                <span className="font-mono font-semibold">{r.sku}</span>
                <span className="text-muted-foreground truncate">{chipTitle(r.sku) ?? ""}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

// ── One zone drawn as doors × shelves ───────────────────────────────────────
function ZoneMap({ zone, layout, binned, chipTitle, isSaving, onRemove }: {
  zone: "fridge" | "freezer";
  layout: { doors: number; shelves: number; firstDoor: number };
  binned: Map<string, SkuLocation[]>;
  chipTitle: (sku: string) => string | null;
  isSaving: (sku: string) => boolean;
  onRemove: (sku: string) => void;
}) {
  const meta = ZONE_META[zone];
  const Icon = meta.icon;
  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <Icon className="w-4 h-4 text-primary" /> {meta.label}
        <span className="text-xs font-normal text-muted-foreground">
          doors {layout.firstDoor}–{layout.firstDoor + layout.doors - 1} · shelf A at the top
        </span>
      </h2>
      <div className="overflow-x-auto">
        <div className="flex gap-2 min-w-max">
          {Array.from({ length: layout.doors }, (_, d) => {
            const door = layout.firstDoor + d;
            return (
              <div key={door} className="w-40 flex-shrink-0 rounded-xl border-2 border-border overflow-hidden">
                <div className="px-2 py-1.5 bg-secondary/40 text-center text-xs font-bold uppercase tracking-wide">Door {door}</div>
                {Array.from({ length: layout.shelves }, (_, s) => {
                  const shelf = shelfLetter(s);
                  return (
                    <ShelfCell
                      key={shelf}
                      zone={zone}
                      door={door}
                      shelf={shelf}
                      rows={binned.get(`${zone}:${door}:${shelf}`) ?? []}
                      cellClass={meta.cell}
                      chipTitle={chipTitle}
                      isSaving={isSaving}
                      onRemove={onRemove}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ShelfCell({ zone, door, shelf, rows, cellClass, chipTitle, isSaving, onRemove }: {
  zone: string;
  door: number;
  shelf: string;
  rows: SkuLocation[];
  cellClass: string;
  chipTitle: (sku: string) => string | null;
  isSaving: (sku: string) => boolean;
  onRemove: (sku: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `bin:${zone}:${door}:${shelf}` });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-[3.5rem] border-t border-border/60 p-1.5 transition-colors",
        cellClass,
        isOver && "ring-2 ring-primary ring-inset bg-primary/10",
      )}
    >
      <div className="flex items-start gap-1">
        <span className="text-[10px] font-bold text-muted-foreground/70 tabular-nums flex-shrink-0 pt-0.5">{door}{shelf}</span>
        <div className="flex flex-wrap gap-1 min-w-0">
          {rows.map(l => (
            <ProductChip key={l.sku} sku={l.sku} title={chipTitle(l.sku)} small saving={isSaving(l.sku)} onRemove={() => onRemove(l.sku)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function AmbientTray({ rows, chipTitle, isSaving, onRemove }: {
  rows: SkuLocation[];
  chipTitle: (sku: string) => string | null;
  isSaving: (sku: string) => boolean;
  onRemove: (sku: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "ambient" });
  const meta = ZONE_META.ambient;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-2xl border border-border bg-card p-5 space-y-2 transition-colors",
        isOver && "ring-2 ring-primary bg-primary/5",
      )}
    >
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <Package className="w-4 h-4 text-primary" /> {meta.label}
        <span className="text-xs font-normal text-muted-foreground">no doors — anything at room temperature</span>
      </h2>
      <div className="flex flex-wrap gap-2 min-h-[2.5rem]">
        {rows.length === 0 && <p className="text-xs text-muted-foreground">Drop products here for ambient storage.</p>}
        {rows.map(l => (
          <ProductChip key={l.sku} sku={l.sku} title={chipTitle(l.sku)} saving={isSaving(l.sku)} onRemove={() => onRemove(l.sku)} />
        ))}
      </div>
    </div>
  );
}

// ── Product chip (draggable) ────────────────────────────────────────────────
function ChipBody({ sku, title, small = false, saving = false, dragging = false, onRemove }: {
  sku: string; title: string | null; small?: boolean; saving?: boolean; dragging?: boolean; onRemove?: () => void;
}) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-lg border border-border bg-background shadow-sm max-w-full",
      small ? "px-1.5 py-1" : "px-2.5 py-1.5",
      dragging && "shadow-xl ring-2 ring-primary rotate-2",
    )}>
      <span className={cn("font-mono font-bold tabular-nums flex-shrink-0", small ? "text-xs" : "text-sm")}>{sku}</span>
      {title && <span className={cn("text-muted-foreground truncate", small ? "text-[10px] max-w-[6rem]" : "text-xs max-w-[10rem]")}>{title}</span>}
      {saving && <Loader2 className="w-3 h-3 animate-spin text-primary flex-shrink-0" />}
      {onRemove && !saving && (
        <button
          onClick={(e) => { e.stopPropagation(); if (confirm(`Take ${sku} off the map?`)) onRemove(); }}
          onPointerDown={(e) => e.stopPropagation()}
          className="text-muted-foreground/50 hover:text-destructive flex-shrink-0"
          aria-label={`Remove ${sku}`}
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </span>
  );
}

function ProductChip({ sku, title, note, small = false, saving = false, onRemove }: {
  sku: string; title: string | null; note?: string; small?: boolean; saving?: boolean; onRemove?: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `sku:${sku}` });
  return (
    <span
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn("touch-none cursor-grab active:cursor-grabbing", isDragging && "opacity-30")}
      title={title ?? sku}
    >
      <ChipBody sku={sku} title={title ?? note ?? null} small={small} saving={saving} onRemove={onRemove} />
    </span>
  );
}

// ── Zone order pills ────────────────────────────────────────────────────────
function ZoneOrderStrip({ zoneOrder, saving, onReorder }: {
  zoneOrder: ZoneValue[];
  saving: boolean;
  onReorder: (next: ZoneValue[]) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = zoneOrder.indexOf(active.id as ZoneValue);
    const newIndex = zoneOrder.indexOf(over.id as ZoneValue);
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder(arrayMove(zoneOrder, oldIndex, newIndex));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={zoneOrder} strategy={horizontalListSortingStrategy}>
        <div className="flex items-center gap-2 flex-wrap">
          {zoneOrder.map((z, i) => <ZonePill key={z} zone={z} index={i} disabled={saving} />)}
          {saving && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function ZonePill({ zone, index, disabled }: { zone: ZoneValue; index: number; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: zone, disabled });
  const meta = ZONE_META[zone];
  const Icon = meta.icon;
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
      {...attributes}
      {...listeners}
      className={cn(
        "inline-flex items-center gap-2 px-3 py-2 rounded-xl border-2 border-border bg-card cursor-grab active:cursor-grabbing touch-none select-none",
        isDragging && "shadow-lg ring-2 ring-primary",
      )}
    >
      <GripVertical className="w-4 h-4 text-muted-foreground/60" />
      <span className="text-sm font-bold tabular-nums text-muted-foreground">{index + 1}.</span>
      <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold", meta.chip)}>
        <Icon className="w-3.5 h-3.5" /> {meta.label}
      </span>
    </div>
  );
}

// ── Shopify barcodes (unchanged behaviour, restyled lightly) ────────────────
function BarcodesCard() {
  const queryClient = useQueryClient();
  const { data: barcodes } = useQuery<BarcodeRow[]>({
    queryKey: ["sku-barcodes"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/fulfilment/sku-barcodes`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch barcodes");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });
  const [syncResult, setSyncResult] = useState<BarcodeSyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const sync = useMutation({
    mutationFn: async (): Promise<BarcodeSyncResult> => {
      const res = await fetch(`${BASE}/api/fulfilment/sync-barcodes`, { method: "POST", credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to sync barcodes");
      return data;
    },
    onSuccess: (data) => {
      setSyncResult(data);
      setSyncError(null);
      queryClient.invalidateQueries({ queryKey: ["sku-barcodes"] });
    },
    onError: (err: Error) => {
      setSyncError(err.message);
      setSyncResult(null);
    },
  });

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Barcode className="w-4 h-4 text-primary" /> Shopify Barcodes
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {barcodes?.length ?? 0} product variant{(barcodes?.length ?? 0) !== 1 ? "s" : ""} have a barcode synced from Shopify.
            Re-run after editing variant barcodes in Shopify admin.
          </p>
        </div>
        <button
          onClick={() => sync.mutate()}
          disabled={sync.isPending}
          className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5 flex-shrink-0"
        >
          {sync.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Sync from Shopify
        </button>
      </div>
      {syncResult && (
        <div className="text-xs text-muted-foreground bg-secondary/30 rounded-lg p-2 border border-border">
          Synced <b className="text-foreground">{syncResult.synced}</b> barcode{syncResult.synced !== 1 ? "s" : ""} from {syncResult.totalProducts} products.
          {syncResult.skippedNoBarcode > 0 && (
            <> {syncResult.skippedNoBarcode} variant{syncResult.skippedNoBarcode !== 1 ? "s" : ""} had no barcode set in Shopify.</>
          )}
        </div>
      )}
      {syncError && (
        <div className="flex items-center gap-2 p-2 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-xs">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          {syncError}
        </div>
      )}
    </div>
  );
}
