// Web-push delivery for temperature alerts.
//
// Uses VAPID (env: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT). Each
// recipient opts in per-device from the installed PWA; subscriptions live in
// the push_subscriptions table. Dead subscriptions (410 Gone / 404) are pruned
// automatically so the list stays clean.

import webpush from "web-push";
import { db, pushSubscriptionsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

let configured = false;

function ensureConfigured(): boolean {
  if (configured) return true;
  const publicKey = process.env["VAPID_PUBLIC_KEY"];
  const privateKey = process.env["VAPID_PRIVATE_KEY"];
  const subject = process.env["VAPID_SUBJECT"] ?? "mailto:noreply@thecalzonekitchen.co.uk";
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export function getVapidPublicKey(): string | null {
  return process.env["VAPID_PUBLIC_KEY"] ?? null;
}

export function isPushConfigured(): boolean {
  return Boolean(process.env["VAPID_PUBLIC_KEY"] && process.env["VAPID_PRIVATE_KEY"]);
}

export interface PushPayload {
  title: string;
  body: string;
  /** Optional deep-link path opened on tap (e.g. "/reports?tab=haccp"). */
  url?: string;
  /** Collapses notifications with the same tag so we don't spam duplicates. */
  tag?: string;
}

interface StoredSubscription {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

async function sendToSubscription(sub: StoredSubscription, payload: PushPayload): Promise<boolean> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
    );
    return true;
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    // 404/410 mean the browser dropped the subscription — remove it.
    if (status === 404 || status === 410) {
      await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, sub.id)).catch(() => {});
      console.log(`[push] pruned dead subscription ${sub.id} (status ${status})`);
    } else {
      console.error(`[push] send failed for subscription ${sub.id}:`, err);
    }
    return false;
  }
}

/** Send a push to every opted-in device of the given users. Returns the number
 *  of devices successfully notified. */
export async function sendPushToUsers(userIds: number[], payload: PushPayload): Promise<number> {
  if (!ensureConfigured()) {
    console.warn("[push] VAPID not configured; skipping push send");
    return 0;
  }
  if (userIds.length === 0) return 0;
  const subs = await db
    .select({
      id: pushSubscriptionsTable.id,
      endpoint: pushSubscriptionsTable.endpoint,
      p256dh: pushSubscriptionsTable.p256dh,
      auth: pushSubscriptionsTable.auth,
    })
    .from(pushSubscriptionsTable)
    .where(inArray(pushSubscriptionsTable.userId, userIds));
  if (subs.length === 0) return 0;
  const results = await Promise.all(subs.map((s) => sendToSubscription(s, payload)));
  return results.filter(Boolean).length;
}

/** Send a push to one user's devices (e.g. the "send test notification" button). */
export async function sendPushToUser(userId: number, payload: PushPayload): Promise<number> {
  return sendPushToUsers([userId], payload);
}

/** Count how many distinct users currently have at least one push device, and
 *  which of the given users are reachable — used by the settings UI to show
 *  who's enabled. */
export async function getUsersWithPush(): Promise<Set<number>> {
  const rows = await db
    .select({ userId: pushSubscriptionsTable.userId })
    .from(pushSubscriptionsTable);
  return new Set(rows.map((r) => r.userId));
}
