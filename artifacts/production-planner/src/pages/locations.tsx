import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { MapPin, Plus, Edit2, Trash2, Loader2, AlertCircle, Save, X, RefreshCw } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface SkuLocation {
  sku: string;
  zone: "fridge" | "freezer" | "ambient";
  locationLabel: string;
  updatedAt: string;
}

const ZONES: { value: "fridge" | "freezer" | "ambient"; label: string; color: string }[] = [
  { value: "fridge", label: "Fridge", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200" },
  { value: "freezer", label: "Freezer", color: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200" },
  { value: "ambient", label: "Ambient", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
];

async function fetchLocations(): Promise<SkuLocation[]> {
  const res = await fetch(`${BASE}/api/fulfilment/sku-locations`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch locations");
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

export default function Locations() {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editingSku, setEditingSku] = useState<string | null>(null);
  const [form, setForm] = useState({ sku: "", zone: "fridge" as "fridge" | "freezer" | "ambient", locationLabel: "" });
  const [editForm, setEditForm] = useState({ zone: "fridge" as "fridge" | "freezer" | "ambient", locationLabel: "" });

  const { data: locations, isLoading, error, refetch } = useQuery({
    queryKey: ["sku-locations"],
    queryFn: fetchLocations,
    staleTime: 5 * 60 * 1000,
  });

  const upsertMutation = useMutation({
    mutationFn: ({ sku, zone, locationLabel }: { sku: string; zone: string; locationLabel: string }) =>
      upsertLocation(sku, zone, locationLabel),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sku-locations"] });
      setAdding(false);
      setEditingSku(null);
      setForm({ sku: "", zone: "fridge", locationLabel: "" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteLocation,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sku-locations"] }),
  });

  function startEdit(loc: SkuLocation) {
    setEditingSku(loc.sku);
    setEditForm({ zone: loc.zone, locationLabel: loc.locationLabel });
    setAdding(false);
  }

  function cancelEdit() {
    setEditingSku(null);
  }

  const inputCls = "px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

  const grouped = ZONES.map(z => ({
    ...z,
    locations: (locations ?? []).filter(l => l.zone === z.value).sort((a, b) => a.locationLabel.localeCompare(b.locationLabel)),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Location Management"
        description="Assign bin locations to product SKUs for the picking list."
      />

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
              onClick={() => { setAdding(true); setEditingSku(null); }}
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
                onChange={e => setForm(f => ({ ...f, zone: e.target.value as any }))}
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
                                onChange={e => setEditForm(f => ({ ...f, zone: e.target.value as any }))}
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
