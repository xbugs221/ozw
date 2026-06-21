/**
 * PURPOSE: Make ozw installable as a PWA while keeping API and realtime traffic
 * on the network so active coding sessions are never served from cache.
 */
const CACHE_PREFIX = 'ozw-pwa';
const CACHE_NAME = `${CACHE_PREFIX}-v1`;
const STATIC_EXTENSIONS = [
  '.css',
  '.eot',
  '.gif',
  '.ico',
  '.jpg',
  '.jpeg',
  '.js',
  '.png',
  '.svg',
  '.ttf',
  '.webmanifest',
  '.webp',
  '.woff',
  '.woff2',
];

/**
 * Return true for backend routes and websocket endpoints that must bypass the
 * service worker cache.
 */
function shouldBypassRequest(request, url) {
  return (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/ws') ||
    url.pathname.startsWith('/shell')
  );
}

/**
 * Return true when a same-origin request is a versioned static asset or PWA
 * metadata that can tolerate stale-while-revalidate caching.
 */
function isStaticAssetRequest(url) {
  return (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/pwa/') ||
    STATIC_EXTENSIONS.some((extension) => url.pathname.endsWith(extension))
  );
}

/**
 * Build a small offline page for installed app launches when the backend is not
 * reachable.
 */
function buildOfflineResponse() {
  return new Response(
    `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ozw offline</title>
    <style>
      :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0c1117; color: #f8fafc; }
      main { max-width: 28rem; padding: 2rem; line-height: 1.6; }
      h1 { margin: 0 0 0.75rem; font-size: 1.5rem; }
      p { margin: 0; color: #cbd5e1; }
    </style>
  </head>
  <body>
    <main>
      <h1>ozw 当前离线</h1>
      <p>请确认服务器或网络连接恢复后，再从桌面图标重新打开。</p>
    </main>
  </body>
</html>`,
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
      status: 503,
    },
  );
}

/**
 * Load navigations from the network first so users see the current server build
 * whenever it is reachable.
 */
async function respondToNavigation(request) {
  try {
    return await fetch(request);
  } catch {
    return buildOfflineResponse();
  }
}

/**
 * Serve cached static assets immediately and refresh them in the background.
 */
async function respondToStaticAsset(request) {
  const cachedResponse = await caches.match(request);
  const networkResponse = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cachedResponse || Response.error());

  return cachedResponse || networkResponse;
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((cacheName) => cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME)
            .map((cacheName) => caches.delete(cacheName)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (shouldBypassRequest(request, url)) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(respondToNavigation(request));
    return;
  }

  if (isStaticAssetRequest(url)) {
    event.respondWith(respondToStaticAsset(request));
  }
});
