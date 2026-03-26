import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Lightbulb, AlertTriangle, CheckCircle, Loader2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface ImprovementSummary {
  id: number;
  title: string;
  station: string;
  submittedByName: string | null;
  progressStatus: string;
  createdAt: string;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const STATIONS = [
  { key: "dough_prep", label: "Dough Prep" },
  { key: "dough_sheeting", label: "Dough Sheeting" },
  { key: "prep", label: "Prep" },
  { key: "main_prep", label: "Main Prep" },
  { key: "prep_bases", label: "Bases & Sauces" },
  { key: "prep_meat", label: "Raw Meat Prep" },
  { key: "mixing", label: "Mixing & Cooking" },
  { key: "building_1", label: "Building Table 1" },
  { key: "building_2", label: "Building Table 2" },
  { key: "ovens", label: "Ovens" },
  { key: "wrapping", label: "Wrapping" },
  { key: "packing", label: "Packing" },
  { key: "general", label: "General / Other" },
];

const ANDON_CATEGORIES = [
  { key: "equipment", label: "Equipment" },
  { key: "safety", label: "Safety" },
  { key: "production", label: "Production" },
  { key: "product", label: "Product" },
  { key: "other", label: "Other" },
];

const STATUS_LABELS: Record<string, string> = {
  submitted_for_review: "Submitted for Review",
  approved: "Approved",
  testing: "Testing",
  complete: "Complete",
};

const TIER_LABELS: Record<string, string> = {
  minor: "Minor",
  medium: "Medium",
  major: "Major",
};

type Tab = "improvements" | "andon";

interface ReportModalProps {
  open: boolean;
  onClose: () => void;
  defaultStation?: string;
}

export function ReportModal({ open, onClose, defaultStation }: ReportModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>("improvements");

  const [impTitle, setImpTitle] = useState("");
  const [impDescription, setImpDescription] = useState("");
  const [impStation, setImpStation] = useState(defaultStation || "general");
  const [impSubmitting, setImpSubmitting] = useState(false);
  const [impSuccess, setImpSuccess] = useState(false);
  const [impError, setImpError] = useState<string | null>(null);

  const [andonCategory, setAndonCategory] = useState("equipment");
  const [andonSeverity, setAndonSeverity] = useState<"yellow" | "red">("yellow");
  const [andonDescription, setAndonDescription] = useState("");
  const [andonStation, setAndonStation] = useState(defaultStation || "general");
  const [andonSubmitting, setAndonSubmitting] = useState(false);
  const [andonSuccess, setAndonSuccess] = useState(false);
  const [andonError, setAndonError] = useState<string | null>(null);

  const [recentImprovements, setRecentImprovements] = useState<ImprovementSummary[]>([]);
  const [impListLoading, setImpListLoading] = useState(false);

  useEffect(() => {
    if (open && activeTab === "improvements") {
      loadRecentImprovements();
    }
  }, [open, activeTab]);

  async function loadRecentImprovements() {
    setImpListLoading(true);
    try {
      const res = await fetch(`${BASE}/api/improvements`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setRecentImprovements(data.slice(0, 10));
      }
    } catch {}
    setImpListLoading(false);
  }

  async function handleImprovementSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!impTitle.trim() || !impDescription.trim()) return;
    setImpSubmitting(true);
    setImpError(null);
    try {
      const res = await fetch(`${BASE}/api/improvements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ title: impTitle.trim(), description: impDescription.trim(), station: impStation }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setImpError(data.error ?? "Failed to submit improvement");
      } else {
        setImpSuccess(true);
        setImpTitle("");
        setImpDescription("");
        loadRecentImprovements();
        setTimeout(() => setImpSuccess(false), 3000);
      }
    } catch {
      setImpError("Network error, please try again");
    }
    setImpSubmitting(false);
  }

  async function handleAndonSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAndonSubmitting(true);
    setAndonError(null);
    try {
      const res = await fetch(`${BASE}/api/andon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          category: andonCategory,
          severity: andonSeverity,
          description: andonDescription.trim() || null,
          station: andonStation,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setAndonError(data.error ?? "Failed to report issue");
      } else {
        setAndonSuccess(true);
        setAndonDescription("");
        setTimeout(() => { setAndonSuccess(false); onClose(); }, 2000);
      }
    } catch {
      setAndonError("Network error, please try again");
    }
    setAndonSubmitting(false);
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="report-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[100] bg-black/50"
            onClick={onClose}
          />
          <motion.div
            key="report-modal"
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-x-4 bottom-4 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 z-[101] w-auto md:w-[560px] bg-card border border-border rounded-2xl shadow-2xl flex flex-col max-h-[90vh]"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
              <h2 className="font-bold text-lg">Report</h2>
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center gap-1 p-3 border-b border-border bg-secondary/20 flex-shrink-0">
              <button
                onClick={() => setActiveTab("improvements")}
                className={cn(
                  "flex items-center gap-2 flex-1 justify-center px-3 py-2 rounded-lg text-sm font-medium transition-all",
                  activeTab === "improvements"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Lightbulb className="w-4 h-4" />
                Improvements
              </button>
              <button
                onClick={() => setActiveTab("andon")}
                className={cn(
                  "flex items-center gap-2 flex-1 justify-center px-3 py-2 rounded-lg text-sm font-medium transition-all",
                  activeTab === "andon"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <AlertTriangle className="w-4 h-4" />
                Report an Issue
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {activeTab === "improvements" && (
                <div className="p-5 space-y-5">
                  <form onSubmit={handleImprovementSubmit} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-1.5">Title <span className="text-destructive">*</span></label>
                      <input
                        type="text"
                        value={impTitle}
                        onChange={e => setImpTitle(e.target.value)}
                        placeholder="Brief summary of the improvement idea"
                        className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1.5">Description <span className="text-destructive">*</span></label>
                      <textarea
                        value={impDescription}
                        onChange={e => setImpDescription(e.target.value)}
                        placeholder="Describe the improvement and why it matters..."
                        rows={3}
                        className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1.5">Station</label>
                      <select
                        value={impStation}
                        onChange={e => setImpStation(e.target.value)}
                        className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                      >
                        {STATIONS.map(s => (
                          <option key={s.key} value={s.key}>{s.label}</option>
                        ))}
                      </select>
                    </div>

                    {impError && (
                      <p className="text-sm text-destructive">{impError}</p>
                    )}
                    {impSuccess && (
                      <div className="flex items-center gap-2 text-sm text-emerald-600">
                        <CheckCircle className="w-4 h-4" />
                        Improvement submitted successfully!
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={impSubmitting || !impTitle.trim() || !impDescription.trim()}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                    >
                      {impSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lightbulb className="w-4 h-4" />}
                      Submit Improvement
                    </button>
                  </form>

                  {(recentImprovements.length > 0 || impListLoading) && (
                    <div className="border-t border-border pt-5">
                      <h3 className="text-sm font-semibold mb-3">Recent Submissions</h3>
                      {impListLoading ? (
                        <div className="flex justify-center py-4">
                          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {recentImprovements.map(imp => (
                            <div key={imp.id} className="bg-secondary/20 rounded-lg p-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium truncate">{imp.title}</p>
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    {imp.submittedByName ?? "Anonymous"} · {STATIONS.find(s => s.key === imp.station)?.label ?? imp.station}
                                    {imp.createdAt ? ` · ${format(new Date(imp.createdAt), "d MMM")}` : ""}
                                  </p>
                                </div>
                                <span className={cn(
                                  "text-xs px-2 py-0.5 rounded-full shrink-0",
                                  imp.progressStatus === "complete"
                                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                    : imp.progressStatus === "testing"
                                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                    : imp.progressStatus === "approved"
                                    ? "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400"
                                    : "bg-secondary text-muted-foreground"
                                )}>
                                  {STATUS_LABELS[imp.progressStatus] ?? imp.progressStatus}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {activeTab === "andon" && (
                <div className="p-5">
                  <form onSubmit={handleAndonSubmit} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-1.5">Severity <span className="text-destructive">*</span></label>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => setAndonSeverity("yellow")}
                          className={cn(
                            "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 text-sm font-medium transition-all",
                            andonSeverity === "yellow"
                              ? "border-yellow-400 bg-yellow-50 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300"
                              : "border-border text-muted-foreground hover:border-yellow-300"
                          )}
                        >
                          <span className="w-3 h-3 rounded-full bg-yellow-400 shrink-0" />
                          Yellow — Minor
                        </button>
                        <button
                          type="button"
                          onClick={() => setAndonSeverity("red")}
                          className={cn(
                            "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 text-sm font-medium transition-all",
                            andonSeverity === "red"
                              ? "border-red-500 bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-300"
                              : "border-border text-muted-foreground hover:border-red-300"
                          )}
                        >
                          <span className="w-3 h-3 rounded-full bg-red-500 shrink-0" />
                          Red — Serious
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-1.5">Category <span className="text-destructive">*</span></label>
                      <div className="flex flex-wrap gap-2">
                        {ANDON_CATEGORIES.map(c => (
                          <button
                            key={c.key}
                            type="button"
                            onClick={() => setAndonCategory(c.key)}
                            className={cn(
                              "px-3 py-1.5 rounded-lg border text-sm font-medium transition-all",
                              andonCategory === c.key
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border text-muted-foreground hover:text-foreground"
                            )}
                          >
                            {c.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-1.5">Station <span className="text-destructive">*</span></label>
                      <select
                        value={andonStation}
                        onChange={e => setAndonStation(e.target.value)}
                        className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                      >
                        {STATIONS.map(s => (
                          <option key={s.key} value={s.key}>{s.label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-1.5">Description <span className="text-muted-foreground font-normal">(optional)</span></label>
                      <textarea
                        value={andonDescription}
                        onChange={e => setAndonDescription(e.target.value)}
                        placeholder="Describe the issue in more detail..."
                        rows={3}
                        className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                      />
                    </div>

                    {andonError && (
                      <p className="text-sm text-destructive">{andonError}</p>
                    )}
                    {andonSuccess && (
                      <div className="flex items-center gap-2 text-sm text-emerald-600">
                        <CheckCircle className="w-4 h-4" />
                        Issue reported! The team has been alerted.
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={andonSubmitting}
                      className={cn(
                        "w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50",
                        andonSeverity === "red"
                          ? "bg-red-600 text-white hover:bg-red-700"
                          : "bg-yellow-500 text-white hover:bg-yellow-600"
                      )}
                    >
                      {andonSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
                      Report {andonSeverity === "red" ? "Serious" : "Minor"} Issue
                    </button>
                  </form>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

interface ReportButtonProps {
  defaultStation?: string;
  className?: string;
}

export function ReportButton({ defaultStation, className }: ReportButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 bg-blue-500 text-white rounded-full shadow-lg shadow-blue-500/30 hover:bg-blue-600 transition-all hover:scale-105 active:scale-95 font-medium text-sm",
          className
        )}
        title="Submit a quick idea or report an issue"
      >
        <AlertTriangle className="w-4 h-4" />
        Quick Idea
      </button>
      <ReportModal open={open} onClose={() => setOpen(false)} defaultStation={defaultStation} />
    </>
  );
}
