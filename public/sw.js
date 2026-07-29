// SACSI PWA Service Worker — cache branded static assets only.
// Business pages, RSC payloads and Next.js chunks must always come from the
// current deployment so financial and operational data cannot become stale.
const CACHE = "sacsi-static-v2";

// Static assets that contain no business data and rarely change.
const STATIC_ASSETS = [
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

// Fetch strategy: cache-first for listed static assets; bypass everything else.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Cache only the exact branded assets listed above.
  if (url.origin === self.location.origin && STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  }
});
