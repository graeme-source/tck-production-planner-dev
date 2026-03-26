/**
 * GitHub Sync — pushes all git-tracked files to the backup repo.
 * Run from workspace root: node scripts/github-sync.mjs
 * Uses the Replit GitHub connector (no PAT needed).
 */
import { ReplitConnectors } from "@replit/connectors-sdk";
import { execSync } from "child_process";
import { readFileSync } from "fs";

const connectors = new ReplitConnectors();
const OWNER = "graeme-source";
const REPO  = "tck-production-planner";

async function ghApi(path, opts = {}) {
  const res = await connectors.proxy("github", path, {
    method: opts.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GitHub ${opts.method ?? "GET"} ${path} → ${res.status}: ${txt.slice(0,300)}`);
  }
  return res.json();
}

async function main() {
  // Get current HEAD on main
  const ref = await ghApi(`/repos/${OWNER}/${REPO}/git/refs/heads/main`);
  const parentSha = ref.object.sha;
  console.log("Current HEAD:", parentSha);

  // List all git-tracked files
  const files = execSync("git ls-files", { encoding: "utf8" })
    .trim().split("\n").filter(Boolean);
  console.log(`Syncing ${files.length} files...`);

  // Create blobs in batches
  async function createBlob(filePath) {
    const raw = readFileSync(filePath);
    const blob = await ghApi(`/repos/${OWNER}/${REPO}/git/blobs`, {
      method: "POST",
      body: { content: raw.toString("base64"), encoding: "base64" },
    });
    return { path: filePath, mode: "100644", type: "blob", sha: blob.sha };
  }

  const treeItems = [];
  const BATCH = 8;
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(f => createBlob(f).catch(() => null)));
    for (const r of results) if (r) treeItems.push(r);
    process.stdout.write(`\r  ${Math.min(i + BATCH, files.length)}/${files.length} blobs`);
  }
  console.log("\nCreating tree + commit...");

  const tree = await ghApi(`/repos/${OWNER}/${REPO}/git/trees`, {
    method: "POST",
    body: { tree: treeItems },
  });

  const now = new Date().toISOString();
  const label = execSync("git log -1 --pretty=%s", { encoding: "utf8" }).trim();
  const commit = await ghApi(`/repos/${OWNER}/${REPO}/git/commits`, {
    method: "POST",
    body: {
      message: `Sync ${now} — ${label}`,
      tree: tree.sha,
      parents: [parentSha],
    },
  });

  await ghApi(`/repos/${OWNER}/${REPO}/git/refs/heads/main`, {
    method: "PATCH",
    body: { sha: commit.sha, force: true },
  });

  console.log(`✓ Synced to https://github.com/${OWNER}/${REPO}`);
  console.log(`  Commit: ${commit.sha.slice(0,7)} — Sync ${now}`);
}

main().catch(err => { console.error("Sync failed:", err.message); process.exit(1); });
