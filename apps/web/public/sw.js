// Ronde's service worker: the push notifications (lib/server/push.ts) and opening the page they point to.
// It does not cache anything: the app needs the network, and a stale copy of a meeting would mislead.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Ronde", body: event.data ? event.data.text() : "" };
  }
  const base = new URL(self.registration.scope).pathname.replace(/\/$/, "");
  event.waitUntil(
    self.registration.showNotification(data.title || "Ronde", {
      body: data.body || "",
      icon: `${base}/icon-192.png`,
      badge: `${base}/icon-192.png`,
      tag: data.tag,
      // A newer one with the same tag (your turn, after "you're next") still rings
      renotify: Boolean(data.tag),
      data: { url: data.url || self.registration.scope },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      // A Ronde window already open goes to the page; otherwise a new one opens
      const open = windows.find((w) => new URL(w.url).origin === new URL(url).origin);
      if (open) return open.focus().then((w) => (w && "navigate" in w ? w.navigate(url) : undefined));
      return self.clients.openWindow(url);
    }),
  );
});
