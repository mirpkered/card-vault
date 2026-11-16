const CACHE = 'collect-everything-v4';
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['./', './index.html', './manifest.webmanifest', './favicon.png', './apple-touch-icon.png', './collect-icon-192.png', './collect-icon-512.png', './collect-wordmark.svg', './collect-wordmark.png'])));
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin && !request.destination.includes('image')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(request, copy)); return response; }).catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html'))));
    return;
  }
  event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((response) => {
    if (response.ok || response.type === 'opaque') caches.open(CACHE).then(async (cache) => {
      if (request.destination === 'image' && url.origin !== self.location.origin) {
        const keys = await cache.keys(); const remoteImages = keys.filter((key) => key.destination === 'image' && new URL(key.url).origin !== self.location.origin);
        if (remoteImages.length > 60) await cache.delete(remoteImages[0]);
      }
      cache.put(request, response.clone());
    });
    return response;
  })));
});