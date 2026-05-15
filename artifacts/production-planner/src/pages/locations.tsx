import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { MapPin, Plus, Edit2, Trash2, Loader2, AlertCircle, Save, X, RefreshCw, Search, PackageSearch, Barcode } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type ZoneValue = "fridge" | "freezer" | "ambient";

interface SkuLocation {
  sku: string;
  zone: ZoneValue;
  locationLabel: string;
  updatedAt: string;
}

interface RecentSku {
  sku: string;
  title: string;
  orderCount: number;
  location: SkuLocation | null;
}

const ZONES: { value: ZoneValue; label: string; color: string }[] = [
  { value: "fridge", label: "Fridge", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200" },
  { value: "freezer", label: "Freezer", color: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200" },
  { value: "ambient", label: "Ambient", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
];

const today = new Date().toISOString().slice(0, 10);

async function fetchLocations(): Promise<SkuLocation[]> {
  const res = await fetch(`${BASE}/api/fulfilment/sku-locations`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch locations");
  return res.json();
}

async function fetchRecentSkus(tag?: string): Promise<RecentSku[]> {
  const url = tag
    ? `${BASE}/api/fulfilment/sku-locations/recent-skus?tag=${encodeURIComponent(tag)}`
    : `${BASE}/api/fulfilment/sku-locations/recent-skus`;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed to fetch recent SKUs");
  }
  return res.json();
}

async function upsertLocation(sku: string, zone: string, locationLabel: string): Promise<SkuLocation> {
  const res = await fetch(`${BASE}/api/fulfilment/sku-locations/${encodeURIComponent(sku)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ zone, locationLabel }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to save location");
  return data;
}

async function deleteLocation(sku: string): Promise<void> {
  const res = await fetch(`${BASE}/api/fulfilment/sku-locations/${encodeURIComponent(sku)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to delete location");
}

interface BarcodeRow {
  sku: string;
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

async function fetchBarcodes(): Promise<BarcodeRow[]> {
  const res = await fetch(`${BASE}/api/fulfilment/sku-barcodes`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch barcodes");
  return res.json();
}

async function syncBarcodes(): Promise<BarcodeSyncResult> {
  const res = await fetch(`${BASE}/api/fulfilment/sync-barcodes`, {
    method: "POST",
    credentials: "include",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to sync barcodes");
  return data;
}

export default function Locations() {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editingSku, setEditingSku] = useState<string | null>(null);
  const [form, setForm] = useState({ sku: "", zone: "fridge" as ZoneValue, locationLabel: "" });
  const [editForm, setEditForm] = useState({ zone: "fridge" as ZoneValue, locationLabel: "" });

  // Recent order SKU discovery — loads broadly by default (no tag), with optional tag filter
  const [scanTag, setScanTag] = useState(today);
  // null = broad recent orders; string = filtered to specific dispatch tag
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [tagFilterActive, setTagFilterActive] = useState(false);
  const [quickAssignSku, setQuickAssignSku] = useState<string | null>(null);
  const [quickForm, setQuickForm] = useState({ zone: "ambient" as ZoneValue, locationLabel: "" });

  const { data: locations, isLoading, error, refetch } = useQuery({
    queryKey: ["sku-locations"],
    queryFn: fetchLocations,
    staleTime: 5 * 60 * 1000,
  });

  const { data: recentSkus, isLoading: recentLoading, error: recentError } = useQuery({
    queryKey: ["sku-locations-recent", tagFilterActive ? activeTag : null],
    queryFn: () => fetchRecentSkus(tagFilterActive && activeTag ? activeTag : undefined),
    staleTime: 2 * 60 * 1000,
  });

  const { data: barcodes } = useQuery({
    queryKey: ["sku-barcodes"],
    queryFn: fetchBarcodes,
    staleTime: 5 * 60 * 1000,
  });

  const [syncResult, setSyncResult] = useState<BarcodeSyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const syncBarcodesMutation = useMutation({
    mutationFn: syncBarcodes,
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

  const upsertMutation = useMutation({
    mutationFn: ({ sku, zone, locationLabel }: { sku: string; zone: string; locationLabel: string }) =>
      upsertLocation(sku, zone, locationLabel),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sku-locations"] });
      queryClient.invalidateQueries({ queryKey: ["sku-locations-recent"] });
      setAdding(false);
      setEditingSku(null);
      setQuickAssignSku(null);
      setForm({ sku: "", zone: "fridge", locationLabel: "" });
      setQuickForm({ zone: "ambient", locationLabel: "" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteLocation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sku-locations"] });
      queryClient.invalidateQueries({ queryKey: ["sku-locations-recent"] });
    },
  });

  function startEdit(loc: SkuLocation) {
    setEditingSku(loc.sku);
    setEditForm({ zone: loc.zone, locationLabel: loc.locationLabel });
    setAdding(false);
    setQuickAssignSku(null);
  }

  function cancelEdit() {
    setEditingSku(null);
  }

  function startQuickAssign(sku: string, title: string) {
    setQuickAssignSku(sku);
    setQuickForm({ zone: "ambient", locationLabel: "" });
    setEditingSku(null);
    setAdding(false);
  }

  const inputCls = "px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

  const grouped = ZONES.map(z => ({
    ...z,
    locations: (locations ?? []).filter(l => l.zone === z.value).sort((a, b) => a.locationLabel.localeCompare(b.locationLabel)),
  }));

  const unassignedRecent = recentSkus?.filter(s => !s.location) ?? [];
  const assignedRecent = recentSkus?.filter(s => s.location) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bin Locations"
        description="Assign bin locations to product SKUs for the fulfilment picking list."
      />

      {/* Shopify Barcode Sync */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Barcode className="w-4 h-4 text-primary" /> Shopify Barcodes
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {barcodes?.length ?? 0} SKU{(barcodes?.length ?? 0) !== 1 ? "s" : ""} have a barcode synced from Shopify.
              Re-run after editing variant barcodes in Shopify admin.
            </p>
          </div>
          <button
            onClick={() => syncBarcodesMutation.mutate()}
            disabled={syncBarcodesMutation.isPending}
            className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5 flex-shrink-0"
          >
            {syncBarcodesMutation.isPending
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <RefreshCw className="w-3.5 h-3.5" />}
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

      {/* Recent Order SKU Inventory */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <PackageSearch className="w-4 h-4 text-primary" /> SKUs from Recent Orders
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {tagFilterActive && activeTag
                ? `Showing SKUs from tag "${activeTag}". `
                : "Showing all SKUs from the last 14 days of orders. "}
              <button onClick={() => setTagFilterActive(f => !f)} className="underline hover:no-underline text-primary">
                {tagFilterActive ? "Clear tag filter" : "Filter by dispatch tag"}
              </button>
            </p>
          </div>
        </div>

        {tagFilterActive && (
          <div className="flex gap-2">
            <input
              className={inputCls + " flex-1 font-mono"}
              placeholder="e.g. 2026-03-21"
              value={scanTag}
              onChange={e => setScanTag(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") { setActiveTag(scanTag); }
              }}
            />
            <button
              onClick={() => setActiveTag(scanTag)}
              disabled={!scanTag.trim()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
            >
              <Search className="w-4 h-4" /> Load
            </button>
          </div>
        )}

        {(
          recentLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : recentError ? (
            <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {(recentError as Error).message}
            </div>
          ) : !recentSkus?.length ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {tagFilterActive && activeTag ? `No orders found with tag "${activeTag}".` : "No recent unfulfilled orders found."}
            </p>
          ) : (
            <div className="space-y-3">
              {unassignedRecent.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 mb-2 uppercase tracking-wide">
                    {unassignedRecent.length} Unassigned SKU{unassignedRecent.length !== 1 ? "s" : ""}
                  </p>
                  <div className="space-y-2">
                    {unassignedRecent.map(s => (
                      <div key={s.sku}>
                        <div className="flex items-center gap-3 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl">
                          <div className="flex-1 min-w-0">
                            <p className="font-mono text-sm font-medium">{s.sku}</p>
                            <p className="text-xs text-muted-foreground truncate">{s.title}</p>
                          </div>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">{s.orderCount} order{s.orderCount !== 1 ? "s" : ""}</span>
                          <button
                            onClick={() => startQuickAssign(s.sku, s.title)}
                            className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 flex items-center gap-1 flex-shrink-0"
                          >
                            <Plus className="w-3 h-3" /> Assign
                          </button>
                        </div>
                        {quickAssignSku === s.sku && (
                          <div className="mt-2 p-3 bg-secondary/20 rounded-xl border border-border space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-xs font-medium mb-1 block text-muted-foreground">Zone</label>
                                <select
                                  className={inputCls + " w-full"}
                                  value={quickForm.zone}
                                  onChange={e => setQuickForm(f => ({ ...f, zone: e.target.value as ZoneValue }))}
                                >
                                  {ZONES.map(z => <option key={z.value} value={z.value}>{z.label}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className="text-xs font-medium mb-1 block text-muted-foreground">Location Label</label>
                                <input
                                  className={inputCls + " w-full"}
                                  placeholder="e.g. Fridge Door 3"
                                  value={quickForm.locationLabel}
                                  autoFocus
                                  onChange={e => setQuickForm(f => ({ ...f, locationLabel: e.target.value }))}
                                  onKeyDown={e => e.key === "Enter" && quickForm.locationLabel && upsertMutation.mutate({ sku: s.sku, ...quickForm })}
                                />
                              </div>
                            </div>
                            <div className="flex gap-2 justify-end">
                              <button
                                onClick={() => setQuickAssignSku(null)}
                                className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg"
                              >Cancel</button>
                              <button
                                onClick={() => upsertMutation.mutate({ sku: s.sku, ...quickForm })}
                                disabled={!quickForm.locationLabel || upsertMutation.isPending}
                                className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"
                              >
                                {upsertMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                Save
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {assignedRecent.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-green-600 dark:text-green-400 mb-2 uppercase tracking-wide">
                    {assignedRecent.length} Assigned
                  </p>
                  <div className="space-y-1">
                    {assignedRecent.map(s => {
                      const zone = ZONES.find(z => z.value === s.location?.zone);
                      return (
                        <div key={s.sku} className="flex items-center gap-3 px-3 py-2 bg-secondary/20 rounded-lg text-sm">
                          <span className="font-mono font-medium flex-1">{s.sku}</span>
                          {zone && <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${zone.color}`}>{zone.label}</span>}
                          <span className="text-muted-foreground flex items-center gap-1">
                            <MapPin className="w-3 h-3" />{s.location?.locationLabel}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {unassignedRecent.length === 0 && (
                <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg text-green-700 dark:text-green-300 text-sm">
                  All {recentSkus.length} SKU{recentSkus.length !== 1 ? "s" : ""} have bin locations assigned.
                </div>
              )}
            </div>
          )
        )}
      </div>

      {/* All Assigned Locations */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {locations?.length ?? 0} SKU{(locations?.length ?? 0) !== 1 ? "s" : ""} assigned
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => refetch()}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          </button>
          {!adding && (
            <button
              onClick={() => { setAdding(true); setEditingSku(null); setQuickAssignSku(null); }}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" /> Add Location
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          {(error as Error).message}
        </div>
      )}

      {adding && (
        <div className="glass-panel p-5 rounded-2xl border border-primary/30 space-y-4">
          <h3 className="text-sm font-semibold text-primary">New SKU Location</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block text-muted-foreground">SKU *</label>
              <input
                className={inputCls + " w-full font-mono"}
                placeholder="e.g. TCK-CAL-001"
                value={form.sku}
                onChange={e => setForm(f => ({ ...f, sku: e.target.value }))}
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block text-muted-foreground">Zone *</label>
              <select
                className={inputCls + " w-full"}
                value={form.zone}
                onChange={e => setForm(f => ({ ...f, zone: e.target.value as ZoneValue }))}
              >
                {ZONES.map(z => (
                  <option key={z.value} value={z.value}>{z.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block text-muted-foreground">Location Label *</label>
              <input
                className={inputCls + " w-full"}
                placeholder="e.g. Fridge Door 3"
                value={form.locationLabel}
                onChange={e => setForm(f => ({ ...f, locationLabel: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setAdding(false); setForm({ sku: "", zone: "fridge", locationLabel: "" }); }}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground rounded-lg border border-border transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => upsertMutation.mutate(form)}
              disabled={!form.sku || !form.locationLabel || upsertMutation.isPending}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
            >
              {upsertMutation.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
              Save Location
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (locations ?? []).length === 0 && !adding ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
          <MapPin className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No locations assigned yet</p>
          <p className="text-sm mt-1">Add bin locations to SKUs so pickers know where to find each product.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.filter(g => g.locations.length > 0).map(group => (
            <div key={group.value}>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${group.color}`}>{group.label}</span>
                <span className="text-muted-foreground font-normal">({group.locations.length})</span>
              </h3>
              <div className="rounded-2xl border border-border bg-card overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/30 text-muted-foreground text-xs">
                    <tr>
                      <th className="px-5 py-3 font-medium text-left">SKU</th>
                      <th className="px-5 py-3 font-medium text-left">Location</th>
                      <th className="px-5 py-3 font-medium text-left">Zone</th>
                      <th className="px-5 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {group.locations.map(loc => (
                      <tr key={loc.sku} className="hover:bg-secondary/10 transition-colors">
                        {editingSku === loc.sku ? (
                          <>
                            <td className="px-5 py-3 font-mono text-sm">{loc.sku}</td>
                            <td className="px-4 py-2.5">
                              <input
                                className={inputCls + " w-full"}
                                value={editForm.locationLabel}
                                onChange={e => setEditForm(f => ({ ...f, locationLabel: e.target.value }))}
                                autoFocus
                                onKeyDown={e => e.key === "Enter" && upsertMutation.mutate({ sku: loc.sku, ...editForm })}
                              />
                            </td>
                            <td className="px-4 py-2.5">
                              <select
                                className={inputCls}
                                value={editForm.zone}
                                onChange={e => setEditForm(f => ({ ...f, zone: e.target.value as ZoneValue }))}
                              >
                                {ZONES.map(z => (
                                  <option key={z.value} value={z.value}>{z.label}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  onClick={() => upsertMutation.mutate({ sku: loc.sku, ...editForm })}
                                  disabled={!editForm.locationLabel || upsertMutation.isPending}
                                  className="p-2 text-primary hover:bg-primary/10 rounded-lg transition-colors"
                                  title="Save"
                                >
                                  {upsertMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                </button>
                                <button
                                  onClick={cancelEdit}
                                  className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors"
                                  title="Cancel"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-5 py-3.5 font-mono text-sm">{loc.sku}</td>
                            <td className="px-5 py-3.5 font-medium">
                              <span className="flex items-center gap-1.5">
                                <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                                {loc.locationLabel}
                              </span>
                            </td>
                            <td className="px-5 py-3.5">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${group.color}`}>
                                {group.label}
                              </span>
                            </td>
                            <td className="px-5 py-3.5 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  onClick={() => startEdit(loc)}
                                  className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors"
                                  title="Edit"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => {
                                    if (confirm(`Delete location for SKU "${loc.sku}"?`)) {
                                      deleteMutation.mutate(loc.sku);
                                    }
                                  }}
                                  className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                                  title="Delete"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
