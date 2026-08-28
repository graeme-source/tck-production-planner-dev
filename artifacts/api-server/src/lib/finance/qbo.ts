import { createHash, randomBytes } from "crypto";
import { db, finLinesTable, finQboConnectionTable, finQboTxnsTable } from "@workspace/db";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { sealSecret, openSecret } from "./secret-box";
import { merchantsLooselyMatch } from "./merchant-normalise";

// Read-only QuickBooks Online connection (docs/vat-reconciliation/PLAN.md,
// revived 2026-08-28 by Graeme: "rule out transactions we already have
// posted"). Scope: com.intuit.quickbooks.accounting; the app only ever
// queries Purchase + Bill — it never writes to QuickBooks.
//
// Token facts (verified Aug 2026): access tokens live 1 hour; refresh
// tokens live 100 days BUT rotate on refresh — the new pair must be
// persisted before first use, and refreshes are serialised behind a
// Postgres advisory lock because Railway can overlap instances during a
// deploy. minorversion=75 pinned (1–74 retired Aug 2025).

const AUTH_BASE = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const API_BASE = "https://quickbooks.api.intuit.com";
const ADVISORY_LOCK_KEY = 0x51b0f19a; // arbitrary app-unique constant

export function qboConfigured(): boolean {
  return Boolean(process.env["QBO_CLIENT_ID"] && process.env["QBO_CLIENT_SECRET"]);
}

function clientCreds(): { id: string; secret: string } {
  const id = process.env["QBO_CLIENT_ID"];
  const secret = process.env["QBO_CLIENT_SECRET"];
  if (!id || !secret) throw new Error("QBO_CLIENT_ID / QBO_CLIENT_SECRET not set");
  return { id, secret };
}

export function redirectUri(): string {
  const base = (process.env["APP_URL"] || "http://localhost:3000").replace(/\/$/, "");
  return `${base}/api/finance/qbo/callback`;
}

export function authorizeUrl(state: string): string {
  const { id } = clientCreds();
  const params = new URLSearchParams({
    client_id: id,
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    redirect_uri: redirectUri(),
    state,
  });
  return `${AUTH_BASE}?${params}`;
}

export function newStateToken(): string {
  return randomBytes(16).toString("hex");
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds (access)
  x_refresh_token_expires_in: number; // seconds (refresh)
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const { id, secret } = clientCreds();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Token request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<TokenResponse>;
}

/** Persist a token pair atomically — ALWAYS before first use. */
async function persistTokens(realmId: string, t: TokenResponse): Promise<void> {
  const now = Date.now();
  const values = {
    realmId,
    accessTokenEnc: sealSecret(t.access_token),
    refreshTokenEnc: sealSecret(t.refresh_token),
    accessExpiresAt: new Date(now + t.expires_in * 1000),
    refreshExpiresAt: new Date(now + t.x_refresh_token_expires_in * 1000),
    lastError: null as string | null,
    updatedAt: new Date(),
  };
  const [existing] = await db.select({ id: finQboConnectionTable.id }).from(finQboConnectionTable).limit(1);
  if (existing) {
    await db.update(finQboConnectionTable).set(values).where(eq(finQboConnectionTable.id, existing.id));
  } else {
    await db.insert(finQboConnectionTable).values(values);
  }
}

export async function exchangeCode(code: string, realmId: string): Promise<void> {
  const t = await tokenRequest(new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
  }));
  await persistTokens(realmId, t);
}

