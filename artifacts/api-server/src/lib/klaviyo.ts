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

// ── Email audiences ────────────────────────────────────────────────────────
// Two audiences exist: the dedicated test list (mailed over and over while a
// survey is being polished) and, per survey, a live segment of real buyers
// built by createBuyersSegment below. The live path was added 2026-08-14
// after the test flow was signed off.

export const TEST_LIST_NAME = "TCK Survey Test Recipients";

export async function getOrCreateTestList(apiKey: string): Promise<string> {
  const found = await klaviyoFetch<{ data: Array<{ id: string }> }>(
    apiKey, `/api/lists?filter=${encodeURIComponent(`equals(name,"${TEST_LIST_NAME}")`)}`,
  );
  if (found.data?.[0]?.id) return found.data[0].id;
  const created = await klaviyoFetch<{ data: { id: string } }>(apiKey, "/api/lists", {
    method: "POST",
    body: { data: { type: "list", attributes: { name: TEST_LIST_NAME } } },
  });
  return created.data.id;
}

/** Create-or-find a profile by email, returning its id. */
async function getOrCreateProfile(apiKey: string, email: string): Promise<string> {
  try {
    const created = await klaviyoFetch<{ data: { id: string } }>(apiKey, "/api/profiles", {
      method: "POST",
      body: { data: { type: "profile", attributes: { email } } },
    });
    return created.data.id;
  } catch (err) {
    // 409 duplicate_profile carries the existing id in meta.
    const msg = err instanceof Error ? err.message : "";
    const match = msg.match(/duplicate_profile_id[":\s]+"?([A-Za-z0-9_-]+)"?/);
    if (msg.includes("409") && match) return match[1];
    if (msg.includes("409")) {
      // Fall back to a lookup if the id wasn't in the error body slice.
      const found = await klaviyoFetch<{ data: Array<{ id: string }> }>(
        apiKey, `/api/profiles?filter=${encodeURIComponent(`equals(email,"${email}")`)}`,
      );
      if (found.data?.[0]?.id) return found.data[0].id;
    }
    throw err;
  }
}

export async function addTestRecipient(apiKey: string, listId: string, email: string): Promise<void> {
  const profileId = await getOrCreateProfile(apiKey, email);
  await klaviyoFetch(apiKey, `/api/lists/${listId}/relationships/profiles`, {
    method: "POST",
    body: { data: [{ type: "profile", id: profileId }] },
  });
}

export interface TestListMember { email: string; consent: string }

export async function getTestListMembers(apiKey: string, listId: string): Promise<TestListMember[]> {
  const data = await klaviyoFetch<{
    data: Array<{ attributes?: { email?: string; subscriptions?: { email?: { marketing?: { consent?: string } } } } }>;
  }>(apiKey, `/api/lists/${listId}/profiles?${new URLSearchParams({
    // Klaviyo quirk: `subscriptions` is a computed field — it must be asked
    // for via additional-fields as well as the sparse fieldset, else 400.
    "fields[profile]": "email,subscriptions",
    "additional-fields[profile]": "subscriptions",
    "page[size]": "100",
  })}`);
  return (data.data ?? []).map(p => ({
    email: p.attributes?.email ?? "(no email)",
    consent: p.attributes?.subscriptions?.email?.marketing?.consent ?? "NEVER_SUBSCRIBED",
  }));
}

export async function createEmailTemplate(apiKey: string, name: string, html: string): Promise<string> {
  const created = await klaviyoFetch<{ data: { id: string } }>(apiKey, "/api/templates", {
    method: "POST",
    body: { data: { type: "template", attributes: { name, editor_type: "CODE", html } } },
  });
  return created.data.id;
}

export interface CampaignInput {
  name: string;
  /** Klaviyo list id OR segment id — the audiences API takes either. */
  audienceId: string;
  subject: string;
  previewText: string;
  fromEmail: string;
  fromLabel: string;
  /** null = send immediately when the send job fires; ISO = scheduled. */
  sendAt: string | null;
  /**
   * Smart sending suppresses profiles emailed recently. OFF for the test
   * list (the same inbox gets mailed repeatedly on purpose); ON for live
   * sends so customers aren't stacked on top of other campaigns.
   */
  smartSending: boolean;
}

export async function createCampaignForAudience(apiKey: string, input: CampaignInput): Promise<{ campaignId: string; messageId: string }> {
  const sendStrategy = input.sendAt
    ? { method: "static", options_static: { datetime: input.sendAt } }
    : { method: "immediate" };
  const created = await klaviyoFetch<{
    data: { id: string; relationships?: { "campaign-messages"?: { data?: Array<{ id: string }> } } };
  }>(apiKey, "/api/campaigns", {
    method: "POST",
    body: {
      data: {
        type: "campaign",
        attributes: {
          name: input.name,
          audiences: { included: [input.audienceId], excluded: [] },
          send_strategy: sendStrategy,
          send_options: { use_smart_sending: input.smartSending },
          "campaign-messages": {
            data: [{
              type: "campaign-message",
              attributes: {
                channel: "email",
                label: "Survey invite",
                content: {
                  subject: input.subject,
                  preview_text: input.previewText,
                  from_email: input.fromEmail,
                  from_label: input.fromLabel,
                },
              },
            }],
          },
        },
      },
    },
  });
  const messageId = created.data.relationships?.["campaign-messages"]?.data?.[0]?.id;
  if (!messageId) throw new Error("Klaviyo campaign created but no message id returned");
  return { campaignId: created.data.id, messageId };
}

export async function assignTemplateToMessage(apiKey: string, messageId: string, templateId: string): Promise<void> {
  await klaviyoFetch(apiKey, "/api/campaign-message-assign-template", {
    method: "POST",
    body: {
      data: {
        type: "campaign-message",
        id: messageId,
        relationships: { template: { data: { type: "template", id: templateId } } },
      },
    },
  });
}

export async function createCampaignSendJob(apiKey: string, campaignId: string): Promise<void> {
  await klaviyoFetch(apiKey, "/api/campaign-send-jobs", {
    method: "POST",
    body: { data: { type: "campaign-send-job", id: campaignId } },
  });
}

// ── Live audience: buyers segment ──────────────────────────────────────────
// A survey's live audience is a Klaviyo segment: "Placed Order at least once
// in the last N days where Items contains <product>", one OR'd condition per
// product in the survey's source collection. Klaviyo matches on the product
// NAME as it appeared on the order (its Placed Order events carry names, not
// Shopify ids) — the profile-count vs order-count cross-check in the email
// dialog is what catches a renamed product drifting out of the match.
// Requires the key to carry metrics:read + segments:read/write scopes.

/**
 * Find the Shopify "Placed Order" metric id. Pages through /api/metrics
 * (the metrics endpoint has no name filter); prefers the Shopify
 * integration's metric if several integrations define one.
 */
export async function getPlacedOrderMetricId(apiKey: string): Promise<string> {
  type MetricPage = {
    data: Array<{ id: string; attributes?: { name?: string; integration?: { name?: string } } }>;
    links?: { next?: string | null };
  };
  const matches: Array<{ id: string; integration: string }> = [];
  let path: string | null = "/api/metrics";
  while (path) {
    const page: MetricPage = await klaviyoFetch<MetricPage>(apiKey, path);
    for (const m of page.data ?? []) {
      if (m.attributes?.name === "Placed Order") {
        matches.push({ id: m.id, integration: m.attributes?.integration?.name ?? "" });
      }
    }
    const next = page.links?.next;
    path = next ? next.replace(/^https:\/\/a\.klaviyo\.com/, "") : null;
  }
  const shopify = matches.find(m => m.integration.toLowerCase() === "shopify");
  const chosen = shopify ?? matches[0];
  if (!chosen) throw new Error("No 'Placed Order' metric found in Klaviyo — is the Shopify integration connected?");
  return chosen.id;
}

export interface BuyersSegmentInput {
  name: string;
  productNames: string[];
  lookbackDays: number;
}

/** Create the buyers segment and return its id. */
export async function createBuyersSegment(apiKey: string, input: BuyersSegmentInput): Promise<string> {
  const metricId = await getPlacedOrderMetricId(apiKey);
  // Condition groups AND together; conditions within a group OR together —
  // so "bought any of these products" is ONE group with a condition per
  // product (Segments API, revision 2024-10-15).
  const conditions = input.productNames.map(productName => ({
    type: "profile-metric",
    metric_id: metricId,
    measurement: "count",
    measurement_filter: { type: "numeric", operator: "greater-than-or-equal", value: 1 },
    timeframe_filter: { type: "date", operator: "in-the-last", unit: "day", quantity: input.lookbackDays },
    metric_filters: [
      { property: "Items", filter: { type: "string", operator: "contains", value: productName } },
    ],
  }));
  const created = await klaviyoFetch<{ data: { id: string } }>(apiKey, "/api/segments", {
    method: "POST",
    body: {
      data: {
        type: "segment",
        attributes: {
          name: input.name,
          is_starred: false,
          definition: { condition_groups: [{ conditions }] },
        },
      },
    },
  });
  return created.data.id;
}

export interface SegmentStatus {
  exists: boolean;
  name: string | null;
  /** Null while Klaviyo is still materialising a fresh segment. */
  profileCount: number | null;
}

export async function getSegmentStatus(apiKey: string, segmentId: string): Promise<SegmentStatus> {
  try {
    const got = await klaviyoFetch<{ data: { attributes?: { name?: string; profile_count?: number | null } } }>(
      apiKey, `/api/segments/${segmentId}?additional-fields[segment]=profile_count`,
    );
    return {
      exists: true,
      name: got.data.attributes?.name ?? null,
      profileCount: got.data.attributes?.profile_count ?? null,
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes("Klaviyo 404")) {
      return { exists: false, name: null, profileCount: null };
    }
    throw err;
  }
}

/** Best-effort delete (used when rebuilding a survey's audience). */
export async function deleteSegment(apiKey: string, segmentId: string): Promise<void> {
  try {
    await klaviyoFetch(apiKey, `/api/segments/${segmentId}`, { method: "DELETE" });
  } catch (err) {
    console.warn("[klaviyo] segment delete failed (leaving it in place):", err instanceof Error ? err.message : String(err));
  }
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
