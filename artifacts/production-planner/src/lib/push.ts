// Web-push client helpers: register the (push-only) service worker, subscribe /
// unsubscribe this device, and report support/permission state. Used by the
// "Enable alerts on this device" control in Settings.

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function isPushSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

/** True when running as an installed (standalone) PWA — required for push on iOS. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    // iOS Safari exposes this non-standard flag for home-screen web apps.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration(`${BASE}/`);
  if (existing) return existing;
  return navigator.serviceWorker.register(`${BASE}/sw.js`);
}

/** Whether this specific device/browser currently has a push subscription. */
export async function isSubscribedOnThisDevice(): Promise<boolean> {
  if (!isPushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration(`${BASE}/`);
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription();
  return sub !== null;
}

/** Request permission, subscribe this device, and register it server-side.
 *  Returns true on success. Throws with a user-readable message on failure. */
export async function enablePushOnThisDevice(): Promise<boolean> {
  if (!isPushSupported()) throw new Error("This device/browser doesn't support notifications.");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notification permission was not granted.");

  const keyRes = await fetch(`${BASE}/api/govee/push/public-key`, { credentials: "include" });
  const { publicKey } = (await keyRes.json()) as { publicKey: string | null };
  if (!publicKey) throw new Error("Push is not configured on the server.");

  const reg = await registerServiceWorker();
  await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      // Cast: TS 5.7 typed Uint8Array as generic over ArrayBufferLike, which no
      // longer structurally matches BufferSource; the runtime value is correct.
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });
  }

  const res = await fetch(`${BASE}/api/govee/push/subscribe`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
  if (!res.ok) throw new Error("Couldn't register this device with the server.");
  return true;
}

/** Unsubscribe this device and remove it server-side. */
export async function disablePushOnThisDevice(): Promise<void> {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration(`${BASE}/`);
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => {});
  await fetch(`${BASE}/api/govee/push/unsubscribe`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {});
}

/** Fire a server-side test push to this user's devices. */
export async function sendTestPush(): Promise<number> {
  const res = await fetch(`${BASE}/api/govee/push/test`, { method: "POST", credentials: "include" });
  if (!res.ok) throw new Error("Test push failed.");
  const { devicesNotified } = (await res.json()) as { devicesNotified: number };
  return devicesNotified;
}
