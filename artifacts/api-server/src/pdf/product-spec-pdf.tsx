// Server-side PDF generation for a BRC-style finished-product specification
// sheet, aimed at trade / wholesale buyers. Most of the technical content is
// derived live from the recipe tree (ingredients declaration + QUID +
// allergens via the ingredient-deck endpoint; nutrition via the nutritionals
// endpoint); the buyer-facing detail (storage, cooking, packaging, micro,
// approval) comes from the product_specifications + company_profile tables.
//
// A DRAFT banner is rendered whenever required data is missing so an
// incomplete sheet can never be mistaken for a signed-off one.

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
  type Styles,
} from "@react-pdf/renderer";

// The per-key style object produced by StyleSheet.create (Styles is a map of these).
type Style = Styles[string];

// ---------------------------------------------------------------------------
// Data shapes
// ---------------------------------------------------------------------------

type Nutrient = number | null;

export interface SpecDeckEntry {
  declaration: string; // may contain **bold** allergen markers
  percentage: number;
}

export interface SpecNutrition {
  per100g: Record<string, Nutrient>;
  perPortion: Record<string, Nutrient>;
  portionWeightG: number;
  declaredPackWeightG: number;
  packSize: number;
  // False when some ingredients have no per-100g data, so the aggregate is
  // understated and must not be presented as a final declaration.
  complete: boolean;
  missingCount: number;
}

export interface SpecMicroRow {
  organism?: string;
  target?: string;
  maximum?: string;
  lastTestDate?: string;
  lastTestLab?: string;
  lastTestResult?: string;
}

export interface ProductSpecPdfData {
  recipe: {
    id: number;
    name: string;
    description: string | null;
    category: string | null;
    dietaryCategory: string | null;
    shelfLifeDays: number | null;
  };
  spec: {
    legalName: string | null;
    productDescription: string | null;
    intendedUse: string | null;
    storageInstructions: string | null;
    usageInstructions: string | null;
    mayContainOverride: string | null;
    packagingSpec: Record<string, string> | null;
    organolepticStandards: Record<string, string> | null;
    microCriteria: SpecMicroRow[] | null;
    dietarySuitability: string | null;
    specVersion: number;
    specStatus: string;
    preparedBy: string | null;
    approvedBy: string | null;
    approvedAt: string | null;
  } | null;
  company: {
    legalBusinessName: string | null;
    tradingName: string | null;
    siteAddress: string | null;
    fboRegistrationNumber: string | null;
    localAuthority: string | null;
    certificationStatus: string | null;
    technicalContactName: string | null;
    technicalContactEmail: string | null;
    technicalContactPhone: string | null;
    emergencyContact: string | null;
  } | null;
  deck: {
    entries: SpecDeckEntry[];
    deckText: string;
    allergens: string[];
    mayContainStatement: string | null;
  } | null;
  nutrition: SpecNutrition | null;
  barcode: string | null;
  cookCcps: Array<{ ingredientName: string; minCookingTempC: number | null }>;
  missing: string[];
  generatedAt: string;
}

// UK14 allergens — shown as a contains/not-present matrix.
const UK14_DISPLAY = [
  "Celery", "Wheat", "Crustaceans", "Eggs", "Fish", "Lupin", "Milk",
  "Molluscs", "Mustard", "Nuts", "Peanuts", "Sesame", "Soybeans", "Sulphur Dioxide",
];

