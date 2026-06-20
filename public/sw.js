// SACSI PWA Service Worker — offline support for core assets
const CACHE = "sacsi-v1";

// Static assets safe to cache aggressively (rarely change)
const STATIC_ASSETS = [
  "/",
  "/manifest.json",
  "/logo.png",
  "/favicon.ico",
  "/favicon.png",
  "/icon-192.png",
  "/icon-512.png",
];

// Install: pre-cache static assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch strategy: cache-first for static assets, network-first for everything else
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Cache-first for static assets
  if (STATIC_ASSETS.some((a) => url.pathname.endsWith(a) || url.pathname === a)) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
    return;
  }

  // Network-first for everything else (Next.js chunks, API, HTML)
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses for next time
        const clone = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => {
        // Offline: try cache, then show offline page
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          // If requesting a page, show cached root
          if (event.request.mode === "navigate") {
            return caches.match("/");
          }
          return new Response("Offline", { status: 503 });
        });
      })
  );
});
