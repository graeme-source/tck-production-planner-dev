/**
 * Employee Hub — per-user landing page reached from the username
 * dropdown in the sidebar. Today it hosts only the Forms section
 * (mileage claim); the layout is intentionally sectioned so future
 * additions (payslips, schedule, training certs) can slot in without
 * restructuring the page.
 *
 * The mileage claim is pure client-side: the employee fills in their
 * trips, the form computes the total using current HMRC AMAP rates,
 * and a one-page PDF is generated via jsPDF for them to download and
 * email to the accountant. No DB writes — the source of truth is the
 * PDF in their email trail.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { useAuth } from "@/contexts/auth-context";
import { PageHeader } from "@/components/page-header";
import { Car, Plus, Trash2, FileDown, Mail, Lightbulb, AlertTriangle, Flame, BookOpen, Loader2, Receipt } from "lucide-react";
import { jsPDF } from "jspdf";
import { toast } from "@/hooks/use-toast";

// HMRC Approved Mileage Allowance Payment (AMAP) rates — cars and
// vans. Unchanged since 2011 but stored in one place so updating
// them when HMRC revises is a one-line change.
const AMAP = {
  // Source: gov.uk/expenses-and-benefits-business-travel-mileage/rules-for-tax
  carFirst10k: 0.45, // £ per mile, first 10,000 business miles in tax year
  carAbove10k: 0.25, // £ per mile thereafter
  threshold: 10_000,
  effectiveFrom: "2011-04-06",
  source: "HMRC AMAP — gov.uk/expenses-and-benefits-business-travel-mileage",
} as const;

interface Trip {
  date: string;
  purpose: string;
  from: string;
  to: string;
  miles: number;
}

interface FormValues {
  employeeName: string;
  vehicleReg: string;
  periodStart: string;
  periodEnd: string;
  priorMilesThisTaxYear: number;
  trips: Trip[];
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtGBP(n: number): string {
  return `£${n.toFixed(2)}`;
}

function fmtDateUK(iso: string): string {
  // dd/mm/yyyy — what an accountant on this side of the channel expects.
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

/** Splits the claim across the 10k-mile AMAP threshold. The "prior
 *  miles" input lets a high-mileage employee tell the form how many
 *  business miles they've already claimed this tax year so the
 *  threshold maths is right. */
function calculate(trips: Trip[], priorMiles: number) {
  const totalClaimMiles = trips.reduce((sum, t) => sum + (Number(t.miles) || 0), 0);
  const milesIntoYearAtStart = Math.max(0, priorMiles);
  const milesAt45p = Math.max(0, Math.min(totalClaimMiles, AMAP.threshold - milesIntoYearAtStart));
  const milesAt25p = Math.max(0, totalClaimMiles - milesAt45p);
  const amount45 = milesAt45p * AMAP.carFirst10k;
  const amount25 = milesAt25p * AMAP.carAbove10k;
  return {
    totalClaimMiles,
    milesAt45p,
    milesAt25p,
    amount45,
    amount25,
    total: amount45 + amount25,
  };
}

/** Builds the mileage-claim PDF in memory. The "Download" path then
 *  calls .save(); the "Email" path serialises it to a base64 string
 *  and POSTs it to the server. */
