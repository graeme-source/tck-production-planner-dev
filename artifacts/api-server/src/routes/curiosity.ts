/**
 * Curiosity Time — Lean Made Simple step 5 ("Teach Your People To See
 * Waste") as a daily habit on the station checklist (Objective E). A team
 * member walks their area with the iPad, answers "can you see this here?"
 * for each of the eight wastes in the book's order, and snaps a photo of
 * anything they spot.
 *
 * Feature-switched via app_settings (`curiosity_time_enabled`), OFF by
 * default — Graeme launches it only after the team has been taught the
 * wastes in the weekly lessons. Same kill-switch idiom as lean-reviews:
 * a feature-scoped GET/PATCH pair, enforced server-side on walk creation.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import {
  db,
  curiosityWalksTable,
  curiosityObservationsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import * as z from "zod";
import { validate } from "../middleware/validate";
import { requireManagerOrAdmin } from "../middleware/roles";
import { LMS_EIGHT_WASTES } from "../lib/lean-corpus";
import { isCanonicalWaste, walkProgress } from "../lib/curiosity-walk";
import { resolveChecklistStation } from "./checklists";

const router: IRouter = Router();

// OFF by default (absent row = off) — the opposite of the lean-review
// switch, deliberately: Curiosity Time launches weeks after the wastes
// have been taught, so a fresh deploy must not show it to the team.
const ENABLED_KEY = "curiosity_time_enabled";

async function curiosityEnabled(): Promise<boolean> {
  const rows = await db.execute<{ value: string }>(sql`
    SELECT value FROM app_settings WHERE key = ${ENABLED_KEY}
  `);
  return (rows.rows ?? [])[0]?.value === "true";
}

// Same image handling as meeting-slide photos: in-memory, 10MB cap, and the
// HEIC-inclusive allowlist (iPads that haven't been switched to "Most
// Compatible" hand over HEIC).
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"];

async function sessionUserName(req: Request): Promise<string> {
  if (!req.session.userId) return "Unknown";
  const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.session.userId));
  return user?.name ?? "Unknown";
}

/** Observations for a walk, photo bytes NEVER selected — only hasPhoto. */
async function walkObservations(walkId: number) {
  return db
    .select({
      id: curiosityObservationsTable.id,
      wasteName: curiosityObservationsTable.wasteName,
      spotted: curiosityObservationsTable.spotted,
      note: curiosityObservationsTable.note,
      hasPhoto: sql<boolean>`${curiosityObservationsTable.photo} IS NOT NULL`,
      updatedAt: curiosityObservationsTable.updatedAt,
    })
    .from(curiosityObservationsTable)
    .where(eq(curiosityObservationsTable.walkId, walkId));
}

// ─── Settings (the kill switch) ──────────────────────────────────────

const SettingsBody = z.object({ enabled: z.boolean() });

// Read is open to every logged-in user — the station checklist needs it to
// decide whether to show the card at all.
router.get("/settings", async (_req: Request, res: Response) => {
  res.json({ enabled: await curiosityEnabled() });
});

