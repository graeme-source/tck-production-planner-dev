// Server-side PDF generation for a locked production plan. This is the
// emergency fallback artifact — if the app goes down, the person who
// locked the plan has a printable copy of every figure the kitchen
// needs to run the day. Layout is print-optimised (not a screenshot of
// the UI), one document covering all stations.

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";

// ---------------------------------------------------------------------------
// Data shapes
// ---------------------------------------------------------------------------

export interface PdfPlan {
  id: number;
  planDate: string;
  prepDate: string | null;
  doughDate: string | null;
  name: string | null;
  batchNumber: number | null;
  notes: string | null;
}

export interface PdfItem {
  id: number;
  recipeName: string;
  category: string | null;
  batchesTarget: number;
  portionsPerBatch: number | null;
  packSize: number | null;
  tinSize: string | null;
  maxBatchesPerTin: number | null;
}

export interface PdfSubRecipe {
  subRecipeName: string;
  totalRequired: number;
  yieldUnit: string;
  yield: number;
}

export interface PdfFillingMixItem {
  recipeName: string;
  tinSize: string | null;
  tinsTarget: number;
  batchesPerTin: number;
  servingsPerTin: number;
  ingredients: { name: string; unit: string; qtyPerTin: number }[];
  subRecipes: { name: string; unit: string; qtyPerTin: number }[];
}

export interface PdfAssemblyItem {
  recipeName: string;
  fillingWeightPerBatch: number;
  items: { name: string; unit: string; weightPerBatch: number; isTopping: boolean }[];
  postOvenItems: { name: string; unit: string; weightPerBatch: number }[];
}

export interface ProductionPlanPdfData {
  plan: PdfPlan;
  items: PdfItem[];
  subRecipes: PdfSubRecipe[];
  fillingMix: PdfFillingMixItem[];
  assembly: PdfAssemblyItem[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const fmtDate = (iso: string | null): string => {
  if (!iso) return "—";
  // Use UTC parse to avoid TZ shifts changing the displayed date
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
};

const fmtQty = (qty: number, unit: string): string => {
  const u = (unit || "").toLowerCase();
  if (u === "g") {
    return qty >= 1000 ? `${(qty / 1000).toFixed(2)} kg` : `${Math.round(qty)} g`;
  }
  if (u === "kg") {
    return qty < 1 ? `${Math.round(qty * 1000)} g` : `${qty.toFixed(2)} kg`;
  }
  if (u === "ml") {
    return qty >= 1000 ? `${(qty / 1000).toFixed(2)} L` : `${Math.round(qty)} ml`;
  }
  if (u === "l") {
    return qty < 1 ? `${Math.round(qty * 1000)} ml` : `${qty.toFixed(2)} L`;
  }
  if (u === "ea" || u === "each" || u === "") {
    // Integer counts
    return Math.abs(qty - Math.round(qty)) < 0.01 ? `${Math.round(qty)}` : qty.toFixed(2);
  }
  return `${qty.toFixed(2)} ${unit}`;
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 50,
    paddingHorizontal: 36,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#111",
  },
  header: {
    marginBottom: 18,
    paddingBottom: 12,
    borderBottomWidth: 1.5,
    borderBottomColor: "#333",
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 11,
    color: "#444",
  },
  headerMetaRow: {
    flexDirection: "row",
    marginTop: 8,
    gap: 24,
  },
  headerMetaLabel: {
    fontSize: 8,
    color: "#666",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  headerMetaValue: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    marginTop: 2,
  },
  sectionHeading: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    marginTop: 18,
    marginBottom: 6,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#333",
  },
  subHeading: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    marginTop: 10,
    marginBottom: 4,
    color: "#222",
  },
  recipeBlock: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: "#bbb",
  },
  recipeBlockTitle: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },
  recipeBlockMeta: {
    fontSize: 9,
    color: "#555",
    marginBottom: 4,
  },
  table: {
    marginTop: 4,
    width: "100%",
  },
  tableHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#f0f0f0",
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "#aaa",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 3,
    paddingHorizontal: 4,
    borderBottomWidth: 0.25,
    borderBottomColor: "#ddd",
  },
  tableCell: {
    fontSize: 9.5,
  },
  tableCellBold: {
    fontSize: 9.5,
    fontFamily: "Helvetica-Bold",
  },
  notes: {
    marginTop: 6,
    padding: 6,
    backgroundColor: "#fafafa",
    fontSize: 9,
    color: "#333",
  },
  footer: {
    position: "absolute",
    bottom: 22,
    left: 36,
    right: 36,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: "#888",
    paddingTop: 6,
    borderTopWidth: 0.5,
    borderTopColor: "#ddd",
  },
});

