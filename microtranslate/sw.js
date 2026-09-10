const CACHE = 'microtranslate-gh-v2.1';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app-core.js',
  './app-main.js',
  './app-fix.js?v=2.1',
  './manifest.webmanifest',
  './icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const u = new URL(event.request.url);

  if (u.hostname.endsWith('wikimedia.org') ||
      u.hostname.endsWith('wikipedia.org') ||
      u.hostname.endsWith('wikidata.org')) {
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('./index.html')));
    return;
  }

  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});