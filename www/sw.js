/* 送迎計画 — Cache First Service Worker */
const CACHE_NAME = 'haisha-cache-v20261029n';

const PRECACHE_URLS = [
  './',
  './index.html',
  './css/style.css',
  './js/data.js',
  './js/ui.js',
  './js/carpool.js',
  './js/route.js',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  // index.html が参照するキャッシュバスター付き URL も事前格納
  './css/style.css?v=20261029n',
  './js/data.js?v=20261029n',
  './js/ui.js?v=20261029n',
  './js/carpool.js?v=20261029n',
  './js/route.js?v=20261029n',
  './js/app.js?v=20261029n'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(PRECACHE_URLS).catch(async (err) => {
        // 一部失敗しても個別に入れられるものは入れる
        console.warn('SW precache partial failure:', err);
        for (const url of PRECACHE_URLS) {
          try {
            await cache.add(url);
          } catch (e) {
            console.warn('SW skip precache:', url, e);
          }
        }
      })
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

/** クエリ無しパスでもキャッシュを探せるようにする */
function requestCandidates(request) {
  const candidates = [request];
  try {
    const url = new URL(request.url);
    if (url.search) {
      url.search = '';
      candidates.push(new Request(url.href, { headers: request.headers, mode: request.mode, credentials: request.credentials }));
    }
  } catch (e) { /* ignore */ }
  return candidates;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // 同一オリジンのみキャッシュファースト（クロスオリジンはネットワーク）
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      for (const candidate of requestCandidates(request)) {
        const cached = await cache.match(candidate, { ignoreSearch: false });
        if (cached) return cached;
      }
      // ignoreSearch でもう一度
      const cachedIgnore = await cache.match(request, { ignoreSearch: true });
      if (cachedIgnore) return cachedIgnore;

      try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.ok) {
          cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      } catch (err) {
        // オフライン最終手段: index 系
        if (request.mode === 'navigate') {
          const fallback = await cache.match('./index.html') || await cache.match('./');
          if (fallback) return fallback;
        }
        throw err;
      }
    })()
  );
});
