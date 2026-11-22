/* Service worker de Jarvis Mobile : reçoit les notifications push et les affiche. Aucun secret ici. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { titre: "Jarvis", corps: event.data ? event.data.text() : "" };
  }
  // Obligatoire sur iPhone : chaque push doit afficher une notification, sinon l'abonnement est supprimé.
  event.waitUntil(
    self.registration.showNotification(data.titre || "Jarvis", {
      body: data.corps || "",
      tag: data.tag || undefined,
      icon: "/icon-180.png",
      badge: "/icon-180.png",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const fenetres = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const f of fenetres) {
        if ("focus" in f) return f.focus();
      }
      return self.clients.openWindow(url);
    })(),
  );
});
