// Retirement worker for legacy SACSI PWA installations. Older versions cached
// authenticated pages and Next.js chunks, which can trap mobile users on an
// obsolete login/root page after authentication.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith("sacsi")).map((key) => caches.delete(key)))
      ),
      self.registration.unregister(),
    ])
  );
});
