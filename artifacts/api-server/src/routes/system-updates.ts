/**
 * System Updates feed — recent git commits surfaced inside the
 * morning meeting so the team can see what changed in the system
 * yesterday/this week. Reads from `git log` at runtime; results are
 * cached for 5 minutes so the dashboard endpoint stays cheap.
 *
 * If git isn't available in the runtime environment (some container
 * builds strip .git), the endpoint returns an empty list with an
 * `available: false` flag so the frontend renders an honest empty
 * state rather than hanging or 500-ing.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { db, usersTable } from "@workspace/db";
import { sql, eq } from "drizzle-orm";
import { getClaudeClient, isClaudeConfigured, CLAUDE_MODELS } from "../lib/ai/claude";

const execFileP = promisify(execFile);
const router: IRouter = Router();

interface Commit {
  sha: string;
  shortSha: string;
  date: string; // ISO 8601
  author: string;
  subject: string;
  body: string;
}

interface CachedFeed {
  fetchedAt: number;
  available: boolean;
  last24h: Commit[];
  last7Days: Commit[];
  /** Bullet-pointed plain-English summary of the last 24h. null when
   *  there's nothing to summarise OR Claude isn't configured. */
  summary: string[] | null;
}

let cache: CachedFeed | null = null;
const CACHE_TTL_MS = 5 * 60_000;

// Summary cache keyed by the SHA-set of the last 24h commits. When
// commits roll forward we miss this cache and call Claude again; if
// the same set repeats (no new deploys) we serve the cached summary.
const summaryCache = new Map<string, string[]>();

const FIELD_SEP = "\x1f"; // unit separator — unlikely to appear in commit text
const RECORD_SEP = "\x1e"; // record separator

/** A commit source (local git or GitHub) plus a way to ask it for the
 *  exact range of commits that landed after a known baseline SHA. */
interface SourceResult {
  headSha: string | null;
  /** Date-based window — fallback when we have no baseline snapshot. */
  last24h: Commit[];
  last7Days: Commit[];
  range: (baselineSha: string) => Promise<Commit[] | null>;
}

async function loadCommits(): Promise<CachedFeed> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache;

  // Local `git log` works in dev where .git is on disk; GitHub's REST
  // API covers production where the runtime container doesn't ship
  // .git. Reads from master so the feed always reflects what's deployed.
  const src = (await loadCommitsFromLocalGit()) ?? (await loadCommitsFromGithub());
  if (!src) {
    // Neither path worked. Cache the empty state briefly so we
    // don't hammer either source on every dashboard refresh.
    const empty: CachedFeed = { fetchedAt: now, available: false, last24h: [], last7Days: [], summary: null };
    cache = empty;
    return empty;
  }

  const fresh = await commitsSinceLastMeeting(src);
  const summary = await summariseLast24h(fresh);
  const feed: CachedFeed = { fetchedAt: now, available: true, last24h: fresh, last7Days: src.last7Days, summary };
  cache = feed;
  return feed;
}

/** "What shipped since yesterday's meeting?" — a pure author-date filter
 *  misses it: dev work committed days ago only reaches master (= live)
 *  when it's merged and deployed at night, by which point the commits
 *  look "old". So each time the feed is built we snapshot master's HEAD,
 *  and the slide shows every commit that became reachable since the most
 *  recent snapshot that's at least 20h old (≈ yesterday's meeting).
 *  Falls back to the 24h date window when there's no usable snapshot
 *  (first run, rebased history, DB hiccup). */
async function commitsSinceLastMeeting(src: SourceResult): Promise<Commit[]> {
  if (!src.headSha) return src.last24h;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS system_updates_feed_state (
        id serial PRIMARY KEY,
        sha text NOT NULL,
        seen_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const baselineRows = toRows<{ sha: string }>(await db.execute(sql`
      SELECT sha FROM system_updates_feed_state
      WHERE seen_at <= now() - interval '20 hours'
      ORDER BY seen_at DESC LIMIT 1
    `));
    const newestRows = toRows<{ sha: string }>(await db.execute(sql`
      SELECT sha FROM system_updates_feed_state ORDER BY seen_at DESC LIMIT 1
    `));
    if (newestRows[0]?.sha !== src.headSha) {
      await db.execute(sql`INSERT INTO system_updates_feed_state (sha) VALUES (${src.headSha})`);
      await db.execute(sql`DELETE FROM system_updates_feed_state WHERE seen_at < now() - interval '30 days'`);
    }

    const baseline = baselineRows[0]?.sha;
    if (!baseline) return src.last24h;
    if (baseline === src.headSha) return []; // nothing deployed since yesterday
    return (await src.range(baseline)) ?? src.last24h;
  } catch (err) {
    console.warn("[system-updates] feed state failed:", err instanceof Error ? err.message : err);
    return src.last24h;
  }
}

