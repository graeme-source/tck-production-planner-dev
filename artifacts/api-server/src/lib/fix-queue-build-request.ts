/**
 * "Build approved fixes now" — the stored request (app_settings) and the
 * Fix queue's numbers beside it. Rules: fix-queue-build-request-rules.ts.
 */
import { db, appSettingsTable, issueTriageTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { BUILD_REQUEST_SETTING_KEY, buildRequestStatus, parseBuildRequest, type BuildRequest } from "./fix-queue-build-request-rules";

export async function readBuildRequest(): Promise<BuildRequest | null> {
  const [row] = await db.select({ value: appSettingsTable.value }).from(appSettingsTable).where(eq(appSettingsTable.key, BUILD_REQUEST_SETTING_KEY));
  return parseBuildRequest(row?.value);
}

export async function writeBuildRequest(r: BuildRequest): Promise<void> {
  const value = JSON.stringify(r);
  await db.insert(appSettingsTable).values({ key: BUILD_REQUEST_SETTING_KEY, value })
    .onConflictDoUpdate({ target: appSettingsTable.key, set: { value, updatedAt: new Date() } });
}

/** What the button shows: the request, plus how many approved cards wait to be built. */
export async function buildRequestView() {
  const r = await readBuildRequest();
  const [counts] = await db.select({
    approved: sql<number>`count(*) filter (where ${issueTriageTable.status} = 'approved')::int`,
    building: sql<number>`count(*) filter (where ${issueTriageTable.status} = 'in_progress')::int`,
  }).from(issueTriageTable);
  return { status: buildRequestStatus(r), request: r, approvedWaiting: counts?.approved ?? 0, inProgress: counts?.building ?? 0 };
}
