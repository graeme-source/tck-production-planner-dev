/**
 * Back labels through the print bridge — /api/print-jobs/back-labels.
 * Objective C (27 Nov 2026: a roll ran out mid-run and Windows reprinted
 * the WHOLE PDF job — 50–60 labels wasted) and D (the printed count is the
 * real count).
 *
 * The wrapping PC's bridge prints a run ONE label per Windows print job and
 * waits for Windows to finish each before sending the next. When the roll
 * runs out only that one label is retried after the new roll goes in —
 * what Label LIVE did. The run lives in print_jobs (kind 'back-labels');
 * the state rules are lib/product-labels bridge-job.ts.
 *
 * Operators (session, mounted behind the login guard):
 *   GET  /setup                 is a wrapping printer set up, is its PC on
 *   GET  /latest?recipeId=…     today's run for this recipe / plan item
 *   GET  /:id                   one run's progress
 *   POST /                      send a run (same production rules as the PDF)
 *   POST /:id/cancel            stop what's left
 *   POST /:id/more              print N more packs
 *   POST /:id/retry             try a failed run again from where it stopped
 *
 * The bridge (PRINT_BRIDGE_TOKEN bearer, mounted above the login guard at
 * /bridge):
 *   GET  /bridge/next           long-poll: claim (or take back) a run
 *   GET  /bridge/:id/label/:seq the single-label PDF for label seq
 *   POST /bridge/:id/progress   printed so far / paused — after every label
 *   POST /bridge/:id/finish     done, or gave up
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { db, productLabelPrintsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  addMoreToBridgeJob, applyBridgeProgress, BACK_LABEL_PRINTER_SETTING_KEY, BRIDGE_ACTIVE_STATES, bridgePackerView,
  cancelBridgeJob, canClaimBridgeJob, claimBridgeJob, expireBridgeJobIfStale, finishBridgeJob, MAX_PRINT_COUNT,
  normaliseTemplate, packsLabelled, pageForSeq, parseBackLabelPrinterSetting, PRINT_REFUSAL_TEXT, retryBridgeJob,
  runsFor, totalLabels, type BridgeJob, type BridgeJobState, type BridgePauseReason, type LabelRun, type PrintRecord,
} from "@workspace/product-labels";
import { labelsPdf } from "@workspace/product-labels/render";
import { validate, validateQuery } from "../middleware/validate";
import { londonDateString } from "../lib/london-time";
import { prepare, printRecordFor } from "../lib/product-label-print-prepare";
import { bridgeLastSeen, isBridgeOnline, markBridgeSeen, requireBridgeToken } from "../lib/print-bridge-auth";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = Pick<Tx, "execute" | "insert">;

interface JobPayload {
  record: PrintRecord;
  printerName: string;
  recipeName: string;
  packs: number;
  labelsPerPack: number;
  test: boolean;
  role: "main" | "wrapping";
  title: string;
}

interface JobRow {
  id: number;
  status: BridgeJobState;
  station: string;
  payload: JobPayload;
  error: string | null;
  recipe_id: number | null;
  plan_item_id: number | null;
  label_runs: LabelRun[];
  printed_count: number;
  claimed_by: string | null;
  lease_ms: number | null;
  pause_reason: BridgePauseReason | null;
  print_date: string;
  label_print_id: number | null;
  updated_at: string;
  [key: string]: unknown;
}

const SELECT_JOB = sql`
  SELECT id, status, station, payload, error, recipe_id, plan_item_id, label_runs, printed_count, claimed_by,
         (EXTRACT(EPOCH FROM lease_until) * 1000)::float8 AS lease_ms, pause_reason, print_date::text AS print_date,
         label_print_id, updated_at
  FROM print_jobs`;

function toJob(r: JobRow): BridgeJob {
  return {
    state: r.status,
    runs: r.label_runs ?? [],
    printed: r.printed_count,
    claimedBy: r.claimed_by,
    leaseUntil: r.lease_ms,
    printDate: r.print_date,
    pauseReason: r.pause_reason,
    error: r.error,
  };
}

async function loadJob(tx: Exec, id: number, lock: boolean): Promise<JobRow | null> {
  const rows = await tx.execute<JobRow>(sql`${SELECT_JOB} WHERE id = ${id} AND kind = 'back-labels' ${lock ? sql`FOR UPDATE` : sql``}`);
  return rows.rows[0] ?? null;
}

/** Write a run's state back. Timestamps are written and read as UTC epoch
 *  so the lease means the same whatever the session time zone. */
