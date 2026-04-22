import { useState, useEffect, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Lightbulb, AlertTriangle, CheckCircle, Loader2, ChevronDown, CircleDot, HandHelping, ScanLine, ArrowDownCircle, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { QrScanner } from "./qr-scanner";

interface ImprovementSummary {
  id: number;
  title: string;
  station: string;
  type: string;
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

type Tab = "pullKanban" | "improvements" | "struggle" | "andon";

type QuickIdeaTabSettings = { kanban: boolean; idea: boolean; struggle: boolean; issue: boolean };
const DEFAULT_TAB_SETTINGS: QuickIdeaTabSettings = { kanban: true, idea: true, struggle: true, issue: true };

function useQuickIdeaTabSettings() {
  const [settings, setSettings] = useState<QuickIdeaTabSettings>(DEFAULT_TAB_SETTINGS);
  useEffect(() => {
    fetch("/api/app-settings/quick_idea_tabs", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.value) { try { setSettings({ ...DEFAULT_TAB_SETTINGS, ...JSON.parse(d.value) }); } catch {} } })
      .catch(() => {});
  }, []);
  return settings;
}

interface KanbanInfo {
  id: number;
  ingredientId: number;
  ingredientName: string | null;
  ingredientUnit: string | null;
  kanbanQuantity: number | null;
  supplierId: number | null;
  supplierName: string | null;
  status: string;
  pulledAt: string | null;
  pulledByName: string | null;
  orderDayLabel: string;
  isDueToday: boolean;
  notes: string | null;
}

interface KanbanLookupResult {
  found: boolean;
  kanban?: KanbanInfo;
  kanbans?: KanbanInfo[];
  ingredientName?: string;
  sourceType?: string;
  sourceName?: string;
  message?: string;
}

interface ReportModalProps {
  open: boolean;
  onClose: () => void;
  defaultStation?: string;
  reportContext?: string;
  tabSettings?: QuickIdeaTabSettings;
}

