/**
 * Reasons to Buy on the Sales & Marketing page (Graeme, 18 Nov 2026).
 *
 *   GET    /marketing-calendar/reasons            the list, least recently used first, with each reason's uses
 *   POST   /marketing-calendar/reasons            add a reason
 *   PATCH  /marketing-calendar/reasons/:id        rename / reword
 *   DELETE /marketing-calendar/reasons/:id        remove (soft)
 *   POST   /marketing-calendar/reasons/read-now   read any unread emails now
 *
 * Same access as the calendar: the founder, or anyone granted Sales &
 * Marketing. Objective I.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { requireFounderArea } from "../middleware/founder-area-access";
import { addReason, kickReasonReader, reasonsReport, removeReason, updateReason } from "../lib/reasons-to-buy-store";

const router: IRouter = Router();
router.use(requireFounderArea("founder.sales"));

const londonToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());

router.get("/", async (_req: Request, res: Response) => {
  try {
    res.json(await reasonsReport(londonToday()));
  } catch (err) {
    console.error("[reasons-to-buy] report failed:", err);
    res.status(500).json({ error: "Couldn't load the reasons to buy" });
  }
});

const ReasonBody = z.object({
  name: z.string().trim().min(1, "Give it a name").max(120),
  description: z.string().trim().max(600).nullable().optional(),
});

router.post("/", validate(ReasonBody), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof ReasonBody>;
  try {
    const id = await addReason({ name: b.name, description: b.description || null }, req.session.userId ?? null);
    res.status(201).json({ id });
  } catch (err) {
    console.error("[reasons-to-buy] add failed:", err);
    res.status(500).json({ error: "Couldn't add it" });
  }
});

const Params = z.object({ id: z.coerce.number().int().positive() });
const PatchBody = ReasonBody.partial();

router.patch("/:id", validate(PatchBody), async (req: Request, res: Response) => {
  const p = Params.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Bad id" }); return; }
  const b = req.body as z.infer<typeof PatchBody>;
  try {
    const ok = await updateReason(p.data.id, {
      ...(b.name !== undefined ? { name: b.name } : {}),
      ...(b.description !== undefined ? { description: b.description || null } : {}),
    });
    if (!ok) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch (err) {
    console.error("[reasons-to-buy] update failed:", err);
    res.status(500).json({ error: "Couldn't save it" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  const p = Params.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Bad id" }); return; }
  try {
    if (!(await removeReason(p.data.id))) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch (err) {
    console.error("[reasons-to-buy] remove failed:", err);
    res.status(500).json({ error: "Couldn't remove it" });
  }
});

router.post("/read-now", validate(z.object({})), async (_req: Request, res: Response) => {
  void kickReasonReader();
  res.json({ ok: true });
});

export default router;
