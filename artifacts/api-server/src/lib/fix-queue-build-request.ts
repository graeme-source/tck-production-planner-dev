/**
 * "Build approved fixes now" — the stored request (app_settings) and the
 * Fix queue's numbers beside it. Rules: fix-queue-build-request-rules.ts.
 */
import { db, appSettingsTable, issueTriageTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { BUILD_REQUEST_SETTING_KEY, approvedBlocker, buildRequestStatus, hasCodeToWrite, parseBuildRequest, type BuildRequest } from "./fix-queue-build-request-rules";

export async function readBuildRequest(): Promise<BuildRequest | null> {
  const [row] = await db.select({ value: appSettingsTable.value }).from(appSettingsTable).where(eq(appSettingsTable.key, BUILD_REQUEST_SETTING_KEY));
  return parseBuildRequest(row?.value);
}

export async function writeBuildRequest(r: BuildRequest): Promise<void> {
  const value = JSON.stringify(r);
  await db.insert(appSettingsTable).values({ key: BUILD_REQUEST_SETTING_KEY, value })
    .onConflictDoUpdate({ target: appSettingsTable.key, set: { value, updatedAt: new Date() } });
}

/** What the button shows: the request, how many approved cards have code to
 *  build, and the approved ones that are waiting on something else. */
export async function buildRequestView() {
  const r = await readBuildRequest();
  const rows = await db.select({
    issueId: issueTriageTable.andonIssueId,
    lane: issueTriageTable.lane,
    status: issueTriageTable.status,
    summary: issueTriageTable.verdictSummary,
  }).from(issueTriageTable).where(inArray(issueTriageTable.status, ["approved", "in_progress"]));
  const approved = rows.filter(row => row.status === "approved");
  return {
    status: buildRequestStatus(r),
    request: r,
    approvedWaiting: approved.filter(row => hasCodeToWrite(row.lane)).length,
    approvedNotCode: approved
      .filter(row => !hasCodeToWrite(row.lane))
      .map(row => ({ issueId: row.issueId, waitingFor: approvedBlocker(row.lane), summary: row.summary }))
      .sort((a, b) => a.issueId - b.issueId),
    inProgress: rows.filter(row => row.status === "in_progress").length,
  };
}
