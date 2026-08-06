/**
 * Klaviyo API access for the surveys feature (email invites to recent
 * buyers). Deliberately SEPARATE from the Founder Sales key: that one is
 * read-only by design ("TCK planner"), this one ("TCK Planner 2") carries
 * list/profile/campaign/template write scopes. Both live in founder_settings
 * under different keys, pasted via their own connect cards — never env vars,
 * never chat.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export const SURVEYS_KLAVIYO_SETTING = "klaviyo_surveys_api_key";
export const KLAVIYO_REVISION = "2024-10-15";

export async function klaviyoFetch<T>(
  apiKey: string,
  path: string,
  init?: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown },
): Promise<T> {
  const res = await fetch(`https://a.klaviyo.com${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      revision: KLAVIYO_REVISION,
      Accept: "application/vnd.api+json",
      ...(init?.body !== undefined ? { "Content-Type": "application/vnd.api+json" } : {}),
    },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Klaviyo ${res.status}: ${text.slice(0, 300)}`);
  }
  // 204 No Content on some deletes.
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function getSurveysKlaviyoKey(): Promise<string | null> {
  const rows = await db.execute<{ value: string }>(
    sql`SELECT value FROM founder_settings WHERE key = ${SURVEYS_KLAVIYO_SETTING} LIMIT 1`,
  );
  return rows.rows[0]?.value ?? null;
}

export async function setSurveysKlaviyoKey(apiKey: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO founder_settings (key, value, updated_at)
    VALUES (${SURVEYS_KLAVIYO_SETTING}, ${apiKey}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = ${apiKey}, updated_at = NOW()
  `);
}

export async function deleteSurveysKlaviyoKey(): Promise<void> {
  await db.execute(sql`DELETE FROM founder_settings WHERE key = ${SURVEYS_KLAVIYO_SETTING}`);
}

/**
 * Validate a key for the connect card. Probes the LISTS endpoint — one of
 * the four scopes the surveys key actually carries. (An earlier version
 * probed /api/accounts, which needs accounts:read — a scope the key was
 * never asked to have, so valid keys bounced with 403.) Account name is
 * best-effort on top: nice in the toast, never required.
 */
export async function validateSurveysKlaviyoKey(apiKey: string): Promise<{ accountName: string | null }> {
  await klaviyoFetch(apiKey, "/api/lists?page[size]=1");
  try {
    const data = await klaviyoFetch<{ data: Array<{ attributes?: { contact_information?: { organization_name?: string } } }> }>(
      apiKey, "/api/accounts",
    );
    return { accountName: data.data?.[0]?.attributes?.contact_information?.organization_name ?? null };
  } catch {
    return { accountName: null };
  }
}
