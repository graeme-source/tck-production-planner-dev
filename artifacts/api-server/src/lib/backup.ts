/**
 * Automated backup — runs daily at 18:00 Europe/London.
 *
 * Code sync : pushes all git-tracked files to GitHub (graeme-source/tck-production-planner)
 * DB backup : runs pg_dump, gzips the output, uploads as backups/YYYY-MM-DD.sql.gz
 *
 * Both operations use the Replit GitHub connector (no PAT needed).
 */
import { execSync, spawnSync } from "child_process";
import { createGzip } from "zlib";
import { Readable } from "stream";
import { readFileSync } from "fs";
import { schedule } from "node-cron";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { isStaging } from "./app-env";

const OWNER = "graeme-source";
const REPO  = "tck-production-planner";

async function ghApi(
  path: string,
  opts: { method?: string; body?: unknown } = {}
): Promise<unknown> {
  const connectors = new ReplitConnectors();
  const res = await connectors.proxy("github", path, {
    method: opts.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GitHub ${opts.method ?? "GET"} ${path} → ${res.status}: ${txt.slice(0, 300)}`);
  }
  return res.json();
}

// ── Database backup ───────────────────────────────────────────────────────────

async function backupDatabase(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL not set — cannot backup database");

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const env = process.env.NODE_ENV === "development" ? "dev" : "prod";
  const filePath = `backups/${env}/${today}.sql.gz`;

  console.log(`[backup] Running pg_dump → ${filePath}`);

  // Run pg_dump and capture output
  const dump = spawnSync("pg_dump", [dbUrl, "--no-password", "-Fp"], {
    maxBuffer: 50 * 1024 * 1024, // 50 MB
    timeout: 60_000,
  });

  if (dump.error) throw dump.error;
  if (dump.status !== 0) {
    throw new Error(`pg_dump exited ${dump.status}: ${dump.stderr?.toString().slice(0, 200)}`);
  }

  // Gzip the dump
  const gzipped = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const gz = createGzip();
    Readable.from(dump.stdout).pipe(gz);
    gz.on("data", (c: Buffer) => chunks.push(c));
    gz.on("end", () => resolve(Buffer.concat(chunks)));
    gz.on("error", reject);
  });

  const content = gzipped.toString("base64");

  // Check if file already exists on GitHub (need its SHA to update)
  let existingSha: string | undefined;
  try {
    const existing = await ghApi(`/repos/${OWNER}/${REPO}/contents/${filePath}`) as { sha: string };
    existingSha = existing.sha;
  } catch {
    // 404 — file doesn't exist yet, that's fine
  }

  await ghApi(`/repos/${OWNER}/${REPO}/contents/${filePath}`, {
    method: "PUT",
    body: {
      message: `DB backup ${today}`,
      content,
      ...(existingSha ? { sha: existingSha } : {}),
    },
  });

  console.log(`[backup] Database backup pushed to GitHub: ${filePath} (${(gzipped.length / 1024).toFixed(1)} KB)`);
}

// ── Code sync ─────────────────────────────────────────────────────────────────

async function syncCode(): Promise<void> {
  console.log("[backup] Syncing code to GitHub...");

  // Get current HEAD on main
  const ref = await ghApi(`/repos/${OWNER}/${REPO}/git/refs/heads/main`) as { object: { sha: string } };
  const parentSha = ref.object.sha;

  const files = execSync("git ls-files", { encoding: "utf8", cwd: "/home/runner/workspace" })
    .trim().split("\n").filter(Boolean);

  async function createBlob(filePath: string) {
    const raw = readFileSync(`/home/runner/workspace/${filePath}`);
    const blob = await ghApi(`/repos/${OWNER}/${REPO}/git/blobs`, {
      method: "POST",
      body: { content: raw.toString("base64"), encoding: "base64" },
    }) as { sha: string };
    return { path: filePath, mode: "100644", type: "blob", sha: blob.sha };
  }

  const treeItems: Array<{ path: string; mode: string; type: string; sha: string }> = [];
  const BATCH = 8;
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const results = await Promise.all(batch.map((f) => createBlob(f).catch(() => null)));
    for (const r of results) if (r) treeItems.push(r);
  }

  const tree = await ghApi(`/repos/${OWNER}/${REPO}/git/trees`, {
    method: "POST",
    body: { tree: treeItems },
  }) as { sha: string };

  const now = new Date().toISOString();
  const commit = await ghApi(`/repos/${OWNER}/${REPO}/git/commits`, {
    method: "POST",
    body: {
      message: `Auto-sync ${now}`,
      tree: tree.sha,
      parents: [parentSha],
    },
  }) as { sha: string };

  await ghApi(`/repos/${OWNER}/${REPO}/git/refs/heads/main`, {
    method: "PATCH",
    body: { sha: commit.sha, force: true },
  });

  console.log(`[backup] Code synced → ${commit.sha.slice(0, 7)}`);
}

// ── Full backup ───────────────────────────────────────────────────────────────

export async function runBackup(): Promise<void> {
  console.log("[backup] Starting scheduled backup...");
  const errors: string[] = [];

  try {
    await backupDatabase();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[backup] DB backup failed:", msg);
    errors.push(`DB: ${msg}`);
  }

  try {
    await syncCode();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[backup] Code sync failed:", msg);
    errors.push(`Code: ${msg}`);
  }

  if (errors.length > 0) {
    console.error("[backup] Completed with errors:", errors.join(" | "));
  } else {
    console.log("[backup] All done ✓");
  }
}

// ── Scheduler — daily 18:00 Europe/London ─────────────────────────────────────

export function startBackupScheduler(): void {
  // Staging: don't run the backup scheduler. Production is the source
  // of truth for backups and we don't want staging clobbering the
  // backups/YYYY-MM-DD.sql.gz bucket with its snapshot data.
  if (isStaging()) {
    console.log("[backup] staging: scheduler disabled");
    return;
  }

  // "0 18 * * *" = 6pm, timezone handles BST/GMT automatically
  schedule("0 18 * * *", () => {
    runBackup().catch((err) => {
      console.error("[backup] Unhandled error:", err instanceof Error ? err.message : String(err));
    });
  }, { timezone: "Europe/London" });

  console.log("[backup] Scheduler started — daily backup at 18:00 Europe/London");
}
