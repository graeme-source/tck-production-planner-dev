import React, { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BookOpen, X, Loader2, Plus, Upload, Trash2, ZoomIn, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { STATIONS } from "@/pages/station/shared/constants";

interface StandardSOP {
  id: number;
  title: string;
  stations: string[];
  imageUrl: string;
  createdAt?: string;
  creatorName?: string | null;
}

const STATION_LABELS: Record<string, string> = {
  main_prep: "Main Prep",
  prep_bases: "Bases & Sauces",
  prep_meat: "Raw Meat Prep",
};
for (const s of STATIONS) STATION_LABELS[s.key] = s.label;

const ALL_STATION_KEYS: string[] = [
  ...STATIONS.map(s => s.key),
  "main_prep",
  "prep_bases",
  "prep_meat",
];

function stationLabel(key: string): string {
  return STATION_LABELS[key] ?? key;
}

export function StandardsSopsDialog({
  open,
  onClose,
  currentStationType,
}: {
  open: boolean;
  onClose: () => void;
  currentStationType?: string | null;
}) {
  const { state } = useAuth();
  const isManagerOrAdmin = state.status === "authenticated" && (state.user.role === "admin" || state.user.role === "manager");

  const [filter, setFilter] = useState<"current" | "all">(currentStationType ? "current" : "all");
  const [items, setItems] = useState<StandardSOP[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewItem, setViewItem] = useState<StandardSOP | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const effectiveStationFilter = filter === "current" ? currentStationType ?? null : null;

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = effectiveStationFilter ? `?station=${encodeURIComponent(effectiveStationFilter)}` : "";
      const resp = await fetch(`/api/standards${params}`, { credentials: "include" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: StandardSOP[] = await resp.json();
      setItems(data);
    } catch (err) {
      console.warn("[Standards] fetch failed:", err);
      toast({ title: "Failed to load standards", variant: "destructive" });
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [effectiveStationFilter]);

  useEffect(() => {
    if (open) fetchList();
  }, [open, fetchList]);

  // Reset filter when opened from a different station.
  useEffect(() => {
    if (open) setFilter(currentStationType ? "current" : "all");
  }, [open, currentStationType]);

  const handleDelete = async (id: number) => {
    if (!window.confirm("Delete this standard?")) return;
    try {
      const resp = await fetch(`/api/standards/${id}`, { method: "DELETE", credentials: "include" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      toast({ title: "Deleted" });
      fetchList();
    } catch (err) {
      toast({ title: "Delete failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 bg-black/60"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
          >
            <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col pointer-events-auto">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <BookOpen className="w-5 h-5 text-primary flex-shrink-0" />
                  <h2 className="font-display font-bold text-xl truncate">Standards & SOPs</h2>
                </div>
                <div className="flex items-center gap-2">
                  {isManagerOrAdmin && (
                    <button
                      onClick={() => setUploadOpen(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90"
                    >
                      <Plus className="w-4 h-4" /> Upload
                    </button>
                  )}
                  <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {currentStationType && (
                <div className="flex items-center gap-1.5 px-5 py-3 border-b border-border flex-shrink-0 text-sm">
                  <Filter className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground mr-1">Show:</span>
                  <div className="inline-flex rounded-lg border border-border bg-background overflow-hidden">
                    <button
                      onClick={() => setFilter("current")}
                      className={cn(
                        "px-3 py-1.5 text-sm font-medium transition-colors",
                        filter === "current"
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
                      )}
                    >
                      {stationLabel(currentStationType)}
                    </button>
                    <button
                      onClick={() => setFilter("all")}
                      className={cn(
                        "px-3 py-1.5 text-sm font-medium transition-colors border-l border-border",
                        filter === "all"
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
                      )}
                    >
                      All stations
                    </button>
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-5">
                {loading && (
                  <div className="flex items-center justify-center py-16 text-muted-foreground">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                )}
                {!loading && items && items.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <BookOpen className="w-12 h-12 text-muted-foreground/40 mb-3" />
                    <p className="font-semibold">No standards yet</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {filter === "current" && currentStationType
                        ? `Nothing is filed against ${stationLabel(currentStationType)} yet.`
                        : "Upload your first standard to get started."}
                    </p>
                  </div>
                )}
                {!loading && items && items.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {items.map(item => (
                      <StandardCard
                        key={item.id}
                        item={item}
                        canDelete={isManagerOrAdmin}
                        onView={() => setViewItem(item)}
                        onDelete={() => handleDelete(item.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}

      {viewItem && (
        <StandardViewer item={viewItem} onClose={() => setViewItem(null)} />
      )}

      {uploadOpen && (
        <UploadDialog
          defaultStation={currentStationType ?? null}
          onClose={() => setUploadOpen(false)}
          onUploaded={() => {
            setUploadOpen(false);
            fetchList();
          }}
        />
      )}
    </AnimatePresence>
  );
}

function StandardCard({
  item,
  canDelete,
  onView,
  onDelete,
}: {
  item: StandardSOP;
  canDelete: boolean;
  onView: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="bg-background border border-border rounded-xl overflow-hidden flex flex-col group">
      <button
        onClick={onView}
        className="relative aspect-[4/3] bg-secondary/40 overflow-hidden flex items-center justify-center"
      >
        <img
          src={item.imageUrl}
          alt={item.title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
        />
        <span className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
          <ZoomIn className="w-8 h-8 text-white drop-shadow" />
        </span>
      </button>
      <div className="p-3 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm leading-tight">{item.title}</p>
          {item.stations.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {item.stations.slice(0, 3).map(s => (
                <span
                  key={s}
                  className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground"
                >
                  {stationLabel(s)}
                </span>
              ))}
              {item.stations.length > 3 && (
                <span className="text-[10px] text-muted-foreground">+{item.stations.length - 3}</span>
              )}
            </div>
          )}
          {item.stations.length === 0 && (
            <span className="text-[10px] px-1.5 py-0.5 mt-1.5 inline-block rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              All stations
            </span>
          )}
        </div>
        {canDelete && (
          <button
            onClick={onDelete}
            title="Delete"
            className="flex-shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function StandardViewer({ item, onClose }: { item: StandardSOP; onClose: () => void }) {
  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] bg-black/80"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        className="fixed inset-0 z-[70] flex items-center justify-center p-4 pointer-events-none"
      >
        <div className="relative max-w-6xl max-h-[92vh] flex flex-col gap-3 pointer-events-auto">
          <div className="flex items-center justify-between gap-3 text-white">
            <h3 className="font-semibold text-lg truncate">{item.title}</h3>
            <button onClick={onClose} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white flex-shrink-0">
              <X className="w-5 h-5" />
            </button>
          </div>
          <img
            src={item.imageUrl}
            alt={item.title}
            className="max-w-full max-h-[82vh] object-contain rounded-lg shadow-2xl bg-white"
          />
        </div>
      </motion.div>
    </>
  );
}

function UploadDialog({
  defaultStation,
  onClose,
  onUploaded,
}: {
  defaultStation: string | null;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [stations, setStations] = useState<Set<string>>(() => new Set(defaultStation ? [defaultStation] : []));
  const [saving, setSaving] = useState(false);

  const sortedStations = useMemo(() => {
    const seen = new Set<string>();
    const combined: string[] = [];
    for (const s of ALL_STATION_KEYS) {
      if (!seen.has(s)) { seen.add(s); combined.push(s); }
    }
    return combined;
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(f ? URL.createObjectURL(f) : null);
  };

  const toggleStation = (key: string) => {
    setStations(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const submit = async () => {
    if (!file || !title.trim()) {
      toast({ title: "Add a title and pick an image", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const form = new FormData();
      form.append("image", file);
      form.append("title", title.trim());
      form.append("stations", JSON.stringify(Array.from(stations)));
      const resp = await fetch("/api/standards", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${resp.status}`);
      }
      toast({ title: "Standard uploaded" });
      onUploaded();
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] bg-black/70"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 6 }}
        className="fixed inset-0 z-[70] flex items-center justify-center p-4 pointer-events-none"
      >
        <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col pointer-events-auto">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
            <h3 className="font-semibold text-lg">New Standard / SOP</h3>
            <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <div>
              <label className="text-sm font-medium block mb-1.5">Headline</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Margherita Filling — 80 g per pocket"
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            <div>
              <label className="text-sm font-medium block mb-1.5">Stations</label>
              <p className="text-xs text-muted-foreground mb-2">
                Pick the stations where this belongs. Leave empty to show on every station.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {sortedStations.map(s => {
                  const selected = stations.has(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleStation(s)}
                      className={cn(
                        "text-xs px-2.5 py-1 rounded-full border transition-colors",
                        selected
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground border-border hover:text-foreground",
                      )}
                    >
                      {stationLabel(s)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium block mb-1.5">Image</label>
              <label className="flex flex-col items-center justify-center gap-2 px-4 py-8 border-2 border-dashed border-border rounded-xl cursor-pointer hover:bg-secondary/30 transition-colors">
                {preview ? (
                  <img src={preview} alt="preview" className="max-h-48 rounded-lg object-contain" />
                ) : (
                  <>
                    <Upload className="w-6 h-6 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Tap to select an image (JPEG, PNG, WebP, GIF)</span>
                  </>
                )}
                <input type="file" accept="image/*" className="hidden" onChange={onFileChange} />
              </label>
              {file && (
                <p className="text-xs text-muted-foreground mt-1.5">
                  {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border flex-shrink-0">
            <button onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-secondary">
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={saving || !file || !title.trim()}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {saving ? "Uploading…" : "Upload"}
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );
}
