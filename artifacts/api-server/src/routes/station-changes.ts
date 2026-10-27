/**
 * Station changes — "What's changed in this station?" (Graeme, 27 Oct 2026;
 * objectives E, F and H). Mounted at /api/station-changes.
 *
 * Reads the System Updates entries (table system_updates) with the areas
 * they're tagged with, an optional walkthrough, and whether the signed-in
 * PERSON has seen each one. The station screens and the morning-meeting
 * slide do the grouping/filtering with the pure rules in
 * @workspace/station-changes, so the server only serves data.
 *
 *   GET  /?days=7          areas + published entries in the window + my seen ids
 *   POST /seen             mark { ids } seen for me
 *   GET  /admin            every entry from the last 120 days (editors)
 *   POST /                 add an entry; areas guessed when not given (editors)
 *   PUT  /:id              edit title/body/areas/tutorial/published (editors)
 *   POST /guess            best-guess areas for { title, body, paths } (editors)
 *
 * Editors = Settings → "Feature flags & updates" (settings.features), the
 * same people who already manage System Updates.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import * as z from "zod";
import { guessAreas, parseTutorial, sortAreaKeys, type ChangeArea, type Tutorial } from "@workspace/station-changes";
import { validate, validateQuery } from "../middleware/validate";
import { requireFeature } from "../lib/feature-access";
import { loadChangeAreas } from "../lib/change-areas";

const router: IRouter = Router();
const requireEditor = requireFeature("settings.features");

const toRows = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[]));
const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());

interface EntryRow {
  id: number;
  title: string | null;
  body: string;
  areas: string[] | null;
  tutorial: unknown;
  published: boolean;
  slug: string | null;
  created_at: Date | string;
  has_image: boolean;
}

function bodyToBullets(body: string): string[] {
  return body.split("\n").map(l => l.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean);
}

/** A stored walkthrough that no longer passes validation is dropped, never
 *  sent: a bad tutorial must not be able to break a station screen. */
function safeTutorial(raw: unknown): Tutorial | null {
  const r = parseTutorial(raw);
  return r.ok ? r.tutorial : null;
}

function toEntry(r: EntryRow) {
  return {
    id: r.id,
    title: r.title?.trim() || bodyToBullets(r.body)[0] || "Update",
    bullets: bodyToBullets(r.body),
    areas: r.areas ?? [],
    createdAt: iso(r.created_at),
    hasImage: !!r.has_image,
    tutorial: safeTutorial(r.tutorial),
  };
}

