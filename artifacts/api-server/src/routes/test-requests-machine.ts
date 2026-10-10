/**
 * Forced testing — the MACHINE side, for the Claude Code session that
 * deploys for Graeme (docs/FORCED_TESTING.md). Mounted inside
 * routes/issue-pipeline-machine.ts AFTER its bearer-token gate, so it is
 * /api/issue-pipeline/machine/test-requests and needs the same
 * ISSUE_PIPELINE_TOKEN (503 when unset, 401 when wrong).
 *
 *   POST /   create a test request for a change that just shipped:
 *            { title, steps, linkPath?, onlyOnPath?, notBefore?, dailyFrom?,
 *              dailyUntil?, whenText?, andonIssueId?, testerIds?,
 *              testerEmails?, fixRef?, createdByName? }
 *            With andonIssueId the issue's reporter is always asked.
 *   GET  /?since=ISO&status=…   requests with every tester's answer.
 *
 * "Doesn't work" / "confusing" / "couldn't test" answers on these go to
 * Graeme's bell (there is no person who asked).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, usersTable, testRequestsTable } from "@workspace/db";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { validate, validateQuery } from "../middleware/validate";
import { TEST_STATUSES } from "../lib/test-request-rules";
import { createTestRequest, createTestRequestFields, loadRequestViews } from "../lib/test-requests-data";

const router: IRouter = Router();

const machineBody = z.object({
  ...createTestRequestFields,
  testerEmails: z.array(z.string().trim().toLowerCase().email()).max(30).optional().default([]),
  fixRef: z.string().trim().max(200).optional().nullable(),
  createdByName: z.string().trim().max(80).optional().nullable(),
});

router.post("/", validate(machineBody), async (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof machineBody>;
  let ids = [...body.testerIds];
  if (body.testerEmails.length) {
    const found = await db.select({ id: usersTable.id, email: usersTable.email }).from(usersTable)
      .where(and(inArray(sql`lower(${usersTable.email})`, body.testerEmails), eq(usersTable.isActive, true)));
    const missing = body.testerEmails.filter(e => !found.some(f => f.email.toLowerCase() === e));
    if (missing.length) { res.status(400).json({ error: `No active team member with email: ${missing.join(", ")}` }); return; }
    ids = [...ids, ...found.map(f => f.id)];
  }
  const out = await createTestRequest({ ...body, testerIds: ids }, {
    userId: null,
    name: body.createdByName || "Claude (deploy)",
    source: "deploy",
    fixRef: body.fixRef ?? null,
  });
  if (!out.ok) { res.status(out.status).json({ error: out.error }); return; }
  res.status(201).json({ id: out.request.id, testerIds: out.testerIds });
});

const listQuery = z.object({
  since: z.string().datetime({ offset: true }).optional(),
  status: z.enum(TEST_STATUSES).optional(),
});

router.get("/", validateQuery(listQuery), async (_req: Request, res: Response) => {
  const q = res.locals["query"] as z.infer<typeof listQuery>;
  const views = await loadRequestViews(q.since ? gte(testRequestsTable.createdAt, new Date(q.since)) : undefined, 300);
  res.json({ requests: q.status ? views.filter(v => v.status === q.status) : views });
});

export default router;