export function ReportModal({ open, onClose, defaultStation, reportContext, tabSettings = DEFAULT_TAB_SETTINGS }: ReportModalProps) {
  const enabledTabs: { key: Tab; settingKey: keyof QuickIdeaTabSettings }[] = [
    { key: "pullKanban", settingKey: "kanban" },
    { key: "improvements", settingKey: "idea" },
    { key: "struggle", settingKey: "struggle" },
    { key: "andon", settingKey: "issue" },
  ].filter(t => tabSettings[t.settingKey]) as { key: Tab; settingKey: keyof QuickIdeaTabSettings }[];

  const [activeTab, setActiveTab] = useState<Tab>(enabledTabs[0]?.key ?? "pullKanban");

  const [scanActive, setScanActive] = useState(false);
  const [scanStep, setScanStep] = useState<"scanning" | "loading" | "result" | "pulling" | "done" | "error">("scanning");
  const [lookupResult, setLookupResult] = useState<KanbanLookupResult | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);

  const [impTitle, setImpTitle] = useState("");
  const [impDescription, setImpDescription] = useState("");
  const [impStation, setImpStation] = useState(defaultStation || "general");
  const [impSubmitting, setImpSubmitting] = useState(false);
  const [impSuccess, setImpSuccess] = useState(false);
  const [impError, setImpError] = useState<string | null>(null);

  const [struggleTitle, setStruggleTitle] = useState("");
  const [struggleDescription, setStruggleDescription] = useState("");
  const [struggleStation, setStruggleStation] = useState(defaultStation || "general");
  const [struggleSubmitting, setStruggleSubmitting] = useState(false);
  const [struggleSuccess, setStruggleSuccess] = useState(false);
  const [struggleError, setStruggleError] = useState<string | null>(null);

  const [andonCategory, setAndonCategory] = useState("equipment");
  const [andonSeverity, setAndonSeverity] = useState<"green" | "yellow" | "red">("yellow");
  const [andonDescription, setAndonDescription] = useState("");
  const [andonStation, setAndonStation] = useState(defaultStation || "general");
  const [andonSubmitting, setAndonSubmitting] = useState(false);
  const [andonSuccess, setAndonSuccess] = useState(false);
  const [andonError, setAndonError] = useState<string | null>(null);

  // Synchronous submit guards. React state updates don't propagate before a
  // second rapid tap on an iPad can re-fire the submit handler — the stale
  // `disabled` prop on the button isn't enough. These refs short-circuit
  // duplicate invocations before they reach the network.
  const andonSubmittingRef = useRef(false);
  const impSubmittingRef = useRef(false);
  const struggleSubmittingRef = useRef(false);

  const [recentImprovements, setRecentImprovements] = useState<ImprovementSummary[]>([]);
  const [impListLoading, setImpListLoading] = useState(false);

  useEffect(() => {
    if (open && activeTab === "pullKanban") {
      setScanActive(true);
      setScanStep("scanning");
      setLookupResult(null);
      setPullError(null);
    } else {
      setScanActive(false);
    }
  }, [open, activeTab]);

  useEffect(() => {
    if (open) {
      setActiveTab(enabledTabs[0]?.key ?? "pullKanban");
    } else {
      setScanActive(false);
      setScanStep("scanning");
      setLookupResult(null);
      setPullError(null);
    }
  }, [open]);

  const parseQrData = useCallback((raw: string): { type: string; id: number } | null => {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.type && parsed.id) return { type: parsed.type, id: Number(parsed.id) };
    } catch {
    }

    const urlMatch = raw.match(/[?&]type=([\w-]+)&id=(\d+)/);
    if (urlMatch) return { type: urlMatch[1].replace(/-/g, "_"), id: Number(urlMatch[2]) };

    const simpleMatch = raw.match(/^([\w-]+):(\d+)$/);
    if (simpleMatch) return { type: simpleMatch[1].replace(/-/g, "_"), id: Number(simpleMatch[2]) };

    const numOnly = raw.match(/^(\d+)$/);
    if (numOnly) return { type: "ingredient", id: Number(numOnly[1]) };

    return null;
  }, []);

  const handleQrScan = useCallback(async (data: string) => {
    setScanActive(false);
    setScanStep("loading");
    setPullError(null);

    const parsed = parseQrData(data);
    if (!parsed) {
      setScanStep("error");
      setPullError(`Could not parse QR code data: "${data}"`);
      return;
    }

    try {
      const res = await fetch(`${BASE}/api/kanbans/lookup?type=${parsed.type}&id=${parsed.id}`, {
        credentials: "include",
      });

      if (res.status === 404) {
        const errData = await res.json().catch(() => ({}));
        setScanStep("error");
        setPullError(errData.error || "Item not found");
        return;
      }

      if (!res.ok) {
        setScanStep("error");
        setPullError("Failed to look up kanban information");
        return;
      }

      const result: KanbanLookupResult = await res.json();
      setLookupResult(result);
      setScanStep("result");
    } catch (err) {
      console.warn("[ReportModal] Kanban lookup failed:", err);
      setScanStep("error");
      setPullError("Network error. Please check your connection and try again.");
    }
  }, [parseQrData]);

  const handlePullKanban = useCallback(async (kanbanId: number) => {
    setScanStep("pulling");
    setPullError(null);

    try {
      const res = await fetch(`${BASE}/api/kanbans/${kanbanId}/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setScanStep("error");
        setPullError(errData.error || "Failed to pull kanban");
        return;
      }

      setScanStep("done");
    } catch (err) {
      console.warn("[ReportModal] Kanban pull failed:", err);
      setScanStep("error");
      setPullError("Network error. Please try again.");
    }
  }, []);

  const handleScanReset = useCallback(() => {
    setScanStep("scanning");
    setLookupResult(null);
    setPullError(null);
    setScanActive(true);
  }, []);

  useEffect(() => {
    if (open && (activeTab === "improvements" || activeTab === "struggle")) {
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
    } catch (err) {
      console.warn("[ReportModal] Failed to load recent improvements:", err);
      toast({ title: "Failed to load improvements", description: "Could not fetch recent improvements.", variant: "destructive" });
    }
    setImpListLoading(false);
  }

  async function handleImprovementSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!impTitle.trim() || !impDescription.trim()) return;
    if (impSubmittingRef.current) return;
    impSubmittingRef.current = true;
    setImpSubmitting(true);
    setImpError(null);
    try {
      const res = await fetch(`${BASE}/api/improvements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ title: impTitle.trim(), description: impDescription.trim(), station: impStation, type: "improvement", reportContext: reportContext || null }),
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
    } catch (err) {
      console.warn("[ReportModal] Improvement submit failed:", err);
      setImpError("Network error, please try again");
    }
    impSubmittingRef.current = false;
    setImpSubmitting(false);
  }

  async function handleStruggleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!struggleTitle.trim() || !struggleDescription.trim()) return;
    if (struggleSubmittingRef.current) return;
    struggleSubmittingRef.current = true;
    setStruggleSubmitting(true);
    setStruggleError(null);
    try {
      const res = await fetch(`${BASE}/api/improvements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ title: struggleTitle.trim(), description: struggleDescription.trim(), station: struggleStation, type: "struggle", reportContext: reportContext || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setStruggleError(data.error ?? "Failed to submit struggle");
      } else {
        setStruggleSuccess(true);
        setStruggleTitle("");
        setStruggleDescription("");
        loadRecentImprovements();
        setTimeout(() => setStruggleSuccess(false), 3000);
      }
    } catch (err) {
      console.warn("[ReportModal] Struggle submit failed:", err);
      setStruggleError("Network error, please try again");
    }
    struggleSubmittingRef.current = false;
    setStruggleSubmitting(false);
  }

  async function handleAndonSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (andonSubmittingRef.current) return;
    andonSubmittingRef.current = true;
    setAndonSubmitting(true);
    setAndonError(null);
    let succeeded = false;
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
          reportContext: reportContext || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setAndonError(data.error ?? "Failed to report issue");
      } else {
        succeeded = true;
        setAndonSuccess(true);
        setAndonDescription("");
        setTimeout(() => { setAndonSuccess(false); onClose(); }, 2000);
      }
    } catch (err) {
      console.warn("[ReportModal] Andon submit failed:", err);
      setAndonError("Network error, please try again");
    }
    // On success, keep the button disabled until the modal closes so a tap
    // during the 2s success banner can't submit a blank follow-up issue.
    // On error, re-enable so the user can retry.
    if (!succeeded) {
      andonSubmittingRef.current = false;
      setAndonSubmitting(false);
    }
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

            <div className="flex items-center gap-1 p-3 border-b border-border bg-secondary/20 flex-shrink-0 overflow-x-auto">
              {tabSettings.kanban && <button
                onClick={() => setActiveTab("pullKanban")}
                className={cn(
                  "flex items-center gap-1.5 flex-1 justify-center px-2.5 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap min-w-0",
                  activeTab === "pullKanban"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <ScanLine className="w-4 h-4 shrink-0" />
                Pull Kanban
              </button>}
              {tabSettings.idea && <button
                onClick={() => setActiveTab("improvements")}
                className={cn(
                  "flex items-center gap-1.5 flex-1 justify-center px-2.5 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap min-w-0",
                  activeTab === "improvements"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Lightbulb className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline">Improvement</span> Idea
              </button>}
              {tabSettings.struggle && <button
                onClick={() => setActiveTab("struggle")}
                className={cn(
                  "flex items-center gap-1.5 flex-1 justify-center px-2.5 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap min-w-0",
                  activeTab === "struggle"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <HandHelping className="w-4 h-4 shrink-0" />
                Struggle
              </button>}
              {tabSettings.issue && <button
                onClick={() => setActiveTab("andon")}
                className={cn(
                  "flex items-center gap-1.5 flex-1 justify-center px-2.5 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap min-w-0",
                  activeTab === "andon"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Issue
              </button>}
            </div>

            {reportContext && activeTab !== "pullKanban" && (
              <div className="mx-5 mt-3 mb-0 px-3 py-2 bg-blue-50 dark:bg-blue-950/20 border border-blue-200/60 dark:border-blue-800/40 rounded-lg flex items-center gap-2 flex-shrink-0">
                <Package className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                <p className="text-xs text-blue-700 dark:text-blue-400">
                  <span className="font-medium">Context:</span> {reportContext}
                </p>
              </div>
            )}

            <div className="flex-1 overflow-y-auto">
              {activeTab === "pullKanban" && (
                <div className="p-5">
                  {scanStep === "scanning" && (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground text-center">
                        Scan an ingredient QR code to pull its kanban
                      </p>
                      <QrScanner
                        onScan={handleQrScan}
                        active={scanActive}
                      />
                    </div>
                  )}

                  {scanStep === "loading" && (
                    <div className="flex flex-col items-center gap-3 py-12">
                      <Loader2 className="w-8 h-8 animate-spin text-primary" />
                      <p className="text-sm text-muted-foreground">Looking up kanban...</p>
                    </div>
                  )}

                  {scanStep === "result" && lookupResult && (
                    <div className="space-y-4">
                      {lookupResult.found && lookupResult.kanban ? (
                        <>
                          <div className="rounded-xl border border-border bg-secondary/20 p-4 space-y-3">
                            <div className="flex items-center gap-2">
                              <Package className="w-5 h-5 text-primary" />
                              <h3 className="font-semibold text-base">
                                {lookupResult.kanban.ingredientName ?? `Ingredient #${lookupResult.kanban.ingredientId}`}
                              </h3>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                              <div>
                                <span className="text-muted-foreground">Quantity:</span>{" "}
                                <span className="font-medium">
                                  {lookupResult.kanban.kanbanQuantity != null
                                    ? `${lookupResult.kanban.kanbanQuantity} ${lookupResult.kanban.ingredientUnit ?? ""}`
                                    : "—"}
                                </span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Supplier:</span>{" "}
                                <span className="font-medium">{lookupResult.kanban.supplierName ?? "—"}</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Status:</span>{" "}
                                <span className={cn(
                                  "font-medium",
                                  lookupResult.kanban.status === "active" ? "text-emerald-600" : "text-blue-600"
                                )}>
                                  {lookupResult.kanban.status.charAt(0).toUpperCase() + lookupResult.kanban.status.slice(1)}
                                </span>
                              </div>
                            </div>
                          </div>

                          {lookupResult.kanban.status === "active" ? (
                            <button
                              onClick={() => handlePullKanban(lookupResult.kanban!.id)}
                              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors shadow-md"
                            >
                              <ArrowDownCircle className="w-5 h-5" />
                              Pull Kanban
                            </button>
                          ) : (
                            <div className="text-center py-2">
                              <p className="text-sm text-amber-600 font-medium">
                                This kanban has already been pulled
                              </p>
                            </div>
                          )}

                          <button
                            onClick={handleScanReset}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground rounded-lg border border-border hover:bg-secondary/50 transition-colors"
                          >
                            <ScanLine className="w-4 h-4" />
                            Scan Another
                          </button>
                        </>
                      ) : (
                        <div className="text-center py-6 space-y-3">
                          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
                          <div>
                            <p className="font-medium">
                              {lookupResult.sourceName
                                ? `No active kanban for "${lookupResult.sourceName}"`
                                : lookupResult.ingredientName
                                ? `No active kanban for "${lookupResult.ingredientName}"`
                                : "No active kanban found"}
                            </p>
                            <p className="text-sm text-muted-foreground mt-1">
                              {lookupResult.message || "This ingredient does not have an active kanban card."}
                            </p>
                          </div>
                          <button
                            onClick={handleScanReset}
                            className="flex items-center justify-center gap-2 mx-auto px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                          >
                            <ScanLine className="w-4 h-4" />
                            Scan Again
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {scanStep === "pulling" && (
                    <div className="flex flex-col items-center gap-3 py-12">
                      <Loader2 className="w-8 h-8 animate-spin text-primary" />
                      <p className="text-sm text-muted-foreground">Pulling kanban...</p>
                    </div>
                  )}

                  {scanStep === "done" && (
                    <div className="flex flex-col items-center gap-4 py-10">
                      <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
                        <CheckCircle className="w-8 h-8 text-emerald-500" />
                      </div>
                      <div className="text-center">
                        <p className="font-semibold text-lg">Kanban Pulled!</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          {lookupResult?.kanban?.ingredientName ?? "Ingredient"} has been pulled successfully.
                        </p>
                      </div>
                      <div className="flex gap-3 mt-2">
                        <button
                          onClick={handleScanReset}
                          className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-border hover:bg-secondary/50 transition-colors"
                        >
                          <ScanLine className="w-4 h-4" />
                          Scan Another
                        </button>
                        <button
                          onClick={onClose}
                          className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  )}

                  {scanStep === "error" && (
                    <div className="flex flex-col items-center gap-4 py-8">
                      <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center">
                        <AlertTriangle className="w-7 h-7 text-destructive" />
                      </div>
                      <div className="text-center">
                        <p className="font-medium text-destructive">Error</p>
                        <p className="text-sm text-muted-foreground mt-1 max-w-[300px]">
                          {pullError || "Something went wrong"}
                        </p>
                      </div>
                      <button
                        onClick={handleScanReset}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                      >
                        <ScanLine className="w-4 h-4" />
                        Try Again
                      </button>
                    </div>
                  )}
                </div>
              )}

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
                                  <div className="flex items-center gap-1.5">
                                    <p className="text-sm font-medium truncate">{imp.title}</p>
                                    <span className={cn(
                                      "px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 leading-none",
                                      (imp.type ?? "improvement") === "struggle"
                                        ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
                                        : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                    )}>
                                      {(imp.type ?? "improvement") === "struggle" ? "Struggle" : "Idea"}
                                    </span>
                                  </div>
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

              {activeTab === "struggle" && (
                <div className="p-5 space-y-5">
                  <form onSubmit={handleStruggleSubmit} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-1.5">Title <span className="text-destructive">*</span></label>
                      <input
                        type="text"
                        value={struggleTitle}
                        onChange={e => setStruggleTitle(e.target.value)}
                        placeholder="Brief summary of the struggle"
                        className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1.5">Description <span className="text-destructive">*</span></label>
                      <textarea
                        value={struggleDescription}
                        onChange={e => setStruggleDescription(e.target.value)}
                        placeholder="Describe the difficulty you're facing on the floor..."
                        rows={3}
                        className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1.5">Station</label>
                      <select
                        value={struggleStation}
                        onChange={e => setStruggleStation(e.target.value)}
                        className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                      >
                        {STATIONS.map(s => (
                          <option key={s.key} value={s.key}>{s.label}</option>
                        ))}
                      </select>
                    </div>

                    {struggleError && (
                      <p className="text-sm text-destructive">{struggleError}</p>
                    )}
                    {struggleSuccess && (
                      <div className="flex items-center gap-2 text-sm text-emerald-600">
                        <CheckCircle className="w-4 h-4" />
                        Struggle submitted successfully!
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={struggleSubmitting || !struggleTitle.trim() || !struggleDescription.trim()}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 disabled:opacity-50 transition-colors"
                    >
                      {struggleSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <HandHelping className="w-4 h-4" />}
                      Submit Struggle
                    </button>
                  </form>
                </div>
              )}

              {activeTab === "andon" && (
                <div className="p-5">
                  <form onSubmit={handleAndonSubmit} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-1.5">Priority <span className="text-destructive">*</span></label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setAndonSeverity("green")}
                          className={cn(
                            "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 text-sm font-medium transition-all",
                            andonSeverity === "green"
                              ? "border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300"
                              : "border-border text-muted-foreground hover:border-emerald-300"
                          )}
                        >
                          <span className="w-3 h-3 rounded-full bg-emerald-500 shrink-0" />
                          Green — Wish List
                        </button>
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
                          : andonSeverity === "green"
                            ? "bg-emerald-600 text-white hover:bg-emerald-700"
                            : "bg-yellow-500 text-white hover:bg-yellow-600"
                      )}
                    >
                      {andonSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
                      {andonSeverity === "green"
                        ? "Add to Wish List"
                        : `Report ${andonSeverity === "red" ? "Serious" : "Minor"} Issue`}
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
  reportContext?: string;
  className?: string;
}

export function ReportButton({ defaultStation, reportContext, className }: ReportButtonProps) {
  const [open, setOpen] = useState(false);
  const tabSettings = useQuickIdeaTabSettings();
  const anyEnabled = tabSettings.kanban || tabSettings.idea || tabSettings.struggle || tabSettings.issue;

  if (!anyEnabled) return null;

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
        <CircleDot className="w-4 h-4" />
        Quick Idea
      </button>
      <ReportModal open={open} onClose={() => setOpen(false)} defaultStation={defaultStation} reportContext={reportContext} tabSettings={tabSettings} />
    </>
  );
}
