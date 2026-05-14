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
import { Router, type IRouter, type Request, type Response } from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
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

async function loadCommits(): Promise<CachedFeed> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache;

  // Walk up from this file to find the repo root (the directory that
  // contains a .git folder). In dev this is the workspace root; in
  // Railway it's the deploy directory. If we can't find one, treat
  // the feature as unavailable.
  const repoRoot = await findRepoRoot();
  if (!repoRoot) {
    const empty: CachedFeed = { fetchedAt: now, available: false, last24h: [], last7Days: [], summary: null };
    cache = empty;
    return empty;
  }

  try {
    // `--no-merges` keeps the output focused on actual changes;
    // pickaxe formatting via custom separators handles bodies that
    // contain newlines.
    const format = `%H${FIELD_SEP}%aI${FIELD_SEP}%an${FIELD_SEP}%s${FIELD_SEP}%b${RECORD_SEP}`;
    const { stdout } = await execFileP("git", [
      "log",
      "--no-merges",
      "--since=7 days ago",
      `--pretty=format:${format}`,
      "master",
    ], { cwd: repoRoot, maxBuffer: 5 * 1024 * 1024 });

    const all: Commit[] = stdout
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

    const cutoff24h = now - 24 * 60 * 60_000;
    const last24h = all.filter(c => new Date(c.date).getTime() >= cutoff24h);

    const summary = await summariseLast24h(last24h);

    const feed: CachedFeed = { fetchedAt: now, available: true, last24h, last7Days: all, summary };
    cache = feed;
    return feed;
  } catch (err) {
    console.warn("[system-updates] git log failed:", err instanceof Error ? err.message : err);
    const empty: CachedFeed = { fetchedAt: now, available: false, last24h: [], last7Days: [], summary: null };
    cache = empty;
    return empty;
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

  const prompt = `You're summarising what changed in the TCK Production Planner over the last 24 hours for the kitchen team's morning meeting.

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

router.get("/", async (_req: Request, res: Response) => {
  try {
    const feed = await loadCommits();
    res.json(feed);
  } catch (err) {
    console.error("[system-updates] handler failed:", err);
    res.status(500).json({ error: "Failed to load system updates" });
  }
});

export default router;
