/**
 * Reading an invoice's lines for the delivery check (Graeme, 13 Nov 2026) —
 * the pure half: the prompt, the tool Claude fills in, and tidying what comes
 * back. Claude is shown the supplier's ingredients so it can say which one
 * each line is and how many of OUR unit one invoice unit is ("TGP500 box"
 * → Ice gel pack × 36; "10 kg pack" of chicken → 10 kg). No database here.
 */

export interface IngredientForReading {
  id: number;
  name: string;
  unit: string;
  packWeight: number;
  packName: string | null;
  partNumber: string | null;
}

export interface InvoiceLineReading {
  position: number;
  code: string | null;
  description: string;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  lineTotal: number | null;
  isCharge: boolean;
  ingredientId: number | null;
  nativePerUnit: number | null;
}

export const INVOICE_LINES_TOOL = {
  name: "record_invoice_lines",
  description: "Record every line on the invoice.",
  input_schema: {
    type: "object",
    properties: {
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            code: { type: ["string", "null"], description: "The supplier's product code, if shown" },
            description: { type: "string" },
            quantity: { type: ["number", "null"], description: "Quantity invoiced, in the invoice's own unit" },
            unit: { type: ["string", "null"], description: "The invoice's unit: kg, box, each, roll, pallet …" },
            unit_price: { type: ["number", "null"], description: "Price per invoice unit before VAT" },
            line_total: { type: ["number", "null"], description: "Line total before VAT, after any line discount" },
            is_charge: { type: "boolean", description: "True for delivery, carriage, freight, tail-lift, fuel or other charges that aren't goods" },
            ingredient_id: { type: ["integer", "null"], description: "Which of our ingredients this is, from the list; null if none fits" },
            native_per_unit: { type: ["number", "null"], description: "How many of that ingredient's unit one invoice unit is" },
          },
          required: ["code", "description", "quantity", "unit", "unit_price", "line_total", "is_charge", "ingredient_id", "native_per_unit"],
        },
      },
    },
    required: ["lines"],
  },
} as const;

function describeIngredient(i: IngredientForReading): string {
  const pack = i.packWeight > 0 ? `, bought in a ${i.packName ?? "pack"} of ${i.packWeight} ${i.unit}` : "";
  const code = i.partNumber?.trim() ? `, supplier code "${i.partNumber.trim()}"` : "";
  return `- id ${i.id}: ${i.name} (counted in ${i.unit}${pack}${code})`;
}

export function invoiceLinesPrompt(supplierName: string, ingredients: IngredientForReading[]): string {
  return [
    `This is an invoice from ${supplierName} to The Calzone Kitchen. Record every line on it with the tool.`,
    "",
    "These are the things we buy from this supplier:",
    ...ingredients.map(describeIngredient),
    "",
    "For each goods line, set ingredient_id to the one it is (match on the supplier code first, then the description), or null if none fits.",
    "native_per_unit converts ONE of the invoice's units into our counting unit (the \"counted in\" unit above, NOT the pack we buy in):",
    "- the invoice counts single items and we count single items (each, piece, pcs, unit) → 1, even though we buy them in packs or pallets;",
    "- the invoice counts boxes/cases and the description says how many are inside (\"box of 36\", \"x36\") → that number, e.g. 36;",
    "- a 10 kg pack of chicken when we count in kg → 10; kg invoiced and kg counted → 1.",
    "Only use what the invoice itself says; if you can't tell, use 1 when the units are the same kind and null otherwise.",
    "line_total is before VAT and after any discount on that line. Delivery, carriage, freight, tail-lift and surcharges are is_charge = true with ingredient_id null.",
    "Leave anything you can't read with confidence as null rather than guessing.",
  ].join("\n");
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[£,\s]/g, "")) : NaN;
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

const SINGLE_ITEM = /^(each|ea|pcs?|pieces?|units?|items?|no\.?|nos|qty)$/i;

/** Tidy Claude's answer; an ingredient id not in the list is dropped.
 *  `ingredientUnits` (id → our counting unit) settles the one thing it gets
 *  wrong: single items invoiced as single items are always 1, never our pack
 *  size (Macfarlane's 360 boxes "each" are 360 boxes, not 360 × 360). */
export function normaliseInvoiceLines(raw: unknown, ingredientUnits: ReadonlyMap<number, string>): InvoiceLineReading[] {
  const ingredientIds = new Set(ingredientUnits.keys());
  const lines = (raw as { lines?: unknown })?.lines;
  if (!Array.isArray(lines)) return [];
  const out: InvoiceLineReading[] = [];
  for (const l of lines.slice(0, 200)) {
    const r = (l ?? {}) as Record<string, unknown>;
    const description = str(r.description, 500) ?? str(r.code, 200);
    if (!description) continue;
    const isCharge = r.is_charge === true;
    const id = num(r.ingredient_id);
    const ingredientId = !isCharge && id != null && ingredientIds.has(id) ? id : null;
    let perUnit = num(r.native_per_unit);
    const invoiceUnit = str(r.unit, 40);
    const ourUnit = ingredientId != null ? ingredientUnits.get(ingredientId) ?? "" : "";
    if (ingredientId != null && invoiceUnit && SINGLE_ITEM.test(invoiceUnit.trim()) && SINGLE_ITEM.test(ourUnit.trim())) perUnit = 1;
    out.push({
      position: out.length + 1,
      code: str(r.code, 200),
      description,
      quantity: num(r.quantity),
      unit: invoiceUnit,
      unitPrice: num(r.unit_price),
      lineTotal: num(r.line_total),
      isCharge,
      ingredientId,
      nativePerUnit: ingredientId != null && perUnit != null && perUnit > 0 ? perUnit : null,
    });
  }
  return out;
}

/**
 * The price an invoice line works out at for one of OUR packs, given how
 * many of our units it was really for. null when it can't be worked out.
 */
export function invoicePricePerOurPack(
  line: { lineTotal: number | null; quantity: number | null; nativePerUnit: number | null },
  packWeight: number,
  usualRatio = 1,
): number | null {
  if (line.lineTotal == null || line.quantity == null || line.nativePerUnit == null) return null;
  const ourUnits = (line.quantity * line.nativePerUnit) / (usualRatio > 0 ? usualRatio : 1);
  if (!(ourUnits > 0) || !(line.lineTotal > 0)) return null;
  return (line.lineTotal / ourUnits) * (packWeight > 0 ? packWeight : 1);
}

/** Worth asking about: more than 2% apart, or we have no price at all. */
export function priceDiffers(ours: number, invoice: number): boolean {
  if (!(invoice > 0)) return false;
  if (!(ours > 0)) return true;
  return Math.abs(invoice / ours - 1) > 0.02;
}