async function saveJob(tx: Exec, id: number, j: BridgeJob): Promise<void> {
  const total = totalLabels(j.runs);
  await tx.execute(sql`
    UPDATE print_jobs SET
      status = ${j.state},
      label_runs = ${JSON.stringify(j.runs)}::jsonb,
      total_count = ${total},
      copies = ${Math.max(1, total)},
      printed_count = ${j.printed},
      claimed_by = ${j.claimedBy},
      lease_until = ${j.leaseUntil == null ? null : sql`(to_timestamp(${j.leaseUntil / 1000}) AT TIME ZONE 'UTC')`},
      pause_reason = ${j.pauseReason},
      error = ${j.error},
      printed_at = ${j.state === "done" ? sql`NOW()` : sql`printed_at`},
      updated_at = NOW()
    WHERE id = ${id}
  `);
}

/** Keep the run's product_label_prints record at the packs really labelled
 *  — the same record the PDF route writes, with the actual count. */
async function syncPrintRecord(tx: Exec, row: JobRow, j: BridgeJob): Promise<void> {
  const packs = packsLabelled(j.runs, j.printed);
  if (packs < 1) return;
  if (row.label_print_id) {
    await tx.execute(sql`UPDATE product_label_prints SET count = ${packs} WHERE id = ${row.label_print_id}`);
    return;
  }
  const [rec] = await tx.insert(productLabelPrintsTable).values({ ...row.payload.record, count: packs }).returning({ id: productLabelPrintsTable.id });
  if (rec) await tx.execute(sql`UPDATE print_jobs SET label_print_id = ${rec.id} WHERE id = ${row.id}`);
}

async function printerSetting() {
  const rows = await db.execute<{ value: string }>(sql`SELECT value FROM app_settings WHERE key = ${BACK_LABEL_PRINTER_SETTING_KEY}`);
  return parseBackLabelPrinterSetting(rows.rows[0]?.value);
}

/** What the dialog shows for a run. */
function view(row: JobRow, j: BridgeJob = toJob(row)) {
  const online = isBridgeOnline(row.station);
  return {
    id: row.id,
    state: j.state,
    total: totalLabels(j.runs),
    printed: j.printed,
    packsLabelled: packsLabelled(j.runs, j.printed),
    pauseReason: j.pauseReason,
    error: j.error,
    recipeName: row.payload.recipeName,
    printerName: row.payload.printerName,
    labelsPerPack: row.payload.labelsPerPack,
    test: row.payload.test,
    bridgeOnline: online,
    updatedAt: row.updated_at,
    ...bridgePackerView(j, online),
  };
}

const activeList = sql.raw(BRIDGE_ACTIVE_STATES.map(s => `'${s}'`).join(", "));

/** Unfinished runs dated an earlier day never print (their date is wrong). */
async function expireOldRuns(today: string): Promise<void> {
  await db.execute(sql`
    UPDATE print_jobs
    SET status = 'expired', claimed_by = NULL, lease_until = NULL, pause_reason = NULL,
        error = 'Not finished on the day it was dated.', updated_at = NOW()
    WHERE kind = 'back-labels' AND status IN (${activeList}) AND print_date < ${today}
  `);
}

// ═══ Operator routes ═══════════════════════════════════════════════════════

export const backLabelJobsRouter: IRouter = Router();

backLabelJobsRouter.use((req: Request, res: Response, next: NextFunction) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  next();
});

backLabelJobsRouter.get("/setup", async (_req, res) => {
  const s = await printerSetting();
  const station = s?.station ?? "wrapping";
  const seen = bridgeLastSeen(station);
  res.json({
    configured: !!s,
    printerName: s?.printerName ?? null,
    station,
    bridgeOnline: isBridgeOnline(station),
    lastSeenAt: seen ? new Date(seen).toISOString() : null,
  });
});

