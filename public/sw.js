// public/sw.js - Service Worker for WORDDUEL PWA and Android Offline Support
const CACHE_NAME = 'wordduel-v7';
const STATIC_ASSETS = [
  '/',
  '/style.css?v=7',
  '/game.js?v=7',
  '/words.json',
  '/icon.svg',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only handle GET requests and ignore WebSocket / Socket.io
  if (event.request.method !== 'GET' || event.request.url.includes('/socket.io/')) {
    return;
  }

  // Network-First for HTML navigation and JS/CSS assets so updates reflect immediately
  const isCodeAsset = event.request.mode === 'navigate' ||
                      event.request.url.includes('/style.css') ||
                      event.request.url.includes('/game.js');

  if (isCodeAsset) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(event.request).then((cached) => {
            if (cached) return cached;
            if (event.request.mode === 'navigate') return caches.match('/');
          });
        })
    );
    return;
  }

  // Cache-First for static immutable assets (words.json, icons)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return networkResponse;
      });
    })
  );
});
