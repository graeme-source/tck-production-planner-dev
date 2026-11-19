// Applies statusForDocuments (line-documents.ts, pure) to a transaction in
// the database after a document is added, attached or relabelled.
import { and, eq, isNull } from "drizzle-orm";
import { db, finDocumentsTable, finLinesTable } from "@workspace/db";
import { statusForDocuments } from "./line-documents";

/** Re-place a transaction after its documents changed. Returns the new status
 *  when it moved, else null. */
export async function placeLineByDocuments(lineId: number): Promise<string | null> {
  const [line] = await db.select({ status: finLinesTable.status }).from(finLinesTable).where(eq(finLinesTable.id, lineId));
  if (!line) return null;
  const docs = await db.select({ docKind: finDocumentsTable.docKind }).from(finDocumentsTable)
    .where(and(eq(finDocumentsTable.lineId, lineId), isNull(finDocumentsTable.supersededBy)));
  const next = statusForDocuments(line.status, docs.map((d) => d.docKind));
  if (!next) return null;
  await db.update(finLinesTable).set({ status: next, updatedAt: new Date() })
    .where(and(eq(finLinesTable.id, lineId), eq(finLinesTable.status, line.status)));
  return next;
}
