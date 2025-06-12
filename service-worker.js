/* Same functionality, new cache name */
const CACHE_NAME = 'coherent-breathing-cache-v1';
const urlsToCache = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png'
];

/* Install */
self.addEventListener('install', evt => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

/* Activate – clear old caches */
self.addEventListener('activate', evt => {
  evt.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (k !== CACHE_NAME ? caches.delete(k) : null)))
    ).then(()=>self.clients.claim())
  );
});

/* Fetch */
self.addEventListener('fetch', evt => {
  evt.respondWith(
    caches.match(evt.request).then(resp => {
      if (resp) return resp;

      const fetchReq = evt.request.clone();
      return fetch(fetchReq).then(netResp => {
        if (!netResp || netResp.status !== 200 || netResp.type !== 'basic')
          return netResp;
        const respClone = netResp.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(evt.request, respClone));
        return netResp;
      }).catch(() => (evt.request.mode === 'navigate')
          ? caches.match('./index.html') : undefined);
    })
  );
});

/* Skip-waiting helper */
self.addEventListener('message', evt => {
  if (evt.data && evt.data.type === 'SKIP_WAITING') self.skipWaiting();
});
