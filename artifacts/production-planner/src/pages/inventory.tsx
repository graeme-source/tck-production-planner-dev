import { useState, useRef, useMemo } from "react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useListIngredients, useListSuppliers } from "@workspace/api-client-react";
import type { Ingredient } from "@workspace/api-client-react";
import { useAppMutations } from "@/hooks/use-mutations";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import {
  Search, Plus, Trash2, Edit2, Loader2, ExternalLink, Upload,
  FileText, CheckCircle2, XCircle, AlertTriangle, RefreshCw,
  Carrot, Box, ChevronDown, Printer,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ingredientFormSchema,
  emptyIngredientFormDefaults,
  ingredientToFormValues,
  buildIngredientPayload,
  type IngredientFormValues,
} from "@/lib/ingredient-form";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import Papa from "papaparse";
import { useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type TabType = "ingredients" | "supplies";

const INGREDIENT_CATEGORIES = [
  { value: "", label: "— No category —" },
  { value: "raw_meat", label: "Raw Meat" },
  { value: "cooked_meat", label: "Cooked Meat" },
  { value: "vegetable", label: "Vegetable" },
  { value: "base", label: "Base (Sauce/Mozzarella)" },
  { value: "sauce", label: "Sauce" },
  { value: "cheese", label: "Cheese" },
  { value: "seasoning", label: "Seasoning/Spice" },
  { value: "pasta", label: "Pasta" },
  { value: "dough", label: "Dough" },
  { value: "packaging", label: "Packaging" },
  { value: "other", label: "Other" },
] as const;

const SUPPLY_CATEGORIES = [
  { value: "", label: "— No category —" },
  { value: "packaging", label: "Packaging & Containers" },
  { value: "courier", label: "Courier & Shipping" },
  { value: "insulation", label: "Insulation & Cool Packs" },
  { value: "tape_labels", label: "Tape & Labels" },
  { value: "cleaning", label: "Cleaning Supplies" },
  { value: "trays", label: "Trays & Bakeware" },
  { value: "other", label: "Other" },
] as const;

const UK14_ALLERGENS = [
  { value: "celery", label: "Celery" },
  { value: "cereals_containing_gluten", label: "Cereals containing Gluten" },
  { value: "crustaceans", label: "Crustaceans" },
  { value: "eggs", label: "Eggs" },
  { value: "fish", label: "Fish" },
  { value: "lupin", label: "Lupin" },
  { value: "milk", label: "Milk" },
  { value: "molluscs", label: "Molluscs" },
  { value: "mustard", label: "Mustard" },
  { value: "nuts", label: "Nuts" },
  { value: "peanuts", label: "Peanuts" },
  { value: "sesame", label: "Sesame" },
  { value: "soybeans", label: "Soybeans" },
  { value: "sulphur_dioxide", label: "Sulphur Dioxide" },
] as const;

const schema = ingredientFormSchema;
type FormValues = IngredientFormValues;

function emptyDefaults(mode: TabType): FormValues {
  return emptyIngredientFormDefaults(mode === "supplies" ? "supply" : "ingredient");
}

function categoryLabel(value: string | null | undefined, isPerishable: boolean): string {
  const cats = isPerishable ? INGREDIENT_CATEGORIES : SUPPLY_CATEGORIES;
  return (cats as readonly { value: string; label: string }[]).find(c => c.value === value)?.label ?? value ?? "—";
}

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

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface KanbanCardData {
  id: number;
  name: string;
  unit: string;
  packWeight: number;
  kanbanQuantity: number;
  kanbanUnit: string;
  kanbanOrderAmount: number | null;
  supplier: string | null;
  location: string | null;
  qrCodeUrl: string | null;
}

async function printKanban(ingredientId: number) {
  const [cardResp, qrResp] = await Promise.all([
    fetch(`${BASE}/api/ingredients/${ingredientId}/kanban-card`, { credentials: "include" }),
    fetch(`${BASE}/api/qr/ingredient/${ingredientId}`, { credentials: "include" }),
  ]);
  if (!cardResp.ok) return;
  const card: KanbanCardData = await cardResp.json();

  let qrDataUrl = "";
  if (qrResp.ok) {
    const blob = await qrResp.blob();
    qrDataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  }

  const safeName = escapeHtml(card.name);
  const pullQty = card.kanbanQuantity > 0
    ? `${card.kanbanQuantity} ${card.kanbanUnit === "packs" ? "pack" + (card.kanbanQuantity > 1 ? "s" : "") : card.unit}`
    : "Not set";
  const orderAmt = card.kanbanOrderAmount
    ? `${card.kanbanOrderAmount} ${card.kanbanUnit === "packs" ? "pack" + (card.kanbanOrderAmount > 1 ? "s" : "") : card.unit}`
    : "Not set";
  const supplier = escapeHtml(card.supplier ?? "Not assigned");
  const location = escapeHtml(card.location ?? "Not assigned");

  const w = window.open("", "_blank", "width=600,height=900");
  if (!w) return;
  w.document.write(`<!DOCTYPE html><html><head><title>Kanban — ${safeName}</title>
<style>
  @page { size: A6 landscape; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 0; }

  .page { width: 148mm; height: 105mm; position: relative; page-break-after: always; overflow: hidden; }

  /* === FRONT SIDE === */
  .front { background: #fffdf0; border: 2px solid #919b5f; }
  .front .header { background: #919b5f; color: white; padding: 6mm 8mm 5mm; }
  .front .header h1 { font-size: 16pt; font-weight: 700; letter-spacing: 0.5px; }
  .front .header .subtitle { font-size: 8pt; opacity: 0.85; margin-top: 1mm; text-transform: uppercase; letter-spacing: 1px; }
  .front .body { display: flex; padding: 5mm 8mm 4mm; gap: 6mm; }
  .front .fields { flex: 1; display: flex; flex-direction: column; gap: 3.5mm; }
  .front .field { border-bottom: 1px solid #d6c38c; padding-bottom: 2.5mm; }
  .front .field-label { font-size: 7pt; text-transform: uppercase; letter-spacing: 0.8px; color: #919b5f; font-weight: 600; margin-bottom: 1mm; }
  .front .field-value { font-size: 11pt; font-weight: 600; color: #3b4317; }
  .front .qr-section { display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 64mm; }
  .front .qr-section img { width: 60mm; height: 60mm; }
  .front .qr-label { font-size: 6pt; color: #919b5f; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2mm; text-align: center; }
  .front .footer { position: absolute; bottom: 0; left: 0; right: 0; background: #3b4317; color: #fffdf0; text-align: center; padding: 2.5mm; font-size: 7pt; letter-spacing: 1px; text-transform: uppercase; }

  /* === BACK SIDE (flipped for fold) === */
  .back { background: #ffbe23; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; transform: rotate(180deg); }
  .back .alert-icon { font-size: 36pt; margin-bottom: 4mm; }
  .back .alert-title { font-size: 20pt; font-weight: 800; color: #3b4317; text-transform: uppercase; letter-spacing: 1.5px; line-height: 1.2; }
  .back .alert-subtitle { font-size: 10pt; color: #3b4317; margin-top: 3mm; font-weight: 500; }
  .back .item-name { font-size: 13pt; font-weight: 700; color: #3b4317; margin-top: 5mm; padding: 2mm 6mm; background: rgba(255,255,255,0.4); border-radius: 3mm; }

  .no-print { text-align: center; padding: 16px; background: #f5f5f5; }
  .no-print button { padding: 10px 32px; font-size: 14px; cursor: pointer; border: 1px solid #ccc; border-radius: 8px; background: white; margin: 0 8px; }
  .no-print button:hover { background: #eee; }
  @media print { .no-print { display: none; } }
</style></head><body>

<div class="no-print">
  <button onclick="window.print()">Print Kanban Card</button>
  <button onclick="window.close()">Close</button>
</div>

<!-- FRONT SIDE -->
<div class="page front">
  <div class="header">
    <h1>${safeName}</h1>
    <div class="subtitle">Kanban Card — The Calzone Kitchen</div>
  </div>
  <div class="body">
    <div class="fields">
      <div class="field">
        <div class="field-label">Pull When Using Last</div>
        <div class="field-value">${escapeHtml(pullQty)}</div>
      </div>
      <div class="field">
        <div class="field-label">Order Amount</div>
        <div class="field-value">${escapeHtml(orderAmt)}</div>
      </div>
      <div class="field">
        <div class="field-label">Location</div>
        <div class="field-value">${location}</div>
      </div>
      <div class="field">
        <div class="field-label">Supplier</div>
        <div class="field-value">${supplier}</div>
      </div>
    </div>
    <div class="qr-section">
      ${qrDataUrl ? `<img src="${qrDataUrl}" alt="QR Code" />` : '<div style="width:60mm;height:60mm;border:1px dashed #ccc;display:flex;align-items:center;justify-content:center;font-size:8pt;color:#999;">No QR</div>'}
      <div class="qr-label">Scan to pull</div>
    </div>
  </div>
  <div class="footer">Pull — Scan QR or notify manager</div>
</div>

<!-- BACK SIDE (rotated 180° so when folded it reads correctly) -->
<div class="page back">
  <div class="alert-icon">\u26A0\uFE0F</div>
  <div class="alert-title">Kanban Pulled</div>
  <div class="alert-subtitle">Item on Order</div>
  <div class="item-name">${safeName}</div>
</div>

</body></html>`);
  w.document.close();
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
    method: "POST", headers: { "Content-Type": "application/json" },
    credentials: "include", body: JSON.stringify({ rows, dryRun }),
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

  function reset() { setStep("upload"); setParsedRows([]); setFileName(""); setPreview(null); setResult(null); setError(null); }
  function handleClose() { reset(); onClose(); }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name); setError(null);
    Papa.parse<Record<string, string>>(file, {
      header: true, skipEmptyLines: true,
      transformHeader: h => h.trim().toLowerCase().replace(/\s+/g, "_"),
      complete: (res) => {
        const rows = (res.data as Record<string, string>[]).filter(r => !String(Object.values(r)[0] ?? "").startsWith("#"));
        if (rows.length === 0) { setError("No data rows found in the file."); return; }
        setParsedRows(rows);
      },
      error: (err: { message: string }) => setError(err.message),
    });
    e.target.value = "";
  }

  async function runPreview() {
    setLoading(true); setError(null);
    try { setPreview(await callImport(parsedRows, true)); setStep("preview"); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setLoading(false); }
  }

  async function runImport() {
    setLoading(true); setError(null);
    try { setResult(await callImport(parsedRows, false)); setStep("done"); onDone(); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setLoading(false); }
  }

  const blockingIssues = preview?.issues.filter(i => i.message.includes("skipped")) ?? [];
  const warningIssues = preview?.issues.filter(i => !i.message.includes("skipped")) ?? [];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[680px] bg-card border-border rounded-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Import Ingredients from CSV</DialogTitle>
        </DialogHeader>
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
        {error && <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm mb-3"><XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /><span>{error}</span></div>}

        {step === "upload" && (
          <div className="space-y-4">
            <div className="p-4 bg-secondary/30 rounded-xl border border-border text-sm space-y-1">
              <p className="font-medium">How it works:</p>
              <ul className="text-muted-foreground space-y-1 list-disc list-inside">
                <li>Download the template, fill in your ingredients, save as CSV</li>
                <li>Existing ingredients (matched by name) will be <span className="text-amber-600 font-medium">updated</span></li>
                <li>New ingredients will be <span className="text-emerald-600 font-medium">created</span></li>
              </ul>
            </div>
            <button onClick={downloadTemplate} className="flex items-center gap-2 px-4 py-2.5 border border-border rounded-xl text-sm font-medium hover:bg-secondary/50 transition-colors">
              <FileText className="w-4 h-4" /> Download CSV Template
            </button>
            <div>
              <label className="text-sm font-medium mb-2 block">Upload your CSV file</label>
              <div onClick={() => fileRef.current?.click()} className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-secondary/20 transition-colors">
                <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                {fileName ? <p className="font-medium text-foreground">{fileName}</p> : <p className="text-muted-foreground text-sm">Click to select a CSV file</p>}
                {parsedRows.length > 0 && <p className="text-xs text-emerald-600 mt-1 font-medium">{parsedRows.length} rows ready</p>}
              </div>
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={handleClose} className="px-4 py-2 text-sm rounded-xl border border-border hover:bg-secondary/50 transition-colors">Cancel</button>
              <button onClick={runPreview} disabled={parsedRows.length === 0 || loading} className="px-5 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium disabled:opacity-50 flex items-center gap-2 hover:bg-primary/90 transition-colors">
                {loading && <RefreshCw className="w-4 h-4 animate-spin" />} Preview Import
              </button>
            </div>
          </div>
        )}

        {step === "preview" && preview && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <span className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-sm font-medium border border-emerald-200">{preview.created.length} new</span>
              <span className="px-3 py-1 rounded-full bg-amber-50 text-amber-700 text-sm font-medium border border-amber-200">{preview.updated.length} updates</span>
              {blockingIssues.length > 0 && <span className="px-3 py-1 rounded-full bg-destructive/10 text-destructive text-sm font-medium border border-destructive/20">{blockingIssues.length} skipped</span>}
              {warningIssues.length > 0 && <span className="px-3 py-1 rounded-full bg-orange-50 text-orange-700 text-sm font-medium border border-orange-200">{warningIssues.length} warning{warningIssues.length !== 1 ? "s" : ""}</span>}
            </div>
            {preview.issues.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium">Issues:</p>
                <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
                  {preview.issues.map((issue, i) => (
                    <div key={i} className={`flex items-start gap-3 px-4 py-2.5 text-sm ${issue.message.includes("skipped") ? "bg-destructive/5" : "bg-amber-50/50"}`}>
                      {issue.message.includes("skipped") ? <XCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />}
                      <span className="text-muted-foreground">Row {issue.row} · <span className="font-mono text-xs">{issue.field}</span>: {issue.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {preview.created.length > 0 && (
              <details className="rounded-xl border border-border overflow-hidden">
                <summary className="px-4 py-3 text-sm font-medium bg-secondary/20 cursor-pointer">New items ({preview.created.length})</summary>
                <div className="px-4 py-3 grid grid-cols-2 gap-x-4 gap-y-1 max-h-48 overflow-y-auto">
                  {preview.created.map((c, i) => <div key={i} className="flex items-center gap-1.5 text-sm"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" /><span className="truncate">{c.name}</span></div>)}
                </div>
              </details>
            )}
            <div className="flex justify-between gap-2 pt-2">
              <button onClick={() => setStep("upload")} className="px-4 py-2 text-sm rounded-xl border border-border hover:bg-secondary/50 transition-colors">← Back</button>
              <div className="flex gap-2">
                <button onClick={handleClose} className="px-4 py-2 text-sm rounded-xl border border-border hover:bg-secondary/50 transition-colors">Cancel</button>
                <button onClick={runImport} disabled={loading || (preview.created.length === 0 && preview.updated.length === 0)} className="px-5 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium disabled:opacity-50 flex items-center gap-2">
                  {loading && <RefreshCw className="w-4 h-4 animate-spin" />} Confirm Import ({preview.created.length + preview.updated.length} items)
                </button>
              </div>
            </div>
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
              <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0" />
              <div><p className="font-semibold text-emerald-800">Import complete</p><p className="text-sm text-emerald-700">{result.created.length} created · {result.updated.length} updated</p></div>
            </div>
            <div className="flex justify-end"><button onClick={handleClose} className="px-5 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors">Close</button></div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ItemFormDialog({
  open, onClose, editingItem, defaultMode, suppliers,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  editingItem: Ingredient | null;
  defaultMode: TabType;
  suppliers: { id: number; name: string }[];
  onSave: (data: FormValues, id: number | null) => void;
}) {
  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: emptyDefaults(defaultMode),
  });

  const formMode = watch("formMode");
  const isIngredient = formMode === "ingredient";
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
  const showRawMeatTray = isIngredient && watchedCategory === "raw_meat";

  const populateForm = (item: Ingredient | null, mode: TabType) => {
    if (!item) { reset(emptyDefaults(mode)); return; }
    reset(ingredientToFormValues(item, mode === "supplies" ? "supply" : "ingredient"));
  };

  const [initialized, setInitialized] = useState(false);
  const [nutritionOpen, setNutritionOpen] = useState(false);
  if (open && !initialized) { populateForm(editingItem, defaultMode); setInitialized(true); }
  if (!open && initialized) { setInitialized(false); setNutritionOpen(false); }

  const switchMode = (mode: "ingredient" | "supply") => {
    setValue("formMode", mode);
    setValue("category", "");
  };

  const watchedAllergens = watch("allergens") ?? [];
  const toggleAllergen = (val: string) => {
    const cur = watchedAllergens;
    setValue("allergens", cur.includes(val) ? cur.filter((a: string) => a !== val) : [...cur, val]);
  };

  const onSubmit = (data: FormValues) => {
    onSave(data, editingItem?.id ?? null);
  };

  const inputClass = "w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";
  const numInputClass = "w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-[640px] bg-card border-border rounded-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            {editingItem ? "Edit Item" : "Add New Item"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-1 p-1 bg-secondary/40 rounded-xl mt-2 mb-1">
          <button
            type="button"
            onClick={() => switchMode("ingredient")}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all",
              formMode === "ingredient"
                ? "bg-card shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Carrot className="w-4 h-4" /> Ingredient
          </button>
          <button
            type="button"
            onClick={() => switchMode("supply")}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all",
              formMode === "supply"
                ? "bg-card shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Box className="w-4 h-4" /> Supply
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-4 text-center">
          {formMode === "ingredient"
            ? "Perishable food item used in recipes"
            : "Non-perishable packaging, courier materials or supplies"}
        </p>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="text-sm font-medium mb-1 block">Name *</label>
              <input {...register("name")} className={inputClass} placeholder={formMode === "ingredient" ? "e.g. Organic Plain Flour" : "e.g. Courier Box (Large)"} />
              {errors.name && <span className="text-destructive text-xs">{errors.name.message}</span>}
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Unit *</label>
              <select {...register("unit")} className={inputClass}>
                <option value="kg">kg</option>
                <option value="g">g</option>
                <option value="l">L</option>
                <option value="ml">ml</option>
                <option value="pieces">pieces</option>
                {/* Packaging-style units are only valid for non-ingredient
                    supplies. Ingredients must always use native weight/volume
                    units so prep, recipe and cost maths stay consistent. */}
                {formMode === "supply" && (
                  <>
                    <option value="box">box</option>
                    <option value="bag">bag</option>
                    <option value="tub">tub</option>
                    <option value="each">each</option>
                    <option value="roll">roll</option>
                    <option value="sheet">sheet</option>
                  </>
                )}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Brand</label>
              <input {...register("brand")} className={inputClass} placeholder="e.g. Jiffy" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Supplier Part No.</label>
              <input {...register("supplierPartNumber")} className={inputClass} placeholder="e.g. JF-BOX-L" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Pack size ({watchedUnit || "unit"}) *</label>
              <input type="number" step="0.001" {...register("packWeight")} className={numInputClass} placeholder="e.g. 50" />
              <p className="text-xs text-muted-foreground mt-1">How many {watchedUnit || "units"} in one pack</p>
              {errors.packWeight && <span className="text-destructive text-xs">{errors.packWeight.message}</span>}
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Cost per pack (£) *</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">£</span>
                <input type="number" step="0.01" {...register("costPerPack")} className="w-full pl-7 pr-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="0.00" />
              </div>
              {errors.costPerPack && <span className="text-destructive text-xs">{errors.costPerPack.message}</span>}
            </div>
          </div>

          {liveCostPerUnit !== null && (
            <div className="rounded-lg bg-secondary/30 border border-border px-3.5 py-2.5 text-sm flex items-center justify-between">
              <span className="text-muted-foreground">Implied cost per {watchedUnit || "unit"}:</span>
              <span className="font-semibold tabular-nums">£{liveCostPerUnit.toFixed(4)} / {watchedUnit || "unit"}</span>
            </div>
          )}

          {!isIngredient && (
            <div>
              <label className="text-sm font-medium mb-1 block">Pallet Size <span className="text-xs font-normal text-muted-foreground">(packs per pallet)</span></label>
              <input type="number" step="1" min="1" {...register("palletSize")} className={cn(numInputClass, "max-w-[160px]")} placeholder="e.g. 48" />
              <p className="text-xs text-muted-foreground mt-1">How many packs fit on a full pallet. Used for bulk ordering calculations.</p>
              {errors.palletSize && <span className="text-destructive text-xs">{String(errors.palletSize.message)}</span>}
            </div>
          )}

          <div>
            <label className="text-sm font-medium mb-1 block">
              {isIngredient ? "Ingredient Category" : "Supply Category"}
            </label>
            <select {...register("category")} className={inputClass}>
              {(isIngredient ? INGREDIENT_CATEGORIES : SUPPLY_CATEGORIES).map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          {isIngredient && (
            <>
              <div>
                <label className="text-sm font-medium mb-1 block">
                  Processing Ratio <span className="text-xs font-normal text-muted-foreground">(unchopped → chopped / raw → cooked)</span>
                </label>
                <div className="relative max-w-[160px]">
                  <input type="number" step="0.01" min="0" max="100" {...register("processingRatioPct")} className={cn(numInputClass, "pr-8")} placeholder="e.g. 84.70" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">%</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Leave blank for 100% (no loss). Adjusts sub-recipe yield.</p>
                {errors.processingRatioPct && <span className="text-destructive text-xs">{String(errors.processingRatioPct.message)}</span>}
              </div>

              {watchedProcessingRatioPct != null && watchedProcessingRatioPct < 100 && (
                <div className="pl-4 border-l-2 border-primary/20">
                  <label className="text-sm font-medium mb-1 block">Prep Weighing Point</label>
                  <select {...register("prepWeightMode")} className={cn(numInputClass, "max-w-[280px]")}>
                    <option value="raw">Raw weight (weigh before processing)</option>
                    <option value="processed">Processed weight (weigh after processing)</option>
                  </select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Controls which weight the prep station shows. Use "processed" for ingredients where staff chop/pick then weigh the exact amount (e.g. basil, fresh veg).
                  </p>
                </div>
              )}

              <div>
                <label className="text-sm font-medium mb-1 block">Shelf Life <span className="text-xs font-normal text-muted-foreground">(days)</span></label>
                <div className="relative max-w-[160px]">
                  <input type="number" step="1" min="1" {...register("shelfLifeDays")} className={cn(numInputClass, "pr-12")} placeholder="e.g. 7" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">days</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Auto-calculates use-by dates on deliveries.</p>
              </div>

              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" {...register("requiresUseByDate")} className="w-4 h-4 rounded border-border" />
                  <span className="text-sm font-medium">Require use-by date at goods-in</span>
                </label>
                <p className="text-xs text-muted-foreground mt-1 ml-6">When on, staff must enter a use-by date for this ingredient when receiving a delivery.</p>
              </div>

              <div className="bg-secondary/30 rounded-lg px-4 py-3">
                <label className="text-sm font-medium mb-1 block">
                  Prep count per portion
                  <span className="ml-2 text-xs font-normal text-muted-foreground">(optional)</span>
                </label>
                <div className="relative max-w-[160px]">
                  <input
                    type="number"
                    step="1"
                    min="1"
                    {...register("prepCountPerPortion")}
                    className={cn(numInputClass, "pr-14")}
                    placeholder="e.g. 2"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none">pieces</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  When set, the prep station shows this ingredient as a count of pieces (portions × this number) instead of weight — e.g. Pigs &amp; Blankets at 2 per portion for a 24-portion batch renders as &ldquo;48 pieces&rdquo;. Recipe quantity stays in the ingredient&rsquo;s native unit for ordering and stock. Leave blank for normal weight-based prep.
                </p>
                {errors.prepCountPerPortion && <span className="text-destructive text-xs">{String(errors.prepCountPerPortion.message)}</span>}
              </div>
            </>
          )}

          {showRawMeatTray && (
            <div className="pl-4 border-l-2 border-primary/20 flex flex-col gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">Tray Capacity <span className="text-xs font-normal text-muted-foreground">(kg per tray)</span></label>
                <div className="relative max-w-[160px]">
                  <input type="number" step="0.1" min="0" {...register("rawMeatTrayCapacityKg")} className={cn(numInputClass, "pr-10")} placeholder="e.g. 10" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">kg</span>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Min Cooking Temp <span className="text-xs font-normal text-muted-foreground">(°C)</span></label>
                <div className="relative max-w-[160px]">
                  <input type="number" step="1" min="0" max="300" {...register("minCookingTempC")} className={cn(numInputClass, "pr-10")} placeholder="e.g. 75" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">°C</span>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Estimated Cook Time <span className="text-xs font-normal text-muted-foreground">(minutes)</span></label>
                <div className="relative max-w-[160px]">
                  <input type="number" step="1" min="1" {...register("estimatedCookTimeMin")} className={cn(numInputClass, "pr-12")} placeholder="e.g. 45" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">min</span>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Oven Temperature <span className="text-xs font-normal text-muted-foreground">(°C)</span></label>
                <div className="relative max-w-[160px]">
                  <input type="number" step="1" min="0" max="500" {...register("ovenTempC")} className={cn(numInputClass, "pr-10")} placeholder="e.g. 180" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">°C</span>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Steam %</label>
                <select {...register("steamPct")} className={cn(inputClass, "max-w-[160px]")}>
                  <option value="">— not set —</option>
                  {[0,10,20,30,40,50,60,70,80,90,100].map(v => <option key={v} value={v}>{v}%</option>)}
                </select>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Primary Supplier</label>
              <select {...register("supplierId")} className={inputClass}>
                <option value="0">— No supplier —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Secondary Supplier</label>
              <select {...register("secondarySupplierId")} className={inputClass}>
                <option value="0">— None —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">Ordering URL</label>
            <input {...register("orderingUrl")} className={inputClass} placeholder="https://..." />
          </div>

          <div className="flex items-center gap-3 py-1">
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" {...register("stockCheckEnabled")} className="sr-only peer" />
              <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
            </label>
            <div>
              <span className="text-sm font-medium">Requires Stock Check</span>
              <p className="text-xs text-muted-foreground">Operators must record remaining stock during Main Prep.</p>
            </div>
          </div>

          {watchedStockCheckEnabled && (
            <div className="pl-4 border-l-2 border-primary/20 flex flex-col gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">Check Frequency</label>
                <select {...register("stockCheckFrequency")} className={inputClass}>
                  <option value="daily">Daily — check every production day</option>
                  <option value="weekly">Weekly — check on a specific day only</option>
                </select>
              </div>
              {watchedStockCheckFrequency === "weekly" && (
                <div>
                  <label className="text-sm font-medium mb-1 block">Check Day</label>
                  <select {...register("stockCheckDay")} className={inputClass}>
                    <option value="">— Select a day —</option>
                    {["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="text-sm font-medium mb-1 block">Surplus % <span className="text-xs font-normal text-muted-foreground">(ordering buffer)</span></label>
                <div className="relative max-w-[160px]">
                  <input type="number" step="1" min="0" {...register("surplusPercent")} className={cn(numInputClass, "pr-8")} placeholder="10" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">%</span>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 py-1">
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" {...register("kanbanEnabled")} className="sr-only peer" />
              <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
            </label>
            <div>
              <span className="text-sm font-medium">Kanban Enabled</span>
              <p className="text-xs text-muted-foreground">Item appears in the kanban reorder system.</p>
            </div>
          </div>

          {watchedKanbanEnabled && (
            <div className="pl-4 border-l-2 border-primary/20 flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">Kanban Unit</label>
                  <select {...register("kanbanUnit")} className={inputClass}>
                    <option value="weight">Weight (kg/g/L)</option>
                    <option value="pack">Pack</option>
                    <option value="bottle">Bottle</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Trigger Quantity</label>
                  <input type="number" step="0.1" min="0" {...register("kanbanQuantity")} className={numInputClass} placeholder="e.g. 10" />
                  <p className="text-xs text-muted-foreground mt-1">Pull card when stock reaches this level.</p>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Order Amount</label>
                <input type="number" step="0.1" min="0" {...register("kanbanOrderAmount")} className={cn(numInputClass, "max-w-[160px]")} placeholder="e.g. 50" />
                <p className="text-xs text-muted-foreground mt-1">Quantity to order when card is pulled.</p>
              </div>
            </div>
          )}

          {isIngredient && (
            <div className="border border-amber-300/50 rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => setNutritionOpen(!nutritionOpen)}
                className="w-full flex items-center justify-between px-4 py-3 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-950/50 transition-colors"
              >
                <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">Nutritionals &amp; Labelling</span>
                <ChevronDown className={cn("w-4 h-4 text-amber-600 transition-transform", nutritionOpen && "rotate-180")} />
              </button>
              {nutritionOpen && (
                <div className="px-4 py-4 space-y-4 bg-card">
                  <p className="text-xs text-muted-foreground">All values per 100 g as supplied.</p>
                  <div className="grid grid-cols-4 gap-3">
                    {([
                      { field: "energyKj", label: "Energy (kJ)" },
                      { field: "energyKcal", label: "Energy (kcal)" },
                      { field: "fat", label: "Fat (g)" },
                      { field: "saturates", label: "Saturates (g)" },
                      { field: "carbohydrate", label: "Carbs (g)" },
                      { field: "sugars", label: "Sugars (g)" },
                      { field: "protein", label: "Protein (g)" },
                      { field: "fibre", label: "Fibre (g)" },
                      { field: "salt", label: "Salt (g)" },
                    ] as const).map(({ field, label }) => (
                      <div key={field}>
                        <label className="text-xs font-medium mb-1 block">{label}</label>
                        <input type="number" step="0.01" min="0" {...register(field)} className={numInputClass} placeholder="0.00" />
                      </div>
                    ))}
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Label Declaration</label>
                    <textarea {...register("labelDeclaration")} rows={2} className={cn(inputClass, "resize-none")} placeholder='e.g. "Wheat Flour (Wheat, Calcium Carbonate, Iron, Niacin, Thiamin)"' />
                    <p className="text-xs text-muted-foreground mt-1">How this ingredient appears in the product ingredient deck.</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Allergens (UK14)</label>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {UK14_ALLERGENS.map(a => (
                        <button
                          key={a.value}
                          type="button"
                          onClick={() => toggleAllergen(a.value)}
                          className={cn(
                            "px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                            watchedAllergens.includes(a.value)
                              ? "bg-red-100 border-red-300 text-red-800 dark:bg-red-900/40 dark:border-red-700 dark:text-red-300"
                              : "bg-secondary/40 border-border text-muted-foreground hover:bg-secondary"
                          )}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <label className="text-sm font-medium mb-1 block">Notes</label>
            <textarea {...register("notes")} rows={2} className={cn(inputClass, "resize-none")} placeholder="Any additional notes..." />
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-border">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-xl border border-border hover:bg-secondary/50 transition-colors">Cancel</button>
            <button type="submit" className="px-5 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm shadow-primary/20">
              {editingItem ? "Save Changes" : formMode === "ingredient" ? "Add Ingredient" : "Add Supply"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const buildPayload = buildIngredientPayload;

export default function Inventory() {
  const searchStr = useSearch();
  const params = new URLSearchParams(searchStr);
  const rawTab = params.get("tab");
  const activeTab: TabType = rawTab === "supplies" ? "supplies" : "ingredients";

  const { data: allIngredients, isLoading } = useListIngredients();
  const { data: suppliers } = useListSuppliers();
  const { createIngredient, updateIngredient, deleteIngredient } = useAppMutations();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterUsage, setFilterUsage] = useState<"all" | "used" | "unused">("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Ingredient | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const [isPending, setIsPending] = useState(false);

  const tabItems = useMemo(() => {
    return (allIngredients ?? []).filter(i => {
      const itemPerishable = (i as Record<string, unknown>).perishable !== false;
      return activeTab === "ingredients" ? itemPerishable : !itemPerishable;
    });
  }, [allIngredients, activeTab]);

  const filtered = useMemo(() => {
    return tabItems.filter(i => {
      const matchesSearch =
        i.name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        (i.brand ?? "").toLowerCase().includes(debouncedSearch.toLowerCase());
      const matchesCategory =
        filterCategory === "all" ||
        (filterCategory === "uncategorised" ? !i.category : i.category === filterCategory);
      const rec = i as Record<string, unknown>;
      const totalUsage = (Number(rec.usedInRecipes) || 0) + (Number(rec.usedInSubRecipes) || 0);
      const matchesUsage =
        filterUsage === "all" ||
        (filterUsage === "used" ? totalUsage > 0 : totalUsage === 0);
      return matchesSearch && matchesCategory && matchesUsage;
    });
  }, [tabItems, debouncedSearch, filterCategory, filterUsage]);

  const supplierMap = Object.fromEntries((suppliers ?? []).map(s => [s.id, s.name]));
  const categoryOptions = activeTab === "ingredients" ? INGREDIENT_CATEGORIES : SUPPLY_CATEGORIES;

  const openAdd = () => { setEditingItem(null); setIsDialogOpen(true); };
  const openEdit = (item: Ingredient) => { setEditingItem(item); setIsDialogOpen(true); };

  const handleSave = (data: FormValues, id: number | null) => {
    const payload = buildPayload(data);
    setIsPending(true);
    if (id !== null) {
      updateIngredient.mutate({ id, data: payload }, {
        onSuccess: () => { setIsDialogOpen(false); setEditingItem(null); setIsPending(false); },
        onError: () => setIsPending(false),
      });
    } else {
      createIngredient.mutate({ data: payload }, {
        onSuccess: () => { setIsDialogOpen(false); setIsPending(false); },
        onError: () => setIsPending(false),
      });
    }
  };

  const ingredientCount = (allIngredients ?? []).filter(i => (i as Record<string, unknown>).perishable !== false).length;
  const supplyCount = (allIngredients ?? []).filter(i => (i as Record<string, unknown>).perishable === false).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        description="Manage your ingredients, packaging and supplies — one system for everything you stock."
        action={
          <div className="flex items-center gap-2">
            {activeTab === "ingredients" && (
              <button onClick={() => setIsImportOpen(true)} className="px-4 py-2.5 border border-border rounded-xl font-medium flex items-center gap-2 hover:bg-secondary/50 transition-colors text-sm">
                <Upload className="w-4 h-4" /> Import CSV
              </button>
            )}
            <button
              onClick={openAdd}
              className="px-5 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium shadow-md shadow-primary/20 flex items-center gap-2 hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-5 h-5" />
              {activeTab === "ingredients" ? "Add Ingredient" : "Add Supply"}
            </button>
          </div>
        }
      />

      <div className="flex gap-0 p-1 bg-secondary/40 rounded-2xl w-full">
        <a
          href={`${BASE}/inventory?tab=ingredients`}
          className={cn(
            "flex-1 flex items-center justify-center gap-2.5 py-3 rounded-xl text-sm font-semibold transition-all",
            activeTab === "ingredients"
              ? "bg-card shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Carrot className="w-4 h-4" />
          Ingredients
          <span className={cn(
            "text-xs font-medium px-2 py-0.5 rounded-full",
            activeTab === "ingredients" ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"
          )}>
            {ingredientCount}
          </span>
        </a>
        <a
          href={`${BASE}/inventory?tab=supplies`}
          className={cn(
            "flex-1 flex items-center justify-center gap-2.5 py-3 rounded-xl text-sm font-semibold transition-all",
            activeTab === "supplies"
              ? "bg-card shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Box className="w-4 h-4" />
          Supplies
          <span className={cn(
            "text-xs font-medium px-2 py-0.5 rounded-full",
            activeTab === "supplies" ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"
          )}>
            {supplyCount}
          </span>
        </a>
      </div>

      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={activeTab === "ingredients" ? "Search ingredients..." : "Search supplies..."}
            className="w-full pl-9 pr-3 py-2 bg-card border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="px-3 py-2 bg-card border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="all">All categories</option>
          <option value="uncategorised">Uncategorised</option>
          {categoryOptions.filter(c => c.value !== "").map(c => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        <select
          value={filterUsage}
          onChange={e => setFilterUsage(e.target.value as "all" | "used" | "unused")}
          className="px-3 py-2 bg-card border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="all">All usage</option>
          <option value="used">Used in recipes</option>
          <option value="unused">Not used</option>
        </select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-secondary/20 rounded-2xl border border-dashed border-border">
          {activeTab === "ingredients" ? <Carrot className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-30" /> : <Box className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-30" />}
          <p className="font-medium text-muted-foreground">
            {search || filterCategory !== "all" ? "No items match your search" : activeTab === "ingredients" ? "No ingredients yet" : "No supplies yet"}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {activeTab === "ingredients" ? "Add food ingredients used in your recipes" : "Add packaging, courier boxes, tape and other supplies"}
          </p>
          <button onClick={openAdd} className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover-lift flex items-center gap-1.5 mx-auto">
            <Plus className="w-4 h-4" />
            {activeTab === "ingredients" ? "Add Ingredient" : "Add Supply"}
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-border overflow-hidden bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-secondary/20">
              <tr>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Name</th>
                <th className="text-left py-3 px-3 font-medium text-muted-foreground">Category</th>
                <th className="text-left py-3 px-3 font-medium text-muted-foreground">Unit</th>
                <th className="text-right py-3 px-3 font-medium text-muted-foreground">Pack Size</th>
                {activeTab === "supplies" && <th className="text-right py-3 px-3 font-medium text-muted-foreground">Pallet</th>}
                <th className="text-right py-3 px-3 font-medium text-muted-foreground">Cost/Pack</th>
                <th className="text-left py-3 px-3 font-medium text-muted-foreground">Supplier</th>
                <th className="text-center py-3 px-3 font-medium text-muted-foreground">Used In</th>
                <th className="text-center py-3 px-3 font-medium text-muted-foreground">Kanban</th>
                <th className="py-3 px-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filtered.map(item => {
                const itemPerishable = (item as Record<string, unknown>).perishable !== false;
                const palletSz = (item as Record<string, unknown>).palletSize as number | null ?? null;
                return (
                  <tr key={item.id} className="hover:bg-secondary/20 transition-colors group">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{item.name}</span>
                        {item.brand && <span className="text-xs text-muted-foreground">{item.brand}</span>}
                        {item.orderingUrl && (
                          <a href={item.orderingUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors" title="Order link">
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                      {item.supplierPartNumber && <span className="text-xs text-muted-foreground font-mono">{item.supplierPartNumber}</span>}
                    </td>
                    <td className="py-3 px-3 text-muted-foreground text-xs">
                      {item.category ? categoryLabel(item.category, itemPerishable) : <span className="opacity-40">—</span>}
                    </td>
                    <td className="py-3 px-3 text-muted-foreground">{item.unit}</td>
                    <td className="py-3 px-3 text-right tabular-nums">
                      {Number(item.packWeight) > 0 ? `${Number(item.packWeight)} ${item.unit}` : <span className="text-muted-foreground opacity-40">—</span>}
                    </td>
                    {activeTab === "supplies" && (
                      <td className="py-3 px-3 text-right tabular-nums text-muted-foreground">
                        {palletSz != null ? `${palletSz} packs` : <span className="opacity-40">—</span>}
                      </td>
                    )}
                    <td className="py-3 px-3 text-right tabular-nums font-medium">
                      {Number(item.costPerPack) > 0 ? `£${Number(item.costPerPack).toFixed(2)}` : <span className="text-muted-foreground opacity-40">—</span>}
                    </td>
                    <td className="py-3 px-3 text-muted-foreground text-xs">
                      {item.supplierId ? supplierMap[item.supplierId] ?? "—" : <span className="opacity-40">—</span>}
                    </td>
                    <td className="py-3 px-3 text-center">
                      {(() => {
                        const rec = item as Record<string, unknown>;
                        const r = Number(rec.usedInRecipes) || 0;
                        const s = Number(rec.usedInSubRecipes) || 0;
                        const total = r + s;
                        if (total === 0) return <span className="text-muted-foreground opacity-40 text-xs">—</span>;
                        const parts: string[] = [];
                        if (r > 0) parts.push(`${r} recipe${r > 1 ? "s" : ""}`);
                        if (s > 0) parts.push(`${s} sub-recipe${s > 1 ? "s" : ""}`);
                        return <span className="text-xs text-primary font-medium" title={parts.join(", ")}>{total}</span>;
                      })()}
                    </td>
                    <td className="py-3 px-3 text-center">
                      {(item as Record<string, unknown>).kanbanEnabled ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">Active</span>
                      ) : (
                        <span className="text-muted-foreground opacity-40 text-xs">—</span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1 justify-end">
                        {activeTab === "ingredients" && (
                          <button onClick={() => printKanban(item.id)} className="p-1.5 text-foreground bg-secondary/30 hover:bg-secondary/60 transition-colors rounded-lg" title="Print Kanban">
                            <Printer className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button onClick={() => openEdit(item)} className="p-1.5 text-foreground bg-secondary/30 hover:bg-secondary/60 transition-colors rounded-lg" title="Edit">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setDeleteTarget({ id: item.id, name: item.name })} className="p-1.5 text-destructive bg-destructive/10 hover:bg-destructive/20 transition-colors rounded-lg" title="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t border-border bg-secondary/10">
              <tr>
                <td colSpan={activeTab === "supplies" ? 10 : 9} className="py-2 px-4 text-xs text-muted-foreground">
                  {filtered.length} {filtered.length === 1 ? "item" : "items"}
                  {filtered.length !== tabItems.length && ` (filtered from ${tabItems.length})`}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <ItemFormDialog
        open={isDialogOpen}
        onClose={() => { setIsDialogOpen(false); setEditingItem(null); }}
        editingItem={editingItem}
        defaultMode={activeTab}
        suppliers={suppliers ?? []}
        onSave={handleSave}
      />

      <ImportDialog
        open={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onDone={() => queryClient.invalidateQueries({ queryKey: ["/api/ingredients"] })}
      />

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDeleteTarget(null)}>
          <div className="bg-card border border-border rounded-xl p-6 shadow-xl max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-lg mb-2">Delete Item?</h3>
            <p className="text-sm text-muted-foreground mb-6">This will permanently delete "{deleteTarget.name}". This cannot be undone.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-secondary/60 transition-colors">Cancel</button>
              <button
                onClick={() => { deleteIngredient.mutate({ id: deleteTarget.id }); setDeleteTarget(null); }}
                className="px-4 py-2 text-sm rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors font-medium"
              >Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
