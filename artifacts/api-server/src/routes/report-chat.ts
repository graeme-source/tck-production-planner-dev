/**
 * AI Jane talks an app report or idea through before it's filed (Graeme,
 * 19 Nov 2026). Who gets it: the "AI Jane talks it through" grant (managers
 * by default, anyone it's handed to) while the Fix queue switch is on.
 * See lib/report-chat.ts and lib/report-chat-rules.ts. Objectives E and F.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db, andonIssuesTable, appSettingsTable, improvementSubmissionsTable, issueReportChecksTable, reportChatsTable, usersTable } from "@workspace/db";
import { validate } from "../middleware/validate";
import { requireFounder } from "../middleware/founder-access";
import { isClaudeConfigured } from "../lib/ai/claude";
import { userCan } from "../lib/feature-access";
import { looksLikeAppRequest } from "../lib/improvement-app-request";
import { nextStep } from "../lib/report-chat";
import { TALK_THROUGH_FEATURE, TALK_THROUGH_SETTING_KEY, talkThroughOn } from "../lib/report-chat-rules";
import { buildReport, liveTurn } from "../lib/report-live-chat";
import { loadJaneAccess } from "../lib/ai/jane-data-tools";

const router: IRouter = Router();

async function switchOn(): Promise<boolean> {
  const [row] = await db.select({ value: appSettingsTable.value }).from(appSettingsTable).where(eq(appSettingsTable.key, TALK_THROUGH_SETTING_KEY));
  return talkThroughOn(row?.value);
}

async function availableTo(req: Request): Promise<boolean> {
  if (!isClaudeConfigured() || !(await switchOn())) return false;
  return userCan(req.session.userId, String(req.session.userRole ?? ""), TALK_THROUGH_FEATURE);
}

router.get("/status", async (req: Request, res: Response) => {
  const on = await switchOn();
  // live: everyone talks to Jane before reporting (Graeme, 20 Nov 2026);
  // the same off switch turns it off.
  res.json({ available: await availableTo(req), switchOn: on, live: on && isClaudeConfigured() });
});

const switchBody = z.object({ on: z.boolean() });

// Graeme's off switch, on the Fix queue.
router.put("/switch", requireFounder, validate(switchBody), async (req: Request, res: Response) => {
  const { on } = req.body as z.infer<typeof switchBody>;
  const value = on ? "on" : "off";
  await db.insert(appSettingsTable).values({ key: TALK_THROUGH_SETTING_KEY, value })
    .onConflictDoUpdate({ target: appSettingsTable.key, set: { value, updatedAt: new Date() } });
  res.json({ switchOn: on });
});

const turnsSchema = z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(4000) })).min(1).max(12);
// A live chat can run longer than the talk-through's questions.
const liveTurnsSchema = z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(4000) })).min(1).max(60);

const turnBody = z.object({
  kind: z.enum(["issue", "idea"]),
  history: turnsSchema,
  /** Where an idea was logged, so one logged against the app counts. */
  station: z.string().max(100).nullable().optional(),
  /** "Just send it": no more questions, their answers become the summary. */
  finish: z.boolean().optional(),
});

// Never a failure the person sees: no step just means "file it as it is".
router.post("/turn", validate(turnBody), async (req: Request, res: Response) => {
  const { kind, history, station, finish } = req.body as z.infer<typeof turnBody>;
  try {
    // Their answers as the summary needs no AI and no switch: never lose them.
    if (finish) { res.json({ step: await nextStep(kind, history, true) }); return; }
    if (history[history.length - 1].role !== "user") { res.json({ step: null }); return; }
    if (!(await availableTo(req))) { res.json({ step: null }); return; }
    // Ideas only when they'd change the app: the rest go on the board as now.
    if (kind === "idea" && history.length === 1 && !looksLikeAppRequest({ title: history[0].text, station }).flagged) {
      res.json({ step: null }); return;
    }
    res.json({ step: await nextStep(kind, history, false) });
  } catch (err) {
    console.error("[report-chat] turn failed, filing as it is:", err instanceof Error ? err.message : String(err));
    res.json({ step: null });
  }
});

