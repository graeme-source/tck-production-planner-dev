// Recipe P&L Report — print-optimised page.
//
// Usage: open /print/recipe-pnl in a new tab, pick filters, then use the
// browser print dialog (Cmd/Ctrl + P → Save as PDF) to export. Designed
// for A4 landscape so the financial columns fit comfortably on one row
// per recipe.
//
// Data source: GET /api/recipes already returns per-recipe computed cost
// fields (packIngredientCost, packagingCost, labourCost, totalPackCost,
// rrp, grossMargin). This page is pure presentation — no new backend.

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { useListRecipes } from "@workspace/api-client-react";
import type { Recipe } from "@workspace/api-client-react";

type FilterCategory = "all" | string;
type CoreFilter = "all" | "core" | "non_core";

function fmtGBP(value: number | null | undefined, dp = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `£${value.toFixed(dp)}`;
}

function fmtPct(value: number | null | undefined, dp = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(dp)}%`;
}

// Gross margin tier → tailwind-equivalent hex (mirrors the margin badge colour
// logic used on the Recipes page).
function marginTone(margin: number | null | undefined): { bg: string; fg: string } {
  if (margin == null) return { bg: "#f3f4f6", fg: "#6b7280" };
  if (margin >= 60) return { bg: "#dcfce7", fg: "#15803d" }; // green
  if (margin >= 50) return { bg: "#fef3c7", fg: "#b45309" }; // amber
  return { bg: "#fee2e2", fg: "#b91c1c" };                    // red
}

// Shape of an enriched recipe row coming back from GET /api/recipes.
// Uses the generated type plus the computed cost fields tacked on server-side.
type EnrichedRecipe = Recipe & {
  packIngredientCost: number;
  totalPackCost: number;
  grossMargin: number | null;
};

export default function RecipePnLReport() {
  const { data: recipes, isLoading } = useListRecipes();
  const enriched = (recipes ?? []) as EnrichedRecipe[];

  // ── Filter state ──────────────────────────────────────────────────────────
  const [categoryFilter, setCategoryFilter] = useState<FilterCategory>("all");
  const [coreFilter, setCoreFilter] = useState<CoreFilter>("all");
  const [hideNoRrp, setHideNoRrp] = useState(false);
  const [includeSpecials, setIncludeSpecials] = useState(true);

  useEffect(() => {
    document.title = "Recipe P&L Report — TCK";
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const r of enriched) if (r.category) set.add(r.category);
    return [...set].sort();
  }, [enriched]);

  const rows = useMemo(() => {
    return enriched
      .filter(r => categoryFilter === "all" || r.category === categoryFilter)
      .filter(r => {
        if (coreFilter === "core") return r.isCoreMenu === true;
        if (coreFilter === "non_core") return !r.isCoreMenu;
        return true;
      })
      .filter(r => (includeSpecials ? true : !r.isCurrentSpecial))
      .filter(r => !hideNoRrp || (Number(r.rrp) || 0) > 0)
      .sort((a, b) => {
        const ca = (a.category ?? "").localeCompare(b.category ?? "");
        if (ca !== 0) return ca;
        return a.name.localeCompare(b.name);
      });
  }, [enriched, categoryFilter, coreFilter, hideNoRrp, includeSpecials]);

  // ── Totals / summary calcs ────────────────────────────────────────────────
  const totals = useMemo(() => {
    let ingredient = 0, packaging = 0, labour = 0, total = 0, rrp = 0, marginGbp = 0;
    let marginedRecipes = 0;
    for (const r of rows) {
      const ing = Number(r.packIngredientCost) || 0;
      const pkg = Number(r.packagingCost) || 0;
      const lab = Number(r.labourCost) || 0;
      const tot = Number(r.totalPackCost) || 0;
      const price = Number(r.rrp) || 0;
      ingredient += ing;
      packaging += pkg;
      labour += lab;
      total += tot;
      rrp += price;
      if (price > 0) {
        marginGbp += price - tot;
        marginedRecipes += 1;
      }
    }
    const avgMarginPct = rrp > 0 ? ((rrp - total) / rrp) * 100 : null;
    return { ingredient, packaging, labour, total, rrp, marginGbp, avgMarginPct, marginedRecipes };
  }, [rows]);

  const summary = useMemo(() => {
    const withMargin = rows
      .filter(r => r.grossMargin != null && Number.isFinite(r.grossMargin))
      .map(r => ({ name: r.name, category: r.category ?? "", margin: r.grossMargin as number }));
    if (withMargin.length === 0) return null;
    const avg = withMargin.reduce((s, r) => s + r.margin, 0) / withMargin.length;
    const sorted = [...withMargin].sort((a, b) => a.margin - b.margin);
    const lowest = sorted[0];
    const highest = sorted[sorted.length - 1];
    return { avg, lowest, highest, count: withMargin.length };
  }, [rows]);

  const generatedAt = format(new Date(), "EEE d MMM yyyy 'at' HH:mm");

  return (
    <>
      <style>{`
        @page { size: A4 landscape; margin: 8mm; }
        @media print {
          html, body { background: white !important; margin: 0 !important; padding: 0 !important; }
          .no-print { display: none !important; }
          .pnl-page { padding: 0 !important; max-width: none !important; }
          .pnl-row { page-break-inside: avoid; }
        }
        /* Force colour preservation when printing. Chrome/Safari/Firefox strip
         * background colours by default to save ink; the colour stripes and
         * margin pills are central to this report so we override. */
        html, body,
        .pnl-page, .pnl-page *,
        .pnl-stripe, .pnl-margin-pill, .pnl-summary-card {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          color-adjust: exact !important;
        }
        body { margin: 0; padding: 0; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #111; }
        .pnl-page { max-width: 279mm; margin: 0 auto; padding: 8mm 10mm; background: white; }

        /* ── Screen-only filter bar ────────────────────────────────────── */
        .pnl-controls { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; padding: 12px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; margin-bottom: 12px; font-size: 13px; }
        .pnl-controls label { display: flex; align-items: center; gap: 6px; font-weight: 500; }
        .pnl-controls select { padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 6px; background: white; font: inherit; }
        .pnl-controls .pnl-checkbox { display: flex; align-items: center; gap: 6px; cursor: pointer; }
        .pnl-print-btn { margin-left: auto; padding: 7px 14px; background: #919b5f; color: white; border: none; border-radius: 6px; font-weight: 600; cursor: pointer; }
        .pnl-print-btn:hover { background: #7a8350; }

        /* ── Report header ─────────────────────────────────────────────── */
        .pnl-header { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 6mm; border-bottom: 2pt solid #111; margin-bottom: 5mm; }
        .pnl-title { font-size: 20pt; font-weight: 800; letter-spacing: -0.01em; margin: 0; }
        .pnl-subtitle { font-size: 10pt; color: #6b7280; margin-top: 2mm; }
        .pnl-meta { text-align: right; font-size: 9pt; color: #6b7280; line-height: 1.5; }
        .pnl-meta strong { color: #111; }

        /* ── Table ─────────────────────────────────────────────────────── */
        .pnl-table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
        .pnl-table thead th {
          text-align: left;
          font-weight: 700;
          font-size: 8.5pt;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #6b7280;
          padding: 2mm 2mm;
          border-bottom: 1.5pt solid #111;
          background: #fafafa;
        }
        .pnl-table thead th.num { text-align: right; }
        .pnl-table tbody td { padding: 2.2mm 2mm; border-bottom: 0.5pt solid #e5e7eb; vertical-align: middle; }
        .pnl-table tbody td.num { text-align: right; font-variant-numeric: tabular-nums; }
        .pnl-table tbody tr:nth-child(even) td { background: #fafafa; }
        .pnl-stripe-col { width: 4mm; padding: 0 !important; }
        .pnl-stripe { display: inline-block; width: 3mm; height: 6mm; border-radius: 1mm; vertical-align: middle; background: #cbd5e1; }
        .pnl-name { font-weight: 600; }
        .pnl-category { font-size: 8.5pt; color: #6b7280; text-transform: uppercase; letter-spacing: 0.04em; margin-top: 0.5mm; }

        .pnl-margin-pill { display: inline-block; padding: 1mm 2.5mm; border-radius: 3mm; font-weight: 700; font-size: 9.5pt; font-variant-numeric: tabular-nums; }

        .pnl-totals-row td { padding-top: 3.5mm; padding-bottom: 3.5mm; border-top: 1.5pt solid #111; border-bottom: 1.5pt solid #111; font-weight: 700; font-size: 10pt; background: #fafafa !important; }

        /* ── Summary band ──────────────────────────────────────────────── */
        .pnl-summary { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6mm; margin-top: 6mm; }
        .pnl-summary-card { padding: 4mm; border-radius: 3mm; border: 1pt solid #e5e7eb; }
        .pnl-summary-card.green { background: #f0fdf4; border-color: #bbf7d0; }
        .pnl-summary-card.amber { background: #fffbeb; border-color: #fcd34d; }
        .pnl-summary-card.red { background: #fef2f2; border-color: #fecaca; }
        .pnl-summary-label { font-size: 9pt; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.04em; margin: 0 0 2mm; }
        .pnl-summary-value { font-size: 22pt; font-weight: 800; font-variant-numeric: tabular-nums; margin: 0; line-height: 1; }
        .pnl-summary-sub { font-size: 9pt; color: #6b7280; margin: 2mm 0 0; }

        .pnl-empty { padding: 20mm; text-align: center; color: #6b7280; font-size: 11pt; }
      `}</style>

      <div className="pnl-page">
        {/* Filter controls — hidden on print */}
        <div className="no-print pnl-controls">
          <label>
            Category:
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
              <option value="all">All categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>
            Menu scope:
            <select value={coreFilter} onChange={e => setCoreFilter(e.target.value as CoreFilter)}>
              <option value="all">All recipes</option>
              <option value="core">Core menu only</option>
              <option value="non_core">Non-core only</option>
            </select>
          </label>
          <label className="pnl-checkbox">
            <input type="checkbox" checked={hideNoRrp} onChange={e => setHideNoRrp(e.target.checked)} />
            Hide recipes without RRP
          </label>
          <label className="pnl-checkbox">
            <input type="checkbox" checked={includeSpecials} onChange={e => setIncludeSpecials(e.target.checked)} />
            Include current specials
          </label>
          <button className="pnl-print-btn" onClick={() => window.print()}>
            Print / Save as PDF
          </button>
        </div>

        {/* Printed header */}
        <div className="pnl-header">
          <div>
            <h1 className="pnl-title">Recipe Profit &amp; Loss Report</h1>
            <p className="pnl-subtitle">
              Per-pack cost breakdown &amp; gross margin across
              {" "}
              {categoryFilter === "all" ? "all categories" : `“${categoryFilter}”`}
              {coreFilter === "core" && " · core menu only"}
              {coreFilter === "non_core" && " · non-core only"}
              {hideNoRrp && " · priced recipes only"}
            </p>
          </div>
          <div className="pnl-meta">
            <div><strong>The Calzone Kitchen</strong></div>
            <div>Generated {generatedAt}</div>
            <div>{rows.length} recipe{rows.length === 1 ? "" : "s"}</div>
          </div>
        </div>

        {isLoading ? (
          <div className="pnl-empty">Loading recipes…</div>
        ) : rows.length === 0 ? (
          <div className="pnl-empty">No recipes match the current filters.</div>
        ) : (
          <>
            <table className="pnl-table">
              <thead>
                <tr>
                  <th className="pnl-stripe-col" aria-hidden="true" />
                  <th>Recipe</th>
                  <th className="num">Ingredients</th>
                  <th className="num">Packaging</th>
                  <th className="num">Labour</th>
                  <th className="num">Total Cost</th>
                  <th className="num">RRP</th>
                  <th className="num">Margin £</th>
                  <th className="num">Margin %</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const ingredient = Number(r.packIngredientCost) || 0;
                  const packaging = Number(r.packagingCost) || 0;
                  const labour = Number(r.labourCost) || 0;
                  const totalCost = Number(r.totalPackCost) || 0;
                  const rrp = Number(r.rrp) || 0;
                  const marginGbp = rrp > 0 ? rrp - totalCost : null;
                  const marginPct = r.grossMargin ?? null;
                  const tone = marginTone(marginPct);
                  const stripeColor = r.color ?? "#cbd5e1";
                  return (
                    <tr key={r.id} className="pnl-row">
                      <td className="pnl-stripe-col">
                        <span className="pnl-stripe" style={{ background: stripeColor }} />
                      </td>
                      <td>
                        <div className="pnl-name">{r.name}</div>
                        {(r.category || r.isCoreMenu) && (
                          <div className="pnl-category">
                            {r.category ?? ""}
                            {r.category && r.isCoreMenu ? " · " : ""}
                            {r.isCoreMenu ? "Core" : ""}
                          </div>
                        )}
                      </td>
                      <td className="num">{fmtGBP(ingredient, 3)}</td>
                      <td className="num">{fmtGBP(packaging, 3)}</td>
                      <td className="num">{fmtGBP(labour, 3)}</td>
                      <td className="num"><strong>{fmtGBP(totalCost)}</strong></td>
                      <td className="num">{rrp > 0 ? fmtGBP(rrp) : "—"}</td>
                      <td className="num"><strong>{marginGbp != null ? fmtGBP(marginGbp) : "—"}</strong></td>
                      <td className="num">
                        {marginPct != null ? (
                          <span className="pnl-margin-pill" style={{ background: tone.bg, color: tone.fg }}>
                            {fmtPct(marginPct)}
                          </span>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
                <tr className="pnl-totals-row">
                  <td className="pnl-stripe-col" />
                  <td>Totals</td>
                  <td className="num">{fmtGBP(totals.ingredient)}</td>
                  <td className="num">{fmtGBP(totals.packaging)}</td>
                  <td className="num">{fmtGBP(totals.labour)}</td>
                  <td className="num">{fmtGBP(totals.total)}</td>
                  <td className="num">{fmtGBP(totals.rrp)}</td>
                  <td className="num">{fmtGBP(totals.marginGbp)}</td>
                  <td className="num">{fmtPct(totals.avgMarginPct)}</td>
                </tr>
              </tbody>
            </table>

            {/* Summary band */}
            {summary && (
              <div className="pnl-summary">
                <div className="pnl-summary-card amber">
                  <p className="pnl-summary-label">Average margin</p>
                  <p className="pnl-summary-value">{fmtPct(summary.avg)}</p>
                  <p className="pnl-summary-sub">across {summary.count} priced recipe{summary.count === 1 ? "" : "s"}</p>
                </div>
                <div className="pnl-summary-card red">
                  <p className="pnl-summary-label">Lowest margin</p>
                  <p className="pnl-summary-value">{fmtPct(summary.lowest.margin)}</p>
                  <p className="pnl-summary-sub">{summary.lowest.name}</p>
                </div>
                <div className="pnl-summary-card green">
                  <p className="pnl-summary-label">Highest margin</p>
                  <p className="pnl-summary-value">{fmtPct(summary.highest.margin)}</p>
                  <p className="pnl-summary-sub">{summary.highest.name}</p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
