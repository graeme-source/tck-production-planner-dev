import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Thermometer, Snowflake, Package, RefreshCw, ChevronRight, Settings2, Plus, Pencil, Trash2, X, Save, Loader2, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface StockItem {
  id: number;
  name: string;
  color: string | null;
  qty: number;
  unit: string;
  type: string;
}

interface StockLocation {
  key: string;
  label: string;
  zone: string;
  icon: string;
  dbId: number | null;
  totalPacks: number;
  items: StockItem[];
}

interface StockControlData {
  productionFridgeTotal: number;
  locations: StockLocation[];
}

interface StorageLocation {
  id: number;
  name: string;
  zone: string;
  isSystem: boolean;
  createdAt: string;
  racks: { id: number; locationId: number; label: string }[];
}

async function fetchStorageLocations(): Promise<StorageLocation[]> {
  const res = await fetch(`${BASE}/api/storage-locations`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch storage locations");
  return res.json();
}

async function createStorageLocation(data: { name: string; zone: string }): Promise<StorageLocation> {
  const res = await fetch(`${BASE}/api/storage-locations`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Failed to create location");
  return json;
}

async function updateStorageLocation(id: number, data: { name: string; zone: string }): Promise<StorageLocation> {
  const res = await fetch(`${BASE}/api/storage-locations/${id}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Failed to update location");
  return json;
}

async function deleteStorageLocation(id: number): Promise<void> {
  const res = await fetch(`${BASE}/api/storage-locations/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error((json as { error?: string }).error ?? "Failed to delete location");
  }
}

async function fetchStockControl(): Promise<StockControlData> {
  const res = await fetch(`${BASE}/api/stock-control`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch stock control data");
  return res.json();
}

function ZoneIcon({ zone, className }: { zone: string; className?: string }) {
  if (zone === "freezer") return <Snowflake className={className} />;
  if (zone === "fridge") return <Thermometer className={className} />;
  return <Package className={className} />;
}

function zoneColors(zone: string) {
  if (zone === "freezer")
    return { icon: "text-blue-500", bg: "bg-blue-500/10", ring: "ring-blue-400/60", activeBg: "bg-blue-500/15" };
  if (zone === "fridge")
    return { icon: "text-cyan-500", bg: "bg-cyan-500/10", ring: "ring-cyan-400/60", activeBg: "bg-cyan-500/15" };
  return { icon: "text-amber-500", bg: "bg-amber-500/10", ring: "ring-amber-400/60", activeBg: "bg-amber-500/15" };
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-20 text-muted-foreground gap-3">
      <Package className="w-12 h-12 opacity-15" />
      <p className="text-sm">No stock recorded for {label}</p>
    </div>
  );
}

function FocusPanel({ location }: { location: StockLocation }) {
  const colors = zoneColors(location.zone);
  const totalQty = location.items.reduce((s, i) => s + i.qty, 0);
  const maxQty = location.items[0]?.qty ?? 1;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-5 border-b border-border">
        <div className={cn("p-3 rounded-xl", colors.bg)}>
          <ZoneIcon zone={location.zone} className={cn("w-5 h-5", colors.icon)} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-display font-bold text-xl leading-tight">{location.label}</h2>
          <p className="text-xs text-muted-foreground capitalize mt-0.5">{location.zone} storage</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-3xl font-display font-bold tabular-nums leading-none">
            {Math.round(totalQty).toLocaleString()}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {location.items.length} {location.items.length === 1 ? "item" : "items"}
          </p>
        </div>
      </div>

      {/* Item list */}
      <div className="flex-1 overflow-y-auto">
        {location.items.length === 0 ? (
          <EmptyState label={location.label} />
        ) : (
          <div className="divide-y divide-border/40">
            {location.items.map((item, idx) => {
              const barWidth = Math.max(3, (item.qty / maxQty) * 100);
              const pct = totalQty > 0 ? Math.round((item.qty / totalQty) * 100) : 0;
              return (
                <div key={`${item.type}-${item.id}`} className="px-6 py-4 hover:bg-secondary/30 transition-colors">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-xs font-semibold text-muted-foreground w-5 tabular-nums shrink-0">
                      {idx + 1}
                    </span>
                    <span
                      className="flex-1 font-medium text-sm truncate"
                      style={item.color ? { color: item.color } : undefined}
                    >
                      {item.name}
                    </span>
                    <span className="text-sm font-bold tabular-nums shrink-0">
                      {Math.round(item.qty).toLocaleString()}
                      <span className="text-xs font-normal text-muted-foreground ml-1">{item.unit}</span>
                    </span>
                    <span className="text-xs text-muted-foreground w-9 text-right shrink-0">{pct}%</span>
                  </div>
                  <div className="ml-8 h-2 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${barWidth}%`,
                        background: item.color ?? "hsl(var(--primary))",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const ZONE_OPTIONS = [
  { value: "fridge", label: "Fridge" },
  { value: "freezer", label: "Freezer" },
  { value: "ambient", label: "Ambient" },
];

export default function StockControl() {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["stock-control"],
    queryFn: fetchStockControl,
    staleTime: 2 * 60 * 1000,
  });

  const [selectedKey, setSelectedKey] = useState<string>("production_fridge");
  const [managing, setManaging] = useState(false);
  const [addingLoc, setAddingLoc] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", zone: "fridge" });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ name: "", zone: "fridge" });
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["storage-locations"] });
    queryClient.invalidateQueries({ queryKey: ["stock-control"] });
  };

  const createMutation = useMutation({
    mutationFn: createStorageLocation,
    onSuccess: () => { invalidate(); setAddingLoc(false); setAddForm({ name: "", zone: "fridge" }); setMutationError(null); },
    onError: (err: unknown) => setMutationError(err instanceof Error ? err.message : String(err)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: number; name: string; zone: string }) => updateStorageLocation(id, data),
    onSuccess: () => { invalidate(); setEditingId(null); setMutationError(null); },
    onError: (err: unknown) => setMutationError(err instanceof Error ? err.message : String(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteStorageLocation,
    onSuccess: () => { invalidate(); setDeleteId(null); setMutationError(null); },
    onError: (err: unknown) => setMutationError(err instanceof Error ? err.message : String(err)),
  });

  // When data loads, ensure selected key is valid; keep production_fridge as default
  useEffect(() => {
    if (!data) return;
    const keys = data.locations.map(l => l.key);
    if (!keys.includes(selectedKey)) {
      setSelectedKey(keys[0] ?? "production_fridge");
    }
  }, [data]);

  const selectedLocation = data?.locations.find(l => l.key === selectedKey) ?? null;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] -mt-0">
      <div className="px-6 pt-6 pb-0 flex-shrink-0">
        <PageHeader
          title="Stock Control"
          description="Current stock levels across all storage locations"
          action={
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-2 hover:bg-secondary transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
              Refresh
            </button>
          }
        />
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <RefreshCw className="w-6 h-6 animate-spin mr-2" />
          <span className="text-sm">Loading stock levels…</span>
        </div>
      ) : error ? (
        <div className="m-6 glass-panel rounded-2xl p-8 text-center text-destructive text-sm">
          Failed to load stock data. Please refresh and try again.
        </div>
      ) : (
        <div className="flex flex-1 gap-4 px-6 pb-6 pt-4 overflow-hidden min-h-0">

          {/* ── LEFT — location list ─────────────────────────────── */}
          <div className="w-64 xl:w-72 flex-shrink-0 glass-panel rounded-2xl overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Locations</p>
              <div className="flex items-center gap-1">
                {managing && (
                  <button
                    onClick={() => { setAddingLoc(true); setEditingId(null); setDeleteId(null); setMutationError(null); }}
                    className="p-1.5 text-primary hover:bg-primary/10 rounded-lg transition-colors"
                    title="Add location"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => { setManaging(m => !m); setAddingLoc(false); setEditingId(null); setDeleteId(null); setMutationError(null); }}
                  className={cn("p-1.5 rounded-lg transition-colors", managing ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50")}
                  title={managing ? "Done managing" : "Manage locations"}
                >
                  <Settings2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <nav className="flex-1 overflow-y-auto py-1.5">
              {/* Add location form */}
              {managing && addingLoc && (
                <div className="px-3 py-3 border-b border-border/60 space-y-2">
                  <p className="text-xs font-semibold text-primary">New Location</p>
                  <input
                    autoFocus
                    className="w-full px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder="Location name"
                    value={addForm.name}
                    onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                    onKeyDown={e => { if (e.key === "Escape") { setAddingLoc(false); } }}
                  />
                  <select
                    className="w-full px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none"
                    value={addForm.zone}
                    onChange={e => setAddForm(f => ({ ...f, zone: e.target.value }))}
                  >
                    {ZONE_OPTIONS.map(z => <option key={z.value} value={z.value}>{z.label}</option>)}
                  </select>
                  {mutationError && <p className="text-xs text-destructive">{mutationError}</p>}
                  <div className="flex gap-1.5 justify-end">
                    <button onClick={() => { setAddingLoc(false); setMutationError(null); }} className="px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg">Cancel</button>
                    <button
                      disabled={!addForm.name.trim() || createMutation.isPending}
                      onClick={() => createMutation.mutate(addForm)}
                      className="px-2.5 py-1 text-xs bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"
                    >
                      {createMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                      Save
                    </button>
                  </div>
                </div>
              )}

              {data?.locations.map((loc) => {
                const colors = zoneColors(loc.zone);
                const qty = Math.round(loc.items.reduce((s, i) => s + i.qty, 0));
                const isSelected = loc.key === selectedKey;
                const isUserLoc = loc.key.startsWith("sl_");
                const locDbId = loc.dbId;
                const isEditing = managing && editingId !== null && editingId === locDbId;
                const isDeleting = managing && deleteId !== null && deleteId === locDbId;

                if (isEditing) {
                  return (
                    <div key={loc.key} className="px-3 py-3 border-b border-border/40 space-y-2 bg-secondary/20">
                      <input
                        autoFocus
                        className="w-full px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                        value={editForm.name}
                        onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                        onKeyDown={e => { if (e.key === "Escape") setEditingId(null); }}
                      />
                      <select
                        className="w-full px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none"
                        value={editForm.zone}
                        onChange={e => setEditForm(f => ({ ...f, zone: e.target.value }))}
                      >
                        {ZONE_OPTIONS.map(z => <option key={z.value} value={z.value}>{z.label}</option>)}
                      </select>
                      {mutationError && <p className="text-xs text-destructive">{mutationError}</p>}
                      <div className="flex gap-1.5 justify-end">
                        <button onClick={() => { setEditingId(null); setMutationError(null); }} className="px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg">Cancel</button>
                        <button
                          disabled={!editForm.name.trim() || updateMutation.isPending}
                          onClick={() => updateMutation.mutate({ id: editingId!, ...editForm })}
                          className="px-2.5 py-1 text-xs bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"
                        >
                          {updateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                          Save
                        </button>
                      </div>
                    </div>
                  );
                }

                if (isDeleting) {
                  return (
                    <div key={loc.key} className="px-3 py-3 border-b border-border/40 bg-destructive/5">
                      <p className="text-xs font-medium text-destructive mb-1">Delete "{loc.label}"?</p>
                      <p className="text-xs text-muted-foreground mb-2">This cannot be undone.</p>
                      {mutationError && <p className="text-xs text-destructive mb-1">{mutationError}</p>}
                      <div className="flex gap-1.5">
                        <button onClick={() => { setDeleteId(null); setMutationError(null); }} className="flex-1 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg">Cancel</button>
                        <button
                          disabled={deleteMutation.isPending}
                          onClick={() => deleteMutation.mutate(locDbId!)}
                          className="flex-1 px-2.5 py-1 text-xs bg-destructive text-destructive-foreground rounded-lg font-medium hover:bg-destructive/90 disabled:opacity-50 flex items-center justify-center gap-1"
                        >
                          {deleteMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={loc.key}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3 text-left transition-all duration-150 relative group",
                      isSelected
                        ? "bg-secondary/80 text-foreground"
                        : "hover:bg-secondary/40 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {isSelected && (
                      <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r-full bg-primary" />
                    )}
                    <button
                      onClick={() => !managing && setSelectedKey(loc.key)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    >
                      <div className={cn("p-2 rounded-lg flex-shrink-0", isSelected ? colors.bg : "bg-secondary/60")}>
                        <ZoneIcon zone={loc.zone} className={cn("w-4 h-4", isSelected ? colors.icon : "text-muted-foreground")} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn("text-sm font-medium leading-tight truncate", isSelected && "text-foreground")}>
                          {loc.label}
                        </p>
                        <p className="text-xs text-muted-foreground capitalize">{loc.zone}</p>
                      </div>
                      {!managing && (
                        <div className="shrink-0 text-right">
                          <p className={cn("text-base font-display font-bold tabular-nums leading-tight", isSelected ? "text-foreground" : "text-muted-foreground")}>
                            {qty.toLocaleString()}
                          </p>
                          {loc.items.length > 0 && (
                            <p className="text-xs text-muted-foreground">{loc.items.length} item{loc.items.length !== 1 ? "s" : ""}</p>
                          )}
                        </div>
                      )}
                      {!managing && isSelected && <ChevronRight className="w-3.5 h-3.5 text-primary shrink-0" />}
                    </button>

                    {managing && (
                      <div className="flex items-center gap-1 shrink-0">
                        {locDbId !== null ? (
                          <>
                            <button
                              onClick={() => { setEditingId(locDbId); setEditForm({ name: loc.label, zone: loc.zone }); setAddingLoc(false); setDeleteId(null); setMutationError(null); }}
                              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary/60 rounded-lg transition-colors"
                              title="Edit"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            {isUserLoc && (
                              <button
                                onClick={() => { setDeleteId(locDbId); setEditingId(null); setAddingLoc(false); setMutationError(null); }}
                                className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                                title="Delete"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </>
                        ) : (
                          <span title="No database record for this location" className="p-1.5 text-muted-foreground/40">
                            <Lock className="w-3.5 h-3.5" />
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>
          </div>

          {/* ── RIGHT — focus panel ──────────────────────────────── */}
          <div className="flex-1 glass-panel rounded-2xl overflow-hidden min-w-0">
            {selectedLocation ? (
              <FocusPanel location={selectedLocation} />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Select a location to view its stock
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