function parseGitLog(stdout: string): Commit[] {
  return stdout
    .split(RECORD_SEP)
    .map(rec => rec.trim())
    .filter(Boolean)
    .map(rec => {
      const [sha, date, author, subject, body] = rec.split(FIELD_SEP);
      return {
        sha,
        shortSha: sha.slice(0, 7),
        date,
        author: author ?? "",
        subject: subject ?? "",
        body: (body ?? "").trim(),
      };
    });
}

async function gitLog(repoRoot: string, refArgs: string[]): Promise<Commit[]> {
  const format = `%H${FIELD_SEP}%aI${FIELD_SEP}%an${FIELD_SEP}%s${FIELD_SEP}%b${RECORD_SEP}`;
  const { stdout } = await execFileP("git", [
    "log",
    "--no-merges",
    `--pretty=format:${format}`,
    ...refArgs,
  ], { cwd: repoRoot, maxBuffer: 5 * 1024 * 1024 });
  return parseGitLog(stdout);
}

async function loadCommitsFromLocalGit(): Promise<SourceResult | null> {
  const repoRoot = await findRepoRoot();
  if (!repoRoot) return null;

  try {
    const all = await gitLog(repoRoot, ["--since=7 days ago", "HEAD"]);
    const { stdout: headOut } = await execFileP("git", ["rev-parse", "HEAD"], { cwd: repoRoot });

    const cutoff24h = Date.now() - 24 * 60 * 60_000;
    const last24h = all.filter(c => new Date(c.date).getTime() >= cutoff24h);
    return {
      headSha: headOut.trim() || null,
      last24h,
      last7Days: all,
      range: async (baselineSha) => {
        if (!/^[0-9a-f]{7,40}$/i.test(baselineSha)) return null;
        try {
          return await gitLog(repoRoot, [`${baselineSha}..HEAD`]);
        } catch {
          return null; // baseline unknown to this clone (e.g. rebased away)
        }
      },
    };
  } catch (err) {
    console.warn("[system-updates] local git log failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Owner/repo for the GitHub fallback. Set via env var so the same
 *  binary works for dev/staging/prod. Falls back to the repo this
 *  was deployed from. */
const GITHUB_REPO = process.env["GITHUB_REPO"] ?? "graeme-source/tck-production-planner-dev";
const GITHUB_BRANCH = process.env["GITHUB_BRANCH"] ?? "master";
const GITHUB_TOKEN = process.env["GITHUB_TOKEN"]; // optional, raises rate limit and unlocks private repos

interface GithubCommitResponse {
  sha: string;
  commit: {
    author: { name: string; date: string } | null;
    message: string;
  };
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "tck-production-planner",
  };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  return headers;
}

function mapGithubCommit(r: GithubCommitResponse): Commit {
  const msg = r.commit.message;
  const newlineIdx = msg.indexOf("\n");
  const subject = newlineIdx === -1 ? msg : msg.slice(0, newlineIdx).trim();
  const body = newlineIdx === -1 ? "" : msg.slice(newlineIdx + 1).trim();
  return {
    sha: r.sha,
    shortSha: r.sha.slice(0, 7),
    date: r.commit.author?.date ?? new Date().toISOString(),
    author: r.commit.author?.name ?? "",
    subject,
    body,
  };
}

async function loadCommitsFromGithub(): Promise<SourceResult | null> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
  const url = `https://api.github.com/repos/${GITHUB_REPO}/commits?sha=${encodeURIComponent(GITHUB_BRANCH)}&since=${encodeURIComponent(since)}&per_page=100`;

  try {
    const res = await fetch(url, { headers: githubHeaders() });
    if (!res.ok) {
      console.warn(`[system-updates] github fetch ${res.status}:`, await res.text().catch(() => ""));
      return null;
    }
    const rows = (await res.json()) as GithubCommitResponse[];

    // GitHub returns merge commits too; skip ones whose subject starts
    // with "Merge ". Matches what `git log --no-merges` does. The head
    // SHA is taken from the unfiltered list — the branch tip is often
    // itself a merge commit.
    const headSha = rows[0]?.sha ?? null;
    const all: Commit[] = rows
      .filter(r => !r.commit.message.startsWith("Merge "))
      .map(mapGithubCommit);

    const cutoff24h = Date.now() - 24 * 60 * 60_000;
    const last24h = all.filter(c => new Date(c.date).getTime() >= cutoff24h);
    return { headSha, last24h, last7Days: all, range: githubCompareRange };
  } catch (err) {
    console.warn("[system-updates] github fetch failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Commits on the deployed branch that aren't reachable from `baselineSha`,
 *  newest first — GitHub's equivalent of `git log baseline..HEAD`. */
async function githubCompareRange(baselineSha: string): Promise<Commit[] | null> {
  if (!/^[0-9a-f]{7,40}$/i.test(baselineSha)) return null;
  const url = `https://api.github.com/repos/${GITHUB_REPO}/compare/${baselineSha}...${encodeURIComponent(GITHUB_BRANCH)}`;
  try {
    const res = await fetch(url, { headers: githubHeaders() });
    if (!res.ok) {
      console.warn(`[system-updates] github compare ${res.status}:`, await res.text().catch(() => ""));
      return null;
    }
    const data = (await res.json()) as { commits?: GithubCommitResponse[] };
    return (data.commits ?? [])
      .filter(r => !r.commit.message.startsWith("Merge "))
      .map(mapGithubCommit)
      .reverse(); // compare lists oldest→newest; the feed wants newest first
  } catch (err) {
    console.warn("[system-updates] github compare failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Ask Claude Haiku for a short, plain-English summary of the last
 *  24h of commits — the kitchen audience doesn't care about commit
 *  subjects, they care about "what's actually different today?"
 *  Returns null when there's nothing to summarise or Claude isn't
 *  configured; the slide falls back to the raw commit list. */
async function summariseLast24h(commits: Commit[]): Promise<string[] | null> {
  if (commits.length === 0) return null;
  if (!isClaudeConfigured()) return null;

  const key = commits.map(c => c.sha).sort().join(",");
  const cached = summaryCache.get(key);
  if (cached) return cached;

  // Compact prompt — subject + body for each commit, capped so we
  // don't blow the context. Haiku handles a few KB just fine.
  const bullets = commits
    .map(c => {
      const body = c.body ? `\n${c.body.split("\n").slice(0, 6).join("\n")}` : "";
      return `- ${c.subject}${body}`;
    })
    .join("\n\n")
    .slice(0, 8_000);

  const prompt = `You're summarising what changed in the TCK Production Planner since yesterday's morning meeting for the kitchen team.

The audience: cooks and shift managers, not developers. They want to know "what's different today?" — what bugs got fixed, what new features they can use, what numbers will now look different. They do not care about code, schemas, refactors, or commit hygiene.

Rules:
- Output 3-6 short bullet points. One sentence each, plain English, present tense ("Packing speed now matches the Analytics page").
- Lead with anything that affects the user-facing experience (bug fixes, new buttons, changed numbers). Skip anything internal-only.
- If multiple commits relate to the same change, fold them into one bullet.
- Never invent details. If a commit is unclear, leave it out.
- Return ONLY the bullets, one per line, prefixed with "- ". No headings, no preamble.

Commits to summarise:
${bullets}`;

  try {
    const client = getClaudeClient();
    const resp = await client.messages.create({
      model: CLAUDE_MODELS.haiku,
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    });
    const text = resp.content
      .map(b => (b.type === "text" ? b.text : ""))
      .join("\n");

    const lines = text
      .split("\n")
      .map(l => l.trim())
      .filter(l => l.startsWith("-"))
      .map(l => l.replace(/^-\s*/, "").trim())
      .filter(Boolean)
      .slice(0, 6);

    if (lines.length === 0) return null;
    summaryCache.set(key, lines);
    return lines;
  } catch (err) {
    console.warn("[system-updates] summarise failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function findRepoRoot(): Promise<string | null> {
  // Try `git rev-parse --show-toplevel` from the current process cwd.
  try {
    const { stdout } = await execFileP("git", ["rev-parse", "--show-toplevel"], { cwd: process.cwd() });
    const root = stdout.trim();
    if (root) return root;
  } catch {
    // fall through to fs walk
  }

  // Last-resort: walk up from __dirname looking for a .git directory.
  const fs = await import("node:fs/promises");
  let dir = path.resolve(__dirname);
  for (let i = 0; i < 8; i++) {
    try {
      await fs.access(path.join(dir, ".git"));
      return dir;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

// ── Curated updates (DB-backed) ──────────────────────────────────────────
// A simple admin-managed changelog. When a published entry exists it is the
// source of truth for the morning-meeting slide; otherwise we fall back to
// the git/GitHub commit feed above so nothing regresses.

interface UpdateRow {
  id: number;
  title: string | null;
  body: string;
  published: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

const toRows = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[]));
const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : d);

/** Split a body blob into clean bullet lines (strip any leading -, •, * marker). */
function bodyToBullets(body: string): string[] {
  return body
    .split("\n")
    .map(l => l.replace(/^\s*[-•*]\s*/, "").trim())
    .filter(Boolean);
}

async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.session.userRole === "admin") { next(); return; }
  if (req.session.userId && !req.session.userRole) {
    const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, req.session.userId));
    if (user) {
      req.session.userRole = user.role as "admin" | "manager" | "viewer";
      if (user.role === "admin") { next(); return; }
    }
  }
  res.status(403).json({ error: "Admin access required" });
}

// Public (for the meeting slide): a published curated entry overrides the
// automatic feed for 24 hours after it's written — long enough to carry one
// morning meeting — then the git/GitHub commit feed resumes. (It used to
// override forever, which froze the slide on a stale entry.)
router.get("/", async (_req: Request, res: Response) => {
  try {
    const rows = toRows<UpdateRow>(await db.execute(sql`
      SELECT id, title, body, published, created_at, updated_at
      FROM system_updates
      WHERE published = true AND created_at >= now() - interval '24 hours'
      ORDER BY created_at DESC LIMIT 1
    `));
    const latest = rows[0];
    if (latest) {
      res.json({
        available: true,
        summary: bodyToBullets(latest.body),
        updateTitle: latest.title,
        updateDate: iso(latest.created_at),
        last24h: [],
        last7Days: [],
      });
      return;
    }
    // No curated entry — fall back to the commit feed.
    res.json(await loadCommits());
  } catch (err) {
    console.error("[system-updates] handler failed:", err);
    res.status(500).json({ error: "Failed to load system updates" });
  }
});

// Admin list — all entries, newest first.
router.get("/admin", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = toRows<UpdateRow>(await db.execute(sql`
      SELECT id, title, body, published, created_at, updated_at
      FROM system_updates ORDER BY created_at DESC
    `));
    res.json(rows.map(r => ({
      id: r.id,
      title: r.title,
      body: r.body,
      published: r.published,
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
    })));
  } catch (err) {
    console.error("[system-updates] admin list failed:", err);
    res.status(500).json({ error: "Failed to load updates" });
  }
});

router.post("/", requireAdmin, async (req: Request, res: Response) => {
  const title = typeof req.body?.title === "string" && req.body.title.trim() ? req.body.title.trim() : null;
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  const published = req.body?.published === false ? false : true;
  if (!body) { res.status(400).json({ error: "body (bullets) is required" }); return; }
  const rows = toRows<{ id: number }>(await db.execute(sql`
    INSERT INTO system_updates (title, body, published) VALUES (${title}, ${body}, ${published}) RETURNING id
  `));
  res.status(201).json({ id: rows[0]?.id });
});

router.put("/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (typeof req.body?.title !== "undefined") {
    const title = typeof req.body.title === "string" && req.body.title.trim() ? req.body.title.trim() : null;
    await db.execute(sql`UPDATE system_updates SET title = ${title}, updated_at = now() WHERE id = ${id}`);
  }
  if (typeof req.body?.body === "string") {
    const body = req.body.body.trim();
    if (!body) { res.status(400).json({ error: "body cannot be empty" }); return; }
    await db.execute(sql`UPDATE system_updates SET body = ${body}, updated_at = now() WHERE id = ${id}`);
  }
  if (typeof req.body?.published === "boolean") {
    await db.execute(sql`UPDATE system_updates SET published = ${req.body.published}, updated_at = now() WHERE id = ${id}`);
  }
  res.json({ ok: true });
});

router.delete("/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.execute(sql`DELETE FROM system_updates WHERE id = ${id}`);
  res.json({ ok: true });
});

export default router;
