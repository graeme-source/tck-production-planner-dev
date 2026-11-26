// Vendors — find-or-create by normalised merchant key (moved out of
// routes/finance.ts, 26 Nov 2026, so attaching an invoice can use it too).
import { eq } from "drizzle-orm";
import { db, finVendorsTable } from "@workspace/db";
import { normaliseMerchant } from "./merchant-normalise";

export async function findOrCreateVendor(merchantRaw: string): Promise<number | null> {
  const normalised = normaliseMerchant(merchantRaw);
  if (!normalised) return null;
  const [existing] = await db
    .select({ id: finVendorsTable.id })
    .from(finVendorsTable)
    .where(eq(finVendorsTable.normalisedName, normalised));
  if (existing) return existing.id;
  const [created] = await db
    .insert(finVendorsTable)
    .values({ name: titleCase(normalised), normalisedName: normalised })
    .onConflictDoNothing({ target: finVendorsTable.normalisedName })
    .returning({ id: finVendorsTable.id });
  if (created) return created.id;
  const [raced] = await db
    .select({ id: finVendorsTable.id })
    .from(finVendorsTable)
    .where(eq(finVendorsTable.normalisedName, normalised));
  return raced?.id ?? null;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
