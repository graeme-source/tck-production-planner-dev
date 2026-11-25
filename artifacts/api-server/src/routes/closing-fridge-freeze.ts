/**
 * POST /checklists/closing-fridge-freeze — the action half of the closing
 * fridge check: move out-of-life packs from the production fridge into
 * freezer (Wonky) stock. Moved out of routes/checklists.ts (25 Nov 2026) and
 * mounted AHEAD of it, so the path is unchanged.
 *
 * Goes through the adjustFridgeStock chokepoint so the aggregate, the FIFO
 * batch rows and the audit log all move together; packs are re-validated
 * server-side against the live expiring list so a stale screen can't freeze
 * packs that were dispatched in the meantime.
 *
 * With F2F freezer pushes switched on (lib/f2f-freezer-push.ts), the frozen
 * packs are also added (+N) to the recipe's F2F product in Shopify, after the
 * screen showed "These will be added to Shopify: …" and the person confirmed
 * (f2fConfirmed). The push is CLAIMED (by eventId, the screen's id for this
 * tap) before the stock moves, so a double tap or a replay moves nothing
 * twice — the repeat gets { alreadyDone: true }. A Shopify problem never
 * undoes the move: the push is recorded as failed with a Retry for managers.
 * Switched off, this is exactly the old behaviour and `f2f` is null.
 *
 * Body: { recipeId, packs, eventId?, f2fConfirmed? }.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import * as z from "zod";
import { validate } from "../middleware/validate";
import { londonDateString } from "../lib/london-time";
import { computeClosingFridgeActions } from "../lib/fridge-expiry";
import { adjustFridgeStock, addRecipeFreezerStock } from "../lib/fridge-stock";
import {
  RECORD_FAILED_MESSAGE, claimF2fPush, completeF2fClaim, findF2fPush, planF2fMove, releaseF2fClaim, toView, userName,
  type F2fMoveResult,
} from "../lib/f2f-freezer-push";
import { CLIENT_EVENT_ID } from "../lib/f2f-freezer-push-rules";

const router: IRouter = Router();

export const ClosingFreezeBody = z.object({
  recipeId: z.coerce.number().int().positive(),
  packs: z.coerce.number().int().min(1).max(10_000),
  eventId: z.string().regex(CLIENT_EVENT_ID).optional(),
  f2fConfirmed: z.boolean().optional(),
});

router.post("/closing-fridge-freeze", validate(ClosingFreezeBody), async (req: Request, res: Response) => {
  const { recipeId, packs: packsToFreeze, eventId: givenEventId, f2fConfirmed } = req.body as z.infer<typeof ClosingFreezeBody>;
  const eventId = givenEventId ?? randomUUID();
  const userId = req.session.userId ?? null;
  try {
    // The same tap again (double tap / replay): report it, move nothing.
    if (givenEventId) {
      const done = await findF2fPush("closing_check", recipeId, givenEventId);
      if (done) { res.json({ ok: true, alreadyDone: true, recipeId, frozenPacks: done.delta, f2f: { pushes: [done], skipped: [], errors: [] } }); return; }
    }

    const actions = await computeClosingFridgeActions(londonDateString());
    const action = actions.find(a => a.recipeId === recipeId);
    if (!action) {
      res.status(409).json({ error: "Nothing left to freeze for this recipe — the list may be out of date. Refresh and check again." });
      return;
    }
    if (packsToFreeze > action.actionPacks) {
      res.status(409).json({ error: `Only ${action.actionPacks} pack(s) still need freezing for ${action.recipeName}. Refresh and check again.` });
      return;
    }

    // F2F: claim the push BEFORE the stock moves (switched off = nothing).
    let f2f: F2fMoveResult | null = null;
    let claimId: number | null = null;
    try {
      const plan = await planF2fMove("closing_check", [{ recipeId, packs: packsToFreeze }]);
      if (plan.enabled) {
        f2f = { pushes: [], skipped: plan.skipped, errors: [] };
        const item = plan.push[0];
        if (item) {
          const claim = await claimF2fPush({ source: "closing_check", item, clientEventId: eventId, userId, userName: await userName(userId).catch(() => null) });
          if (!claim.isNew) { res.json({ ok: true, alreadyDone: true, recipeId, frozenPacks: claim.row.delta, f2f: { pushes: [toView(claim.row)], skipped: [], errors: [] } }); return; }
          claimId = claim.row.id;
        }
      }
    } catch (err) {
      console.error("[closing-fridge-freeze] F2F claim failed:", err);
      f2f = { pushes: [], skipped: [], errors: [RECORD_FAILED_MESSAGE] };
    }

    let result: Awaited<ReturnType<typeof adjustFridgeStock>>;
    let newFreezerQty: number;
    try {
      result = await adjustFridgeStock({
        recipeId,
        delta: -packsToFreeze,
        packSize: 2,
        reason: `Closing check: ${packsToFreeze} out-of-life pack(s) → freezer (Wonky)`,
        source: "freeze",
        userId,
      });
      newFreezerQty = await addRecipeFreezerStock(
        recipeId,
        packsToFreeze,
        `Closing check: frozen from production fridge (out of chilled life)`,
      );
    } catch (err) {
      // Nothing moved (or not all of it) — nothing may go to Shopify.
      if (claimId) await releaseF2fClaim(claimId).catch(e => console.error("[closing-fridge-freeze] release claim failed:", e));
      throw err;
    }

    if (claimId && f2f) {
      const sent = await completeF2fClaim(claimId, f2fConfirmed === true).catch(err => {
        console.error("[closing-fridge-freeze] F2F push failed:", err);
        return null;
      });
      if (sent) f2f.pushes.push(sent);
      else f2f.errors.push(RECORD_FAILED_MESSAGE);
    }

    res.json({
      ok: true,
      recipeId,
      frozenPacks: packsToFreeze,
      newFridgeQty: result.newAggregateQty,
      newFreezerQty,
      f2f,
    });
  } catch (err) {
    console.error("closing-fridge-freeze error:", err);
    res.status(500).json({ error: "Failed to freeze packs" });
  }
});

export default router;
