/**
 * Parse the "Author:" line from each Gember PDF and match it to an
 * app_users row, then UPDATE standards_sops.author_id.
 *
 * Names in the Gember export aren't perfectly normalised:
 *   - case differs ("Jane miles" vs "Jane Miles", "JI HEY KIM" vs "Ji-Hey Kim")
 *   - short names ("Tommy Noithip" vs "Thomas Noithip", "Dave" vs "David")
 *   - generic placeholders ("Admin TCK" vs "Admin")
 *
 * Match strategy:
 *   1. Strip non-alphanumeric chars and lowercase both sides → exact match.
 *   2. Try the same normalisation against the AUTHOR_ALIASES table (manual
 *      overrides for cases #1 can't reach).
 *   3. (Optional) If LIVE_DATABASE_URL is set, look up unmatched names on
 *      the live DB and, when found, mirror that user into the local
 *      app_users table so we can attach the SOP locally. The push-to-live
 *      script later remaps author_id by name so the live SOP lands on the
 *      live user.
 *
 * Idempotent — re-run safely; we only target SOPs tagged "imported:gembadocs".
 *
 * Usage:
 *   # Local-only match.
 *   DATABASE_URL=postgresql://localhost/tck_planner \
 *     pnpm --filter @workspace/scripts run assign-gember-authors
 *
 *   # Also mirror missing users from live.
 *   DATABASE_URL=postgresql://localhost/tck_planner \
 *   LIVE_DATABASE_URL=<railway public url> \
 *     pnpm --filter @workspace/scripts run assign-gember-authors
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ARCHIVE_DIR = path.resolve(process.cwd(), "../attached_assets/sop-archive");

// Manual alias table — keys + values are normalised (alphanumeric, lower).
// The key is what appears in the Gember PDF, the value is the app_users.name
// it should resolve to.
const AUTHOR_ALIASES: Record<string, string> = {
  "admintck": "admin",
  "thomasnoithip": "tommynoithip",
  "davidbewsey": "davebewsey",
  "janemiles": "janemiles",          // case-only — already handled by norm()
  "jiheykim": "jiheykim",            // hyphen-only — already handled by norm()
};

function norm(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function authorFromPdf(pdfPath: string): string | null {
  try {
    const text = execFileSync("pdftotext", [pdfPath, "-"], { encoding: "utf8" });
    // Gember footer always contains "Author: <Name>" on its own line.
    // The regex grabs everything to end-of-line and trims.
    const m = text.match(/Author:\s*([^\n]+)/);
    if (!m) return null;
    return m[1].trim();
  } catch {
    return null;
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "pipe" });
  } catch {
    console.error("ERROR: `pdftotext` not found. Install poppler (brew install poppler).");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Pre-load the local user table and build a normalised lookup.
  const users = await client.query<{ id: number; name: string }>(
    `SELECT id, name FROM app_users`,
  );
  const usersByNorm = new Map<string, { id: number; name: string }>();
  for (const u of users.rows) {
    usersByNorm.set(norm(u.name), u);
  }

  // Optionally also load users from the live database, indexed by name. We
  // only use this for *creating* missing local users from live data — the
  // SOP's author_id will always be the local id we insert here.
  type LiveUser = { name: string; email: string; role: string };
  const liveUsersByNorm = new Map<string, LiveUser>();
  let liveClient: pg.Client | null = null;
  if (process.env.LIVE_DATABASE_URL) {
    console.log("Loading users from LIVE_DATABASE_URL…");
    liveClient = new pg.Client({ connectionString: process.env.LIVE_DATABASE_URL });
    await liveClient.connect();
    const liveRows = await liveClient.query<LiveUser>(
      `SELECT name, email, role::text AS role FROM app_users`,
    );
    for (const u of liveRows.rows) liveUsersByNorm.set(norm(u.name), u);
    console.log(`  ${liveRows.rowCount} live user(s) loaded.\n`);
  }

  // Helper: ensure a local user exists for a given normalised name, mirroring
  // from live if needed. Returns the local user (or null if no live record).
  const ensureLocalUser = async (rawAuthorName: string, normName: string): Promise<{ id: number; name: string } | null> => {
    const existing = usersByNorm.get(normName);
    if (existing) return existing;
    if (!liveClient) return null;
    const live = liveUsersByNorm.get(normName);
    if (!live) return null;

    // Mirror the live row into the local app_users table. The local id is
    // assigned by the sequence — it doesn't need to match live; the push
    // script remaps author_id by name on copy-up.
    //
    // password_hash gets a deliberately invalid value (not a real bcrypt
    // hash) so the mirrored user can't actually log in locally. is_active
    // is false for the same reason — they're a record, not an account.
    const result = await client.query<{ id: number }>(
      `INSERT INTO app_users (name, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4::user_role, false)
       RETURNING id`,
      [live.name, live.email, "mirrored-from-live--cannot-login", live.role],
    );
    const created = { id: result.rows[0].id, name: live.name };
    usersByNorm.set(normName, created);
    console.log(`  + mirrored "${live.name}" from live (local id ${created.id}, marked inactive)`);
    return created;
  };

  // Pull every imported SOP along with its ref slug.
  const sops = await client.query<{ id: number; title: string; tags: string[]; author_id: number | null }>(
    `SELECT id, title, tags, author_id FROM standards_sops WHERE 'imported:gembadocs' = ANY(tags)`,
  );

  let assigned = 0;
  let unchanged = 0;
  const unmatched: { slug: string; rawAuthor: string }[] = [];
  const noAuthorInPdf: string[] = [];
  const matchCounts: Record<string, number> = {};

  try {
    for (const sop of sops.rows) {
      const refTag = (sop.tags ?? []).find(t => t.startsWith("ref:"));
      if (!refTag) continue;
      const slug = refTag.slice("ref:".length);
      const pdfPath = path.join(ARCHIVE_DIR, slug, "source.pdf");
      if (!fs.existsSync(pdfPath)) continue;

      const rawAuthor = authorFromPdf(pdfPath);
      if (!rawAuthor) {
        noAuthorInPdf.push(slug);
        continue;
      }

      const normalised = norm(rawAuthor);
      const aliased = AUTHOR_ALIASES[normalised] ?? normalised;
      const user = (await ensureLocalUser(rawAuthor, aliased));

      if (!user) {
        unmatched.push({ slug, rawAuthor });
        continue;
      }

      if (sop.author_id === user.id) {
        unchanged++;
        matchCounts[user.name] = (matchCounts[user.name] ?? 0) + 1;
        continue;
      }

      await client.query(
        `UPDATE standards_sops SET author_id = $1, updated_at = NOW() WHERE id = $2`,
        [user.id, sop.id],
      );
      assigned++;
      matchCounts[user.name] = (matchCounts[user.name] ?? 0) + 1;
    }
  } finally {
    await client.end();
    if (liveClient) await liveClient.end();
  }

  console.log(`Assigned ${assigned} SOP(s) to a user. Unchanged (already correct): ${unchanged}.`);
  if (Object.keys(matchCounts).length > 0) {
    console.log("\nDistribution:");
    for (const name of Object.keys(matchCounts).sort()) {
      console.log(`  ${matchCounts[name].toString().padStart(4)} → ${name}`);
    }
  }
  if (unmatched.length > 0) {
    console.warn(`\n${unmatched.length} SOP(s) with an author that doesn't match any app_user:`);
    const seen = new Map<string, number>();
    for (const u of unmatched) seen.set(u.rawAuthor, (seen.get(u.rawAuthor) ?? 0) + 1);
    for (const [name, count] of Array.from(seen.entries()).sort((a, b) => b[1] - a[1])) {
      console.warn(`  ${count.toString().padStart(2)} × "${name}"`);
    }
    console.warn(`\nAdd these to app_users (or to AUTHOR_ALIASES if it's a name variant) and re-run.`);
  }
  if (noAuthorInPdf.length > 0) {
    console.warn(`\n${noAuthorInPdf.length} PDF(s) had no Author: line:`);
    for (const s of noAuthorInPdf) console.warn(`  - ${s}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
