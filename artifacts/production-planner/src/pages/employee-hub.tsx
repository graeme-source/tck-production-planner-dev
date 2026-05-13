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
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { useAuth } from "@/contexts/auth-context";
import { PageHeader } from "@/components/page-header";
import { Car, Plus, Trash2, FileDown } from "lucide-react";
import { jsPDF } from "jspdf";

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

function generatePdf(form: FormValues) {
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

  const onSubmit = (data: FormValues) => {
    if (!data.employeeName?.trim()) return;
    if (!data.trips.length) return;
    generatePdf({
      ...data,
      priorMilesThisTaxYear: Number(data.priorMilesThisTaxYear) || 0,
      trips: data.trips.map(t => ({ ...t, miles: Number(t.miles) || 0 })),
    });
  };

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

      <button
        type="submit"
        disabled={!trips?.some(t => (Number(t.miles) || 0) > 0)}
        className="w-full md:w-auto px-6 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium shadow-md shadow-primary/20 flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <FileDown className="w-4 h-4" /> Download PDF
      </button>
    </form>
  );
}

export default function EmployeeHub() {
  const [active, setActive] = useState<"mileage" | null>("mileage");

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Employee Hub"
        description="Your personal forms and downloads. Currently: mileage claim. More sections coming."
      />

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
        <nav className="space-y-1">
          <button
            type="button"
            onClick={() => setActive("mileage")}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors ${
              active === "mileage" ? "bg-primary/10 text-primary font-medium" : "hover:bg-secondary/40 text-foreground"
            }`}
          >
            <Car className="w-4 h-4" /> Mileage Claim
          </button>
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
        </div>
      </div>
    </div>
  );
}