function buildMileagePdf(form: FormValues): { doc: jsPDF; filename: string; calc: ReturnType<typeof calculate> } {
  const calc = calculate(form.trips, form.priorMilesThisTaxYear);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const left = 40;
  const right = pageWidth - 40;
  let y = 50;

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Mileage Claim", left, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Generated ${fmtDateUK(todayIso())}`, right, y, { align: "right" });
  y += 20;
  doc.setDrawColor(180);
  doc.line(left, y, right, y);
  y += 20;

  // Employee details
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Employee:", left, y);
  doc.setFont("helvetica", "normal");
  doc.text(form.employeeName || "—", left + 80, y);
  doc.setFont("helvetica", "bold");
  doc.text("Vehicle reg:", left + 280, y);
  doc.setFont("helvetica", "normal");
  doc.text(form.vehicleReg || "—", left + 360, y);
  y += 18;
  doc.setFont("helvetica", "bold");
  doc.text("Period:", left, y);
  doc.setFont("helvetica", "normal");
  doc.text(`${fmtDateUK(form.periodStart)} — ${fmtDateUK(form.periodEnd)}`, left + 80, y);
  y += 28;

  // Trip table
  const colDate = left;
  const colPurpose = left + 70;
  const colFrom = left + 200;
  const colTo = left + 320;
  const colMiles = right - 40;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Date", colDate, y);
  doc.text("Purpose", colPurpose, y);
  doc.text("From", colFrom, y);
  doc.text("To", colTo, y);
  doc.text("Miles", colMiles, y, { align: "right" });
  y += 6;
  doc.line(left, y, right, y);
  y += 14;
  doc.setFont("helvetica", "normal");

  for (const t of form.trips) {
    doc.text(fmtDateUK(t.date), colDate, y);
    doc.text(t.purpose.slice(0, 22), colPurpose, y);
    doc.text(t.from.slice(0, 18), colFrom, y);
    doc.text(t.to.slice(0, 18), colTo, y);
    doc.text(String(t.miles || 0), colMiles, y, { align: "right" });
    y += 16;
    if (y > 760) { doc.addPage(); y = 50; }
  }

  y += 8;
  doc.line(left, y, right, y);
  y += 18;

  // Totals
  doc.setFont("helvetica", "bold");
  doc.text(`Total miles this claim:`, left, y);
  doc.setFont("helvetica", "normal");
  doc.text(`${calc.totalClaimMiles}`, colMiles, y, { align: "right" });
  y += 16;

  if (calc.milesAt45p > 0) {
    doc.text(`Miles @ ${(AMAP.carFirst10k * 100).toFixed(0)}p (first ${AMAP.threshold.toLocaleString()} miles in tax year)`, left, y);
    doc.text(`${calc.milesAt45p} × ${(AMAP.carFirst10k * 100).toFixed(0)}p = ${fmtGBP(calc.amount45)}`, colMiles, y, { align: "right" });
    y += 14;
  }
  if (calc.milesAt25p > 0) {
    doc.text(`Miles @ ${(AMAP.carAbove10k * 100).toFixed(0)}p (above ${AMAP.threshold.toLocaleString()} miles)`, left, y);
    doc.text(`${calc.milesAt25p} × ${(AMAP.carAbove10k * 100).toFixed(0)}p = ${fmtGBP(calc.amount25)}`, colMiles, y, { align: "right" });
    y += 14;
  }
  if (form.priorMilesThisTaxYear > 0) {
    doc.setTextColor(120);
    doc.text(`Prior business miles claimed this tax year: ${form.priorMilesThisTaxYear.toLocaleString()}`, left, y);
    doc.setTextColor(0);
    y += 14;
  }
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Total claim:", left, y);
  doc.text(fmtGBP(calc.total), colMiles, y, { align: "right" });
  y += 30;

  // Signature line
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("Employee signature:", left, y);
  doc.line(left + 110, y + 2, left + 320, y + 2);
  doc.text("Date:", left + 360, y);
  doc.line(left + 395, y + 2, right, y + 2);
  y += 30;

  // Footer
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(AMAP.source, left, 815);

  const filename = `mileage-claim-${(form.employeeName || "employee").toLowerCase().replace(/\s+/g, "-")}-${form.periodEnd || todayIso()}.pdf`;
  return { doc, filename, calc };
}

function downloadMileagePdf(form: FormValues) {
  const { doc, filename } = buildMileagePdf(form);
  doc.save(filename);
}

