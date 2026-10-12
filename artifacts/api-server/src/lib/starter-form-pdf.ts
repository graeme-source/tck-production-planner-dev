/**
 * The archival PDF of a signed starter form — one place, used by the
 * starter's own download (routes/starter-forms.ts) and the People record
 * (routes/person-documents.ts). Rendered at signing; if that render failed,
 * it's rebuilt from the frozen body the first time anyone opens it, and kept.
 */
import { db, starterFormSubmissionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { renderContractPdf } from "../pdf/contract-pdf";

export async function ensureStarterFormPdf(row: { id: number; body: string; signedPdf: Buffer | null }): Promise<Buffer> {
  if (row.signedPdf) return row.signedPdf;
  const pdf = await renderContractPdf(row.body);
  await db.update(starterFormSubmissionsTable).set({ signedPdf: pdf }).where(eq(starterFormSubmissionsTable.id, row.id));
  return pdf;
}
