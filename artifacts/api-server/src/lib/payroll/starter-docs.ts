/**
 * Load a joiner's payroll paperwork (rules: starter-docs-rules.ts) as file
 * attachments for the payroll report.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { ensureStarterFormPdf } from "../starter-form-pdf";
import { isPayrollStarterForm, isPayrollUpload, starterDocFileName, starterDocTitle } from "./starter-docs-rules";

export interface StarterAttachment { userId: number; title: string; filename: string; content: Buffer; contentType: string }

export async function loadStarterDocs(people: ReadonlyArray<{ userId: number; name: string }>): Promise<StarterAttachment[]> {
  const ids = people.map(p => p.userId);
  if (!ids.length) return [];
  const nameOf = new Map(people.map(p => [p.userId, p.name]));
  const idList = sql.raw(ids.map(Number).filter(Number.isInteger).join(","));
  const out: StarterAttachment[] = [];

  const forms = await db.execute<{ id: number; user_id: number; form_type: string; body: string | null; signed_pdf: Buffer | null }>(sql`
    SELECT id, user_id, form_type, body, signed_pdf FROM starter_form_submissions
     WHERE user_id IN (${idList}) AND signed_at IS NOT NULL
  `);
  for (const f of forms.rows) {
    if (!isPayrollStarterForm(f.form_type) || !f.body) continue;
    const pdf = await ensureStarterFormPdf({ id: Number(f.id), body: f.body, signedPdf: f.signed_pdf });
    const name = nameOf.get(Number(f.user_id)) ?? "Starter";
    out.push({ userId: Number(f.user_id), title: starterDocTitle(f.form_type), filename: starterDocFileName(name, f.form_type), content: pdf, contentType: "application/pdf" });
  }

  const uploads = await db.execute<{ user_id: number; kind: string; file_blob: Buffer; file_mime: string; file_name: string | null }>(sql`
    SELECT user_id, kind, file_blob, file_mime, file_name FROM onboarding_documents WHERE user_id IN (${idList})
  `);
  for (const u of uploads.rows) {
    if (!isPayrollUpload(u.kind) || !u.file_blob) continue;
    const name = nameOf.get(Number(u.user_id)) ?? "Starter";
    const ext = (u.file_name?.split(".").pop() || (u.file_mime.includes("pdf") ? "pdf" : "jpg")).toLowerCase();
    out.push({ userId: Number(u.user_id), title: starterDocTitle(u.kind.toLowerCase()), filename: starterDocFileName(name, u.kind.toLowerCase(), ext), content: u.file_blob, contentType: u.file_mime });
  }
  return out;
}
