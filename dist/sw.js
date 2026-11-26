const CACHE_NAME = "scottgrid-v4";
const PRECACHE_URLS = [
"/",
"/index.html",
"/logo.png",
"/spider-icon.png",
"/assets/index-CMKuYMEn.css",
"/assets/index-qA1RYenB.js",
"/assets/manifest-B1M5-Dqa.json"
];

self.addEventListener("install", (event) => {
event.waitUntil(
caches.open(CACHE_NAME).then(async (cache) => {
  for (const url of PRECACHE_URLS) {
    try {
      await cache.add(url);
    } catch {}
  }
})
);
self.skipWaiting();
});

self.addEventListener("activate", (event) => {
event.waitUntil(
caches.keys().then((keys) =>
  Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
)
);
self.clients.claim();
});

self.addEventListener("fetch", (event) => {
if (event.request.method !== "GET") return;
const url = new URL(event.request.url);
if (url.origin !== self.location.origin) return;

if (event.request.mode === "navigate") {
event.respondWith(
  caches.match(event.request).then((cached) => {
    const networkFetch = fetch(event.request)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("/index.html", copy));
        }
        return res;
      })
      .catch(() => cached || caches.match("/index.html"));

    return cached || networkFetch;
  })
);
return;
}

event.respondWith(
caches.match(event.request).then((cached) => {
  if (cached) return cached;
  return fetch(event.request).then((res) => {
    if (res && res.ok) {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    }
    return res;
  });
})
);
});