/** Fresh access token, refreshing behind an advisory lock when stale. */
async function freshAccessToken(): Promise<{ realmId: string; accessToken: string }> {
  const [conn] = await db.select().from(finQboConnectionTable).limit(1);
  if (!conn) throw new Error("QuickBooks is not connected");
  const stillValid = conn.accessExpiresAt && conn.accessExpiresAt.getTime() - Date.now() > 5 * 60_000;
  if (stillValid) return { realmId: conn.realmId, accessToken: openSecret(conn.accessTokenEnc) };

  // Serialise the refresh: the loser of a race would persist a refresh
  // token the winner already invalidated (they rotate on every refresh).
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`);
    const [c] = await tx.select().from(finQboConnectionTable).limit(1);
    if (!c) throw new Error("QuickBooks is not connected");
    if (c.accessExpiresAt && c.accessExpiresAt.getTime() - Date.now() > 5 * 60_000) {
      return { realmId: c.realmId, accessToken: openSecret(c.accessTokenEnc) };
    }
    const t = await tokenRequest(new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: openSecret(c.refreshTokenEnc),
    }));
    const now = Date.now();
    await tx.update(finQboConnectionTable).set({
      accessTokenEnc: sealSecret(t.access_token),
      refreshTokenEnc: sealSecret(t.refresh_token),
      accessExpiresAt: new Date(now + t.expires_in * 1000),
      refreshExpiresAt: new Date(now + t.x_refresh_token_expires_in * 1000),
      lastError: null,
      updatedAt: new Date(),
    }).where(eq(finQboConnectionTable.id, c.id));
    return { realmId: c.realmId, accessToken: t.access_token };
  });
}

async function qboQuery<T>(query: string): Promise<T[]> {
  const { realmId, accessToken } = await freshAccessToken();
  const url = `${API_BASE}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=75`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`QuickBooks query failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = await res.json() as { QueryResponse?: Record<string, T[]> };
  const qr = json.QueryResponse ?? {};
  const key = Object.keys(qr).find(k => Array.isArray((qr as Record<string, unknown>)[k]));
  return key ? qr[key] : [];
}

interface QboTxn {
  Id: string;
  TxnDate?: string;
  TotalAmt?: number;
  DocNumber?: string;
  EntityRef?: { name?: string };
  VendorRef?: { name?: string };
  MetaData?: { LastUpdatedTime?: string };
}

export interface QboSyncOutcome {
  purchases: number;
  bills: number;
  linesClosed: number;
  error?: string;
}

let qboSyncRunning = false;

/**
 * Pull posted Purchases + Bills updated since the cursor, mirror them, and
 * close any open card line that unambiguously matches one — the "already
 * posted, ruled out" signal.
 */
export async function runQboSync(): Promise<QboSyncOutcome> {
  if (qboSyncRunning) return { purchases: 0, bills: 0, linesClosed: 0, error: "Sync already running" };
  qboSyncRunning = true;
  try {
    return await doQboSync();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const [conn] = await db.select({ id: finQboConnectionTable.id }).from(finQboConnectionTable).limit(1);
    if (conn) await db.update(finQboConnectionTable).set({ lastError: msg, updatedAt: new Date() }).where(eq(finQboConnectionTable.id, conn.id));
    return { purchases: 0, bills: 0, linesClosed: 0, error: msg };
  } finally {
    qboSyncRunning = false;
  }
}

async function doQboSync(): Promise<QboSyncOutcome> {
  const [conn] = await db.select().from(finQboConnectionTable).limit(1);
  if (!conn) return { purchases: 0, bills: 0, linesClosed: 0, error: "QuickBooks is not connected" };

  // Cursor with a 2-day overlap: LastUpdatedTime comparisons are safe to
  // repeat (upserts), missing an update is not.
  const sinceIso = conn.syncCursor
    ? new Date(conn.syncCursor.getTime() - 2 * 86_400_000).toISOString()
    : "2026-06-01T00:00:00Z";
  const syncStartedAt = new Date();

  let purchases = 0;
  let bills = 0;
  for (const entity of ["Purchase", "Bill"] as const) {
    let startPos = 1;
    for (;;) {
      const batch = await qboQuery<QboTxn>(
        `SELECT * FROM ${entity} WHERE MetaData.LastUpdatedTime > '${sinceIso}' ORDERBY MetaData.LastUpdatedTime STARTPOSITION ${startPos} MAXRESULTS 200`
      );
      for (const t of batch) {
        const vendorName = t.EntityRef?.name ?? t.VendorRef?.name ?? null;
        await db.execute(sql`
          INSERT INTO fin_qbo_txns (qbo_id, entity_type, txn_date, total_amt, vendor_name, doc_number, synced_at)
          VALUES (${t.Id}, ${entity}, ${t.TxnDate ?? null}, ${t.TotalAmt ?? null}, ${vendorName}, ${t.DocNumber ?? null}, NOW())
          ON CONFLICT (entity_type, qbo_id) DO UPDATE
            SET txn_date = EXCLUDED.txn_date, total_amt = EXCLUDED.total_amt,
                vendor_name = EXCLUDED.vendor_name, doc_number = EXCLUDED.doc_number,
                synced_at = NOW()
        `);
        if (entity === "Purchase") purchases++; else bills++;
      }
      if (batch.length < 200) break;
      startPos += 200;
    }
  }

  const linesClosed = await closePostedLines();

  await db.update(finQboConnectionTable).set({
    syncCursor: syncStartedAt,
    lastSyncAt: new Date(),
    lastError: null,
    updatedAt: new Date(),
  }).where(eq(finQboConnectionTable.id, conn.id));

  return { purchases, bills, linesClosed };
}

