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

// ── Test-mode email plumbing ───────────────────────────────────────────────
// Everything below targets the dedicated test list ONLY. There is no
// live-audience path in this module on purpose: going live is a separate,
// deliberate build after Graeme signs off the test flow.

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
  listId: string;
  subject: string;
  previewText: string;
  fromEmail: string;
  fromLabel: string;
  /** null = send immediately when the send job fires; ISO = scheduled. */
  sendAt: string | null;
}

export async function createCampaignForList(apiKey: string, input: CampaignInput): Promise<{ campaignId: string; messageId: string }> {
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
          audiences: { included: [input.listId], excluded: [] },
          send_strategy: sendStrategy,
          // Smart sending would suppress repeat sends to the same profile —
          // exactly wrong for a test list that gets mailed over and over.
          send_options: { use_smart_sending: false },
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
