/**
 * Seed the documents repository with the 7 starter PDFs:
 *   - 3 risk assessments (FRA, HACCP, HSRA) — TCK-branded, just rebuilt
 *   - 4 insurance documents (EL Cert, Policy Schedule, Policy Wording, Statement of Fact)
 *
 * Idempotent — runs `INSERT ... ON CONFLICT (title) DO UPDATE` so re-running
 * picks up new files / metadata without duplicating rows.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... pnpm --filter @workspace/scripts tsx ./src/seed-documents.ts
 */

import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();

interface DocSeed {
  title: string;
  assessmentType:
    | "fire"
    | "food_safety"
    | "general_safety"
    | "insurance"
    | "certification"
    | "licence"
    | "sop"
    | "other";
  reviewFrequencyMonths: number;
  originalIssueDate: string; // YYYY-MM-DD
  fileVersion: string;
  /** Path to the canonical PDF on disk. */
  filePath: string;
  /** Filename to store with the upload. */
  fileName: string;
  /**
   * If true, this is a reviewed-this-cycle document — set lastReviewedAt to
   * the supplied review date and bump nextReviewDue accordingly.
   */
  reviewedDate?: string; // YYYY-MM-DD
  reviewerName?: string;
  bodyMarkdown?: string;
}

const RA_DIR = path.join(
  HOME,
  "Library/CloudStorage/GoogleDrive-graeme@thecalzonekitchen.co.uk",
  "My Drive/Events/Docs/Application Docs/2026-2027/Risk Assessments/TCK Gazebo",
);
const INSURANCE_DIR = path.join(
  HOME,
  "Library/CloudStorage/GoogleDrive-graeme@thecalzonekitchen.co.uk",
  "My Drive/Events/Docs/Application Docs/2026-2027/Insurance",
);

