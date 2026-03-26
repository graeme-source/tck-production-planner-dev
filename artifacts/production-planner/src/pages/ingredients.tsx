import { useState, useRef } from "react";
import { useListIngredients, useListSuppliers, getListRecipesQueryKey, getListSubRecipesQueryKey } from "@workspace/api-client-react";
import type { Ingredient } from "@workspace/api-client-react";
import { useAppMutations } from "@/hooks/use-mutations";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { Search, Plus, Trash2, Edit2, Loader2, ExternalLink, Upload, FileText, CheckCircle2, XCircle, AlertTriangle, RefreshCw } from "lucide-react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Papa from "papaparse";
import { useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const CSV_COLUMNS = ["name","unit","pack_weight","cost_per_pack","brand","supplier_name","secondary_supplier_name","supplier_part_number","ordering_url","notes","processing_ratio_percent"];
const CSV_EXAMPLE = ["Caputo Flour","kg","15","16.00","Caputo","Brakes Food Service","","BRK-FLOUR-15","https://brakes.co.uk/flour","00 pizza flour",""];

function downloadTemplate() {
  const header = CSV_COLUMNS.join(",");
  const example = CSV_EXAMPLE.join(",");
  const hint = ["# Remove this line before importing. Units: kg g l ml pcs box bag tub each. processing_ratio_percent is 0-100 (leave blank for no loss).","","","","","","","","","",""].join(",");
  const csv = [header, hint, example].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "ingredients_template.csv"; a.click();
  URL.revokeObjectURL(url);
}

interface ImportResult {
  created: { name: string }[];
  updated: { name: string; changes: string[] }[];
  issues: { row: number; field: string; message: string }[];
  suppliersCreated: string[];
  dryRun: boolean;
}

async function callImport(rows: Record<string, string>[], dryRun: boolean): Promise<ImportResult> {
  const res = await fetch(`${BASE}/api/ingredients/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ rows, dryRun }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? "Import failed");
  }
  return res.json();
}

type ImportStep = "upload" | "preview" | "done";

function ImportDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<ImportStep>("upload");
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setStep("upload");
    setParsedRows([]);
    setFileName("");
    setPreview(null);
    setResult(null);
    setError(null);
  }

  function handleClose() { reset(); onClose(); }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: h => h.trim().toLowerCase().replace(/\s+/g, "_"),
      complete: (res) => {
        const rows = (res.data as Record<string, string>[]).filter(r => {
          const firstVal = Object.values(r)[0];
          return !String(firstVal ?? "").startsWith("#");
        });
        if (rows.length === 0) { setError("No data rows found in the file."); return; }
        setParsedRows(rows);
      },
      error: (err: { message: string }) => setError(err.message),
    });
    e.target.value = "";
  }

  async function runPreview() {
    setLoading(true); setError(null);
    try {
      const res = await callImport(parsedRows, true);
      setPreview(res);
      setStep("preview");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setLoading(false); }
  }

  async function runImport() {
    setLoading(true); setError(null);
    try {
      const res = await callImport(parsedRows, false);
      setResult(res);
      setStep("done");
      onDone();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setLoading(false); }
  }

  const blockingIssues = preview?.issues.filter(i => i.message.includes("skipped")) ?? [];
  const warningIssues = preview?.issues.filter(i => !i.message.includes("skipped")) ?? [];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[680px] bg-card border-border rounded-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Import Ingredients from CSV</DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mt-2 mb-4">
          {(["upload","preview","done"] as ImportStep[]).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${step === s ? "bg-primary text-primary-foreground" : (["upload","preview","done"].indexOf(step) > i ? "bg-emerald-500 text-white" : "bg-secondary text-muted-foreground")}`}>
                {["upload","preview","done"].indexOf(step) > i ? "✓" : i + 1}
              </div>
              <span className={`text-xs font-medium ${step === s ? "text-foreground" : "text-muted-foreground"}`}>
                {s === "upload" ? "Upload" : s === "preview" ? "Preview" : "Done"}
              </span>
              {i < 2 && <div className="w-8 h-px bg-border" />}
            </div>
          ))}
        </div>

        {error && (
          <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm mb-3">
            <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Step 1: Upload */}
        {step === "upload" && (
          <div className="space-y-4">
            <div className="p-4 bg-secondary/30 rounded-xl border border-border text-sm space-y-1">
              <p className="font-medium">How it works:</p>
              <ul className="text-muted-foreground space-y-1 list-disc list-inside">
                <li>Download the template, fill in your ingredients, save as CSV</li>
                <li>Existing ingredients (matched by name) will be <span className="text-amber-600 font-medium">updated</span></li>
                <li>New ingredients will be <span className="text-emerald-600 font-medium">created</span></li>
                <li>Supplier names are matched automatically — new ones are created</li>
              </ul>
            </div>

            <button
              onClick={downloadTemplate}
              className="flex items-center gap-2 px-4 py-2.5 border border-border rounded-xl text-sm font-medium hover:bg-secondary/50 transition-colors"
            >
              <FileText className="w-4 h-4" /> Download CSV Template
            </button>

            <div>
              <label className="text-sm font-medium mb-2 block">Upload your CSV file</label>
              <div
                onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-secondary/20 transition-colors"
              >
                <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                {fileName ? (
                  <p className="font-medium text-foreground">{fileName}</p>
                ) : (
                  <p className="text-muted-foreground text-sm">Click to select a CSV file</p>
                )}
                {parsedRows.length > 0 && (
                  <p className="text-xs text-emerald-600 mt-1 font-medium">{parsedRows.length} rows ready</p>
                )}
              </div>
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={handleClose} className="px-4 py-2 text-sm rounded-xl border border-border hover:bg-secondary/50 transition-colors">
                Cancel
              </button>
              <button
                onClick={runPreview}
                disabled={parsedRows.length === 0 || loading}
                className="px-5 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium disabled:opacity-50 flex items-center gap-2 hover:bg-primary/90 transition-colors"
              >
                {loading && <RefreshCw className="w-4 h-4 animate-spin" />}
                Preview Import
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Preview */}
        {step === "preview" && preview && (
          <div className="space-y-4">
            {/* Summary badges */}
            <div className="flex flex-wrap gap-2">
              <span className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-sm font-medium border border-emerald-200">
                {preview.created.length} new
              </span>
              <span className="px-3 py-1 rounded-full bg-amber-50 text-amber-700 text-sm font-medium border border-amber-200">
                {preview.updated.length} updates
              </span>
              {preview.suppliersCreated.length > 0 && (
                <span className="px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-sm font-medium border border-blue-200">
                  {preview.suppliersCreated.length} new supplier{preview.suppliersCreated.length !== 1 ? "s" : ""}
                </span>
              )}
              {blockingIssues.length > 0 && (
                <span className="px-3 py-1 rounded-full bg-destructive/10 text-destructive text-sm font-medium border border-destructive/20">
                  {blockingIssues.length} skipped
                </span>
              )}
              {warningIssues.length > 0 && (
                <span className="px-3 py-1 rounded-full bg-orange-50 text-orange-700 text-sm font-medium border border-orange-200">
                  {warningIssues.length} warning{warningIssues.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>

            {/* New suppliers */}
            {preview.suppliersCreated.length > 0 && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-sm">
                <p className="font-medium text-blue-800 mb-1">New suppliers will be created:</p>
                <p className="text-blue-700">{preview.suppliersCreated.join(", ")}</p>
              </div>
            )}

            {/* Issues */}
            {preview.issues.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium">Issues requiring review:</p>
                <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
                  {preview.issues.map((issue, i) => (
                    <div key={i} className={`flex items-start gap-3 px-4 py-2.5 text-sm ${issue.message.includes("skipped") ? "bg-destructive/5" : "bg-amber-50/50"}`}>
                      {issue.message.includes("skipped")
                        ? <XCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                        : <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />}
                      <span className="text-muted-foreground">Row {issue.row} · <span className="font-mono text-xs">{issue.field}</span>: {issue.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* New ingredients list */}
            {preview.created.length > 0 && (
              <details className="rounded-xl border border-border overflow-hidden">
                <summary className="px-4 py-3 text-sm font-medium bg-secondary/20 cursor-pointer hover:bg-secondary/40 transition-colors">
                  New ingredients ({preview.created.length})
                </summary>
                <div className="px-4 py-3 grid grid-cols-2 gap-x-4 gap-y-1 max-h-48 overflow-y-auto">
                  {preview.created.map((c, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-sm">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                      <span className="truncate">{c.name}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {/* Updated ingredients list */}
            {preview.updated.length > 0 && (
              <details className="rounded-xl border border-border overflow-hidden">
                <summary className="px-4 py-3 text-sm font-medium bg-secondary/20 cursor-pointer hover:bg-secondary/40 transition-colors">
                  Updated ingredients ({preview.updated.length})
                </summary>
                <div className="divide-y divide-border max-h-48 overflow-y-auto">
                  {preview.updated.map((u, i) => (
                    <div key={i} className="px-4 py-2.5 text-sm">
                      <span className="font-medium">{u.name}</span>
                      {u.changes.length > 0 && (
                        <span className="text-muted-foreground ml-2 text-xs">{u.changes.join(", ")}</span>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            )}

            <div className="flex justify-between gap-2 pt-2">
              <button onClick={() => setStep("upload")} className="px-4 py-2 text-sm rounded-xl border border-border hover:bg-secondary/50 transition-colors">
                ← Back
              </button>
              <div className="flex gap-2">
                <button onClick={handleClose} className="px-4 py-2 text-sm rounded-xl border border-border hover:bg-secondary/50 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={runImport}
                  disabled={loading || (preview.created.length === 0 && preview.updated.length === 0)}
                  className="px-5 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium disabled:opacity-50 flex items-center gap-2 hover:bg-primary/90 transition-colors"
                >
                  {loading && <RefreshCw className="w-4 h-4 animate-spin" />}
                  Confirm Import ({preview.created.length + preview.updated.length} ingredients)
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Done */}
        {step === "done" && result && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
              <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0" />
              <div>
                <p className="font-semibold text-emerald-800">Import complete</p>
                <p className="text-sm text-emerald-700">
                  {result.created.length} created · {result.updated.length} updated
                  {result.suppliersCreated.length > 0 ? ` · ${result.suppliersCreated.length} supplier${result.suppliersCreated.length !== 1 ? "s" : ""} created` : ""}
                </p>
              </div>
            </div>

            {result.issues.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-500" /> Issues to review:
                </p>
                <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
                  {result.issues.map((issue, i) => (
                    <div key={i} className={`flex items-start gap-3 px-4 py-2.5 text-sm ${issue.message.includes("skipped") ? "bg-destructive/5" : "bg-amber-50/50"}`}>
                      {issue.message.includes("skipped")
                        ? <XCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                        : <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />}
                      <span className="text-muted-foreground">Row {issue.row} · <span className="font-mono text-xs">{issue.field}</span>: {issue.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={handleClose}
                className="px-5 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const INGREDIENT_CATEGORIES = [
  { value: "", label: "— No category —" },
  { value: "raw_meat", label: "Raw Meat" },
  { value: "vegetable", label: "Vegetable" },
  { value: "base", label: "Base (Sauce/Mozzarella)" },
  { value: "sauce", label: "Sauce" },
  { value: "cheese", label: "Cheese" },
  { value: "seasoning", label: "Seasoning/Spice" },
  { value: "dough", label: "Dough" },
  { value: "packaging", label: "Packaging" },
  { value: "other", label: "Other" },
] as const;

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  unit: z.string().min(1, "Unit is required"),
  packWeight: z.coerce.number().min(0, "Must be positive"),
  costPerPack: z.coerce.number().min(0, "Must be positive"),
  brand: z.string().optional(),
  supplierPartNumber: z.string().optional(),
  supplierId: z.coerce.number().optional(),
  secondarySupplierId: z.coerce.number().optional(),
  orderingUrl: z.string().optional(),
  notes: z.string().optional(),
  category: z.string().optional(),
  processingRatioPct: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().min(0).max(100).nullable().optional()
  ),
  rawMeatTrayCapacityKg: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().positive().nullable().optional()
  ),
  minCookingTempC: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().min(0).max(300).nullable().optional()
  ),
  estimatedCookTimeMin: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().int().min(1).nullable().optional()
  ),
  ovenTempC: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().int().min(0).max(500).nullable().optional()
  ),
  steamPct: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().int().min(0).max(100).nullable().optional()
  ),
  stockCheckEnabled: z.boolean().optional(),
  stockCheckFrequency: z.enum(["daily", "weekly"]).optional(),
  stockCheckDay: z.string().optional(),
  surplusPercent: z.coerce.number().min(0).optional(),
  shelfLifeDays: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().int().positive().nullable().optional()
  ),
  kanbanEnabled: z.boolean().optional(),
  kanbanQuantity: z.coerce.number().min(0).optional(),
  kanbanUnit: z.enum(["weight", "pack", "bottle"]).optional(),
  kanbanOrderAmount: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().min(0).nullable().optional()
  ),
});

type FormValues = z.infer<typeof schema>;

const emptyDefaults: FormValues = {
  name: "", unit: "kg", packWeight: 0, costPerPack: 0,
  brand: "", supplierPartNumber: "", supplierId: 0, secondarySupplierId: 0,
  orderingUrl: "", notes: "", category: "", processingRatioPct: null, rawMeatTrayCapacityKg: null, minCookingTempC: null, estimatedCookTimeMin: null, ovenTempC: null, steamPct: null, stockCheckEnabled: false, stockCheckFrequency: "daily", stockCheckDay: "", surplusPercent: 10, shelfLifeDays: null, kanbanEnabled: false, kanbanQuantity: 0, kanbanUnit: "weight" as const, kanbanOrderAmount: null,
};

export default function Ingredients() {
  const { data: ingredients, isLoading } = useListIngredients();
  const { data: suppliers } = useListSuppliers();
  const { createIngredient, updateIngredient, deleteIngredient } = useAppMutations();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterStockCheck, setFilterStockCheck] = useState("all");
  const [filterSupplier, setFilterSupplier] = useState("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const filtered = ingredients?.filter(i => {
    const matchesSearch =
      i.name.toLowerCase().includes(search.toLowerCase()) ||
      (i.brand ?? "").toLowerCase().includes(search.toLowerCase());
    const matchesCategory =
      filterCategory === "all" ||
      (filterCategory === "uncategorised" ? !i.category : i.category === filterCategory);
    const matchesStockCheck =
      filterStockCheck === "all" ||
      (filterStockCheck === "enabled" ? i.stockCheckEnabled : !i.stockCheckEnabled);
    const matchesSupplier =
      filterSupplier === "all" ||
      (filterSupplier === "none" ? !i.supplierId : String(i.supplierId) === filterSupplier);
    return matchesSearch && matchesCategory && matchesStockCheck && matchesSupplier;
  });

  const supplierMap = Object.fromEntries((suppliers ?? []).map(s => [s.id, s.name]));

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: emptyDefaults,
  });

  const watchedUnit = watch("unit");
  const watchedPackWeight = watch("packWeight");
  const watchedCostPerPack = watch("costPerPack");
  const watchedProcessingRatioPct = watch("processingRatioPct");
  const watchedStockCheckEnabled = watch("stockCheckEnabled");
  const watchedStockCheckFrequency = watch("stockCheckFrequency");
  const watchedCategory = watch("category");
  const watchedKanbanEnabled = watch("kanbanEnabled");
  const watchedKanbanUnit = watch("kanbanUnit");
  const liveCostPerUnit = watchedPackWeight > 0 ? watchedCostPerPack / watchedPackWeight : null;
  const showRawMeatTray = watchedCategory === "raw_meat";

  const openAdd = () => {
    setEditingId(null);
    reset(emptyDefaults);
    setIsDialogOpen(true);
  };

  const openEdit = (item: Ingredient) => {
    setEditingId(item.id);
    reset({
      name: item.name,
      unit: item.unit,
      packWeight: Number(item.packWeight),
      costPerPack: Number(item.costPerPack),
      brand: item.brand ?? "",
      supplierPartNumber: item.supplierPartNumber ?? "",
      supplierId: item.supplierId ?? 0,
      secondarySupplierId: item.secondarySupplierId ?? 0,
      orderingUrl: item.orderingUrl ?? "",
      notes: item.notes ?? "",
      processingRatioPct: item.processingRatio != null
        ? parseFloat((item.processingRatio * 100).toFixed(4))
        : null,
      rawMeatTrayCapacityKg: item.rawMeatTrayCapacityKg != null ? Number(item.rawMeatTrayCapacityKg) : null,
      minCookingTempC: item.minCookingTempC != null ? Number(item.minCookingTempC) : null,
      estimatedCookTimeMin: item.estimatedCookTimeMin != null ? Number(item.estimatedCookTimeMin) : null,
      ovenTempC: item.ovenTempC != null ? Number(item.ovenTempC) : null,
      steamPct: item.steamPct != null ? Number(item.steamPct) : null,
      category: item.category ?? "",
      stockCheckEnabled: item.stockCheckEnabled ?? false,
      stockCheckFrequency: (item.stockCheckFrequency as "daily" | "weekly") ?? "daily",
      stockCheckDay: item.stockCheckDay ?? "",
      surplusPercent: (item as Record<string, unknown>).surplusPercent != null ? Number((item as Record<string, unknown>).surplusPercent) : 10,
      shelfLifeDays: (item as Record<string, unknown>).shelfLifeDays != null ? Number((item as Record<string, unknown>).shelfLifeDays) : null,
      kanbanEnabled: (item as Record<string, unknown>).kanbanEnabled as boolean ?? false,
      kanbanQuantity: (item as Record<string, unknown>).kanbanQuantity != null ? Number((item as Record<string, unknown>).kanbanQuantity) : 0,
      kanbanUnit: ((item as Record<string, unknown>).kanbanUnit as "weight" | "pack" | "bottle") ?? "weight",
      kanbanOrderAmount: (item as Record<string, unknown>).kanbanOrderAmount != null ? Number((item as Record<string, unknown>).kanbanOrderAmount) : null,
    });
    setIsDialogOpen(true);
  };

  const buildPayload = (data: FormValues) => ({
    name: data.name,
    unit: data.unit,
    packWeight: data.packWeight,
    costPerPack: data.costPerPack,
    brand: data.brand || null,
    supplierPartNumber: data.supplierPartNumber || null,
    supplierId: data.supplierId && data.supplierId > 0 ? data.supplierId : null,
    secondarySupplierId: data.secondarySupplierId && data.secondarySupplierId > 0 ? data.secondarySupplierId : null,
    orderingUrl: data.orderingUrl || null,
    notes: data.notes || null,
    category: data.category || null,
    processingRatio: data.processingRatioPct != null ? data.processingRatioPct / 100 : null,
    rawMeatTrayCapacityKg: data.rawMeatTrayCapacityKg ?? null,
    minCookingTempC: data.minCookingTempC ?? null,
    estimatedCookTimeMin: data.estimatedCookTimeMin ?? null,
    ovenTempC: data.ovenTempC ?? null,
    steamPct: data.steamPct ?? null,
    stockCheckEnabled: data.stockCheckEnabled ?? false,
    stockCheckFrequency: data.stockCheckFrequency ?? "daily",
    stockCheckDay: data.stockCheckFrequency === "weekly" ? (data.stockCheckDay || null) : null,
    surplusPercent: data.surplusPercent ?? 10,
    shelfLifeDays: data.shelfLifeDays ?? null,
    kanbanEnabled: data.kanbanEnabled ?? false,
    kanbanQuantity: data.kanbanQuantity ?? 0,
    kanbanUnit: data.kanbanUnit ?? "weight",
    kanbanOrderAmount: data.kanbanOrderAmount ?? null,
  });

  function invalidateCostTouchpoints() {
    queryClient.invalidateQueries({ queryKey: ["/api/ingredients"] });
    queryClient.invalidateQueries({ queryKey: getListRecipesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListSubRecipesQueryKey() });
  }

  const onSubmit = (data: FormValues) => {
    if (editingId !== null) {
      updateIngredient.mutate({ id: editingId, data: buildPayload(data) }, {
        onSuccess: () => { setIsDialogOpen(false); reset(); setEditingId(null); invalidateCostTouchpoints(); }
      });
    } else {
      createIngredient.mutate({ data: buildPayload(data) }, {
        onSuccess: () => { setIsDialogOpen(false); reset(); invalidateCostTouchpoints(); }
      });
    }
  };

  const isPending = createIngredient.isPending || updateIngredient.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ingredients Library"
        description="Manage your raw materials, pack sizes, costs and supplier information."
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsImportOpen(true)}
              className="px-4 py-2.5 border border-border rounded-xl font-medium flex items-center gap-2 hover:bg-secondary/50 transition-colors text-sm"
            >
              <Upload className="w-4 h-4" /> Import CSV
            </button>
            <button
              onClick={openAdd}
              className="px-5 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium shadow-md shadow-primary/20 flex items-center gap-2 hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-5 h-5" /> Add Ingredient
            </button>
          </div>
        }
      />

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[620px] bg-card border-border rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">
              {editingId !== null ? "Edit Ingredient" : "Add New Ingredient"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 mt-4">

            {/* Name + Unit */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="text-sm font-medium mb-1 block">Name *</label>
                <input
                  {...register("name")}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="e.g. Organic Plain Flour"
                />
                {errors.name && <span className="text-destructive text-xs">{errors.name.message}</span>}
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Unit *</label>
                <select
                  {...register("unit")}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="kg">kg</option>
                  <option value="g">g</option>
                  <option value="l">L</option>
                  <option value="ml">ml</option>
                  <option value="pcs">pcs</option>
                  <option value="box">box</option>
                  <option value="bag">bag</option>
                  <option value="tub">tub</option>
                  <option value="each">each</option>
                </select>
              </div>
            </div>

            {/* Brand + Part Number */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">Brand</label>
                <input
                  {...register("brand")}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="e.g. Shipton Mill"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Supplier Part Number</label>
                <input
                  {...register("supplierPartNumber")}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="e.g. HF-0042"
                />
              </div>
            </div>

            {/* Pack Weight + Cost per Pack */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">
                  Pack size ({watchedUnit || "unit"}) *
                </label>
                <input
                  type="number"
                  step="0.001"
                  {...register("packWeight")}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="e.g. 500"
                />
                <p className="text-xs text-muted-foreground mt-1">How many {watchedUnit || "units"} in one pack</p>
                {errors.packWeight && <span className="text-destructive text-xs">{errors.packWeight.message}</span>}
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Cost per pack (£) *</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">£</span>
                  <input
                    type="number"
                    step="0.01"
                    {...register("costPerPack")}
                    className="w-full pl-7 pr-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder="0.00"
                  />
                </div>
                {errors.costPerPack && <span className="text-destructive text-xs">{errors.costPerPack.message}</span>}
              </div>
            </div>
            {liveCostPerUnit !== null && (
              <div className="rounded-lg bg-secondary/30 border border-border px-3.5 py-2.5 text-sm flex items-center justify-between">
                <span className="text-muted-foreground">Implied cost per {watchedUnit || "unit"}:</span>
                <span className="font-semibold tabular-nums">
                  £{liveCostPerUnit.toFixed(4)} / {watchedUnit || "unit"}
                </span>
              </div>
            )}

            {/* Processing Ratio */}
            <div>
              <label className="text-sm font-medium mb-1 block">
                Processing Ratio
                <span className="ml-2 text-xs font-normal text-muted-foreground">(unchopped → chopped / raw → cooked)</span>
              </label>
              <div className="relative max-w-[160px]">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  {...register("processingRatioPct")}
                  className="w-full px-3 pr-8 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="e.g. 84.70"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">%</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Leave blank for 100% (no processing loss). Used to adjust sub-recipe yield calculations.
              </p>
              {errors.processingRatioPct && <span className="text-destructive text-xs">{String(errors.processingRatioPct.message)}</span>}
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Ingredient Category</label>
              <select
                {...register("category")}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {INGREDIENT_CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                Used to filter ingredients by prep station (Raw Meat, Vegetables, Bases).
              </p>
            </div>

            {showRawMeatTray && (
              <div className="pl-4 border-l-2 border-primary/20 flex flex-col gap-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">
                    Tray Capacity
                    <span className="ml-2 text-xs font-normal text-muted-foreground">(kg per tray)</span>
                  </label>
                  <div className="relative max-w-[160px]">
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      {...register("rawMeatTrayCapacityKg")}
                      className="w-full px-3 pr-10 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                      placeholder="e.g. 10"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">kg</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Used in the raw meat prep station to calculate tray counts.</p>
                  {errors.rawMeatTrayCapacityKg && <span className="text-destructive text-xs">{String(errors.rawMeatTrayCapacityKg.message)}</span>}
                </div>

                <div>
                  <label className="text-sm font-medium mb-1 block">
                    Min Food-Safe Cooking Temperature
                    <span className="ml-2 text-xs font-normal text-muted-foreground">(°C)</span>
                  </label>
                  <div className="relative max-w-[160px]">
                    <input
                      type="number"
                      step="1"
                      min="0"
                      max="300"
                      {...register("minCookingTempC")}
                      className="w-full px-3 pr-10 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                      placeholder="e.g. 75"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">°C</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Minimum internal temperature for safe cooking.</p>
                  {errors.minCookingTempC && <span className="text-destructive text-xs">{String(errors.minCookingTempC.message)}</span>}
                </div>

                <div>
                  <label className="text-sm font-medium mb-1 block">
                    Estimated Cook Time
                    <span className="ml-2 text-xs font-normal text-muted-foreground">(minutes)</span>
                  </label>
                  <div className="relative max-w-[160px]">
                    <input
                      type="number"
                      step="1"
                      min="1"
                      {...register("estimatedCookTimeMin")}
                      className="w-full px-3 pr-12 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                      placeholder="e.g. 45"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">min</span>
                  </div>
                  {errors.estimatedCookTimeMin && <span className="text-destructive text-xs">{String(errors.estimatedCookTimeMin.message)}</span>}
                </div>

                <div>
                  <label className="text-sm font-medium mb-1 block">
                    Oven Temperature
                    <span className="ml-2 text-xs font-normal text-muted-foreground">(°C)</span>
                  </label>
                  <div className="relative max-w-[160px]">
                    <input
                      type="number"
                      step="1"
                      min="0"
                      max="500"
                      {...register("ovenTempC")}
                      className="w-full px-3 pr-10 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                      placeholder="e.g. 180"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">°C</span>
                  </div>
                  {errors.ovenTempC && <span className="text-destructive text-xs">{String(errors.ovenTempC.message)}</span>}
                </div>

                <div>
                  <label className="text-sm font-medium mb-1 block">Steam %</label>
                  <select
                    {...register("steamPct")}
                    className="w-full max-w-[160px] px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    <option value="">— not set —</option>
                    {[0,10,20,30,40,50,60,70,80,90,100].map(v => (
                      <option key={v} value={v}>{v}%</option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground mt-1">Oven steam percentage during cooking.</p>
                  {errors.steamPct && <span className="text-destructive text-xs">{String(errors.steamPct.message)}</span>}
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 py-1">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  {...register("stockCheckEnabled")}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
              </label>
              <div>
                <span className="text-sm font-medium">Requires Stock Check</span>
                <p className="text-xs text-muted-foreground">
                  When enabled, operators must record remaining stock during Main Prep before this ingredient is marked complete.
                </p>
              </div>
            </div>

            {watchedStockCheckEnabled && (
              <div className="pl-4 border-l-2 border-primary/20 flex flex-col gap-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">Check Frequency</label>
                  <select
                    {...register("stockCheckFrequency")}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    <option value="daily">Daily — check every production day</option>
                    <option value="weekly">Weekly — check on a specific day only</option>
                  </select>
                </div>

                {watchedStockCheckFrequency === "weekly" && (
                  <div>
                    <label className="text-sm font-medium mb-1 block">Check Day</label>
                    <select
                      {...register("stockCheckDay")}
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      <option value="">— Select a day —</option>
                      {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(d => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground mt-1">
                      Stock check prompt will only appear on this day of the week.
                    </p>
                  </div>
                )}

                <div>
                  <label className="text-sm font-medium mb-1 block">
                    Surplus %
                    <span className="ml-2 text-xs font-normal text-muted-foreground">(ordering buffer)</span>
                  </label>
                  <div className="relative max-w-[160px]">
                    <input
                      type="number"
                      step="1"
                      min="0"
                      {...register("surplusPercent")}
                      className="w-full px-3 pr-10 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                      placeholder="10"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">%</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Extra % added when calculating order quantities.</p>
                  {errors.surplusPercent && <span className="text-destructive text-xs">{String(errors.surplusPercent.message)}</span>}
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 py-1">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  {...register("kanbanEnabled")}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
              </label>
              <div>
                <span className="text-sm font-medium">Kanban Enabled</span>
                <p className="text-xs text-muted-foreground">
                  Track this ingredient with kanban pull cards for ordering.
                </p>
              </div>
            </div>

            {watchedKanbanEnabled && (
              <div className="pl-4 border-l-2 border-primary/20 space-y-3">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">
                    Order Unit
                    <span className="ml-2 text-xs font-normal text-muted-foreground">(how this ingredient is ordered)</span>
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setValue("kanbanUnit", "weight")}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors",
                        watchedKanbanUnit === "weight"
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background border-border text-muted-foreground hover:text-foreground"
                      )}
                    >
                      Weight ({watchedUnit || "kg"})
                    </button>
                    <button
                      type="button"
                      onClick={() => setValue("kanbanUnit", "pack")}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors",
                        watchedKanbanUnit === "pack"
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background border-border text-muted-foreground hover:text-foreground"
                      )}
                    >
                      Pack
                    </button>
                    <button
                      type="button"
                      onClick={() => setValue("kanbanUnit", "bottle")}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors",
                        watchedKanbanUnit === "bottle"
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background border-border text-muted-foreground hover:text-foreground"
                      )}
                    >
                      Bottle
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {watchedKanbanUnit === "pack"
                      ? "Each kanban card will order a set number of packs (bags, etc.)."
                      : watchedKanbanUnit === "bottle"
                      ? "Each kanban card will order a set number of bottles."
                      : `Each kanban card will order a set weight in ${watchedUnit || "kg"}.`}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">
                    Order when using last
                    <span className="ml-2 text-xs font-normal text-muted-foreground">(quantity per kanban card)</span>
                  </label>
                  <div className="relative max-w-[200px]">
                    <input
                      type="number"
                      step={watchedKanbanUnit === "weight" ? "0.01" : "1"}
                      min="0"
                      {...register("kanbanQuantity")}
                      className="w-full px-3 pr-16 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                      placeholder={watchedKanbanUnit === "weight" ? "e.g. 10" : "e.g. 2"}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">
                      {watchedKanbanUnit === "pack" ? "packs" : watchedKanbanUnit === "bottle" ? "bottles" : (watchedUnit || "unit")}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {watchedKanbanUnit === "pack"
                      ? "Number of packs to order per kanban card."
                      : watchedKanbanUnit === "bottle"
                      ? "Number of bottles to order per kanban card."
                      : "Standard order quantity per kanban card."}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">
                    Order amount
                    <span className="ml-2 text-xs font-normal text-muted-foreground">(added to supplier order when pulled)</span>
                  </label>
                  <div className="relative max-w-[200px]">
                    <input
                      type="number"
                      step={watchedKanbanUnit === "weight" ? "0.01" : "1"}
                      min="0"
                      {...register("kanbanOrderAmount")}
                      className="w-full px-3 pr-16 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                      placeholder="e.g. 13"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">
                      {watchedKanbanUnit === "pack" ? "packs" : watchedKanbanUnit === "bottle" ? "bottles" : (watchedUnit || "unit")}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Quantity added to the supplier order line when this kanban card is pulled.
                  </p>
                </div>
              </div>
            )}

            <div>
              <label className="text-sm font-medium mb-1 block">
                Shelf Life
                <span className="ml-2 text-xs font-normal text-muted-foreground">(days)</span>
              </label>
              <div className="relative max-w-[160px]">
                <input
                  type="number"
                  step="1"
                  min="1"
                  {...register("shelfLifeDays")}
                  className="w-full px-3 pr-14 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="e.g. 5"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">days</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Used for use-by date calculation on deliveries.</p>
              {errors.shelfLifeDays && <span className="text-destructive text-xs">{String(errors.shelfLifeDays.message)}</span>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">Supplier</label>
                <select
                  {...register("supplierId")}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value={0}>— None —</option>
                  {(suppliers ?? []).map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Secondary Supplier</label>
                <select
                  {...register("secondarySupplierId")}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value={0}>— None —</option>
                  {(suppliers ?? []).map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Ordering URL */}
            <div>
              <label className="text-sm font-medium mb-1 block">Ordering URL</label>
              <input
                {...register("orderingUrl")}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="https://supplier.co.uk/product/flour-25kg"
              />
            </div>

            {/* Notes */}
            <div>
              <label className="text-sm font-medium mb-1 block">Notes</label>
              <textarea
                {...register("notes")}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[64px] resize-none"
                placeholder="Allergens, storage, quality notes..."
              />
            </div>

            <button
              type="submit"
              disabled={isPending}
              className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {isPending ? "Saving..." : editingId !== null ? "Save Changes" : "Add Ingredient"}
            </button>
          </form>
        </DialogContent>
      </Dialog>

      <ImportDialog
        open={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onDone={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/ingredients"] });
          queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
        }}
      />

      {/* Table */}
      <div className="rounded-2xl border border-border overflow-hidden bg-card">
        <div className="p-4 border-b border-border flex flex-wrap items-center gap-3 bg-secondary/20">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or brand..."
              className="w-full pl-9 pr-4 py-2 bg-background border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <select
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
            className="px-3 py-2 bg-background border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none pr-8 cursor-pointer"
          >
            <option value="all">All Types</option>
            {INGREDIENT_CATEGORIES.filter(c => c.value !== "").map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
            <option value="uncategorised">Uncategorised</option>
          </select>

          <select
            value={filterStockCheck}
            onChange={e => setFilterStockCheck(e.target.value)}
            className="px-3 py-2 bg-background border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none pr-8 cursor-pointer"
          >
            <option value="all">All Stock Check</option>
            <option value="enabled">Stock Checked ✓</option>
            <option value="disabled">Not Checked</option>
          </select>

          <select
            value={filterSupplier}
            onChange={e => setFilterSupplier(e.target.value)}
            className="px-3 py-2 bg-background border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none pr-8 cursor-pointer"
          >
            <option value="all">All Suppliers</option>
            {(suppliers ?? []).map(s => (
              <option key={s.id} value={String(s.id)}>{s.name}</option>
            ))}
            <option value="none">No Supplier</option>
          </select>

          {(filterCategory !== "all" || filterStockCheck !== "all" || filterSupplier !== "all" || search) && (
            <button
              onClick={() => { setFilterCategory("all"); setFilterStockCheck("all"); setFilterSupplier("all"); setSearch(""); }}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 whitespace-nowrap"
            >
              Clear filters
            </button>
          )}

          <span className="text-sm text-muted-foreground whitespace-nowrap ml-auto">{filtered?.length ?? 0} items</span>
        </div>

        {isLoading ? (
          <div className="p-12 flex justify-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : filtered?.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            <p className="text-lg font-medium">No ingredients found</p>
            <p className="text-sm mt-1">Add your first ingredient to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-secondary/30 text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Brand</th>
                  <th className="px-5 py-3 font-medium">Part No.</th>
                  <th className="px-5 py-3 font-medium">Unit</th>
                  <th className="px-5 py-3 font-medium">Pack Size</th>
                  <th className="px-5 py-3 font-medium">Cost / Pack</th>
                  <th className="px-5 py-3 font-medium">Cost / Unit</th>
                  <th className="px-5 py-3 font-medium">Proc. Ratio</th>
                  <th className="px-5 py-3 font-medium">Supplier</th>
                  <th className="px-5 py-3 font-medium">2nd Supplier</th>
                  <th className="px-5 py-3 font-medium">Order</th>
                  <th className="px-5 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {filtered?.map((item) => {
                  const packWeight = Number(item.packWeight);
                  const costPerPack = Number(item.costPerPack);
                  const costPerUnit = packWeight > 0 ? costPerPack / packWeight : 0;
                  return (
                    <tr key={item.id} className="hover:bg-secondary/10 transition-colors">
                      <td className="px-5 py-3 font-medium whitespace-nowrap">
                        <button
                          onClick={() => openEdit(item)}
                          className="hover:text-primary hover:underline underline-offset-2 transition-colors text-left"
                        >
                          {item.name}
                        </button>
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{item.brand || <span className="text-border">—</span>}</td>
                      <td className="px-5 py-3 text-muted-foreground font-mono text-xs">{item.supplierPartNumber || <span className="text-border">—</span>}</td>
                      <td className="px-5 py-3 text-muted-foreground">{item.unit}</td>
                      <td className="px-5 py-3">{packWeight} {item.unit}</td>
                      <td className="px-5 py-3 font-medium">£{costPerPack.toFixed(2)}</td>
                      <td className="px-5 py-3 text-muted-foreground">£{costPerUnit.toFixed(4)}/{item.unit}</td>
                      <td className="px-5 py-3">
                        {item.processingRatio != null ? (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${item.processingRatio < 1 ? "bg-amber-50 text-amber-700" : "bg-secondary/60 text-muted-foreground"}`}>
                            {(item.processingRatio * 100).toFixed(2)}%
                          </span>
                        ) : (
                          <span className="text-border">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {item.supplierId ? supplierMap[item.supplierId] ?? <span className="text-border">—</span> : <span className="text-border">—</span>}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {item.secondarySupplierId ? supplierMap[item.secondarySupplierId] ?? <span className="text-border">—</span> : <span className="text-border">—</span>}
                      </td>
                      <td className="px-5 py-3">
                        {item.orderingUrl ? (
                          <a
                            href={item.orderingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-primary hover:underline text-xs"
                          >
                            <ExternalLink className="w-3 h-3" /> Link
                          </a>
                        ) : (
                          <span className="text-border">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEdit(item)}
                            className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors"
                            title="Edit"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => { if (confirm(`Delete "${item.name}"?`)) deleteIngredient.mutate({ id: item.id }, { onSuccess: invalidateCostTouchpoints }); }}
                            className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