// ── Talk to Jane first (Graeme, 20 Nov 2026) ─────────────────────────────
// Every report starts as a chat: Jane tries to sort it; if she can't, the
// chat becomes the report. Safety never waits — the form skips this.

const liveBody = z.object({ area: z.enum(["factory", "system"]), history: liveTurnsSchema });

router.post("/live", validate(liveBody), async (req: Request, res: Response) => {
  const { area, history } = req.body as z.infer<typeof liveBody>;
  if (!isClaudeConfigured() || !(await switchOn())) { res.status(503).json({ error: "Jane isn't available — write the report as normal." }); return; }
  if (history[history.length - 1].role !== "user") { res.status(400).json({ error: "Say something first" }); return; }
  try {
    const access = await loadJaneAccess(req.session.userId!, (req.session.userRole ?? "viewer") as "admin" | "manager" | "viewer");
    res.json({ reply: await liveTurn(area, history, access) });
  } catch (err) {
    console.error("[report-chat] live turn failed:", err instanceof Error ? err.message : String(err));
    res.status(502).json({ error: "Jane didn't answer. Try again, or write your report." });
  }
});

// The report, written from the chat (their own words if the AI fails).
router.post("/live/report", validate(liveBody), async (req: Request, res: Response) => {
  const { area, history } = req.body as z.infer<typeof liveBody>;
  res.json({ draft: await buildReport(area, history) });
});

// Sorted in the chat: kept with Jane's other checks, so the Fix queue sees
// what she handled without anyone reporting it.
router.post("/live/resolved", validate(liveBody), async (req: Request, res: Response) => {
  const { area, history } = req.body as z.infer<typeof liveBody>;
  const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.session.userId!));
  const lastJane = [...history].reverse().find(t => t.role === "assistant")?.text ?? "";
  await db.insert(issueReportChecksTable).values({
    userId: req.session.userId!, userName: user?.name ?? null,
    description: `[${area === "system" ? "App" : "Factory"}] ${history.filter(t => t.role === "user").map(t => t.text).join("\n")}`.slice(0, 8000),
    outcome: "sorted_in_chat", reply: lastJane.slice(0, 4000), result: "resolved",
  });
  res.json({ ok: true });
});

const saveBody = z.object({
  kind: z.enum(["issue", "idea"]),
  andonIssueId: z.number().int().positive().nullable().optional(),
  improvementId: z.number().int().positive().nullable().optional(),
  original: z.string().trim().min(1).max(4000),
  transcript: liveTurnsSchema,
  brief: z.string().trim().max(4000).nullable().optional(),
});

// The chat, kept against the report it produced. Only the person who filed it.
router.post("/save", validate(saveBody), async (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof saveBody>;
  const me = req.session.userId!;
  if (body.kind === "issue") {
    const [issue] = body.andonIssueId ? await db.select({ by: andonIssuesTable.reportedBy }).from(andonIssuesTable).where(eq(andonIssuesTable.id, body.andonIssueId)) : [];
    if (!issue || issue.by !== me) { res.status(404).json({ error: "Report not found" }); return; }
  } else {
    const [idea] = body.improvementId ? await db.select({ by: improvementSubmissionsTable.submittedBy }).from(improvementSubmissionsTable).where(eq(improvementSubmissionsTable.id, body.improvementId)) : [];
    if (!idea || idea.by !== me) { res.status(404).json({ error: "Idea not found" }); return; }
  }
  const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, me));
  await db.insert(reportChatsTable).values({
    userId: me, userName: user?.name ?? null, kind: body.kind,
    andonIssueId: body.kind === "issue" ? body.andonIssueId! : null,
    improvementId: body.kind === "idea" ? body.improvementId! : null,
    original: body.original, transcript: body.transcript, brief: body.brief ?? null,
  });
  res.json({ ok: true });
});

// The chats behind recent reports, for the Fix queue.
router.get("/recent", requireFounder, async (_req: Request, res: Response) => {
  const rows = await db.select().from(reportChatsTable).orderBy(desc(reportChatsTable.createdAt)).limit(30);
  res.json({ items: rows });
});

export default router;