/**
 * Match open card lines to mirrored posted transactions. Deliberately
 * conservative: exact amount (to the penny), transaction date within 3
 * days, and — when both sides have a usable name — a loose merchant match.
 * A line with MORE than one candidate stays open (wrongly closing a line
 * whose invoice is missing is the exact failure this app exists to stop).
 */
export async function closePostedLines(): Promise<number> {
  const openLines = await db
    .select()
    .from(finLinesTable)
    .where(inArray(finLinesTable.status, ["open", "identified", "matched"]));
  if (openLines.length === 0) return 0;

  let closed = 0;
  for (const line of openLines) {
    const anchor = line.authDate ?? line.lineDate;
    const from = new Date(`${anchor}T00:00:00Z`); from.setUTCDate(from.getUTCDate() - 3);
    const to = new Date(`${line.lineDate}T00:00:00Z`); to.setUTCDate(to.getUTCDate() + 4);
    const candidates = await db
      .select()
      .from(finQboTxnsTable)
      .where(and(
        eq(finQboTxnsTable.totalAmt, line.amount),
        gte(finQboTxnsTable.txnDate, from.toISOString().slice(0, 10)),
        lte(finQboTxnsTable.txnDate, to.toISOString().slice(0, 10)),
      ));
    const nameFiltered = candidates.filter(c =>
      !c.vendorName || merchantsLooselyMatch(line.merchant ?? line.descriptor, c.vendorName)
        // Bank descriptors and QBO vendor names diverge wildly; when the
        // name check fails but there is exactly one amount+date candidate,
        // amount+date alone decides below.
    );
    const pool = nameFiltered.length > 0 ? nameFiltered : candidates;
    if (pool.length !== 1) continue;

    const match = pool[0];
    await db.update(finLinesTable).set({
      status: "done",
      statusNote: `Posted in QuickBooks (${match.entityType}${match.docNumber ? ` ${match.docNumber}` : ""}${match.vendorName ? ` — ${match.vendorName}` : ""})`,
      qboTxnId: match.id,
      postedDetectedAt: new Date(),
      doneAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(finLinesTable.id, line.id));
    closed++;
  }
  return closed;
}

/** Non-secret status for the admin panel. */
export async function qboStatus() {
  const [conn] = await db
    .select({
      realmId: finQboConnectionTable.realmId,
      lastSyncAt: finQboConnectionTable.lastSyncAt,
      lastError: finQboConnectionTable.lastError,
      refreshExpiresAt: finQboConnectionTable.refreshExpiresAt,
    })
    .from(finQboConnectionTable)
    .limit(1);
  const [{ count } = { count: 0 }] = ((await db.execute(sql`SELECT count(*)::int AS count FROM fin_qbo_txns`)) as any).rows ?? [];
  return { configured: qboConfigured(), connected: Boolean(conn), ...conn, mirroredTxns: count };
}

export function stateHash(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}