const NUTRIENT_ROWS: Array<{ key: string; label: string; unit: string }> = [
  { key: "energyKj", label: "Energy", unit: "kJ" },
  { key: "energyKcal", label: "Energy", unit: "kcal" },
  { key: "fat", label: "Fat", unit: "g" },
  { key: "saturates", label: "of which saturates", unit: "g" },
  { key: "carbohydrate", label: "Carbohydrate", unit: "g" },
  { key: "sugars", label: "of which sugars", unit: "g" },
  { key: "fibre", label: "Fibre", unit: "g" },
  { key: "protein", label: "Protein", unit: "g" },
  { key: "salt", label: "Salt", unit: "g" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dash = (v: string | number | null | undefined): string =>
  v === null || v === undefined || v === "" ? "—" : String(v);

const fmtDateTime = (iso: string): string =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London" });

const fmtNutrient = (v: Nutrient, unit: string): string =>
  v === null || v === undefined ? "—" : `${v} ${unit}`;

// Render a declaration string that uses **markers** for allergens, turning
// the marked spans bold (matching how the app bolds allergens on labels).
function BoldedText({ text, style }: { text: string; style?: Style | Style[] }) {
  const parts = text.split("**");
  return (
    <Text style={style}>
      {parts.map((part, i) =>
        i % 2 === 1
          ? <Text key={i} style={{ fontFamily: "Helvetica-Bold" }}>{part}</Text>
          : <Text key={i}>{part}</Text>
      )}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const GREEN = "#2F5233";
const styles = StyleSheet.create({
  page: { paddingTop: 38, paddingBottom: 46, paddingHorizontal: 36, fontSize: 9.5, fontFamily: "Helvetica", color: "#111" },
  banner: { backgroundColor: "#B00020", color: "#fff", padding: 6, marginBottom: 10, fontSize: 9, fontFamily: "Helvetica-Bold" },
  header: { marginBottom: 14, paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: GREEN },
  brand: { fontSize: 9, color: GREEN, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 1 },
  title: { fontSize: 20, fontFamily: "Helvetica-Bold", marginTop: 2 },
  subtitle: { fontSize: 10, color: "#444", marginTop: 3 },
  metaRow: { flexDirection: "row", marginTop: 8, gap: 22 },
  metaLabel: { fontSize: 7.5, color: "#666", textTransform: "uppercase", letterSpacing: 0.5 },
  metaValue: { fontSize: 10, fontFamily: "Helvetica-Bold", marginTop: 2 },
  section: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 14, marginBottom: 5, paddingBottom: 3, borderBottomWidth: 1, borderBottomColor: GREEN, color: GREEN },
  // Two-column label/value grid
  kvRow: { flexDirection: "row", paddingVertical: 2.5, borderBottomWidth: 0.25, borderBottomColor: "#e2e2e2" },
  kvLabel: { width: "32%", fontFamily: "Helvetica-Bold", color: "#333" },
  kvValue: { width: "68%" },
  para: { marginTop: 3, lineHeight: 1.4 },
  // table
  tHeadRow: { flexDirection: "row", backgroundColor: "#eef2ec", paddingVertical: 3, paddingHorizontal: 3, borderBottomWidth: 0.5, borderBottomColor: "#aaa" },
  tRow: { flexDirection: "row", paddingVertical: 2.5, paddingHorizontal: 3, borderBottomWidth: 0.25, borderBottomColor: "#e2e2e2" },
  tHead: { fontFamily: "Helvetica-Bold", fontSize: 8.5 },
  tCell: { fontSize: 8.5 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 },
  chipContains: { backgroundColor: "#ffe0e0", color: "#8a0000", padding: "2 5", fontSize: 8, borderRadius: 2, fontFamily: "Helvetica-Bold" },
  chipAbsent: { backgroundColor: "#eef2ec", color: "#557", padding: "2 5", fontSize: 8, borderRadius: 2 },
  note: { marginTop: 4, padding: 5, backgroundColor: "#fafaf5", fontSize: 8.5, color: "#444" },
  footer: { position: "absolute", bottom: 20, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: "#888", paddingTop: 5, borderTopWidth: 0.5, borderTopColor: "#ddd" },
  missing: { color: "#B00020", fontStyle: "italic" },
});

const cw = (pct: number) => ({ width: `${pct}%` as const });

// ---------------------------------------------------------------------------
// Section components
// ---------------------------------------------------------------------------

function KV({ label, value, missing }: { label: string; value: string | null | undefined; missing?: boolean }) {
  const empty = value === null || value === undefined || value === "";
  return (
    <View style={styles.kvRow}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={[styles.kvValue, empty && missing ? styles.missing : {}]}>
        {empty ? (missing ? "To be completed" : "—") : value}
      </Text>
    </View>
  );
}

function Identity({ data }: { data: ProductSpecPdfData }) {
  const s = data.spec;
  return (
    <View>
      <Text style={styles.section}>1. Product identity</Text>
      <KV label="Product name" value={data.recipe.name.trim()} />
      <KV label="Legal name" value={s?.legalName} missing />
      <KV label="Description" value={s?.productDescription || data.recipe.description} missing />
      <KV label="Category" value={data.recipe.category} />
      <KV label="Product code / SKU" value={String(data.recipe.id)} />
      <KV label="Barcode (GTIN)" value={data.barcode} missing />
      <KV label="Intended use" value={s?.intendedUse} missing />
    </View>
  );
}

function Manufacturer({ company }: { company: ProductSpecPdfData["company"] }) {
  return (
    <View>
      <Text style={styles.section}>2. Manufacturer & site</Text>
      <KV label="Legal business name" value={company?.legalBusinessName} missing />
      <KV label="Trading name" value={company?.tradingName} />
      <KV label="Site address" value={company?.siteAddress} missing />
      <KV label="FBO registration no." value={company?.fboRegistrationNumber} missing />
      <KV label="Local authority" value={company?.localAuthority} missing />
      <KV label="Certification" value={company?.certificationStatus} missing />
      <KV label="Technical contact" value={[company?.technicalContactName, company?.technicalContactEmail, company?.technicalContactPhone].filter(Boolean).join(" · ") || null} missing />
      <KV label="Emergency contact" value={company?.emergencyContact} missing />
    </View>
  );
}

function Ingredients({ deck }: { deck: ProductSpecPdfData["deck"] }) {
  return (
    <View wrap={false}>
      <Text style={styles.section}>3. Ingredients declaration</Text>
      <Text style={{ fontSize: 8, color: "#666", marginBottom: 3 }}>
        In descending order by weight. Allergens shown in bold. Percentages shown where QUID applies.
      </Text>
      {deck && deck.deckText
        ? <BoldedText text={deck.deckText} style={styles.para} />
        : <Text style={[styles.para, styles.missing]}>Ingredients declaration unavailable — recipe data incomplete.</Text>}
    </View>
  );
}

function Allergens({ data }: { data: ProductSpecPdfData }) {
  const present = new Set(data.deck?.allergens ?? []);
  const mayContain = data.spec?.mayContainOverride || data.deck?.mayContainStatement || null;
  return (
    <View wrap={false}>
      <Text style={styles.section}>4. Allergen information</Text>
      <Text style={{ fontSize: 8.5, fontFamily: "Helvetica-Bold", marginBottom: 2 }}>Contains:</Text>
      <Text style={styles.para}>
        {present.size ? [...present].join(", ") : "No declared allergens from tagged ingredients (verify all ingredients are tagged)."}
      </Text>
      <Text style={{ fontSize: 8.5, fontFamily: "Helvetica-Bold", marginTop: 6, marginBottom: 3 }}>Allergen matrix (UK 14):</Text>
      <View style={styles.chipRow}>
        {UK14_DISPLAY.map(a => (
          <Text key={a} style={present.has(a) ? styles.chipContains : styles.chipAbsent}>
            {a}{present.has(a) ? " •" : ""}
          </Text>
        ))}
      </View>
      {mayContain ? <Text style={styles.note}>{mayContain}</Text> : null}
    </View>
  );
}

function Nutrition({ nutrition }: { nutrition: ProductSpecPdfData["nutrition"] }) {
  return (
    <View wrap={false}>
      <Text style={styles.section}>5. Nutrition</Text>
      {nutrition ? (
        <>
          {!nutrition.complete ? (
            <Text style={[styles.note, styles.missing]}>
              Provisional — {nutrition.missingCount} ingredient(s) have no nutritional data, so figures are
              understated. Values below are withheld until every ingredient is complete.
            </Text>
          ) : null}
          <View style={styles.tHeadRow}>
            <Text style={[styles.tHead, cw(50)]}>Typical values</Text>
            <Text style={[styles.tHead, cw(25), { textAlign: "right" }]}>Per 100g</Text>
            <Text style={[styles.tHead, cw(25), { textAlign: "right" }]}>Per portion</Text>
          </View>
          {NUTRIENT_ROWS.map(r => (
            <View key={r.key} style={styles.tRow}>
              <Text style={[styles.tCell, cw(50)]}>{r.label}</Text>
              <Text style={[styles.tCell, cw(25), { textAlign: "right" }]}>{nutrition.complete ? fmtNutrient(nutrition.per100g[r.key], r.unit) : "pending"}</Text>
              <Text style={[styles.tCell, cw(25), { textAlign: "right" }]}>{nutrition.complete ? fmtNutrient(nutrition.perPortion[r.key], r.unit) : "pending"}</Text>
            </View>
          ))}
          {/* Portion weight is derived from the recipe's fill/base weights. When
              those are unset the endpoint still returns a figure, but it is the
              bare ingredient sum and wildly understates a finished calzone — so
              never print a net weight we cannot stand behind on a buyer's spec. */}
          {nutrition.complete ? (
            <Text style={{ fontSize: 8, color: "#666", marginTop: 3 }}>
              Portion weight ~{nutrition.portionWeightG} g. Declared net weight (pack of {nutrition.packSize}) ~{nutrition.declaredPackWeightG} g.
            </Text>
          ) : (
            <Text style={[{ fontSize: 8, marginTop: 3 }, styles.missing]}>
              Portion and declared net weight pending — recipe fill/base weights not set, so no net weight is stated here.
            </Text>
          )}
        </>
      ) : <Text style={[styles.para, styles.missing]}>Nutrition unavailable — ingredient nutritionals incomplete.</Text>}
    </View>
  );
}

function Organoleptic({ spec }: { spec: ProductSpecPdfData["spec"] }) {
  const o = spec?.organolepticStandards ?? {};
  return (
    <View wrap={false}>
      <Text style={styles.section}>6. Physical & organoleptic standards</Text>
      <KV label="Appearance" value={o.appearance} missing />
      <KV label="Aroma" value={o.aroma} missing />
      <KV label="Flavour" value={o.flavour} missing />
      <KV label="Texture" value={o.texture} missing />
    </View>
  );
}

function Micro({ spec, generatedAt }: { spec: ProductSpecPdfData["spec"]; generatedAt: string }) {
  const rows = spec?.microCriteria ?? [];
  const now = new Date(generatedAt);
  return (
    <View wrap={false}>
      <Text style={styles.section}>7. Microbiological criteria & results</Text>
      {rows.length ? (
        <>
          <View style={styles.tHeadRow}>
            <Text style={[styles.tHead, cw(28)]}>Organism</Text>
            <Text style={[styles.tHead, cw(22)]}>Target</Text>
            <Text style={[styles.tHead, cw(18)]}>Last result</Text>
            <Text style={[styles.tHead, cw(16)]}>Test date</Text>
            <Text style={[styles.tHead, cw(16)]}>Lab</Text>
          </View>
          {rows.map((m, i) => {
            let stale = false;
            if (m.lastTestDate) {
              const d = new Date(m.lastTestDate);
              if (!isNaN(d.getTime())) {
                const ageDays = (now.getTime() - d.getTime()) / 86400000;
                stale = ageDays > 365;
              }
            }
            return (
              <View key={i} style={styles.tRow}>
                <Text style={[styles.tCell, cw(28)]}>{dash(m.organism)}</Text>
                <Text style={[styles.tCell, cw(22)]}>{dash(m.target || m.maximum)}</Text>
                <Text style={[styles.tCell, cw(18)]}>{dash(m.lastTestResult)}</Text>
                <Text style={[styles.tCell, cw(16), stale ? styles.missing : {}]}>{dash(m.lastTestDate)}{stale ? " (!)" : ""}</Text>
                <Text style={[styles.tCell, cw(16)]}>{dash(m.lastTestLab)}</Text>
              </View>
            );
          })}
          <Text style={styles.note}>
            (!) marks results over 12 months old. For a chilled cooked ready-to-eat product, end-of-shelf-life
            Listeria monocytogenes testing is the key verification; re-test annually and after any recipe,
            process, packaging or shelf-life change.
          </Text>
        </>
      ) : <Text style={[styles.para, styles.missing]}>Microbiological criteria to be completed.</Text>}
    </View>
  );
}

function Packaging({ spec, nutrition }: { spec: ProductSpecPdfData["spec"]; nutrition: ProductSpecPdfData["nutrition"] }) {
  const p = spec?.packagingSpec ?? {};
  return (
    <View wrap={false}>
      <Text style={styles.section}>8. Weights & packaging</Text>
      {/* Only state a net weight when it is genuinely derived (recipe fill/base
          weights set). Otherwise the figure is the bare ingredient sum — an
          order of magnitude light — and must never reach a buyer's spec. */}
      <KV label="Declared net weight" value={nutrition?.complete ? `${nutrition.declaredPackWeightG} g` : null} missing />
      <KV label="Pack configuration" value={nutrition ? `${nutrition.packSize} portion(s) per pack` : (p.caseConfiguration ?? null)} />
      <KV label="Format" value={p.format} missing />
      <KV label="Primary packaging" value={p.primaryPackaging} missing />
      <KV label="Secondary packaging" value={p.secondaryPackaging} missing />
      <KV label="Case configuration" value={p.caseConfiguration} missing />
      <KV label="Materials" value={p.materials} missing />
      <KV label="Recyclability" value={p.recyclability} missing />
    </View>
  );
}

function Storage({ data }: { data: ProductSpecPdfData }) {
  const s = data.spec;
  return (
    <View wrap={false}>
      <Text style={styles.section}>9. Shelf life, storage & distribution</Text>
      <KV label="Shelf life" value={data.recipe.shelfLifeDays != null ? `${data.recipe.shelfLifeDays} days` : null} missing />
      <KV label="Storage & distribution" value={s?.storageInstructions || "Keep refrigerated 0–5°C. Consume by date on pack."} missing={!s?.storageInstructions} />
    </View>
  );
}

function Usage({ data }: { data: ProductSpecPdfData }) {
  const s = data.spec;
  return (
    <View wrap={false}>
      <Text style={styles.section}>10. Consumer usage & preparation</Text>
      <Text style={s?.usageInstructions ? styles.para : [styles.para, styles.missing]}>
        {s?.usageInstructions || "Cooking / usage instructions to be completed."}
      </Text>
    </View>
  );
}

function Dietary({ data }: { data: ProductSpecPdfData }) {
  const s = data.spec;
  const origins = ""; // origin summary is folded into the ingredients section input for now
  return (
    <View wrap={false}>
      <Text style={styles.section}>11. Dietary suitability & origin</Text>
      <KV label="Dietary suitability" value={s?.dietarySuitability || data.recipe.dietaryCategory} missing={!s?.dietarySuitability && !data.recipe.dietaryCategory} />
      {origins ? <KV label="Country of origin" value={origins} /> : null}
    </View>
  );
}

function Haccp({ data }: { data: ProductSpecPdfData }) {
  const ccps = data.cookCcps.filter(c => c.minCookingTempC != null);
  return (
    <View wrap={false}>
      <Text style={styles.section}>12. Process & HACCP summary</Text>
      <Text style={{ fontSize: 8.5, fontFamily: "Helvetica-Bold", marginBottom: 2 }}>Cook (critical control point):</Text>
      {ccps.length ? ccps.map((c, i) => (
        <View key={i} style={styles.kvRow}>
          <Text style={styles.kvLabel}>{c.ingredientName}</Text>
          <Text style={styles.kvValue}>Cook to a core temperature of at least {c.minCookingTempC}°C, verified and logged per batch.</Text>
        </View>
      )) : <Text style={styles.para}>Cook to a minimum core temperature of 75°C (or equivalent), verified and logged per batch.</Text>}
      <Text style={[styles.para, { marginTop: 4 }]}>
        Chill: cooked product is blast/rapid chilled and held below 5°C. Cold chain is monitored continuously
        (automated fridge sensors) and at goods-in. Metal detection / foreign-body controls applied per the
        site HACCP plan.
      </Text>
    </View>
  );
}

function Approval({ data }: { data: ProductSpecPdfData }) {
  const s = data.spec;
  return (
    <View wrap={false}>
      <Text style={styles.section}>13. Version control & approval</Text>
      <KV label="Specification version" value={s ? `v${s.specVersion}` : "v1 (draft)"} />
      <KV label="Status" value={s ? s.specStatus : "draft"} />
      <KV label="Prepared by" value={s?.preparedBy} missing />
      <KV label="Approved by" value={s?.approvedBy} missing />
      <KV label="Approved date" value={s?.approvedAt ? new Date(s.approvedAt).toLocaleDateString("en-GB") : null} missing />
      <KV label="Issued" value={fmtDateTime(data.generatedAt)} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

const SpecDocument = ({ data }: { data: ProductSpecPdfData }) => {
  const isDraft = !data.spec || data.spec.specStatus !== "approved" || data.missing.length > 0;
  return (
    <Document
      title={`Product Specification — ${data.recipe.name.trim()}`}
      author={data.company?.tradingName ?? "The Calzone Kitchen"}
      subject="Finished product specification"
    >
      <Page size="A4" style={styles.page}>
        {isDraft ? (
          <View style={styles.banner} fixed>
            <Text>
              DRAFT — NOT APPROVED FOR ISSUE{data.missing.length ? `. Outstanding: ${data.missing.join("; ")}` : ""}
            </Text>
          </View>
        ) : null}
        <View style={styles.header}>
          <Text style={styles.brand}>{data.company?.tradingName ?? "The Calzone Kitchen"}</Text>
          <Text style={styles.title}>{data.recipe.name.trim()}</Text>
          <Text style={styles.subtitle}>Finished product specification</Text>
          <View style={styles.metaRow}>
            <View><Text style={styles.metaLabel}>Product code</Text><Text style={styles.metaValue}>{data.recipe.id}</Text></View>
            <View><Text style={styles.metaLabel}>Version</Text><Text style={styles.metaValue}>v{data.spec?.specVersion ?? 1}</Text></View>
            <View><Text style={styles.metaLabel}>Status</Text><Text style={styles.metaValue}>{(data.spec?.specStatus ?? "draft").toUpperCase()}</Text></View>
            <View><Text style={styles.metaLabel}>Shelf life</Text><Text style={styles.metaValue}>{data.recipe.shelfLifeDays != null ? `${data.recipe.shelfLifeDays} days` : "—"}</Text></View>
          </View>
        </View>

        <Identity data={data} />
        <Manufacturer company={data.company} />
        <Ingredients deck={data.deck} />
        <Allergens data={data} />
        <Nutrition nutrition={data.nutrition} />
        <Organoleptic spec={data.spec} />
        <Micro spec={data.spec} generatedAt={data.generatedAt} />
        <Packaging spec={data.spec} nutrition={data.nutrition} />
        <Storage data={data} />
        <Usage data={data} />
        <Dietary data={data} />
        <Haccp data={data} />
        <Approval data={data} />

        <View style={styles.footer} fixed>
          <Text>{data.recipe.name.trim()} · spec v{data.spec?.specVersion ?? 1} · issued {fmtDateTime(data.generatedAt)}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
};

export async function renderProductSpecPdf(data: ProductSpecPdfData): Promise<Buffer> {
  return await renderToBuffer(<SpecDocument data={data} />);
}
