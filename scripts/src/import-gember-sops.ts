/**
 * Import the Gember-exported SOPs in attached_assets/sop-archive/ into the
 * standards_sops + sop_steps tables.
 *
 * Each folder under sop-archive/ contains:
 *   - source.pdf             — the original Gember PDF
 *   - page-N.png             — rendered page images (not used)
 *   - photo-N.jpg            — extracted step photos, numbered in PDF order
 *
 * We parse source.pdf with `pdftotext` (must be installed; comes with poppler)
 * to extract the SOP title and the list of numbered steps + their description
 * text. We then attach photo-1.jpg to the first step, photo-2.jpg to the
 * second, and so on — best-effort positional match. Steps without a matching
 * photo are imported as text-only; photos beyond the step count are appended
 * to the last step or as image-only trailing steps.
 *
 * Idempotent on the `ref:<slug>` tag — re-running updates rather than
 * duplicates. Imported SOPs are tagged `imported:gembadocs` so the existing
 * scripts/push-sops-to-live.py picks them up.
 *
 * Usage:
 *   DATABASE_URL=postgresql://localhost/tck_planner \
 *     pnpm --filter @workspace/scripts tsx ./src/import-gember-sops.ts
 *
 *   DATABASE_URL=... pnpm --filter @workspace/scripts tsx \
 *     ./src/import-gember-sops.ts standard-dough-november-25
 *   (optional folder slug arg → import just that one)
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ARCHIVE_DIR = path.resolve(process.cwd(), "../attached_assets/sop-archive");

interface ParsedSop {
  title: string;
  steps: { description: string }[];
}

function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .map(w => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// Lines that are footer/header chrome — never part of a step description.
const NOISE_PATTERNS = [
  /^Scan To Edit$/i,
  /^Process Ref\./i,
  /^Revision[:\.]/i,
  /^Revision date[:\.]/i,
  /^Date[:\.]/i,
  /^Page \d+ of \d+$/i,
  /^Cycle Time[:\.]/i,
  /^Author[:\.]/i,
  /^Video$/i,
];

function isNoise(line: string): boolean {
  return NOISE_PATTERNS.some(p => p.test(line.trim()));
}

function parsePdf(pdfPath: string, slug: string): ParsedSop {
  const raw = execFileSync("pdftotext", [pdfPath, "-"], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });

  // Strip noise lines.
  const lines = raw.split("\n").map(l => l.replace(/\s+$/, ""));
  const clean: string[] = [];
  for (const line of lines) {
    if (isNoise(line)) continue;
    clean.push(line);
  }

  // Find the title: first non-empty line.
  let title = humanizeSlug(slug);
  for (const line of clean) {
    const t = line.trim();
    if (t && !/^\d+$/.test(t)) {
      title = t;
      break;
    }
  }

  // Drop everything up to (and including) the title line.
  const titleIdx = clean.findIndex(l => l.trim() === title);
  const body = titleIdx >= 0 ? clean.slice(titleIdx + 1) : clean;

  // Walk lines, building paragraph chunks separated by blank lines or lone numbers.
  // Each "number" line starts a new step slot; the next non-empty paragraph
  // is that step's description. Steps come out in PDF order.
  type Slot = { number: number; description: string };
  const slots: Slot[] = [];
  let pendingNumbers: number[] = [];
  let buf: string[] = [];

  const flushPara = () => {
    if (buf.length === 0) return;
    const text = buf.join(" ").replace(/\s+/g, " ").trim();
    buf = [];
    if (!text) return;
    // Pop the oldest pending number; if none, append to last slot.
    if (pendingNumbers.length > 0) {
      const n = pendingNumbers.shift()!;
      slots.push({ number: n, description: text });
    } else if (slots.length > 0) {
      slots[slots.length - 1].description += " " + text;
    }
  };

  for (const line of body) {
    const t = line.trim();
    if (!t) {
      flushPara();
      continue;
    }
    if (/^\d{1,2}$/.test(t)) {
      // It's a step number.
      flushPara();
      pendingNumbers.push(Number(t));
      continue;
    }
    buf.push(t);
  }
  flushPara();

  // Sort by step number — PDF order can interleave columns.
  slots.sort((a, b) => a.number - b.number);

  // De-dup by number (keep first description).
  const byNumber = new Map<number, string>();
  for (const s of slots) {
    if (!byNumber.has(s.number)) byNumber.set(s.number, s.description);
  }

  // Build dense steps list. Use the highest seen number as the count, filling
  // gaps with empty descriptions so photo positions still align.
  const maxN = slots.length > 0 ? Math.max(...slots.map(s => s.number)) : 0;
  const steps: { description: string }[] = [];
  for (let i = 1; i <= maxN; i++) {
    steps.push({ description: byNumber.get(i) ?? "" });
  }

  return { title, steps };
}

interface FolderImport {
  slug: string;
  folder: string;
  pdfPath: string;
  photoPaths: string[];
}

function collectFolders(filter: string | null): FolderImport[] {
  const entries = fs.readdirSync(ARCHIVE_DIR, { withFileTypes: true });
  const out: FolderImport[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (filter && e.name !== filter) continue;
    const folder = path.join(ARCHIVE_DIR, e.name);
    const pdfPath = path.join(folder, "source.pdf");
    if (!fs.existsSync(pdfPath)) continue;
    const photos = fs
      .readdirSync(folder)
      .filter(f => /^photo-\d+\.(jpe?g|png)$/i.test(f))
      .sort((a, b) => {
        const na = Number(a.match(/\d+/)![0]);
        const nb = Number(b.match(/\d+/)![0]);
        return na - nb;
      })
      .map(f => path.join(folder, f));
    out.push({ slug: e.name, folder, pdfPath, photoPaths: photos });
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

function arrayLiteral(values: string[]): string {
  if (values.length === 0) return "{}";
  const quoted = values.map(v => {
    if (/^[A-Za-z0-9_:.-]+$/.test(v)) return v;
    const esc = v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${esc}"`;
  });
  return `{${quoted.join(",")}}`;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  // Confirm pdftotext is installed.
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "pipe" });
  } catch {
    console.error("ERROR: `pdftotext` not found on PATH. Install poppler (brew install poppler) and try again.");
    process.exit(1);
  }

  if (!fs.existsSync(ARCHIVE_DIR)) {
    console.error(`ERROR: archive dir not found: ${ARCHIVE_DIR}`);
    process.exit(1);
  }

  const filter = process.argv[2] || null;
  const folders = collectFolders(filter);
  console.log(`Found ${folders.length} SOP folder(s).${filter ? ` (filter: ${filter})` : ""}\n`);

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  let inserted = 0;
  let updated = 0;
  let stepCount = 0;
  let photoCount = 0;

  try {
    for (const f of folders) {
      const ref = `ref:${f.slug}`;
      const tagsLiteral = arrayLiteral(["imported:gembadocs", ref]);

      let parsed: ParsedSop;
      try {
        parsed = parsePdf(f.pdfPath, f.slug);
      } catch (err) {
        console.warn(`  SKIP — ${f.slug}: PDF parse failed (${(err as Error).message})`);
        continue;
      }

      // Pad steps to match photo count if there are more photos than parsed steps.
      while (parsed.steps.length < f.photoPaths.length) {
        parsed.steps.push({ description: "" });
      }

      // Gember placeholders ("No Process found.") have no steps and no photos —
      // import them as a single empty step so the SOP exists for staff to fill
      // in later, rather than silently dropping it.
      if (parsed.steps.length === 0) {
        parsed.steps.push({ description: "" });
      }

      // Check if this SOP already exists (idempotent by ref tag).
      const existing = await client.query<{ id: number }>(
        `SELECT id FROM standards_sops WHERE $1 = ANY(tags) LIMIT 1`,
        [ref],
      );

      let sopId: number;
      if (existing.rowCount && existing.rows[0]) {
        sopId = existing.rows[0].id;
        await client.query(
          `UPDATE standards_sops
           SET title = $1, tags = $2::text[], updated_at = NOW()
           WHERE id = $3`,
          [parsed.title, tagsLiteral, sopId],
        );
        // Wipe existing steps to re-import cleanly.
        await client.query(`DELETE FROM sop_steps WHERE sop_id = $1`, [sopId]);
        updated++;
      } else {
        const result = await client.query<{ id: number }>(
          `INSERT INTO standards_sops (title, stations, tags, author_id)
           VALUES ($1, '{}'::text[], $2::text[], NULL)
           RETURNING id`,
          [parsed.title, tagsLiteral],
        );
        sopId = result.rows[0].id;
        inserted++;
      }

      // Insert steps.
      for (let i = 0; i < parsed.steps.length; i++) {
        const desc = parsed.steps[i].description;
        const photoPath = f.photoPaths[i] ?? null;

        let mime: string | null = null;
        let bytes: Buffer | null = null;
        if (photoPath) {
          mime = /\.png$/i.test(photoPath) ? "image/png" : "image/jpeg";
          bytes = fs.readFileSync(photoPath);
          photoCount++;
        }

        await client.query(
          `INSERT INTO sop_steps (sop_id, position, description, image_mime, image_data)
           VALUES ($1, $2, $3, $4, $5)`,
          [sopId, i, desc, mime, bytes],
        );
        stepCount++;
      }

      console.log(
        `  ${existing.rowCount ? "UPDATED" : "INSERTED"} #${sopId}  ` +
          `${parsed.title.padEnd(55).slice(0, 55)}  steps=${parsed.steps.length}  photos=${f.photoPaths.length}`,
      );
    }
  } finally {
    await client.end();
  }

  console.log(
    `\nDone — ${inserted} inserted, ${updated} updated, ${stepCount} steps total, ${photoCount} photos attached.`,
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