function MileageClaimForm() {
  const { state } = useAuth();
  const defaultName = state.status === "authenticated" ? state.user.name : "";

  const { register, control, handleSubmit, watch, formState: { errors } } = useForm<FormValues>({
    defaultValues: {
      employeeName: defaultName,
      vehicleReg: "",
      periodStart: todayIso(),
      periodEnd: todayIso(),
      priorMilesThisTaxYear: 0,
      trips: [{ date: todayIso(), purpose: "", from: "", to: "", miles: 0 }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "trips" });

  const trips = watch("trips");
  const prior = Number(watch("priorMilesThisTaxYear")) || 0;
  const calc = calculate(trips ?? [], prior);
  const [emailSending, setEmailSending] = useState(false);

  const normalise = (data: FormValues): FormValues => ({
    ...data,
    priorMilesThisTaxYear: Number(data.priorMilesThisTaxYear) || 0,
    trips: data.trips.map(t => ({ ...t, miles: Number(t.miles) || 0 })),
  });

  const onSubmit = (data: FormValues) => {
    if (!data.employeeName?.trim()) return;
    if (!data.trips.length) return;
    downloadMileagePdf(normalise(data));
  };

  const handleEmail = handleSubmit(async (data) => {
    if (!data.employeeName?.trim() || !data.trips.length) return;
    setEmailSending(true);
    try {
      const normalised = normalise(data);
      const { doc, filename, calc: built } = buildMileagePdf(normalised);
      // jsPDF returns base64 (without the data: prefix) via 'datauristring',
      // but the safer cross-version path is to read the raw output and
      // base64-encode it in the browser.
      const ab = doc.output("arraybuffer");
      const bytes = new Uint8Array(ab);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const pdfBase64 = btoa(binary);
      const res = await fetch("/api/forms/mileage-claim/email", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pdfBase64,
          filename,
          totalMiles: built.totalClaimMiles,
          totalAmount: built.total,
          periodStart: normalised.periodStart,
          periodEnd: normalised.periodEnd,
          employeeName: normalised.employeeName,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Request failed (${res.status})`);
      }
      toast({
        title: "Email sent",
        description: "Your mileage claim has been emailed to graeme@thecalzonekitchen.co.uk for review.",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Couldn't send email",
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setEmailSending(false);
    }
  });

  const inputCls = "w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium mb-1 block">Employee name *</label>
          <input {...register("employeeName", { required: true })} className={inputCls} placeholder="Your full name" />
          {errors.employeeName && <span className="text-destructive text-xs">Required.</span>}
        </div>
        <div>
          <label className="text-sm font-medium mb-1 block">Vehicle registration</label>
          <input {...register("vehicleReg")} className={inputCls} placeholder="e.g. AB12 CDE" />
        </div>
        <div>
          <label className="text-sm font-medium mb-1 block">Period start</label>
          <input type="date" {...register("periodStart")} className={inputCls} />
        </div>
        <div>
          <label className="text-sm font-medium mb-1 block">Period end</label>
          <input type="date" {...register("periodEnd")} className={inputCls} />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-secondary/20 p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold">Trips</h4>
          <button
            type="button"
            onClick={() => append({ date: todayIso(), purpose: "", from: "", to: "", miles: 0 })}
            className="text-xs font-medium text-primary flex items-center gap-1 hover:underline"
          >
            <Plus className="w-3 h-3" /> Add trip
          </button>
        </div>

        <div className="space-y-2">
          {fields.map((field, idx) => (
            <div key={field.id} className="grid grid-cols-[110px_1fr_1fr_1fr_80px_28px] gap-2 items-start">
              <input type="date" {...register(`trips.${idx}.date`)} className={inputCls} />
              <input {...register(`trips.${idx}.purpose`)} className={inputCls} placeholder="Purpose (e.g. Trade show)" />
              <input {...register(`trips.${idx}.from`)} className={inputCls} placeholder="From" />
              <input {...register(`trips.${idx}.to`)} className={inputCls} placeholder="To" />
              <Controller
                control={control}
                name={`trips.${idx}.miles`}
                render={({ field: f }) => (
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    min="0"
                    value={f.value ?? 0}
                    onChange={e => f.onChange(e.target.value === "" ? 0 : Number(e.target.value))}
                    className={inputCls + " text-right tabular-nums"}
                    placeholder="0"
                  />
                )}
              />
              <button
                type="button"
                onClick={() => remove(idx)}
                disabled={fields.length === 1}
                className="self-center text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:cursor-not-allowed"
                title="Remove trip"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <label className="text-sm font-medium mb-1 block">
          Business miles already claimed this tax year <span className="text-xs font-normal text-muted-foreground">(optional)</span>
        </label>
        <input
          type="number"
          inputMode="numeric"
          min="0"
          {...register("priorMilesThisTaxYear")}
          className={inputCls + " max-w-[200px]"}
          placeholder="0"
        />
        <p className="text-xs text-muted-foreground mt-1">
          HMRC AMAP pays 45p per mile up to {AMAP.threshold.toLocaleString()} business miles per tax year, then 25p. Tell us how many you've already claimed so we apply the right rate.
        </p>
      </div>

      {/* Live totals */}
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Total miles this claim</span>
          <span className="tabular-nums font-medium">{calc.totalClaimMiles.toFixed(1)}</span>
        </div>
        {calc.milesAt45p > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{calc.milesAt45p.toFixed(1)} × 45p</span>
            <span className="tabular-nums">{fmtGBP(calc.amount45)}</span>
          </div>
        )}
        {calc.milesAt25p > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{calc.milesAt25p.toFixed(1)} × 25p</span>
            <span className="tabular-nums">{fmtGBP(calc.amount25)}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-base font-semibold border-t border-border/60 pt-2 mt-2">
          <span>Total claim</span>
          <span className="tabular-nums text-primary">{fmtGBP(calc.total)}</span>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="submit"
          disabled={!trips?.some(t => (Number(t.miles) || 0) > 0) || emailSending}
          className="flex-1 px-6 py-2.5 bg-secondary text-foreground border border-border rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-secondary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <FileDown className="w-4 h-4" /> Download PDF
        </button>
        <button
          type="button"
          onClick={handleEmail}
          disabled={!trips?.some(t => (Number(t.miles) || 0) > 0) || emailSending}
          className="flex-1 px-6 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium shadow-md shadow-primary/20 flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {emailSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
          {emailSending ? "Sending…" : "Email for review"}
        </button>
      </div>
      <p className="text-xs text-muted-foreground -mt-2">
        "Email for review" sends the same PDF as an attachment to graeme@thecalzonekitchen.co.uk with the subject "TCK Mileage claim form for review".
      </p>
    </form>
  );
}

// ── Expense claim ──────────────────────────────────────────────────────────
// Same shape as the mileage claim: pure client-side form → one-page PDF via
// jsPDF → download, or email to the founder for review. The fields cover
// HMRC's minimum for reclaiming input VAT on employee expenses: date,
// supplier, supplier VAT number, description/business purpose, and the
// gross/VAT split. The original receipt remains the legal evidence — the
// form reminds the claimant to hand receipts in with the claim.

const EXPENSE_CATEGORIES = [
  "Travel & parking",
  "Subsistence (food & drink)",
  "Equipment & tools",
  "Ingredients & materials",
  "Office & admin",
  "Other",
] as const;

interface ExpenseLine {
  date: string;
  supplier: string;
  supplierVatNo: string;
  description: string;
  category: string;
  gross: number;
  vat: number;
}

interface ExpenseFormValues {
  employeeName: string;
  lines: ExpenseLine[];
}

function emptyExpenseLine(): ExpenseLine {
  return { date: todayIso(), supplier: "", supplierVatNo: "", description: "", category: EXPENSE_CATEGORIES[0], gross: 0, vat: 0 };
}

function calcExpenses(lines: ExpenseLine[]) {
  const gross = lines.reduce((s, l) => s + (Number(l.gross) || 0), 0);
  const vat = lines.reduce((s, l) => s + (Number(l.vat) || 0), 0);
  return { gross, vat, net: gross - vat };
}

function buildExpensePdf(form: ExpenseFormValues): { doc: jsPDF; filename: string; totals: ReturnType<typeof calcExpenses> } {
  const totals = calcExpenses(form.lines);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const left = 40;
  const right = pageWidth - 40;
  let y = 50;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Expense Claim", left, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Generated ${fmtDateUK(todayIso())}`, right, y, { align: "right" });
  y += 20;
  doc.setDrawColor(180);
  doc.line(left, y, right, y);
  y += 20;

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Employee:", left, y);
  doc.setFont("helvetica", "normal");
  doc.text(form.employeeName || "—", left + 80, y);
  y += 24;

  // Table — columns sized to fill the 515pt text width.
  const cols = [
    { key: "date", label: "Date", w: 58 },
    { key: "supplier", label: "Supplier", w: 95 },
    { key: "description", label: "Description / purpose", w: 132 },
    { key: "category", label: "Category", w: 55 },
    { key: "supplierVatNo", label: "VAT No.", w: 68 },
    { key: "net", label: "Net £", w: 38 },
    { key: "vat", label: "VAT £", w: 34 },
    { key: "gross", label: "Gross £", w: 35 },
  ] as const;

  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  let x = left;
  for (const c of cols) {
    doc.text(c.label, c.key === "net" || c.key === "vat" || c.key === "gross" ? x + c.w : x, y, { align: c.key === "net" || c.key === "vat" || c.key === "gross" ? "right" : "left" });
    x += c.w;
  }
  y += 6;
  doc.line(left, y, right, y);
  y += 12;
  doc.setFont("helvetica", "normal");

  for (const l of form.lines) {
    const gross = Number(l.gross) || 0;
    const vat = Number(l.vat) || 0;
    const cells: Record<string, string[]> = {
      date: [fmtDateUK(l.date)],
      supplier: doc.splitTextToSize(l.supplier || "—", 90),
      description: doc.splitTextToSize(l.description || "—", 127),
      category: doc.splitTextToSize(l.category || "—", 52),
      supplierVatNo: doc.splitTextToSize(l.supplierVatNo || "—", 64),
      net: [(gross - vat).toFixed(2)],
      vat: [vat.toFixed(2)],
      gross: [gross.toFixed(2)],
    };
    const rowLines = Math.max(...Object.values(cells).map(v => v.length));
    const rowHeight = rowLines * 10 + 6;
    if (y + rowHeight > pageHeight - 140) {
      doc.addPage();
      y = 50;
    }
    x = left;
    for (const c of cols) {
      const alignRight = c.key === "net" || c.key === "vat" || c.key === "gross";
      doc.text(cells[c.key], alignRight ? x + c.w : x, y, { align: alignRight ? "right" : "left" });
      x += c.w;
    }
    y += rowHeight;
  }

  y += 2;
  doc.line(left, y, right, y);
  y += 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(`Totals — net £${totals.net.toFixed(2)}   VAT £${totals.vat.toFixed(2)}   gross £${totals.gross.toFixed(2)}`, right, y, { align: "right" });
  y += 28;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const declaration = doc.splitTextToSize(
    "I confirm these expenses were incurred wholly, exclusively and necessarily in the course of company business, and that original itemised receipts (showing the supplier's VAT number for any VAT claimed) are attached or have been handed in with this claim.",
    right - left,
  );
  doc.text(declaration, left, y);
  y += declaration.length * 11 + 24;
  doc.text("Signed: ______________________________", left, y);
  doc.text(`Date: ${fmtDateUK(todayIso())}`, left + 280, y);
  y += 22;
  doc.setFontSize(7.5);
  doc.setTextColor(120);
  doc.text("VAT reclaim requires a receipt showing the supplier's name, address, VAT number, date, a description of the goods, and the VAT amount or rate (simplified receipts acceptable up to £250 gross; a full VAT invoice above that).", left, y, { maxWidth: right - left });

  const filename = `expense-claim-${(form.employeeName || "employee").toLowerCase().replace(/\s+/g, "-")}-${todayIso()}.pdf`;
  return { doc, filename, totals };
}

function ExpenseClaimForm() {
  const { state } = useAuth();
  const defaultName = state.status === "authenticated" ? state.user.name : "";

  const { register, control, handleSubmit, watch, formState: { errors } } = useForm<ExpenseFormValues>({
    defaultValues: { employeeName: defaultName, lines: [emptyExpenseLine()] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "lines" });

  const lines = watch("lines");
  const totals = calcExpenses(lines ?? []);
  const [emailSending, setEmailSending] = useState(false);

  const normalise = (data: ExpenseFormValues): ExpenseFormValues => ({
    ...data,
    lines: data.lines.map(l => ({ ...l, gross: Number(l.gross) || 0, vat: Number(l.vat) || 0 })),
  });

  const canSubmit = Boolean(lines?.some(l => (Number(l.gross) || 0) > 0 && l.supplier?.trim()));

  const onSubmit = (data: ExpenseFormValues) => {
    if (!data.employeeName?.trim()) return;
    const { doc, filename } = buildExpensePdf(normalise(data));
    doc.save(filename);
  };

  const handleEmail = handleSubmit(async (data) => {
    if (!data.employeeName?.trim()) return;
    setEmailSending(true);
    try {
      const normalised = normalise(data);
      const { doc, filename, totals: built } = buildExpensePdf(normalised);
      const ab = doc.output("arraybuffer");
      const bytes = new Uint8Array(ab);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const pdfBase64 = btoa(binary);
      const res = await fetch("/api/forms/expense-claim/email", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pdfBase64,
          filename,
          totalGross: built.gross,
          totalVat: built.vat,
          lineCount: normalised.lines.length,
          employeeName: normalised.employeeName,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Request failed (${res.status})`);
      }
      toast({
        title: "Email sent",
        description: "Your expense claim has been emailed to graeme@thecalzonekitchen.co.uk for review. Remember to hand in your receipts.",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Couldn't send email",
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setEmailSending(false);
    }
  });

  const inputCls = "w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div className="max-w-sm">
        <label className="text-sm font-medium mb-1 block">Employee name *</label>
        <input {...register("employeeName", { required: true })} className={inputCls} placeholder="Your full name" />
        {errors.employeeName && <span className="text-destructive text-xs">Required.</span>}
      </div>

      <div className="rounded-xl border border-border bg-secondary/20 p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold">Expenses</h4>
          <button
            type="button"
            onClick={() => append(emptyExpenseLine())}
            className="text-xs font-medium text-primary flex items-center gap-1 hover:underline"
          >
            <Plus className="w-3 h-3" /> Add expense
          </button>
        </div>

        <div className="space-y-3">
          {fields.map((field, idx) => (
            <div key={field.id} className="rounded-lg border border-border/70 bg-background/60 p-3 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-[130px_1fr_1fr_28px] gap-2 items-start">
                <input type="date" {...register(`lines.${idx}.date`)} className={inputCls} />
                <input {...register(`lines.${idx}.supplier`)} className={inputCls} placeholder="Supplier (e.g. Screwfix)" />
                <select {...register(`lines.${idx}.category`)} className={inputCls}>
                  {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  disabled={fields.length === 1}
                  className="self-center justify-self-center text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Remove expense"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_150px_110px_110px] gap-2 items-start">
                <input {...register(`lines.${idx}.description`)} className={inputCls} placeholder="What was bought & why (business purpose)" />
                <input {...register(`lines.${idx}.supplierVatNo`)} className={inputCls} placeholder="Supplier VAT no." />
                <Controller
                  control={control}
                  name={`lines.${idx}.gross`}
                  render={({ field: f }) => (
                    <input
                      type="number" inputMode="decimal" step="0.01" min="0"
                      value={f.value ?? 0}
                      onChange={e => f.onChange(e.target.value === "" ? 0 : Number(e.target.value))}
                      className={inputCls + " text-right tabular-nums"}
                      placeholder="Gross £"
                      title="Total paid incl. VAT"
                    />
                  )}
                />
                <Controller
                  control={control}
                  name={`lines.${idx}.vat`}
                  render={({ field: f }) => (
                    <input
                      type="number" inputMode="decimal" step="0.01" min="0"
                      value={f.value ?? 0}
                      onChange={e => f.onChange(e.target.value === "" ? 0 : Number(e.target.value))}
                      className={inputCls + " text-right tabular-nums"}
                      placeholder="VAT £"
                      title="VAT shown on the receipt"
                    />
                  )}
                />
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Gross = total paid; VAT = the VAT shown on the receipt (for standard 20% items it's the gross ÷ 6). Leave VAT at 0 for zero-rated items or where the receipt shows no VAT number.
        </p>
      </div>

      {/* Live totals */}
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Net</span>
          <span className="tabular-nums">{fmtGBP(totals.net)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">VAT</span>
          <span className="tabular-nums">{fmtGBP(totals.vat)}</span>
        </div>
        <div className="flex items-center justify-between text-base font-semibold border-t border-border/60 pt-2 mt-2">
          <span>Total claim (gross)</span>
          <span className="tabular-nums text-primary">{fmtGBP(totals.gross)}</span>
        </div>
      </div>

      <div className="rounded-xl border border-amber-300/60 dark:border-amber-700/60 bg-amber-50/60 dark:bg-amber-900/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
        Keep your receipts — VAT can only be claimed back with the original receipt showing the supplier's VAT number. Hand them in (or photograph and reply to the claim email) when you submit.
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="submit"
          disabled={!canSubmit || emailSending}
          className="flex-1 px-6 py-2.5 bg-secondary text-foreground border border-border rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-secondary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <FileDown className="w-4 h-4" /> Download PDF
        </button>
        <button
          type="button"
          onClick={handleEmail}
          disabled={!canSubmit || emailSending}
          className="flex-1 px-6 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium shadow-md shadow-primary/20 flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {emailSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
          {emailSending ? "Sending…" : "Email for review"}
        </button>
      </div>
      <p className="text-xs text-muted-foreground -mt-2">
        "Email for review" sends the PDF as an attachment to graeme@thecalzonekitchen.co.uk with the subject "TCK Expense claim form for review".
      </p>
    </form>
  );
}

// ── "My …" sections ────────────────────────────────────────────────────────
// All four read-only lists below are client-side filtered against the
// authenticated user — there's no per-user endpoint today, and for the
// volume of records on this system the simple fetch-then-filter is
// fine. If the lists grow large we can move filtering to the server.

interface ImprovementRow {
  id: number;
  title: string;
  description: string;
  station: string;
  type: "improvement" | "struggle";
  submittedBy: number | null;
  submittedByName: string | null;
  progressStatus: string | null;
  createdAt: string;
}

interface AndonRow {
  id: number;
  category: string;
  severity: "yellow" | "red" | "green";
  description: string | null;
  station: string;
  reportedBy: number | null;
  reportedByName: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

interface SopRow {
  id: number;
  title: string;
  stations: string[];
  tags: string[];
  authorId: number | null;
  authorName: string | null;
  stepCount: number;
  createdAt: string;
  updatedAt: string;
}

function fmtRelative(iso: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  const day = 86400000;
  if (diff < day) return "today";
  if (diff < 2 * day) return "yesterday";
  if (diff < 7 * day) return `${Math.floor(diff / day)} days ago`;
  if (diff < 30 * day) return `${Math.floor(diff / (7 * day))} wk ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function EmptyList({ label }: { label: string }) {
  return (
    <p className="text-sm text-muted-foreground italic py-6 text-center">
      {label}
    </p>
  );
}

function MyImprovementsList({ userId, type }: { userId: number | null; type: "improvement" | "struggle" }) {
  const { data, isLoading } = useQuery<ImprovementRow[]>({
    queryKey: ["my-improvements"],
    queryFn: async () => {
      const res = await fetch("/api/improvements", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    enabled: userId != null,
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  const rows = (data ?? []).filter(r => r.submittedBy === userId && r.type === type);
  if (rows.length === 0) {
    return <EmptyList label={type === "improvement" ? "You haven't logged any improvements yet." : "You haven't logged any struggles yet."} />;
  }
  return (
    <ul className="divide-y divide-border border border-border rounded-xl overflow-hidden">
      {rows.map(r => (
        <li key={r.id} className="px-4 py-3 bg-card">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{r.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{r.description}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-muted-foreground">{fmtRelative(r.createdAt)}</p>
              {r.progressStatus && (
                <span className="inline-block mt-1 px-1.5 py-0.5 rounded-full bg-secondary text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  {r.progressStatus === "complete" ? "Complete" : "Submitted"}
                </span>
              )}
            </div>
          </div>
          {r.station && (
            <p className="text-[10px] text-muted-foreground/70 mt-1.5 uppercase tracking-wide">{r.station.replace(/_/g, " ")}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

function MyIssuesList({ userId }: { userId: number | null }) {
  const { data, isLoading } = useQuery<AndonRow[]>({
    queryKey: ["my-andon"],
    queryFn: async () => {
      const res = await fetch("/api/andon", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    enabled: userId != null,
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  const rows = (data ?? []).filter(r => r.reportedBy === userId);
  if (rows.length === 0) return <EmptyList label="You haven't reported any issues yet." />;

  const severityClass = (s: AndonRow["severity"]) => {
    if (s === "red") return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300";
    if (s === "yellow") return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300";
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300";
  };

  return (
    <ul className="divide-y divide-border border border-border rounded-xl overflow-hidden">
      {rows.map(r => (
        <li key={r.id} className="px-4 py-3 bg-card">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wide ${severityClass(r.severity)}`}>
                  {r.severity}
                </span>
                <p className="text-sm font-medium capitalize">{r.category}</p>
              </div>
              {r.description && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.description}</p>
              )}
              <p className="text-[10px] text-muted-foreground/70 mt-1 uppercase tracking-wide">{r.station.replace(/_/g, " ")}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-muted-foreground">{fmtRelative(r.createdAt)}</p>
              <span className={`inline-block mt-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wide ${r.resolvedAt ? "bg-secondary text-muted-foreground" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"}`}>
                {r.resolvedAt ? "Resolved" : "Open"}
              </span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function MySopsList({ userId }: { userId: number | null }) {
  const { data, isLoading } = useQuery<SopRow[]>({
    queryKey: ["my-sops"],
    queryFn: async () => {
      const res = await fetch("/api/standards", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    enabled: userId != null,
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  const rows = (data ?? []).filter(r => r.authorId === userId);
  if (rows.length === 0) return <EmptyList label="You haven't created any SOPs yet." />;
  return (
    <ul className="divide-y divide-border border border-border rounded-xl overflow-hidden">
      {rows.map(r => (
        <li key={r.id} className="px-4 py-3 bg-card">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{r.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{r.stepCount} step{r.stepCount === 1 ? "" : "s"}</p>
              {r.stations.length > 0 && (
                <p className="text-[10px] text-muted-foreground/70 mt-1 uppercase tracking-wide">{r.stations.join(" · ").replace(/_/g, " ")}</p>
              )}
            </div>
            <p className="text-xs text-muted-foreground shrink-0">{fmtRelative(r.updatedAt)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

type HubSection = "mileage" | "expenses" | "improvements" | "struggles" | "issues" | "sops";

export default function EmployeeHub() {
  const [active, setActive] = useState<HubSection>("mileage");
  const { state } = useAuth();
  const userId = state.status === "authenticated" ? state.user.id : null;

  const sections: { key: HubSection; label: string; icon: typeof Car }[] = [
    { key: "mileage", label: "Mileage Claim", icon: Car },
    { key: "expenses", label: "Expense Claim", icon: Receipt },
    { key: "improvements", label: "My Improvements", icon: Lightbulb },
    { key: "struggles", label: "My Struggles", icon: Flame },
    { key: "issues", label: "My Issues", icon: AlertTriangle },
    { key: "sops", label: "My SOPs", icon: BookOpen },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Employee Hub"
        description="Your personal forms, downloads, and records. Currently: mileage and expense claims, plus the improvements, struggles, issues and SOPs you've created."
      />

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
        <nav className="space-y-1">
          {sections.map(s => {
            const Icon = s.icon;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setActive(s.key)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors ${
                  active === s.key ? "bg-primary/10 text-primary font-medium" : "hover:bg-secondary/40 text-foreground"
                }`}
              >
                <Icon className="w-4 h-4" /> {s.label}
              </button>
            );
          })}
        </nav>

        <div className="bg-card border border-border rounded-2xl p-5">
          {active === "mileage" && (
            <>
              <div className="mb-4 pb-4 border-b border-border">
                <h2 className="text-lg font-semibold">Mileage Claim</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  For trips made in your own vehicle to a destination outside your normal place of work. Uses HMRC AMAP rates (45p/mile for the first {AMAP.threshold.toLocaleString()} business miles per tax year, then 25p/mile). Download the PDF and email it to accounts.
                </p>
              </div>
              <MileageClaimForm />
            </>
          )}
          {active === "expenses" && (
            <>
              <div className="mb-4 pb-4 border-b border-border">
                <h2 className="text-lg font-semibold">Expense Claim</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  For things you've paid for personally on company business. Fill in one line per receipt — the VAT details let us claim the VAT back, so copy the supplier's VAT number off the receipt where it has one. Download the PDF or email it for approval.
                </p>
              </div>
              <ExpenseClaimForm />
            </>
          )}
          {active === "improvements" && (
            <>
              <div className="mb-4 pb-4 border-b border-border">
                <h2 className="text-lg font-semibold">My Improvements</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Improvement ideas you've submitted. Add new ones from the report dialog on any station.
                </p>
              </div>
              <MyImprovementsList userId={userId} type="improvement" />
            </>
          )}
          {active === "struggles" && (
            <>
              <div className="mb-4 pb-4 border-b border-border">
                <h2 className="text-lg font-semibold">My Struggles</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Struggles you've logged. Surfacing these helps the team know what to fix.
                </p>
              </div>
              <MyImprovementsList userId={userId} type="struggle" />
            </>
          )}
          {active === "issues" && (
            <>
              <div className="mb-4 pb-4 border-b border-border">
                <h2 className="text-lg font-semibold">My Issues</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Andon issues you've raised, with current status.
                </p>
              </div>
              <MyIssuesList userId={userId} />
            </>
          )}
          {active === "sops" && (
            <>
              <div className="mb-4 pb-4 border-b border-border">
                <h2 className="text-lg font-semibold">My SOPs</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Standards &amp; SOPs you've authored.
                </p>
              </div>
              <MySopsList userId={userId} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