const SEEDS: DocSeed[] = [
  {
    title: "Fire Safety Risk Assessment — TCK Gazebo",
    assessmentType: "fire",
    reviewFrequencyMonths: 12,
    originalIssueDate: "2020-11-20",
    fileVersion: "2.0",
    filePath: path.join(RA_DIR, "TCK Fire Safety Risk Assessment 2026-2027.pdf"),
    fileName: "TCK Fire Safety Risk Assessment.pdf",
    reviewedDate: "2026-03-15",
    reviewerName: "Graeme Carter, Director",
    bodyMarkdown:
      "Fire Safety Risk Assessment for the TCK gazebo unit deployed at off-site events. Covers generators, heating, electrical, LPG, gas appliances, combustibles, firefighting equipment, smoking, motorised catering vehicles, tents/marquees, charcoal/wood-fired ovens, all-electric carts and delivery vehicles. Reviewed 15/Mar/2026 — no changes to processes.",
  },
  {
    title: "Food Safety Risk Assessment (HACCP) — TCK Gazebo",
    assessmentType: "food_safety",
    reviewFrequencyMonths: 12,
    originalIssueDate: "2020-11-20",
    fileVersion: "2.0",
    filePath: path.join(RA_DIR, "TCK Food Safety Risk Assessment HACCP 2026-2027.pdf"),
    fileName: "TCK Food Safety Risk Assessment (HACCP).pdf",
    reviewedDate: "2026-03-15",
    reviewerName: "Graeme Carter, Director",
    bodyMarkdown:
      "Food Safety Hazard Analysis based on HACCP principles. Covers Collection from Suppliers → Storage → Defrosting → Transport → Preparation → Cooking → Cooling → Hot Holding → Ambient Display → Reheating → Labelling → Serving. Critical Control Points highlighted. Reviewed 15/Mar/2026 — no changes to processes.",
  },
  {
    title: "Health and Safety Risk Assessment — TCK Gazebo",
    assessmentType: "general_safety",
    reviewFrequencyMonths: 12,
    originalIssueDate: "2020-11-20",
    fileVersion: "2.0",
    filePath: path.join(RA_DIR, "TCK Health and Safety Risk Assessment 2026-2027.pdf"),
    fileName: "TCK Health and Safety Risk Assessment.pdf",
    reviewedDate: "2026-03-15",
    reviewerName: "Graeme Carter, Director",
    bodyMarkdown:
      "Health and Safety Risk Assessment for off-site events: setup, service, breakdown and transport. Covers manual handling, slips/trips/falls, cuts, burns, electrocution, fire, chemicals, coffee machines, generators, LPG, asphyxiation, falls from height, cash handling, marquees, towing trailers, driving and wood/charcoal equipment. Reviewed 15/Mar/2026 — no changes to processes.",
  },
  {
    title: "Employers' Liability Certificate 2026-27",
    assessmentType: "insurance",
    reviewFrequencyMonths: 12,
    originalIssueDate: "2026-02-15",
    fileVersion: "D00051221TA26 01",
    filePath: path.join(INSURANCE_DIR, "TCK Employers Liability Certificate 2026-2027.pdf"),
    fileName: "TCK Employers Liability Certificate 2026-2027.pdf",
    bodyMarkdown:
      "Employers' Liability Certificate, China Taiping Insurance (UK) Co Ltd, policy D00051221TA26 01. Period 15/02/2026 → 14/02/2027. Limit £10,000,000. Renew before 14/02/2027.",
  },
  {
    title: "Insurance Policy Schedule 2026-27",
    assessmentType: "insurance",
    reviewFrequencyMonths: 12,
    originalIssueDate: "2026-02-15",
    fileVersion: "D00051221TA26 01",
    filePath: path.join(INSURANCE_DIR, "TCK Insurance Policy Schedule 2026-2027.pdf"),
    fileName: "TCK Insurance Policy Schedule 2026-2027.pdf",
    bodyMarkdown:
      "Full Policy Schedule, China Taiping Insurance (UK) Co Ltd. Period 15/02/2026 → 14/02/2027. Includes EL £10m, PL/Products £5m, Contents, Business Interruption, Money, Goods in Transit, Stock Deterioration, Legal Expenses, Loss of Liquor Licence, Equipment Breakdown. Renew before 14/02/2027.",
  },
  {
    title: "Insurance Policy Schedule (Redacted for Venues) 2026-27",
    assessmentType: "insurance",
    reviewFrequencyMonths: 12,
    originalIssueDate: "2026-02-15",
    fileVersion: "D00051221TA26 01",
    filePath: path.join(INSURANCE_DIR, "TCK Insurance Policy Schedule REDACTED FOR VENUE 2026-2027.pdf"),
    fileName: "TCK Insurance Policy Schedule (Redacted) 2026-2027.pdf",
    bodyMarkdown:
      "Redacted version of the Policy Schedule for sharing with venues. Premium and sums insured (Contents, BI, Money, Stock Deterioration, Legal Expenses, Loss of Liquor Licence, Equipment Breakdown, All Risks) blacked out; Employers' Liability £10m and Public/Products Liability £5m limits retained.",
  },
  {
    title: "Insurance Policy Wording 2026-27",
    assessmentType: "insurance",
    reviewFrequencyMonths: 12,
    originalIssueDate: "2026-02-15",
    fileVersion: "D00051221TA26 01",
    filePath: path.join(INSURANCE_DIR, "TCK Insurance Policy Wording 2026-2027.pdf"),
    fileName: "TCK Insurance Policy Wording 2026-2027.pdf",
    bodyMarkdown:
      "Full Policy Wording, China Taiping Retail Catering Insurance, applicable for the period 15/02/2026 → 14/02/2027. Read in conjunction with the Policy Schedule.",
  },
  {
    title: "Insurance Statement of Fact 2026-27",
    assessmentType: "insurance",
    reviewFrequencyMonths: 12,
    originalIssueDate: "2026-02-15",
    fileVersion: "D00051221TA26 01",
    filePath: path.join(INSURANCE_DIR, "TCK Insurance Statement of Fact 2026-2027.pdf"),
    fileName: "TCK Insurance Statement of Fact 2026-2027.pdf",
    bodyMarkdown:
      "Statement of Fact submitted at renewal — the disclosed information that underwrites this policy. Review at renewal each year before 14/02/2027.",
  },
];

