/* Offline shell only. Change VERSION whenever any listed file changes. */
'use strict';
const VERSION = '0.2.8';
const PREFIX = 'yingyan-static:' + encodeURIComponent(self.registration.scope) + ':';
const CACHE = PREFIX + VERSION;
const FILES = [
  '英语背词小应用.html', 'reading-module.js', 'sentence-module.js',
  'translation-module.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'
];
const URLS = new Set(FILES.map(file => new URL(file, self.registration.scope).href));

// Install only a complete, anonymous static snapshot. If any file fails, keep
// the previously active worker rather than replace a working offline version.
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      for (const file of FILES) {
        const url = new URL(file, self.registration.scope).href;
        const response = await fetch(url, { credentials: 'omit', cache: 'reload', redirect: 'error' });
        const policy = response.headers.get('Cache-Control') || '';
        const vary = response.headers.get('Vary') || '';
        if (!response.ok || response.type !== 'basic' ||
            /\b(?:private|no-store|no-cache)\b/i.test(policy) ||
            /(?:^|,)\s*(?:\*|cookie|authorization)\s*(?:,|$)/i.test(vary)) {
          throw new Error('Static resource cannot be cached: ' + file);
        }
        await cache.put(url, response);
      }
    } catch (error) {
      try { await caches.delete(CACHE); } catch (_) {}
      throw error;
    }
  })());
});

// Default waiting lifecycle: an update activates only after old clients leave.
// Never call skipWaiting or claim, so an open page retains its old worker.
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try {
      const names = await caches.keys();
      await Promise.all(names.filter(name => name.startsWith(PREFIX) && name !== CACHE)
        .map(name => caches.delete(name).catch(() => false)));
    } catch (_) { /* Storage may be unavailable. */ }
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('Authorization') ||
      request.headers.has('Range') || !URLS.has(request.url)) return;
  event.respondWith((async () => {
    // A controlled page and its modules use the installed snapshot. If the
    // browser evicts the cache, fall back to network without storing responses.
    try {
      const cache = await caches.open(CACHE);
      const response = await cache.match(request.url);
      if (response) return response;
    } catch (_) { /* Cache Storage is optional. */ }
    return fetch(request);
  })());
});
