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
}

let cache: CachedFeed | null = null;
const CACHE_TTL_MS = 5 * 60_000;

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
    const empty: CachedFeed = { fetchedAt: now, available: false, last24h: [], last7Days: [] };
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

    const feed: CachedFeed = { fetchedAt: now, available: true, last24h, last7Days: all };
    cache = feed;
    return feed;
  } catch (err) {
    console.warn("[system-updates] git log failed:", err instanceof Error ? err.message : err);
    const empty: CachedFeed = { fetchedAt: now, available: false, last24h: [], last7Days: [] };
    cache = empty;
    return empty;
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
