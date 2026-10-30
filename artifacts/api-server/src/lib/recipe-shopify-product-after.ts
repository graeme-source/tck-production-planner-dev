/**
 * "Create Shopify product" — what happens once Shopify has made the product
 * (Graeme, 30 Oct 2026). Objectives A and D. In order:
 *
 *   1. Link the 2 Pack to the recipe (so sales reach the planner) — "keep":
 *      never steals another recipe's link.
 *   2. The barcode: the one held for the recipe (Label tab, or typed in the
 *      Create window) moves onto the new 2 Pack and the app's ONE barcode
 *      writer sends it (barcode-store afterListingLinked → barcode-push.ts) —
 *      the same thing linking a listing on the recipe page does. Never over a
 *      different number already in Shopify.
 *   3. The back label, when ticked: published through the label page's own
 *      path (product-label-publish.ts), with the Create confirmation as the
 *      human tick and the hash of the proof that was on screen.
 *   4. The front label, when ticked: switched on as the product's front label
 *      through the label page's own path.
 *
 * Steps 2–4 never undo or fail the product: each one's outcome is a line in
 * the result. The database and Shopify sides are ports, so the sequence is
 * tested with fakes (recipe-shopify-product.test.ts).
 */
import type { PublishOutcome } from "./product-label-publish";

export interface AfterCreatePorts {
  link(v: { shopifyVariantId: string; shopifyVariantTitle: string; shopifySku: string | null }): Promise<{ linked: boolean }>;
  /** Move the held barcode onto the new listing and send it; returns the result line. */
  applyBarcode(): Promise<string>;
  publishBackLabel(expectedHash: string): Promise<PublishOutcome>;
  setFrontLabel(): Promise<void>;
}

export interface AfterCreateInput {
  variants: Array<{ id: string; title: string; sku: string | null }>;
  /** The back-label proof's hash the person saw ticked; null = not ticked. */
  backLabelHash: string | null;
  frontLabel: boolean;
}

export interface LabelOutcome { done: boolean; message: string; versionNo?: number | null }

export interface AfterCreateResult {
  linkedVariants: string[];
  conflicts: string[];
  barcode: string | null;
  backLabel: LabelOutcome | null;
  frontLabel: LabelOutcome | null;
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function afterProductCreated(ports: AfterCreatePorts, input: AfterCreateInput): Promise<AfterCreateResult> {
  const linkedVariants: string[] = [];
  const conflicts: string[] = [];
  for (const v of input.variants) {
    const l = await ports.link({ shopifyVariantId: v.id, shopifyVariantTitle: v.title, shopifySku: v.sku });
    if (l.linked) linkedVariants.push(v.title); else conflicts.push(v.title);
  }

  // The barcode only follows a listing that is now this recipe's.
  let barcode: string | null = null;
  if (linkedVariants.length) {
    try {
      barcode = await ports.applyBarcode();
    } catch (err) {
      barcode = `The barcode wasn't moved onto the new listing (${errText(err)}) — open the Barcode box on the Label tab and save it again.`;
    }
  }

  let backLabel: LabelOutcome | null = null;
  if (input.backLabelHash) {
    try {
      const r = await ports.publishBackLabel(input.backLabelHash);
      backLabel = r.ok
        ? { done: true, versionNo: r.versionNo, message: `Back label published (version ${r.versionNo}) — the wrapping station can print it.` }
        : { done: false, message: `Back label not published — ${[r.error, ...(r.blockers ?? [])].join(" ")} Check it on the recipe's label page.` };
    } catch (err) {
      backLabel = { done: false, message: `Back label not published — ${errText(err)}. Check it on the recipe's label page.` };
    }
  }

  let frontLabel: LabelOutcome | null = null;
  if (input.frontLabel) {
    try {
      await ports.setFrontLabel();
      frontLabel = { done: true, message: "Front label set up — the wrapping station shows Print front labels." };
    } catch (err) {
      frontLabel = { done: false, message: `Front label not set up — ${errText(err)}. Switch it on from the recipe's label page.` };
    }
  }

  return { linkedVariants, conflicts, barcode, backLabel, frontLabel };
}