// Column-width sets used in tables across the doc. Numbers add to 100.
const colsBatches = { recipe: 46, batches: 14, packs: 14, portions: 16, tin: 10 };
const colsSubRec = { name: 50, total: 25, batches: 25 };
const colsMix = { item: 60, perTin: 40 };
const colsAssembly = { item: 55, perBatch: 25, halfBatch: 20 };

const cellWidth = (pct: number) => ({ width: `${pct}%` as const });

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

const HeaderSection = ({ plan, generatedAt }: { plan: PdfPlan; generatedAt: string }) => (
  <View style={styles.header}>
    <Text style={styles.headerTitle}>{plan.name ?? `Production Plan ${plan.planDate}`}</Text>
    <Text style={styles.headerSubtitle}>Production date: {fmtDate(plan.planDate)}</Text>
    <View style={styles.headerMetaRow}>
      <View>
        <Text style={styles.headerMetaLabel}>Batch number</Text>
        <Text style={styles.headerMetaValue}>{plan.batchNumber ?? "—"}</Text>
      </View>
      <View>
        <Text style={styles.headerMetaLabel}>Prep day</Text>
        <Text style={styles.headerMetaValue}>{plan.prepDate ? fmtDate(plan.prepDate) : "—"}</Text>
      </View>
      <View>
        <Text style={styles.headerMetaLabel}>Dough day</Text>
        <Text style={styles.headerMetaValue}>{plan.doughDate ? fmtDate(plan.doughDate) : "—"}</Text>
      </View>
      <View>
        <Text style={styles.headerMetaLabel}>Locked at</Text>
        <Text style={styles.headerMetaValue}>{new Date(generatedAt).toLocaleString("en-GB", { timeZone: "Europe/London" })}</Text>
      </View>
    </View>
    {plan.notes ? <Text style={styles.notes}>Notes: {plan.notes}</Text> : null}
  </View>
);

const BatchesSection = ({ items }: { items: PdfItem[] }) => {
  const calzone = items.filter(i => (i.category ?? "").toLowerCase() !== "macaroni cheese");
  const macCheese = items.filter(i => (i.category ?? "").toLowerCase() === "macaroni cheese");

  const renderGroup = (label: string, group: PdfItem[]) => {
    if (group.length === 0) return null;
    const totalBatches = group.reduce((s, i) => s + (i.batchesTarget ?? 0), 0);
    const totalPortions = group.reduce(
      (s, i) => s + (i.batchesTarget ?? 0) * (i.portionsPerBatch ?? 0),
      0,
    );
    return (
      <View wrap={false}>
        <Text style={styles.subHeading}>{label} — {totalBatches} batches · {totalPortions} portions</Text>
        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.tableCellBold, cellWidth(colsBatches.recipe)]}>Recipe</Text>
            <Text style={[styles.tableCellBold, cellWidth(colsBatches.batches), { textAlign: "right" }]}>Batches</Text>
            <Text style={[styles.tableCellBold, cellWidth(colsBatches.packs), { textAlign: "right" }]}>Packs</Text>
            <Text style={[styles.tableCellBold, cellWidth(colsBatches.portions), { textAlign: "right" }]}>Portions</Text>
            <Text style={[styles.tableCellBold, cellWidth(colsBatches.tin), { textAlign: "right" }]}>Tin</Text>
          </View>
          {group.map(it => {
            const batches = it.batchesTarget ?? 0;
            const portions = batches * (it.portionsPerBatch ?? 0);
            const packs = it.packSize && it.packSize > 0 ? Math.ceil(portions / it.packSize) : portions;
            return (
              <View key={it.id} style={styles.tableRow}>
                <Text style={[styles.tableCell, cellWidth(colsBatches.recipe)]}>{it.recipeName}</Text>
                <Text style={[styles.tableCellBold, cellWidth(colsBatches.batches), { textAlign: "right" }]}>{batches}</Text>
                <Text style={[styles.tableCell, cellWidth(colsBatches.packs), { textAlign: "right" }]}>{packs}</Text>
                <Text style={[styles.tableCell, cellWidth(colsBatches.portions), { textAlign: "right" }]}>{portions}</Text>
                <Text style={[styles.tableCell, cellWidth(colsBatches.tin), { textAlign: "right" }]}>{it.tinSize ?? "—"}</Text>
              </View>
            );
          })}
        </View>
      </View>
    );
  };

  return (
    <View>
      <Text style={styles.sectionHeading}>Recipe batches</Text>
      {renderGroup("Calzone", calzone)}
      {renderGroup("Macaroni Cheese", macCheese)}
    </View>
  );
};

