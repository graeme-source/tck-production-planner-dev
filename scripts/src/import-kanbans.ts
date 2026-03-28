import XLSX from "xlsx";
import pg from "pg";
import path from "path";

const EXCEL_PATH = path.resolve(
  import.meta.dirname,
  "../../attached_assets/kanbans-03-28-2026_1774676865_1774677431707.xlsx",
);

const SUPPLIER_NAME_MAP: Record<string, string> = {
  brakes: "Brakes Food Service",
  "brakes food service": "Brakes Food Service",
  amazon: "Amazon",
  waterdeans: "Waterdene",
  waterdene: "Waterdene",
  "jd meats": "Jay D Meats",
  "express food": "Express Food Service",
  "a di maria": "A D Maria",
  "a.d.maria": "A D Maria",
  "a.b. fruits": "AB Fruits",
  "butchers sundri": "Butcher Sundries",
  "d sticker print": "Discount Sticker Printing",
  "dsp (discount)": "Discount Sticker Printing",
  "discount sticker printing": "Discount Sticker Printing",
  "polypouch.co.uk": "Polypouch",
  "sauce shop": "The Sauce Shop",
  tck: "TCK",
  dalziel: "Dalziel",
  "starry mart": "Starry Mart",
  "universal products": "Universal Products",
  "chef stuff": "Chef Stuff",
  "galleon supplie": "Galleon Supplies",
  "puffin packagin": "Puffin Packaging",
  mcfarlane: "Macfarlane",
  "coffee house": "Coffee House",
  nisbets: "Nisbets",
  macfarlane: "Macfarlane",
  panibois: "Panibois",
  bpc: "BPC",
  tradeprint: "TradePrint",
  schott: "Schott",
  kempner: "Kempner",
  "apex workwear": "Apex Workwear",
  ecobiopack: "Ecobiopack",
  "cups direct": "Cups Direct",
  bchs: "BCHS",
  dpd: "DPD",
  "aa labels": "AA Labels",
  thergis: "Thergis",
  booker: "Booker",
  cakehead: "Cakehead",
  rs: "RS",
  "pronto direct": "Pronto Direct",
  bidfood: "Bidfood",
};

const COMPOSITE_SUPPLIER_MAP: Record<string, { primary: string; secondary: string }> = {
  "waterdene/brakes": { primary: "Waterdene", secondary: "Brakes Food Service" },
  "a.d.maria/wd": { primary: "A D Maria", secondary: "Waterdene" },
  "a.d.maria/a.b f": { primary: "A D Maria", secondary: "AB Fruits" },
  "a di maria/ab f": { primary: "A D Maria", secondary: "AB Fruits" },
  "a di maria/ab fruits": { primary: "A D Maria", secondary: "AB Fruits" },
  "express food/wd": { primary: "Express Food Service", secondary: "Waterdene" },
  "express/wdean": { primary: "Express Food Service", secondary: "Waterdene" },
  "waterdene/ab": { primary: "Waterdene", secondary: "AB Fruits" },
  "bidfood/waterde": { primary: "Bidfood", secondary: "Waterdene" },
  "bidfood/wd": { primary: "Bidfood", secondary: "Waterdene" },
};

const INGREDIENT_USED_FOR = new Set([
  "production",
  "calzone product",
  "mac and cheese",
  "duck calzone",
  "cocky chick",
  "mayo jars",
  "sustenance",
  "brownies/orders",
  "internal",
  "fried chicken",
]);

const STOCK_ITEM_USED_FOR: Record<string, string> = {
  packing: "Packaging",
  packaging: "Packaging",
  "order packing": "Packaging",
  wrapping: "Packaging",
  dispatch: "Packaging",
  ppe: "PPE",
  cleaning: "Cleaning Materials",
  "washing up": "Cleaning Materials",
  waste: "Waste",
  "oil waste": "Waste",
  "grease trap": "Equipment",
  printing: "Printing",
  sales: "Sales",
  events: "Sales",
};

interface ExcelRow {
  Number: number | string;
  Picture: string;
  "Part Description": string;
  "Ordering Item URL": string;
  "Used For": string;
  "Supplier Part Number": string;
  "THE CALZONE KITCHEN Part Number": string;
  Supplier: string;
  "Order when sing the last": string;
  "Order Qty": number | string;
  "Lead Time": string;
  Location: string;
  Tag: string;
  "Created By": string;
}

