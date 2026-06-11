/* TCK Production Planner — push-only service worker.
 *
 * Deliberately minimal: it ONLY handles web-push notifications. It does NOT
 * cache or intercept fetch requests, so it can never serve a stale app — the
 * app keeps loading fresh from the network exactly as before. Its sole reason
 * to exist is that iOS/Android require a service worker to receive web push.
 */

self.addEventListener("install", () => {
  // Activate immediately so the first subscribe works without a reload.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "TCK Planner", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "TCK Planner";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          if ("navigate" in client) {
            try { client.navigate(targetUrl); } catch (e) { /* cross-origin/back-forward cache */ }
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      return undefined;
    }),
  );
});