const LatestQuery = z.object({
  recipeId: z.coerce.number().int().positive(),
  planItemId: z.coerce.number().int().positive().optional(),
  role: z.enum(["main", "wrapping"]).optional(),
  test: z.enum(["1", "true"]).optional(),
});

/** Same recipe, plan item, label and kind (test or real), dated today. */
function sameRun(recipeId: number, planItemId: number | null, role: string, test: boolean, today: string) {
  return sql`kind = 'back-labels' AND recipe_id = ${recipeId}
    AND plan_item_id IS NOT DISTINCT FROM ${planItemId}
    AND payload->>'role' = ${role}
    AND (payload->>'test')::boolean = ${test}
    AND print_date = ${today}`;
}

backLabelJobsRouter.get("/latest", validateQuery(LatestQuery), async (_req, res) => {
  const q = res.locals.query as z.infer<typeof LatestQuery>;
  const today = londonDateString();
  await expireOldRuns(today);
  const test = q.test !== undefined;
  const rows = await db.execute<JobRow>(sql`${SELECT_JOB}
    WHERE ${sameRun(q.recipeId, test ? null : (q.planItemId ?? null), q.role ?? "main", test, today)}
    ORDER BY id DESC LIMIT 1`);
  res.json({ job: rows.rows[0] ? view(rows.rows[0]) : null });
});

const IdParams = z.object({ id: z.coerce.number().int().positive() });

backLabelJobsRouter.get("/:id", async (req, res) => {
  const p = IdParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const row = await loadJob(db, p.data.id, false);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ job: view(row) });
});

const CreateBody = z.object({
  recipeId: z.number().int().positive(),
  count: z.number().int().min(1).max(MAX_PRINT_COUNT),
  planItemId: z.number().int().positive().optional(),
  role: z.enum(["main", "wrapping"]).optional(),
  test: z.boolean().optional(),
});