function addMonthsIso(iso: string, months: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  try {
    for (const seed of SEEDS) {
      if (!fs.existsSync(seed.filePath)) {
        console.warn(`SKIP — missing file: ${seed.filePath}`);
        skipped++;
        continue;
      }
      const stat = fs.statSync(seed.filePath);
      const buf = fs.readFileSync(seed.filePath);

      // Use title as a soft idempotency key. There's no UNIQUE constraint on
      // title, so we look up by title first, then either UPDATE or INSERT.
      const existing = await client.query<{ id: number }>(
        `SELECT id FROM risk_assessments WHERE title = $1 LIMIT 1`,
        [seed.title],
      );

      const reviewedAt = seed.reviewedDate ? new Date(seed.reviewedDate + "T12:00:00Z") : null;
      const nextDue = seed.reviewedDate
        ? addMonthsIso(seed.reviewedDate, seed.reviewFrequencyMonths)
        : addMonthsIso(seed.originalIssueDate, seed.reviewFrequencyMonths);

      if (existing.rowCount && existing.rows[0]) {
        const id = existing.rows[0].id;
        await client.query(
          `UPDATE risk_assessments SET
              assessment_type = $2,
              status = 'active',
              body_markdown = COALESCE($3, body_markdown),
              review_frequency_months = $4,
              original_issue_date = $5,
              file_version = $6,
              file_blob = $7,
              file_mime = 'application/pdf',
              file_name = $8,
              file_size_bytes = $9,
              file_uploaded_at = NOW(),
              last_reviewed_at = COALESCE($10, last_reviewed_at),
              last_reviewed_by_name = COALESCE($11, last_reviewed_by_name),
              next_review_due = $12,
              updated_at = NOW()
            WHERE id = $1`,
          [
            id,
            seed.assessmentType,
            seed.bodyMarkdown ?? null,
            seed.reviewFrequencyMonths,
            seed.originalIssueDate,
            seed.fileVersion,
            buf,
            seed.fileName,
            stat.size,
            reviewedAt,
            seed.reviewerName ?? null,
            nextDue,
          ],
        );
        console.log(`UPDATED  #${id}  ${seed.title}  (${(stat.size / 1024).toFixed(0)}KB)`);
        updated++;
      } else {
        const result = await client.query<{ id: number }>(
          `INSERT INTO risk_assessments (
              assessment_type, title, body_markdown, status,
              review_frequency_months, original_issue_date, file_version,
              file_blob, file_mime, file_name, file_size_bytes, file_uploaded_at,
              last_reviewed_at, last_reviewed_by_name, next_review_due
            ) VALUES (
              $1, $2, $3, 'active',
              $4, $5, $6,
              $7, 'application/pdf', $8, $9, NOW(),
              $10, $11, $12
            ) RETURNING id`,
          [
            seed.assessmentType,
            seed.title,
            seed.bodyMarkdown ?? "",
            seed.reviewFrequencyMonths,
            seed.originalIssueDate,
            seed.fileVersion,
            buf,
            seed.fileName,
            stat.size,
            reviewedAt,
            seed.reviewerName ?? null,
            nextDue,
          ],
        );
        const newId = result.rows[0]?.id;
        console.log(`INSERTED #${newId}  ${seed.title}  (${(stat.size / 1024).toFixed(0)}KB)`);
        inserted++;
      }
    }
  } finally {
    await client.end();
  }

  console.log(`\nDone — inserted ${inserted}, updated ${updated}, skipped ${skipped}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