const PrepSection = ({ subRecipes }: { subRecipes: PdfSubRecipe[] }) => {
  if (subRecipes.length === 0) return null;
  return (
    <View break>
      <Text style={styles.sectionHeading}>Prep — sub-recipe totals</Text>
      <Text style={[styles.headerSubtitle, { marginBottom: 6 }]}>
        How much of each prep batch the prep team needs to produce.
      </Text>
      <View style={styles.table}>
        <View style={styles.tableHeaderRow}>
          <Text style={[styles.tableCellBold, cellWidth(colsSubRec.name)]}>Sub-recipe</Text>
          <Text style={[styles.tableCellBold, cellWidth(colsSubRec.total), { textAlign: "right" }]}>Total required</Text>
          <Text style={[styles.tableCellBold, cellWidth(colsSubRec.batches), { textAlign: "right" }]}>Batches</Text>
        </View>
        {subRecipes.map((sr, idx) => {
          const batchesRequired = sr.yield > 0 ? sr.totalRequired / sr.yield : 0;
          return (
            <View key={idx} style={styles.tableRow} wrap={false}>
              <Text style={[styles.tableCell, cellWidth(colsSubRec.name)]}>{sr.subRecipeName}</Text>
              <Text style={[styles.tableCellBold, cellWidth(colsSubRec.total), { textAlign: "right" }]}>
                {fmtQty(sr.totalRequired, sr.yieldUnit)}
              </Text>
              <Text style={[styles.tableCell, cellWidth(colsSubRec.batches), { textAlign: "right" }]}>
                {batchesRequired.toFixed(2)} × {fmtQty(sr.yield, sr.yieldUnit)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
};

const FillingMixSection = ({ fillingMix }: { fillingMix: PdfFillingMixItem[] }) => {
  if (fillingMix.length === 0) return null;
  return (
    <View break>
      <Text style={styles.sectionHeading}>Mixing & dough — per-tin filling</Text>
      <Text style={[styles.headerSubtitle, { marginBottom: 4 }]}>
        Quantities are per mixing tin. Multiply by tin count for batch totals.
      </Text>
      {fillingMix.map((item, idx) => (
        <View key={idx} style={styles.recipeBlock} wrap={false}>
          <Text style={styles.recipeBlockTitle}>{item.recipeName}</Text>
          <Text style={styles.recipeBlockMeta}>
            {item.tinsTarget} tin{item.tinsTarget === 1 ? "" : "s"} · {item.batchesPerTin} batch
            {item.batchesPerTin === 1 ? "" : "es"} per tin · {item.servingsPerTin} portions per tin
            {item.tinSize ? ` · ${item.tinSize}` : ""}
          </Text>
          <View style={styles.table}>
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.tableCellBold, cellWidth(colsMix.item)]}>Component</Text>
              <Text style={[styles.tableCellBold, cellWidth(colsMix.perTin), { textAlign: "right" }]}>Per tin</Text>
            </View>
            {item.subRecipes.map((sr, i) => (
              <View key={`s${i}`} style={styles.tableRow}>
                <Text style={[styles.tableCell, cellWidth(colsMix.item)]}>{sr.name}</Text>
                <Text style={[styles.tableCellBold, cellWidth(colsMix.perTin), { textAlign: "right" }]}>{fmtQty(sr.qtyPerTin, sr.unit)}</Text>
              </View>
            ))}
            {item.ingredients.map((ing, i) => (
              <View key={`i${i}`} style={styles.tableRow}>
                <Text style={[styles.tableCell, cellWidth(colsMix.item)]}>{ing.name}</Text>
                <Text style={[styles.tableCellBold, cellWidth(colsMix.perTin), { textAlign: "right" }]}>{fmtQty(ing.qtyPerTin, ing.unit)}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
};

const AssemblySection = ({ assembly }: { assembly: PdfAssemblyItem[] }) => {
  if (assembly.length === 0) return null;
  return (
    <View break>
      <Text style={styles.sectionHeading}>Building station — assembly</Text>
      <Text style={[styles.headerSubtitle, { marginBottom: 4 }]}>
        Per-batch weights for each recipe at the building station.
      </Text>
      {assembly.map((a, idx) => (
        <View key={idx} style={styles.recipeBlock} wrap={false}>
          <Text style={styles.recipeBlockTitle}>{a.recipeName}</Text>
          <Text style={styles.recipeBlockMeta}>
            Filling: {fmtQty(a.fillingWeightPerBatch, "g")} per batch (½ batch: {fmtQty(a.fillingWeightPerBatch / 2, "g")})
          </Text>
          {a.items.length > 0 && (
            <View style={styles.table}>
              <View style={styles.tableHeaderRow}>
                <Text style={[styles.tableCellBold, cellWidth(colsAssembly.item)]}>Component</Text>
                <Text style={[styles.tableCellBold, cellWidth(colsAssembly.perBatch), { textAlign: "right" }]}>Per batch</Text>
                <Text style={[styles.tableCellBold, cellWidth(colsAssembly.halfBatch), { textAlign: "right" }]}>Half</Text>
              </View>
              {a.items.map((it, i) => (
                <View key={i} style={styles.tableRow}>
                  <Text style={[styles.tableCell, cellWidth(colsAssembly.item)]}>
                    {it.name}{it.isTopping ? " (topping)" : ""}
                  </Text>
                  <Text style={[styles.tableCellBold, cellWidth(colsAssembly.perBatch), { textAlign: "right" }]}>{fmtQty(it.weightPerBatch, it.unit)}</Text>
                  <Text style={[styles.tableCell, cellWidth(colsAssembly.halfBatch), { textAlign: "right" }]}>{fmtQty(it.weightPerBatch / 2, it.unit)}</Text>
                </View>
              ))}
            </View>
          )}
          {a.postOvenItems.length > 0 && (
            <View style={{ marginTop: 4 }}>
              <Text style={[styles.recipeBlockMeta, { fontFamily: "Helvetica-Bold" }]}>Post-oven:</Text>
              {a.postOvenItems.map((it, i) => (
                <View key={`p${i}`} style={styles.tableRow}>
                  <Text style={[styles.tableCell, cellWidth(colsAssembly.item)]}>{it.name}</Text>
                  <Text style={[styles.tableCellBold, cellWidth(colsAssembly.perBatch), { textAlign: "right" }]}>{fmtQty(it.weightPerBatch, it.unit)}</Text>
                  <Text style={[styles.tableCell, cellWidth(colsAssembly.halfBatch), { textAlign: "right" }]}>{fmtQty(it.weightPerBatch / 2, it.unit)}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      ))}
    </View>
  );
};

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

const ProductionPlanDocument = ({ data }: { data: ProductionPlanPdfData }) => (
  <Document
    title={`TCK Production Plan ${data.plan.planDate}`}
    author="The Calzone Kitchen"
    subject="Daily production plan"
  >
    <Page size="A4" style={styles.page}>
      <HeaderSection plan={data.plan} generatedAt={data.generatedAt} />
      <BatchesSection items={data.items} />
      <PrepSection subRecipes={data.subRecipes} />
      <FillingMixSection fillingMix={data.fillingMix} />
      <AssemblySection assembly={data.assembly} />
      <View style={styles.footer} fixed>
        <Text>TCK production plan · locked {new Date(data.generatedAt).toLocaleString("en-GB", { timeZone: "Europe/London" })}</Text>
        <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      </View>
    </Page>
  </Document>
);

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function renderProductionPlanPdf(data: ProductionPlanPdfData): Promise<Buffer> {
  return await renderToBuffer(<ProductionPlanDocument data={data} />);
}