backLabelJobsRouter.post("/", validate(CreateBody), async (req, res) => {
  const body = req.body as z.infer<typeof CreateBody>;
  const test = body.test === true;
  const role = body.role ?? "main";
  try {
    const setting = await printerSetting();
    if (!setting) {
      res.status(409).json({ error: "No wrapping printer is set up — make the PDF instead.", code: "NOT_CONFIGURED" });
      return;
    }
    // The same rules as the PDF route: live label only, still matching the
    // recipe; production day from the plan item (lib/product-label-print-prepare.ts).
    const r = await prepare(body.recipeId, body.planItemId, test, role);
    if (r.status !== 200) { res.status(r.status).json({ error: r.error }); return; }
    if (r.refusal || !r.proof || !r.snapshot || (!test && !r.live)) {
      res.status(409).json({ error: r.refusal ? PRINT_REFUSAL_TEXT[r.refusal] : "Can't print this label.", refusal: r.refusal });
      return;
    }
    const today = r.printDate;
    await expireOldRuns(today);
    const planItemId = r.plan.planItemId;
    // One run at a time per item: a second tap (or a second iPad) shows the
    // run already going instead of printing everything twice.
    const running = await db.execute<{ id: number }>(sql`
      SELECT id FROM print_jobs WHERE ${sameRun(r.recipe.id, planItemId, role, test, today)} AND status IN (${activeList})
      ORDER BY id DESC LIMIT 1
    `);
    if (running.rows[0]) {
      res.status(409).json({ error: "These labels are already printing.", code: "ALREADY_RUNNING", id: running.rows[0].id });
      return;
    }

    const page = normaliseTemplate(r.snapshot.template).page;
    const title = `${test ? "TEST - " : ""}${r.recipe.name} - ${r.proof.dates.batchCode}`;
    // One single-label PDF per different label (two for a pair), each at
    // the label size — exactly the pages of the PDF route, one at a time.
    const pages = r.proof.pages.map(bitmap => labelsPdf({ bitmap, dpi: page.dpi, copies: 1, title }));
    const runs = runsFor(body.count, pages.length);
    const record = await printRecordFor(r, body.count, test, req.session.userId ?? null);
    const payload: JobPayload = {
      record, printerName: setting.printerName, recipeName: r.recipe.name, packs: body.count,
      labelsPerPack: pages.length, test, role, title,
    };

    const id = await db.transaction(async tx => {
      // Only today's runs can print, so older runs' label PDFs go (the run
      // and its print record stay).
      await tx.execute(sql`
        DELETE FROM print_job_pages WHERE job_id IN (
          SELECT id FROM print_jobs WHERE kind = 'back-labels' AND print_date < ${today}
        )
      `);
      const inserted = await tx.execute<{ id: number }>(sql`
        INSERT INTO print_jobs (kind, payload, tspl, copies, status, station, created_by, recipe_id, plan_item_id,
                                label_runs, total_count, printed_count, print_date)
        VALUES ('back-labels', ${JSON.stringify(payload)}::jsonb, '', ${totalLabels(runs)}, 'queued', ${setting.station},
                ${req.session.userId ?? null}, ${r.recipe.id}, ${planItemId}, ${JSON.stringify(runs)}::jsonb,
                ${totalLabels(runs)}, 0, ${today})
        RETURNING id
      `);
      const jobId = inserted.rows[0]!.id;
      for (const [n, pdf] of pages.entries()) {
        await tx.execute(sql`INSERT INTO print_job_pages (job_id, page_no, pdf) VALUES (${jobId}, ${n}, ${Buffer.from(pdf)})`);
      }
      return jobId;
    });
    const row = await loadJob(db, id, false);
    res.status(201).json({ job: row ? view(row) : null });
  } catch (err) {
    console.error("[back-label-jobs] create:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Lock a run, change it with a pure rule, save it — or say why not. */
async function changeRun(req: Request, res: Response, change: (j: BridgeJob, row: JobRow, today: string) => BridgeJob) {
  const p = IdParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const today = londonDateString();
  try {
    const out = await db.transaction(async tx => {
      const row = await loadJob(tx, p.data.id, true);
      if (!row) return null;
      const next = change(expireBridgeJobIfStale(toJob(row), today), row, today);
      await saveJob(tx, row.id, next);
      return { ...row, status: next.state, label_runs: next.runs, printed_count: next.printed, error: next.error, pause_reason: next.pauseReason };
    });
    if (!out) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ job: view(out) });
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

backLabelJobsRouter.post("/:id/cancel", (req, res) => changeRun(req, res, j => cancelBridgeJob(j)));

const MoreBody = z.object({ packs: z.number().int().min(1).max(MAX_PRINT_COUNT) });
backLabelJobsRouter.post("/:id/more", validate(MoreBody), (req, res) => {
  const { packs } = req.body as z.infer<typeof MoreBody>;
  return changeRun(req, res, (j, row, today) => addMoreToBridgeJob(j, runsFor(packs, row.payload.labelsPerPack), today));
});

backLabelJobsRouter.post("/:id/retry", (req, res) => changeRun(req, res, (j, _row, today) => retryBridgeJob(j, today)));

// ═══ Bridge routes (token, above the login guard) ══════════════════════════

export const backLabelBridgeRouter: IRouter = Router();
backLabelBridgeRouter.use(requireBridgeToken);

const NextQuery = z.object({
  station: z.string().min(1).max(40).default("wrapping"),
  bridge: z.string().min(1).max(120),
  wait: z.coerce.number().min(0).max(25).optional(),
});

// Long-poll (up to 25 s, under every proxy timeout) for a run to print.
// The bridge's own unfinished run comes first, so a restarted bridge
// carries on from its printed count at once.
backLabelBridgeRouter.get("/next", validateQuery(NextQuery), async (_req, res) => {
  const q = res.locals.query as z.infer<typeof NextQuery>;
  const deadline = Date.now() + (q.wait ?? 0) * 1000;
  try {
    for (;;) {
      markBridgeSeen(q.station);
      const today = londonDateString();
      await expireOldRuns(today);
      const claimed = await db.transaction(async tx => {
        const rows = await tx.execute<JobRow>(sql`${SELECT_JOB}
          WHERE kind = 'back-labels' AND station = ${q.station} AND status IN (${activeList})
          ORDER BY (claimed_by IS NOT DISTINCT FROM ${q.bridge}) DESC, id
          LIMIT 10
          FOR UPDATE SKIP LOCKED`);
        const now = Date.now();
        for (const row of rows.rows) {
          const j = toJob(row);
          if (!canClaimBridgeJob(j, q.bridge, now, today)) continue;
          const next = claimBridgeJob(j, q.bridge, now, today);
          await saveJob(tx, row.id, next);
          return { row, job: next };
        }
        return null;
      });
      if (claimed) {
        res.json({
          job: {
            id: claimed.row.id,
            printerName: claimed.row.payload.printerName,
            title: claimed.row.payload.title,
            total: totalLabels(claimed.job.runs),
            printed: claimed.job.printed,
            state: claimed.job.state,
          },
        });
        return;
      }
      if (Date.now() >= deadline) { res.json({ job: null }); return; }
      await new Promise(r => setTimeout(r, 1000));
    }
  } catch (err) {
    console.error("[back-label-jobs] next:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

const LabelParams = z.object({ id: z.coerce.number().int().positive(), seq: z.coerce.number().int().min(0) });

backLabelBridgeRouter.get("/:id/label/:seq", async (req, res) => {
  const p = LabelParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid id or label number" }); return; }
  const row = await loadJob(db, p.data.id, false);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  markBridgeSeen(row.station);
  const page = pageForSeq(row.label_runs ?? [], p.data.seq);
  if (page == null) { res.status(404).json({ error: "That label is past the end of the run" }); return; }
  const pdf = await db.execute<{ pdf: Buffer }>(sql`SELECT pdf FROM print_job_pages WHERE job_id = ${row.id} AND page_no = ${page}`);
  if (!pdf.rows[0]) { res.status(410).json({ error: "This run's labels are no longer kept" }); return; }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Cache-Control", "no-store");
  res.send(Buffer.from(pdf.rows[0].pdf));
});

const ProgressBody = z.object({
  bridgeId: z.string().min(1).max(120),
  printed: z.number().int().min(0),
  paused: z.enum(["out-of-labels", "offline", "attention", "stuck"]).nullable().optional(),
  detail: z.string().max(300).nullable().optional(),
});

backLabelBridgeRouter.post("/:id/progress", validate(ProgressBody), async (req, res) => {
  const p = IdParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body as z.infer<typeof ProgressBody>;
  try {
    const out = await db.transaction(async tx => {
      const row = await loadJob(tx, p.data.id, true);
      if (!row) return null;
      markBridgeSeen(row.station);
      const r = applyBridgeProgress(toJob(row), body, Date.now());
      await saveJob(tx, row.id, r.job);
      await syncPrintRecord(tx, row, r.job);
      return r;
    });
    if (!out) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ stop: out.stop, total: out.total, printed: out.job.printed, state: out.job.state });
  } catch (err) {
    console.error("[back-label-jobs] progress:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

const FinishBody = z.object({
  bridgeId: z.string().min(1).max(120),
  printed: z.number().int().min(0),
  ok: z.boolean(),
  error: z.string().max(500).nullable().optional(),
});

backLabelBridgeRouter.post("/:id/finish", validate(FinishBody), async (req, res) => {
  const p = IdParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body as z.infer<typeof FinishBody>;
  try {
    const out = await db.transaction(async tx => {
      const row = await loadJob(tx, p.data.id, true);
      if (!row) return null;
      markBridgeSeen(row.station);
      const j = finishBridgeJob(toJob(row), body);
      await saveJob(tx, row.id, j);
      await syncPrintRecord(tx, row, j);
      return j;
    });
    if (!out) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ state: out.state, printed: out.printed, total: totalLabels(out.runs) });
  } catch (err) {
    console.error("[back-label-jobs] finish:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
