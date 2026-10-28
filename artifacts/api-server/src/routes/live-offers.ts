/**
 * Live offers (Graeme, 27 Oct 2026) — switchable sales offers on Sales &
 * Marketing → Live offers. First (and so far only) offer: Lucky Order
 * Number (lib/lucky-order). Objective I.
 *
 * Reading is Sales & Marketing (founder.sales). Anything that changes what
 * happens to customers' orders or money — switching it on, practice mode,
 * the gift, the refund limit, the winner emails' wording, approving a
 * refund — is the founder's alone.
 *
 *   GET  /                               offer, winners, status
 *   GET  /gift-options?q=                 product variants to pick the gift from
 *   PATCH /lucky-order                    change the offer (founder)
 *   POST /lucky-order/refund-decision     approve / decline a refund over the limit (founder)
 *   POST /lucky-order/retry               try a stuck winner again (founder)
 *   POST /lucky-order/test-email          send the founder a test winner email (founder)
 *   POST /lucky-order/run                 check for winners now (founder)
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { requireFounderArea } from "../middleware/founder-area-access";
import { requireFounder, FOUNDER_EMAIL } from "../middleware/founder-access";
import { shopifyWritesBlocked } from "../services/shopify";
import {
  OFFER_KEY, loadOffer, runLuckyOrderPass, decideRefund, retryWinner, sendWinnerEmail, createPracticeSubscriptionCode,
} from "../lib/lucky-order/engine";
import { offerLiveAt } from "../lib/lucky-order/rules";

const router: IRouter = Router();
router.use(requireFounderArea("founder.sales"));

async function userName(req: Request): Promise<string> {
  const r = await db.execute<{ name: string }>(sql`SELECT name FROM app_users WHERE id = ${req.session.userId} LIMIT 1`);
  return r.rows[0]?.name ?? "unknown";
}

router.get("/", async (_req: Request, res: Response) => {
  try {
    const offer = await loadOffer();
    const winners = await db.execute<{
      order_id: string; order_name: string; tier: string; practice: boolean; source_name: string | null;
      customer_email: string | null; customer_name: string | null; order_total: string | null; order_created_at: string;
      gift_status: string; gift_title: string | null; refund_status: string; refund_amount: string | null; refund_decided_by: string | null;
      code_status: string; discount_code: string | null; email_status: string; attempts: number; last_error: string | null;
    }>(sql`
      SELECT order_id, order_name, tier, practice, source_name, customer_email, customer_name, order_total::text, order_created_at,
             gift_status, gift_title, refund_status, refund_amount::text, refund_decided_by, code_status, discount_code,
             email_status, attempts, last_error
        FROM lucky_order_winners ORDER BY order_created_at DESC LIMIT 300
    `);
    const num = (v: string | null) => (v == null ? null : Number(v));
    res.json({
      offer: offer && { ...offer, liveNow: offerLiveAt(offer, new Date()) },
      writesBlocked: shopifyWritesBlocked(),
      emailReady: !!process.env["RESEND_API_KEY"],
      founderEmail: FOUNDER_EMAIL,
      winners: winners.rows.map(w => ({
        orderId: w.order_id,
        orderName: w.order_name,
        tier: w.tier,
        practice: w.practice,
        sourceName: w.source_name,
        customerEmail: w.customer_email,
        customerName: w.customer_name,
        orderTotal: num(w.order_total),
        orderCreatedAt: w.order_created_at,
        giftStatus: w.gift_status,
        giftTitle: w.gift_title,
        refundStatus: w.refund_status,
        refundAmount: num(w.refund_amount),
        refundDecidedBy: w.refund_decided_by,
        codeStatus: w.code_status,
        discountCode: w.discount_code,
        emailStatus: w.email_status,
        attempts: w.attempts,
        lastError: w.last_error,
      })),
    });
  } catch (err) {
    console.error("[live-offers] load failed:", err);
    res.status(500).json({ error: "Couldn't load the live offers" });
  }
});

// The planner's own list of Shopify variants (kept fresh by the barcode sync).
router.get("/gift-options", async (req: Request, res: Response) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  try {
    const r = await db.execute<{ variant_id: string; product_title: string | null; variant_title: string | null }>(sql`
      SELECT variant_id, product_title, variant_title FROM sku_barcodes
       WHERE COALESCE(shopify_missing, FALSE) = FALSE
         AND COALESCE(shopify_product_status, 'active') = 'active'
         AND (${q} = '' OR product_title ILIKE ${"%" + q + "%"} OR variant_title ILIKE ${"%" + q + "%"})
       ORDER BY product_title, variant_title LIMIT 40
    `);
    res.json({
      options: r.rows.map(x => ({
        variantId: x.variant_id,
        title: [x.product_title, x.variant_title && x.variant_title !== "Default Title" ? x.variant_title : null].filter(Boolean).join(" – "),
      })),
    });
  } catch (err) {
    console.error("[live-offers] gift options failed:", err);
    res.status(500).json({ error: "Couldn't load products" });
  }
});

const offerPatch = z.object({
  enabled: z.boolean().optional(),
  practiceMode: z.boolean().optional(),
  startsAt: z.string().datetime({ offset: true }).nullable().optional(),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  giftVariantId: z.string().trim().min(1).max(64).nullable().optional(),
  giftTitle: z.string().trim().max(200).nullable().optional(),
  refundAutoLimit: z.number().min(0).max(1000).optional(),
  emails: z.object({
    gift: z.object({ subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(5000) }).optional(),
    gift_refund: z.object({ subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(5000) }).optional(),
    subscription: z.object({ subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(5000) }).optional(),
  }).optional(),
  terms: z.string().trim().max(3000).optional(),
  replyTo: z.string().trim().email().optional(),
});

router.patch("/lucky-order", requireFounder, validate(offerPatch), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof offerPatch>;
  try {
    const current = await loadOffer();
    if (!current) { res.status(404).json({ error: "Offer not set up" }); return; }
    const startsAt = b.startsAt !== undefined ? b.startsAt : current.startsAt;
    const endsAt = b.endsAt !== undefined ? b.endsAt : current.endsAt;
    if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
      res.status(400).json({ error: "The end has to be after the start" }); return;
    }
    const enabled = b.enabled ?? current.enabled;
    if (enabled && b.practiceMode === false && !(b.giftVariantId ?? current.settings.giftVariantId)) {
      res.status(400).json({ error: "Choose the free gift before switching practice mode off" }); return;
    }
    if (enabled && b.enabled === true && current.practiceMode === false && b.practiceMode !== true && !current.settings.giftVariantId) {
      res.status(400).json({ error: "Choose the free gift before switching it on" }); return;
    }
    const settings = {
      ...current.settings,
      ...(b.giftVariantId !== undefined ? { giftVariantId: b.giftVariantId } : {}),
      ...(b.giftTitle !== undefined ? { giftTitle: b.giftTitle } : {}),
      ...(b.refundAutoLimit !== undefined ? { refundAutoLimit: b.refundAutoLimit } : {}),
      ...(b.emails ? { emails: { ...current.settings.emails, ...b.emails } } : {}),
      ...(b.terms !== undefined ? { terms: b.terms } : {}),
      ...(b.replyTo !== undefined ? { replyTo: b.replyTo } : {}),
    };
    // Switching on starts the clock: nothing placed before now can win.
    const switchingOn = b.enabled === true && !current.enabled;
    await db.execute(sql`
      UPDATE live_offers SET
        enabled = ${enabled},
        practice_mode = ${b.practiceMode ?? current.practiceMode},
        starts_at = ${startsAt}::timestamptz,
        ends_at = ${endsAt}::timestamptz,
        activated_at = CASE WHEN ${switchingOn} THEN NOW() ELSE activated_at END,
        settings = ${JSON.stringify(settings)}::jsonb,
        updated_by = ${await userName(req)},
        updated_at = NOW()
      WHERE key = ${OFFER_KEY}
    `);
    res.json({ offer: await loadOffer() });
  } catch (err) {
    console.error("[live-offers] save failed:", err);
    res.status(500).json({ error: "Couldn't save the offer" });
  }
});

const orderRef = z.object({ orderId: z.string().startsWith("gid://shopify/Order/") });

router.post("/lucky-order/refund-decision", requireFounder, validate(orderRef.extend({ approve: z.boolean() })), async (req: Request, res: Response) => {
  const b = req.body as { orderId: string; approve: boolean };
  try {
    const ok = await decideRefund(b.orderId, b.approve, await userName(req));
    if (!ok) { res.status(409).json({ error: "That refund isn't waiting for a decision any more" }); return; }
    res.json({ ok: true });
  } catch (err) {
    console.error("[live-offers] refund decision failed:", err);
    res.status(500).json({ error: "Couldn't record the decision" });
  }
});

router.post("/lucky-order/retry", requireFounder, validate(orderRef), async (req: Request, res: Response) => {
  try {
    await retryWinner((req.body as { orderId: string }).orderId);
    res.json({ ok: true });
  } catch (err) {
    console.error("[live-offers] retry failed:", err);
    res.status(500).json({ error: "Couldn't retry" });
  }
});

const testEmail = z.object({ tier: z.enum(["gift", "gift_refund", "subscription"]) });

// Sends the founder the real email for a prize, with sample details, so
// the wording can be checked in an inbox before any customer wins.
router.post("/lucky-order/test-email", requireFounder, validate(testEmail), async (req: Request, res: Response) => {
  const { tier } = req.body as z.infer<typeof testEmail>;
  try {
    const offer = await loadOffer();
    if (!offer) { res.status(404).json({ error: "Offer not set up" }); return; }
    await sendWinnerEmail({
      to: FOUNDER_EMAIL,
      firstName: "Graeme",
      tier,
      orderName: tier === "subscription" ? "#999000" : tier === "gift_refund" ? "#999100" : "#999110",
      giftTitle: tier === "subscription" ? null : offer.settings.giftTitle ?? "Cinnamon Buns – 6 Pack",
      refundAmount: tier === "gift_refund" ? 54.95 : null,
      discountCode: tier === "subscription" ? "LUCKYYEAR-999000-TEST00" : null,
      settings: offer.settings,
      test: true,
    });
    res.json({ ok: true, sentTo: FOUNDER_EMAIL });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Couldn't send the test" });
  }
});

// A real, live practice 000 code for the founder only (28 Oct 2026) — tied
// to his own Shopify customer account, configured exactly like a winner's,
// so the settings can be checked in Shopify before the offer goes live.
router.post("/lucky-order/test-code", requireFounder, validate(z.object({})), async (_req: Request, res: Response) => {
  try {
    res.json(await createPracticeSubscriptionCode());
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Couldn't make the practice code" });
  }
});

router.post("/lucky-order/run", requireFounder, validate(z.object({})), async (_req: Request, res: Response) => {
  try {
    await runLuckyOrderPass();
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Check failed" });
  }
});

export default router;