const arrayParam = (keys: readonly string[]) => sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb))::text[]`;

const ListQuery = z.object({ days: z.coerce.number().int().min(1).max(60).optional() });

router.get("/", validateQuery(ListQuery), async (req: Request, res: Response) => {
  const days = (res.locals["query"] as z.infer<typeof ListQuery>).days ?? 7;
  const userId = req.session.userId ?? null;
  try {
    const [areas, rows, seen] = await Promise.all([
      loadChangeAreas(),
      db.execute(sql`
        SELECT id, title, body, areas, tutorial, published, slug, created_at, (image IS NOT NULL) AS has_image
          FROM system_updates
         WHERE published = true
           AND created_at >= now() - make_interval(days => ${days})
         ORDER BY created_at DESC, id DESC
      `),
      userId == null ? Promise.resolve([]) : db.execute(sql`
        SELECT s.update_id FROM system_update_seen s
          JOIN system_updates u ON u.id = s.update_id
         WHERE s.user_id = ${userId} AND u.created_at >= now() - make_interval(days => ${days})
      `),
    ]);
    res.json({
      areas,
      entries: toRows<EntryRow>(rows).map(toEntry),
      seenIds: toRows<{ update_id: number }>(seen).map(s => s.update_id),
    });
  } catch (err) {
    console.error("[station-changes] list failed:", err);
    res.status(500).json({ error: "Couldn't load what's changed" });
  }
});

const SeenBody = z.object({ ids: z.array(z.number().int().positive()).min(1).max(200) });

router.post("/seen", validate(SeenBody), async (req: Request, res: Response) => {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Sign in first" }); return; }
  const { ids } = req.body as z.infer<typeof SeenBody>;
  try {
    await db.execute(sql`
      INSERT INTO system_update_seen (update_id, user_id)
      SELECT u.id, ${userId} FROM system_updates u
       WHERE u.id IN (SELECT (jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))::int)
      ON CONFLICT (update_id, user_id) DO NOTHING
    `);
    res.json({ ok: true });
  } catch (err) {
    console.error("[station-changes] mark seen failed:", err);
    res.status(500).json({ error: "Couldn't save that you've seen it" });
  }
});

// ── Editors ────────────────────────────────────────────────────────────

router.get("/admin", requireEditor, async (_req: Request, res: Response) => {
  try {
    const [areas, rows] = await Promise.all([
      loadChangeAreas(),
      db.execute(sql`
        SELECT id, title, body, areas, tutorial, published, slug, created_at, (image IS NOT NULL) AS has_image
          FROM system_updates
         WHERE created_at >= now() - interval '120 days'
         ORDER BY created_at DESC, id DESC
      `),
    ]);
    res.json({
      areas,
      entries: toRows<EntryRow>(rows).map(r => ({
        ...toEntry(r),
        title: r.title ?? "",
        body: r.body,
        published: r.published,
        slug: r.slug,
        // The raw stored walkthrough, so an editor can see and fix one that
        // no longer validates (toEntry drops those).
        tutorialRaw: r.tutorial ?? null,
      })),
    });
  } catch (err) {
    console.error("[station-changes] admin list failed:", err);
    res.status(500).json({ error: "Couldn't load the changes" });
  }
});

/** Known keys only, in display order. */
function cleanAreas(keys: readonly string[] | undefined, areas: readonly ChangeArea[]): string[] {
  return sortAreaKeys(keys ?? [], areas);
}

const GuessBody = z.object({
  title: z.string().max(200).optional().nullable(),
  body: z.string().max(5000).optional().nullable(),
  paths: z.array(z.string().max(400)).max(500).optional(),
});

router.post("/guess", requireEditor, validate(GuessBody), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof GuessBody>;
  const areas = await loadChangeAreas();
  res.json({ areas: guessAreas({ paths: b.paths, text: `${b.title ?? ""}\n${b.body ?? ""}` }, areas) });
});

const CreateBody = z.object({
  title: z.string().trim().max(200).optional().nullable(),
  body: z.string().trim().min(1, "Add at least one line").max(5000),
  /** Omit to have them guessed from the words (and paths, if given). */
  areas: z.array(z.string().max(40)).max(20).optional(),
  paths: z.array(z.string().max(400)).max(500).optional(),
  tutorial: z.unknown().optional().nullable(),
  published: z.boolean().optional(),
});

router.post("/", requireEditor, validate(CreateBody), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof CreateBody>;
  const t = parseTutorial(b.tutorial ?? null);
  if (!t.ok) { res.status(400).json({ error: t.errors.join(" ") }); return; }
  const areaList = await loadChangeAreas();
  const areas = b.areas !== undefined
    ? cleanAreas(b.areas, areaList)
    : guessAreas({ paths: b.paths, text: `${b.title ?? ""}\n${b.body}` }, areaList);
  try {
    const rows = toRows<{ id: number }>(await db.execute(sql`
      INSERT INTO system_updates (title, body, published, areas, tutorial)
      VALUES (${b.title?.trim() || null}, ${b.body}, ${b.published ?? true}, ${arrayParam(areas)},
              ${t.tutorial ? JSON.stringify(t.tutorial) : null}::jsonb)
      RETURNING id
    `));
    res.status(201).json({ id: rows[0]?.id, areas });
  } catch (err) {
    console.error("[station-changes] create failed:", err);
    res.status(500).json({ error: "Couldn't save the change" });
  }
});

const UpdateBody = z.object({
  title: z.string().trim().max(200).optional().nullable(),
  body: z.string().trim().min(1, "Add at least one line").max(5000).optional(),
  areas: z.array(z.string().max(40)).max(20).optional(),
  tutorial: z.unknown().optional(),
  published: z.boolean().optional(),
});

router.put("/:id", requireEditor, validate(UpdateBody), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }
  const b = req.body as z.infer<typeof UpdateBody>;
  let tutorialJson: string | null | undefined;
  if (b.tutorial !== undefined) {
    const t = parseTutorial(b.tutorial);
    if (!t.ok) { res.status(400).json({ error: t.errors.join(" ") }); return; }
    tutorialJson = t.tutorial ? JSON.stringify(t.tutorial) : null;
  }
  const areas = b.areas !== undefined ? cleanAreas(b.areas, await loadChangeAreas()) : undefined;
  try {
    const rows = toRows<{ id: number }>(await db.execute(sql`
      UPDATE system_updates SET
        title = CASE WHEN ${b.title !== undefined} THEN ${b.title?.trim() || null} ELSE title END,
        body = COALESCE(${b.body ?? null}, body),
        published = COALESCE(${b.published ?? null}::boolean, published),
        areas = CASE WHEN ${areas !== undefined} THEN ${arrayParam(areas ?? [])} ELSE areas END,
        tutorial = CASE WHEN ${tutorialJson !== undefined} THEN ${tutorialJson ?? null}::jsonb ELSE tutorial END,
        updated_at = now()
      WHERE id = ${id}
      RETURNING id
    `));
    if (!rows[0]) { res.status(404).json({ error: "Change not found" }); return; }
    res.json({ ok: true, areas });
  } catch (err) {
    console.error("[station-changes] update failed:", err);
    res.status(500).json({ error: "Couldn't save the change" });
  }
});

export default router;