interface ImportReport {
  ingredientsMatched: { name: string; kanbanSet: boolean; matchType: string }[];
  ingredientsCreated: string[];
  stockItemsCreated: string[];
  suppliersCreated: string[];
  categoriesCreated: string[];
  skippedRows: { number: number | string; reason: string }[];
  manualReview: { number: number | string; name: string; reason: string }[];
}

function parseKanbanQuantity(raw: string): number | null {
  if (!raw || raw === "." || raw.toLowerCase() === "n/a") return null;

  const caseMatch = raw.match(/(\d+)\s*[xX]\s*(\d+)/);
  if (caseMatch) return parseInt(caseMatch[2], 10);

  const numberMatch = raw.match(/(\d+)/);
  if (numberMatch) return parseInt(numberMatch[1], 10);

  return null;
}

function parseOrderQty(raw: number | string): number | null {
  if (raw === "" || raw === "." || String(raw).toLowerCase() === "n/a") return null;
  if (typeof raw === "number") return raw;
  const numberMatch = String(raw).match(/(\d+)/);
  if (numberMatch) return parseInt(numberMatch[1], 10);
  return null;
}

function normaliseSupplierName(raw: string): string {
  const key = raw.trim().toLowerCase();
  return SUPPLIER_NAME_MAP[key] || raw.trim();
}

function isJunkRow(row: ExcelRow): boolean {
  const desc = String(row["Part Description"]).trim();
  const usedFor = String(row["Used For"]).trim();
  return desc === "." || usedFor === "." || desc === "";
}

function isEmailSupplier(supplier: string): boolean {
  return supplier.includes("@");
}

function normaliseForMatch(s: string): string {
  return s.toLowerCase().trim()
    .replace(/[()]/g, "")
    .replace(/\s+/g, " ");
}

interface MatchCandidate {
  match: { id: number; kanbanEnabled: boolean };
  matchedName: string;
  confidence: "exact" | "high" | "low";
  score: number;
}

function scoreCandidate(needleNorm: string, keyNorm: string): { confidence: "exact" | "high" | "low"; score: number } | null {
  if (keyNorm === needleNorm) {
    return { confidence: "exact", score: 100 };
  }

  if (needleNorm.includes(keyNorm) || keyNorm.includes(needleNorm)) {
    const lenRatio = Math.min(needleNorm.length, keyNorm.length) / Math.max(needleNorm.length, keyNorm.length);
    if (lenRatio >= 0.6) {
      return { confidence: "high", score: 70 + lenRatio * 20 };
    }
    return { confidence: "low", score: 30 + lenRatio * 20 };
  }

  const needleWords = needleNorm.split(/\s+/).filter(w => w.length > 2);
  if (needleWords.length >= 2) {
    const matchingWords = needleWords.filter(w => keyNorm.includes(w));
    const ratio = matchingWords.length / needleWords.length;
    if (ratio >= 0.7) {
      return { confidence: "high", score: 60 + ratio * 20 };
    }
    if (ratio >= 0.5) {
      return { confidence: "low", score: 20 + ratio * 20 };
    }
  }

  return null;
}

type FuzzyMatchResult =
  | { type: "match"; match: { id: number; kanbanEnabled: boolean }; matchedName: string; confidence: "exact" | "high" }
  | { type: "ambiguous"; candidates: { matchedName: string; confidence: string }[] }
  | null;

