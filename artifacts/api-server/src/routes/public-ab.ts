/**
 * POST /api/public/ab/hit — what the website's A/B snippet calls (tck-theme
 * snippets/tck-ab.liquid): "this browser session is on theme X" once per
 * session, and "added to cart" once per session. These are the sessions
 * that revenue per session divides by (lib/ab-results.ts).
 *
 * NO auth, so it accepts nothing but a theme id, two random ids and a kind,
 * stores one row per session+kind+theme (repeats are ignored), and returns
 * nothing. Mounted in app.ts BEFORE the app-wide CORS/session stack, like
 * public-surveys: own CORS (the shop's origin only, no credentials), own
 * IP-keyed rate limit. The snippet sends with navigator.sendBeacon as
 * text/plain, so there is no preflight and the page never waits.
 */
import { Router, type IRouter, type Request, type Response, text } from "express";
import cors from "cors";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { sql } from "drizzle-orm";
import * as z from "zod";
import { db } from "@workspace/db";

const router: IRouter = Router();

const SHOP_ORIGINS = ["https://thecalzonekitchen.co.uk", "https://www.thecalzonekitchen.co.uk"];

router.use(cors({
  credentials: false,
  origin: (origin, callback) => {
    if (!origin || SHOP_ORIGINS.includes(origin) || /^https:\/\/[a-z0-9-]+\.myshopify\.com$/.test(origin)) { callback(null, true); return; }
    if (process.env["NODE_ENV"] !== "production" && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) { callback(null, true); return; }
    callback(new Error(`CORS: origin '${origin}' not allowed`));
  },
}));

// A real visitor sends two or three a session; this is generous.
const hitLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `ab-hit:${ipKeyGenerator(req.ip ?? "")}`,
  message: { error: "Too many requests" },
});

router.use(text({ limit: "4kb", type: ["text/plain", "application/json"] }));

const hitBody = z.object({
  themeId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  themeName: z.string().max(200).nullish(),
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  visitorId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).nullish(),
  kind: z.enum(["visit", "add_to_cart"]),
  path: z.string().max(300).nullish(),
});

const BOT_UA = /bot|crawl|spider|slurp|preview|headless|lighthouse|pingdom|monitor/i;

router.post("/hit", hitLimiter, async (req: Request, res: Response) => {
  // Bots don't count — Shopify leaves them out of sessions too.
  if (BOT_UA.test(req.get("user-agent") ?? "")) { res.status(204).end(); return; }
  let raw: unknown = req.body;
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { raw = null; } }
  const parsed = hitBody.safeParse(raw);
  if (!parsed.success) { res.status(400).json({ error: "Bad hit" }); return; }
  const h = parsed.data;
  try {
    await db.execute(sql`
      INSERT INTO ab_hits (theme_id, theme_name, session_id, visitor_id, kind, path)
      VALUES (${h.themeId}, ${h.themeName ?? null}, ${h.sessionId}, ${h.visitorId ?? null}, ${h.kind}, ${h.path ?? null})
      ON CONFLICT (session_id, kind, theme_id) DO NOTHING
    `);
    res.status(204).end();
  } catch (err) {
    console.error("[ab-hit] insert failed:", err instanceof Error ? err.message : err);
    res.status(204).end();
  }
});

export default router;
