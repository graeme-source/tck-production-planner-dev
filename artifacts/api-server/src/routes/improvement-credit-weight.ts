/**
 * How many credits an improvement is worth on the improvement score
 * (Graeme, 2026-10-12; Objective E).
 *
 *   PUT /api/improvements/:id/credit-weight   { weight: 1 | 2 | 3 }
 *
 * 1 is every improvement's default — labelling a water bottle is still
 * wanted, every day. 2 = "Wow, that's a really good improvement", 3 =
 * "really substantial". Founder only (requireFounder on the route, NOT on
 * the router: this router is mounted at /improvements ahead of the main
 * improvements router, so a router-wide guard would lock everyone else out
 * of the whole page).
 *
 * Raising an improvement to ×2 or ×3 tells everyone credited on it, on the
 * bell and by push (Graeme, 2026-10-21: "Send a notification back to that
 * team member"). The rules are pure in lib/improvement-rating-notify.ts.
 *
 *   GET /api/improvements/stats — the team's totals for the Leaner-board:
 *   improvements, credits, Great ones and Substantial, last 30 days and
 *   all-time (Graeme, 2026-10-21). Everyone can read it.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, notificationsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireFounder } from "../middleware/founder-access";
import { validate, validateQuery } from "../middleware/validate";
import { CREDIT_WEIGHTS, improvementTotals, scoreWindow } from "../lib/improvement-score";
import {
  RATING_NOTIFICATION_TYPE, ratingMessage, ratingOfNotificationType, ratingRecipients,
} from "../lib/improvement-rating-notify";
import { notificationCentreRecipients } from "../lib/improvement-notify-policy";
import { CREDIT_PAIRS } from "../lib/improvement-credits-data";
import { londonDateString } from "../lib/london-time";
import { sendPushToUsers } from "../services/push";

const router: IRouter = Router();

const bodySchema = z.object({
  weight: z.number().int().refine(n => (CREDIT_WEIGHTS as readonly number[]).includes(n), "weight must be 1, 2 or 3"),
});

router.put("/:id/credit-weight", requireFounder, validate(bodySchema), async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid improvement" }); return; }
  const { weight } = req.body as z.infer<typeof bodySchema>;
  try {
    // The old weight comes back with the new one, so the notification can
    // tell a rise (tell them) from a fall (say nothing).
    const result = await db.execute<{ id: number; credit_weight: number; old_weight: number; title: string | null }>(sql`
      WITH old AS (
        SELECT id, credit_weight FROM improvement_submissions WHERE id = ${id} FOR UPDATE
      )
      UPDATE improvement_submissions s
         SET credit_weight = ${weight},
             credit_weight_set_at = NOW(),
             credit_weight_set_by = ${req.session.userId ?? null}
        FROM old
       WHERE s.id = old.id
       RETURNING s.id, s.credit_weight, old.credit_weight AS old_weight, s.title
    `);
    const row = result.rows[0];
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ id: Number(row.id), creditWeight: Number(row.credit_weight) });
    // Fire-and-forget: a notification hiccup must never undo the rating.
    void notifyRating({
      improvementId: Number(row.id),
      title: row.title ?? "",
      oldWeight: Number(row.old_weight),
      newWeight: Number(row.credit_weight),
      setByUserId: req.session.userId ?? null,
    }).catch(err => console.error("[improvement-credit-weight] notify failed:", err));
  } catch (err) {
    console.error("[improvement-credit-weight] save failed:", err);
    res.status(500).json({ error: "Couldn't save the credits" });
  }
});

/** Tell everyone credited that their improvement was rated higher than
 *  normal — once per rating, never on a fall, never the founder himself. */
async function notifyRating(input: {
  improvementId: number;
  title: string;
  oldWeight: number;
  newWeight: number;
  setByUserId: number | null;
}): Promise<void> {
  const credited = await db.execute<{ user_id: number }>(sql`
    WITH pairs AS (${CREDIT_PAIRS})
    SELECT DISTINCT user_id FROM pairs
     WHERE improvement_id = ${input.improvementId} AND user_id IS NOT NULL
  `);
  const told = await db.execute<{ user_id: number; type: string }>(sql`
    SELECT user_id, type FROM notifications
     WHERE improvement_id = ${input.improvementId}
       AND type IN (${RATING_NOTIFICATION_TYPE[2]}, ${RATING_NOTIFICATION_TYPE[3]})
  `);
  const alreadyTold = new Map<number, number>();
  for (const t of told.rows ?? []) {
    const w = ratingOfNotificationType(t.type);
    if (w == null) continue;
    const uid = Number(t.user_id);
    alreadyTold.set(uid, Math.max(alreadyTold.get(uid) ?? 1, w));
  }
  const send = ratingRecipients({
    oldWeight: input.oldWeight,
    newWeight: input.newWeight,
    creditedUserIds: (credited.rows ?? []).map(r => Number(r.user_id)),
    setByUserId: input.setByUserId,
    alreadyTold,
  });
  if (!send) return;
  const userIds = notificationCentreRecipients({ kind: "rating", recipientIds: send.userIds });
  if (userIds.length === 0) return;
  const words = ratingMessage(send.weight, input.title);
  await db.insert(notificationsTable).values(userIds.map(userId => ({
    userId,
    type: RATING_NOTIFICATION_TYPE[send.weight],
    message: words.message,
    improvementId: input.improvementId,
  })));
  await sendPushToUsers(userIds, {
    title: words.pushTitle,
    body: words.pushBody,
    url: `/improvements?open=${input.improvementId}`,
    tag: `improvement-rating-${input.improvementId}`,
  });
}

// GET /stats — takes no parameters; validateQuery keeps it to exactly that.
router.get("/stats", validateQuery(z.object({}).strict()), async (_req: Request, res: Response) => {
  try {
    const window = scoreWindow(londonDateString());
    // Finished improvements only (the Leaner-board's rule), dated by when
    // they were done. Each improvement counted once, however many people
    // share the credit.
    const rows = await db.execute<{ id: number; credit_weight: number; done: Date | string }>(sql`
      SELECT s.id, s.credit_weight, COALESCE(s.done_at, s.approved_at, s.created_at) AS done
        FROM improvement_submissions s
       WHERE s.progress_status = 'complete'
    `);
    const list = (rows.rows ?? []).map(r => ({
      id: Number(r.id),
      weight: Number(r.credit_weight),
      doneDate: londonDateString(r.done instanceof Date ? r.done : new Date(r.done)),
    }));
    res.json({ window, last30: improvementTotals(list, window), allTime: improvementTotals(list) });
  } catch (err) {
    console.error("[improvement-credit-weight] stats failed:", err);
    res.status(500).json({ error: "Couldn't load the improvement totals" });
  }
});

export default router;
