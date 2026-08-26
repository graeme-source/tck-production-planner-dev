/**
 * Correcting the delivery address that goes on an APC label.
 *
 * The automatic normaliser cuts addresses to APC's 35-character lines, and
 * sometimes the cut lands on the part that finds the door. These endpoints let
 * whoever is booking the labels re-cut the address by hand and save that
 * decision — see services/label-address.ts for why it never touches Shopify.
 *
 * Manager-gated like every other courier action: a saved override changes what
 * is printed on a real parcel.
 */
import { Router, type Request, type Response } from "express";
import * as z from "zod";
import { validate } from "../middleware/validate";
import { requireManagerOrAdmin, resolveUserName } from "../middleware/roles";
import { getLabelAddress, saveLabelAddress, deleteLabelAddress } from "../services/label-address";
import { ADDRESS_LINE_MAX } from "../services/apc";

const router = Router();

// Lines are capped at exactly what APC accepts, so an address that validates
// here is one that can be printed. The screen enforces the same limit live;
// this is the guarantee, not the hint.
const line = z.string().trim().min(1).max(ADDRESS_LINE_MAX);

const labelAddressSchema = z.object({
  address1: line,
  address2: z.string().trim().max(ADDRESS_LINE_MAX).optional(),
  city: line,
  postcode: z.string().trim().min(1).max(12),
  companyName: z.string().trim().max(ADDRESS_LINE_MAX).optional(),
  // APC's Instructions field is 50 characters — a different limit because it
  // is not an address line.
  instructions: z.string().trim().max(50).optional(),
  orderName: z.string().trim().max(50).optional(),
  // What it looked like before, captured so the audit trail doesn't depend on
  // re-fetching the order from Shopify later.
  originalAddress1: z.string().trim().max(255).optional(),
  originalAddress2: z.string().trim().max(255).optional(),
  originalCity: z.string().trim().max(255).optional(),
});

function parseOrderId(req: Request, res: Response): number | null {
  const orderId = Number(req.params.orderId);
  if (!Number.isFinite(orderId) || orderId <= 0) {
    res.status(400).json({ error: "A numeric Shopify order id is required" });
    return null;
  }
  return orderId;
}

// GET /:orderId — the saved correction, or null when the automatic address is
// still in use.
router.get("/:orderId", requireManagerOrAdmin, async (req: Request, res: Response) => {
  const orderId = parseOrderId(req, res);
  if (orderId === null) return;
  try {
    res.json({ labelAddress: await getLabelAddress(orderId) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[LabelAddress] read error:", msg);
    res.status(500).json({ error: msg });
  }
});

// PUT /:orderId — save (or replace) the correction for this order.
router.put("/:orderId", requireManagerOrAdmin, validate(labelAddressSchema), async (req: Request, res: Response) => {
  const orderId = parseOrderId(req, res);
  if (orderId === null) return;
  const body = req.body as z.infer<typeof labelAddressSchema>;
  try {
    const saved = await saveLabelAddress({
      shopifyOrderId: orderId,
      shopifyOrderName: body.orderName,
      address1: body.address1,
      address2: body.address2,
      city: body.city,
      postcode: body.postcode,
      companyName: body.companyName,
      instructions: body.instructions,
      originalAddress1: body.originalAddress1,
      originalAddress2: body.originalAddress2,
      originalCity: body.originalCity,
      updatedByUserId: req.session.userId,
      updatedByName: await resolveUserName(req),
    });
    res.json({ labelAddress: saved });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[LabelAddress] save error:", msg);
    res.status(500).json({ error: msg });
  }
});

// DELETE /:orderId — undo the correction and go back to the automatic address.
router.delete("/:orderId", requireManagerOrAdmin, async (req: Request, res: Response) => {
  const orderId = parseOrderId(req, res);
  if (orderId === null) return;
  try {
    res.json({ removed: await deleteLabelAddress(orderId) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[LabelAddress] delete error:", msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