router.patch("/settings", requireManagerOrAdmin, validate(SettingsBody), async (req: Request, res: Response) => {
  const { enabled } = req.body as { enabled: boolean };
  await db.execute(sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (${ENABLED_KEY}, ${enabled ? "true" : "false"}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `);
  res.json({ enabled });
});

// ─── The walk ────────────────────────────────────────────────────────

// Everything the station card needs in one round-trip: the switch, the
// eight wastes (served from the corpus so the client never carries its own
// copy of the terminology law), and today's walk for this station if one
// has been started.
router.get("/walk", async (req: Request, res: Response) => {
  const planId = Number(req.query.planId);
  const station = typeof req.query.station === "string" ? req.query.station : "";
  if (!Number.isInteger(planId) || planId <= 0 || !station) {
    res.status(400).json({ error: "planId and station are required" });
    return;
  }
  const canonicalStation = resolveChecklistStation(station);

  const enabled = await curiosityEnabled();
  const [walk] = await db
    .select({
      id: curiosityWalksTable.id,
      startedByName: curiosityWalksTable.startedByName,
      completedAt: curiosityWalksTable.completedAt,
    })
    .from(curiosityWalksTable)
    .where(and(eq(curiosityWalksTable.planId, planId), eq(curiosityWalksTable.stationType, canonicalStation)));

  const observations = walk ? await walkObservations(walk.id) : [];
  res.json({
    enabled,
    wastes: LMS_EIGHT_WASTES,
    walk: walk ? { ...walk, observations, progress: walkProgress(observations) } : null,
  });
});

const CreateWalkBody = z.object({
  planId: z.number().int().positive(),
  stationType: z.string().min(1),
});

router.post("/walks", validate(CreateWalkBody), async (req: Request, res: Response) => {
  const { planId, stationType } = req.body as z.infer<typeof CreateWalkBody>;
  if (!(await curiosityEnabled())) {
    res.status(409).json({ error: "Curiosity Time is switched off" });
    return;
  }
  const canonicalStation = resolveChecklistStation(stationType);
  const userName = await sessionUserName(req);
  try {
    const [walk] = await db
      .insert(curiosityWalksTable)
      .values({
        planId,
        stationType: canonicalStation,
        startedBy: req.session.userId ?? null,
        startedByName: userName,
      })
      .returning({
        id: curiosityWalksTable.id,
        startedByName: curiosityWalksTable.startedByName,
        completedAt: curiosityWalksTable.completedAt,
      });
    res.status(201).json({ ...walk, observations: [], progress: walkProgress([]) });
  } catch (err: unknown) {
    // Someone else on the same station started it between our read and
    // write — that's their walk, hand it back rather than erroring.
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505") {
      const [walk] = await db
        .select({
          id: curiosityWalksTable.id,
          startedByName: curiosityWalksTable.startedByName,
          completedAt: curiosityWalksTable.completedAt,
        })
        .from(curiosityWalksTable)
        .where(and(eq(curiosityWalksTable.planId, planId), eq(curiosityWalksTable.stationType, canonicalStation)));
      const observations = walk ? await walkObservations(walk.id) : [];
      res.json(walk ? { ...walk, observations, progress: walkProgress(observations) } : null);
      return;
    }
    throw err;
  }
});

// One answer per waste, autosaved as the person taps — upsert keyed on
// (walk, waste) so changing your mind just overwrites. Never touches the
// photo columns.
const ObservationBody = z.object({
  wasteName: z.string().min(1),
  spotted: z.boolean(),
  note: z.string().max(1000).nullish(),
});

router.put("/walks/:id/observations", validate(ObservationBody), async (req: Request, res: Response) => {
  const walkId = Number(req.params.id);
  const { wasteName, spotted, note } = req.body as z.infer<typeof ObservationBody>;
  if (!isCanonicalWaste(wasteName)) {
    res.status(400).json({ error: `Unknown waste "${wasteName}" — must be one of the Lean Made Simple eight` });
    return;
  }
  const [walk] = await db
    .select({ id: curiosityWalksTable.id })
    .from(curiosityWalksTable)
    .where(eq(curiosityWalksTable.id, walkId));
  if (!walk) {
    res.status(404).json({ error: "Walk not found" });
    return;
  }
  const [row] = await db
    .insert(curiosityObservationsTable)
    .values({ walkId, wasteName, spotted, note: note ?? null })
    .onConflictDoUpdate({
      target: [curiosityObservationsTable.walkId, curiosityObservationsTable.wasteName],
      set: { spotted, note: note ?? null, updatedAt: new Date() },
    })
    .returning({
      id: curiosityObservationsTable.id,
      wasteName: curiosityObservationsTable.wasteName,
      spotted: curiosityObservationsTable.spotted,
      note: curiosityObservationsTable.note,
      updatedAt: curiosityObservationsTable.updatedAt,
    });
  res.json(row);
});

router.post("/walks/:id/complete", async (req: Request, res: Response) => {
  const walkId = Number(req.params.id);
  const [walk] = await db
    .update(curiosityWalksTable)
    .set({ completedAt: new Date() })
    .where(eq(curiosityWalksTable.id, walkId))
    .returning({
      id: curiosityWalksTable.id,
      startedByName: curiosityWalksTable.startedByName,
      completedAt: curiosityWalksTable.completedAt,
    });
  if (!walk) {
    res.status(404).json({ error: "Walk not found" });
    return;
  }
  const observations = await walkObservations(walk.id);
  res.json({ ...walk, observations, progress: walkProgress(observations) });
});

// ─── Photos ──────────────────────────────────────────────────────────

router.post("/observations/:id/photo", photoUpload.single("file"), async (req: Request, res: Response) => {
  const obsId = Number(req.params.id);
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  const mime = req.file.mimetype;
  if (!IMAGE_MIMES.includes(mime)) {
    res.status(400).json({ error: "Unsupported image type. Use JPEG, PNG, WebP, GIF or HEIC." });
    return;
  }
  if (req.file.size > 10 * 1024 * 1024) {
    res.status(400).json({ error: "Image too large (max 10MB)." });
    return;
  }
  const [row] = await db
    .update(curiosityObservationsTable)
    .set({ photo: req.file.buffer, photoMime: mime, updatedAt: new Date() })
    .where(eq(curiosityObservationsTable.id, obsId))
    .returning({ id: curiosityObservationsTable.id, updatedAt: curiosityObservationsTable.updatedAt });
  if (!row) {
    res.status(404).json({ error: "Observation not found" });
    return;
  }
  res.json({ id: row.id, hasPhoto: true, updatedAt: row.updatedAt });
});

router.delete("/observations/:id/photo", async (req: Request, res: Response) => {
  const obsId = Number(req.params.id);
  const [row] = await db
    .update(curiosityObservationsTable)
    .set({ photo: null, photoMime: null, updatedAt: new Date() })
    .where(eq(curiosityObservationsTable.id, obsId))
    .returning({ id: curiosityObservationsTable.id });
  if (!row) {
    res.status(404).json({ error: "Observation not found" });
    return;
  }
  res.json({ id: row.id, hasPhoto: false });
});

router.get("/observations/:id/photo", async (req: Request, res: Response) => {
  const obsId = Number(req.params.id);
  const [row] = await db
    .select({ photo: curiosityObservationsTable.photo, photoMime: curiosityObservationsTable.photoMime })
    .from(curiosityObservationsTable)
    .where(eq(curiosityObservationsTable.id, obsId));
  if (!row || !row.photo || !row.photoMime) {
    res.status(404).json({ error: "No photo" });
    return;
  }
  res.setHeader("Content-Type", row.photoMime);
  res.setHeader("Cache-Control", "private, max-age=300");
  res.send(row.photo);
});

export default router;
