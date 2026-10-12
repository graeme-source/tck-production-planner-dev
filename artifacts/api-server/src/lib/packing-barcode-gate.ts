/**
 * Server half of "no ticking by hand unless the setting is on" (Graeme,
 * 12 Oct 2026). Objectives C and F.
 *
 * The packing screen keeps its ticks in the browser, so the only moment the
 * server sees a packed order is completion. With Settings → "Allow manual
 * tap to pick" OFF, a line with no barcode can only have been ticked by
 * hand — so completion is refused until that product's barcode has been
 * set (the packer scans it off the pack: POST /api/barcodes/variants/:id/
 * packer-set). This holds for an old cached iPad that still shows the tap.
 * Rules: @workspace/barcodes packer.ts.
 */
import { eq } from "drizzle-orm";
import { db, appSettingsTable } from "@workspace/db";
import { linesNeedingBarcode, needsBarcodeMessage, type PackedLine } from "@workspace/barcodes";
import { loadOwnership } from "./barcode-store";

/** app_settings key behind Settings → Packing → "Allow manual tap to pick".
 *  Unset = on (the original default, kept so nothing changes for a site that
 *  never chose); live has it set to "false". */
export const MANUAL_TICK_KEY = "fulfilment_manual_tick_enabled";

export async function isManualTickEnabled(): Promise<boolean> {
  const [row] = await db.select({ value: appSettingsTable.value }).from(appSettingsTable).where(eq(appSettingsTable.key, MANUAL_TICK_KEY));
  return row?.value == null ? true : row.value !== "false";
}

export type GateResult = { ok: true } | { ok: false; message: string; lines: PackedLine[] };

/** May this order be completed, given how its lines could have been ticked? */
export async function checkPackedLines(lineItems: Array<{ variant_id: number | string | null; title: string; variant_title?: string | null }>): Promise<GateResult> {
  if (await isManualTickEnabled()) return { ok: true };
  const ownership = await loadOwnership();
  const lines: PackedLine[] = lineItems.map(li => ({
    variantId: li.variant_id != null ? String(li.variant_id) : null,
    name: [li.title, li.variant_title && li.variant_title !== "Default Title" ? li.variant_title : null].filter(Boolean).join(" — "),
  }));
  const blocked = linesNeedingBarcode(lines, id => ownership.ownership.barcodeOf.get(id), false);
  return blocked.length ? { ok: false, message: needsBarcodeMessage(blocked), lines: blocked } : { ok: true };
}
