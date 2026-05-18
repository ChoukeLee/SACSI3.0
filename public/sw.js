// Service worker: network-first strategy.
// Skips cache for localhost/dev to avoid stale JS after hot reloads.

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Dev / localhost: always go network-first, skip cache
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response("Offline — please connect to the internet.", { status: 503 });
      })
    );
    return;
  }

  // Production: network-first with cache fallback
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request).then((cached) => {
        return cached || new Response("Offline", { status: 503 });
      });
    })
  );
});
