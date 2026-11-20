/**
 * Live chat with Claude on a Fix queue card (Graeme, 20 Nov 2026). Founder
 * only, like the Fix queue. Read-only: lib/fix-queue-chat.ts.
 *
 *   POST /api/fix-queue-chat/:issueId   { history, summarise? } → { text }
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { requireFounder } from "../middleware/founder-access";
import { isClaudeConfigured } from "../lib/ai/claude";
import { loadJaneAccess } from "../lib/ai/jane-data-tools";
import { fixQueueChat } from "../lib/fix-queue-chat";

const router: IRouter = Router();

const Body = z.object({
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(8000) })).min(1).max(80),
  summarise: z.boolean().optional(),
});

router.post("/:issueId", requireFounder, validate(Body), async (req: Request, res: Response) => {
  const issueId = Number(req.params.issueId);
  if (!Number.isInteger(issueId) || issueId <= 0) { res.status(400).json({ error: "Bad report number" }); return; }
  if (!isClaudeConfigured()) { res.status(503).json({ error: "Claude isn't connected (no API key)." }); return; }
  const { history, summarise } = req.body as z.infer<typeof Body>;
  try {
    const access = await loadJaneAccess(req.session.userId!, (req.session.userRole ?? "admin") as "admin" | "manager" | "viewer");
    const answer = await fixQueueChat(issueId, history, access, summarise === true);
    if (!answer) { res.status(404).json({ error: "Report not found" }); return; }
    res.json(answer);
  } catch (err) {
    console.error("[fix-queue-chat] failed:", err instanceof Error ? err.message : String(err));
    res.status(502).json({ error: "Claude didn't answer. Try again in a moment." });
  }
});

export default router;