function fuzzyMatch(
  needle: string,
  haystack: Map<string, { id: number; kanbanEnabled: boolean }>,
): FuzzyMatchResult {
  const needleNorm = normaliseForMatch(needle);
  const candidates: MatchCandidate[] = [];

  for (const [key, val] of haystack) {
    const keyNorm = normaliseForMatch(key);
    const result = scoreCandidate(needleNorm, keyNorm);
    if (result) {
      candidates.push({
        match: val,
        matchedName: key,
        confidence: result.confidence,
        score: result.score,
      });
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0];

  if (best.confidence === "exact") {
    return { type: "match", match: best.match, matchedName: best.matchedName, confidence: "exact" };
  }

  if (best.confidence === "high") {
    const nearCompetitors = candidates.filter(
      (c, i) => i > 0 && (c.confidence === "high" || c.confidence === "exact"),
    );
    if (nearCompetitors.length > 0) {
      return {
        type: "ambiguous",
        candidates: candidates.slice(0, 5).map(c => ({
          matchedName: c.matchedName,
          confidence: c.confidence,
        })),
      };
    }
    return { type: "match", match: best.match, matchedName: best.matchedName, confidence: "high" };
  }

  return {
    type: "ambiguous",
    candidates: candidates.slice(0, 5).map(c => ({
      matchedName: c.matchedName,
      confidence: c.confidence,
    })),
  };
}

function tryResolveComposite(
  rawSupplier: string,
): { primary: string; secondary: string } | null {
  const key = rawSupplier.trim().toLowerCase();
  if (COMPOSITE_SUPPLIER_MAP[key]) return COMPOSITE_SUPPLIER_MAP[key];

  if (rawSupplier.includes("/")) {
    const parts = rawSupplier.split("/").map(p => p.trim()).filter(Boolean);
    if (parts.length === 2) {
      const primary = normaliseSupplierName(parts[0]);
      const secondary = normaliseSupplierName(parts[1]);
      return { primary, secondary };
    }
  }

  return null;
}

export async function importKanbans(
  databaseUrl: string,
  commitMode: boolean,
): Promise<ImportReport> {
  const wb = XLSX.readFile(EXCEL_PATH);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<ExcelRow>(ws, { defval: "", range: 2 });

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  const report: ImportReport = {
    ingredientsMatched: [],
    ingredientsCreated: [],
    stockItemsCreated: [],
    suppliersCreated: [],
    categoriesCreated: [],
    skippedRows: [],
    manualReview: [],
  };

  try {
    if (commitMode) {
      await client.query("BEGIN");
    }

    const suppliersResult = await client.query("SELECT id, name FROM suppliers");
    const supplierMap = new Map<string, number>();
    for (const s of suppliersResult.rows) {
      supplierMap.set(s.name.toLowerCase().trim(), s.id);
    }

    const ingredientsResult = await client.query(
      "SELECT id, name, kanban_enabled FROM ingredients",
    );
    const ingredientMap = new Map<string, { id: number; kanbanEnabled: boolean }>();
    for (const i of ingredientsResult.rows) {
      ingredientMap.set(i.name.toLowerCase().trim(), {
        id: i.id,
        kanbanEnabled: i.kanban_enabled,
      });
    }

    const existingStockItems = await client.query("SELECT id, name FROM stock_items");
    const stockItemMap = new Map<string, number>();
    for (const si of existingStockItems.rows) {
      stockItemMap.set(si.name.toLowerCase().trim(), si.id);
    }

    const categoriesResult = await client.query(
      "SELECT id, name FROM stock_item_categories",
    );
    const categoryMap = new Map<string, number>();
    for (const c of categoriesResult.rows) {
      categoryMap.set(c.name.toLowerCase().trim(), c.id);
    }

    async function ensureSupplier(name: string): Promise<number | null> {
      const key = name.toLowerCase().trim();
      if (supplierMap.has(key)) return supplierMap.get(key)!;

      if (commitMode) {
        const result = await client.query(
          "INSERT INTO suppliers (name) VALUES ($1) RETURNING id",
          [name],
        );
        const id = result.rows[0].id;
        supplierMap.set(key, id);
        report.suppliersCreated.push(name);
        return id;
      } else {
        if (!report.suppliersCreated.includes(name)) {
          report.suppliersCreated.push(name);
        }
        supplierMap.set(key, -1);
        return -1;
      }
    }

    async function ensureCategory(name: string): Promise<number | null> {
      const key = name.toLowerCase().trim();
      if (categoryMap.has(key)) return categoryMap.get(key)!;

      if (commitMode) {
        const result = await client.query(
          "INSERT INTO stock_item_categories (name) VALUES ($1) RETURNING id",
          [name],
        );
        const id = result.rows[0].id;
        categoryMap.set(key, id);
        report.categoriesCreated.push(name);
        return id;
      } else {
        if (!report.categoriesCreated.includes(name)) {
          report.categoriesCreated.push(name);
        }
        categoryMap.set(key, -1);
        return -1;
      }
    }

    const REQUIRED_CATEGORIES = ["PPE", "Printing", "Waste", "Equipment", "Insulation"];
    for (const cat of REQUIRED_CATEGORIES) {
      await ensureCategory(cat);
    }

    async function resolveSuppliers(
      rawSupplier: string,
    ): Promise<{ primaryId: number | null; secondaryId: number | null }> {
      if (!rawSupplier || rawSupplier === "." || rawSupplier === "??" || rawSupplier.toLowerCase() === "n/a") {
        return { primaryId: null, secondaryId: null };
      }

      if (isEmailSupplier(rawSupplier)) {
        return { primaryId: null, secondaryId: null };
      }

      if (rawSupplier.toLowerCase().startsWith("restock")) {
        return { primaryId: null, secondaryId: null };
      }

      const composite = tryResolveComposite(rawSupplier);
      if (composite) {
        const primaryId = await ensureSupplier(composite.primary);
        const secondaryId = await ensureSupplier(composite.secondary);
        return { primaryId, secondaryId };
      }

      const normalised = normaliseSupplierName(rawSupplier);
      const primaryId = await ensureSupplier(normalised);
      return { primaryId, secondaryId: null };
    }

    for (const row of rows) {
      if (isJunkRow(row)) {
        report.skippedRows.push({
          number: row.Number,
          reason: "Junk row (dots or empty description)",
        });
        continue;
      }

      const name = String(row["Part Description"]).trim();
      const usedForRaw = String(row["Used For"]).trim();
      const usedForKey = usedForRaw.toLowerCase();
      const orderingUrl =
        String(row["Ordering Item URL"]).trim() !== "N/A" &&
        !String(row["Ordering Item URL"]).includes("@")
          ? String(row["Ordering Item URL"]).trim() || null
          : null;
      const supplierPartNumber =
        String(row["Supplier Part Number"]).trim() || null;
      const kanbanQty = parseKanbanQuantity(
        String(row["Order when sing the last"]),
      );
      const orderQty = parseOrderQty(row["Order Qty"]);
      const { primaryId: supplierId, secondaryId: secondarySupplierId } =
        await resolveSuppliers(String(row["Supplier"]));

      const kanbanParseWarning =
        kanbanQty === null && String(row["Order when sing the last"]).trim() !== "" &&
        String(row["Order when sing the last"]).trim() !== "N/A" &&
        String(row["Order when sing the last"]).trim() !== ".";

      if (INGREDIENT_USED_FOR.has(usedForKey)) {
        const fuzzyResult = fuzzyMatch(name, ingredientMap);

        if (fuzzyResult && fuzzyResult.type === "ambiguous") {
          const candidateNames = fuzzyResult.candidates.map(c => `"${c.matchedName}" (${c.confidence})`).join(", ");
          report.manualReview.push({
            number: row.Number,
            name,
            reason: `Ambiguous match — multiple candidates: ${candidateNames}`,
          });
          continue;
        }

        if (fuzzyResult && fuzzyResult.type === "match") {
          if (!fuzzyResult.match.kanbanEnabled) {
            if (commitMode) {
              await client.query(
                `UPDATE ingredients SET kanban_enabled = true, kanban_quantity = $1, kanban_order_amount = $2 WHERE id = $3`,
                [kanbanQty ?? 0, orderQty ?? null, fuzzyResult.match.id],
              );
            }
            report.ingredientsMatched.push({ name, kanbanSet: true, matchType: fuzzyResult.confidence });
            if (kanbanParseWarning) {
              report.manualReview.push({
                number: row.Number,
                name,
                reason: `Could not parse kanban quantity from "${row["Order when sing the last"]}" — defaulted to 0`,
              });
            }
          } else {
            report.ingredientsMatched.push({ name, kanbanSet: false, matchType: fuzzyResult.confidence });
          }
        } else {
          if (kanbanParseWarning) {
            report.manualReview.push({
              number: row.Number,
              name,
              reason: `Could not parse kanban quantity from "${row["Order when sing the last"]}" — defaulted to 0`,
            });
          }
          if (commitMode) {
            const result = await client.query(
              `INSERT INTO ingredients (name, unit, supplier_id, secondary_supplier_id, ordering_url, supplier_part_number, kanban_enabled, kanban_quantity, kanban_order_amount)
               VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8) RETURNING id`,
              [
                name,
                "each",
                supplierId,
                secondarySupplierId,
                orderingUrl,
                supplierPartNumber,
                kanbanQty ?? 0,
                orderQty ?? null,
              ],
            );
            ingredientMap.set(name.toLowerCase().trim(), {
              id: result.rows[0].id,
              kanbanEnabled: true,
            });
          }
          report.ingredientsCreated.push(name);
        }
      } else if (STOCK_ITEM_USED_FOR[usedForKey]) {
        const categoryName = STOCK_ITEM_USED_FOR[usedForKey];
        await ensureCategory(categoryName);

        const stockItemKey = name.toLowerCase().trim();
        if (stockItemMap.has(stockItemKey)) {
          report.skippedRows.push({
            number: row.Number,
            reason: `Stock item "${name}" already exists`,
          });
          continue;
        }

        if (commitMode) {
          const result = await client.query(
            `INSERT INTO stock_items (name, category, unit, supplier_id, secondary_supplier_id, ordering_url, supplier_part_number, kanban_enabled, kanban_quantity, kanban_order_amount)
             VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9) RETURNING id`,
            [
              name,
              categoryName,
              "each",
              supplierId,
              secondarySupplierId,
              orderingUrl,
              supplierPartNumber,
              kanbanQty ?? 0,
              orderQty ?? null,
            ],
          );
          stockItemMap.set(stockItemKey, result.rows[0].id);
        }
        report.stockItemsCreated.push(`${name} [${categoryName}]`);
        if (kanbanParseWarning) {
          report.manualReview.push({
            number: row.Number,
            name,
            reason: `Could not parse kanban quantity from "${row["Order when sing the last"]}" — defaulted to 0`,
          });
        }
      } else {
        report.manualReview.push({
          number: row.Number,
          name,
          reason: `Unknown 'Used For' value: "${usedForRaw}"`,
        });
      }
    }

    if (commitMode) {
      await client.query("COMMIT");
    }
  } catch (err) {
    if (commitMode) {
      await client.query("ROLLBACK");
    }
    throw err;
  } finally {
    await client.end();
  }

  return report;
}

function printReport(report: ImportReport, commitMode: boolean) {
  console.log("\n" + "=".repeat(70));
  console.log(commitMode ? "  COMMIT MODE — Changes applied" : "  DRY-RUN MODE — No changes made");
  console.log("=".repeat(70));

  console.log(`\n--- Suppliers to create (${report.suppliersCreated.length}) ---`);
  for (const s of report.suppliersCreated) console.log(`  + ${s}`);

  console.log(`\n--- Categories to create (${report.categoriesCreated.length}) ---`);
  for (const c of report.categoriesCreated) console.log(`  + ${c}`);

  console.log(
    `\n--- Ingredients matched (${report.ingredientsMatched.length}) ---`,
  );
  for (const i of report.ingredientsMatched) {
    console.log(`  = ${i.name} [${i.matchType}] ${i.kanbanSet ? "(kanban fields SET)" : "(already has kanban, SKIPPED)"}`);
  }

  console.log(
    `\n--- Ingredients to create (${report.ingredientsCreated.length}) ---`,
  );
  for (const name of report.ingredientsCreated) console.log(`  + ${name}`);

  console.log(
    `\n--- Stock items to create (${report.stockItemsCreated.length}) ---`,
  );
  for (const name of report.stockItemsCreated) console.log(`  + ${name}`);

  console.log(`\n--- Skipped rows (${report.skippedRows.length}) ---`);
  for (const s of report.skippedRows)
    console.log(`  - Row #${s.number}: ${s.reason}`);

  console.log(
    `\n--- Needs manual review (${report.manualReview.length}) ---`,
  );
  for (const m of report.manualReview)
    console.log(`  ? Row #${m.number} "${m.name}": ${m.reason}`);

  console.log("\n" + "=".repeat(70));
  console.log("SUMMARY:");
  console.log(`  Suppliers to create:  ${report.suppliersCreated.length}`);
  console.log(`  Categories to create: ${report.categoriesCreated.length}`);
  console.log(`  Ingredients matched:  ${report.ingredientsMatched.length}`);
  console.log(`  Ingredients to create: ${report.ingredientsCreated.length}`);
  console.log(`  Stock items to create: ${report.stockItemsCreated.length}`);
  console.log(`  Skipped rows:         ${report.skippedRows.length}`);
  console.log(`  Manual review needed: ${report.manualReview.length}`);
  console.log("=".repeat(70) + "\n");
}

async function main() {
  const args = process.argv.slice(2);
  const commitMode = args.includes("--commit");
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error("ERROR: DATABASE_URL environment variable is required");
    process.exit(1);
  }

  console.log(`Starting kanban import (${commitMode ? "COMMIT" : "DRY-RUN"} mode)...`);
  console.log(`Database: ${databaseUrl.replace(/:[^:@]+@/, ":***@")}`);

  const report = await importKanbans(databaseUrl, commitMode);
  printReport(report, commitMode);
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("import-kanbans.ts") ||
    process.argv[1].endsWith("import-kanbans.js"));

if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
