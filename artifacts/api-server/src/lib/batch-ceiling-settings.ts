// Reads the settings the batch-ceiling rule needs (#305). The rule itself is
// pure and tested in ./batch-ceiling.ts; this is only the database read.
import { db, appSettingsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { batchCeilings, type BatchCeilings } from "./batch-ceiling";

const KEYS = ["total_daily_batches", "capacity_batches_without_dough_prep", "capacity_batches_with_dough_prep"];

export async function loadBatchCeilings(): Promise<BatchCeilings> {
  const rows = await db.select({ key: appSettingsTable.key, value: appSettingsTable.value })
    .from(appSettingsTable).where(inArray(appSettingsTable.key, KEYS));
  const num = (key: string) => Number(rows.find(r => r.key === key)?.value ?? NaN);
  return batchCeilings({
    dptDailyBatches: num("total_daily_batches"),
    withoutDoughPrep: num("capacity_batches_without_dough_prep"),
    legacyWithDoughPrep: num("capacity_batches_with_dough_prep"),
  });
}
