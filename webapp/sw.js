const CACHE_NAME = 'pin-together-shell-v3';
const APP_SHELL = [
  '/',
  '/index.html',
  '/app.css',
  '/app.js',
  '/config.js',
  '/manifest.webmanifest',
  '/icons/pin-together.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('pin-together-shell-') && key !== CACHE_NAME)
    .map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/index.html')));
    return;
  }

  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; }
  catch { payload = { body:event.data?.text() || '새 알림이 있습니다.' }; }
  const title = payload.title || '핀투게더';
  event.waitUntil(self.registration.showNotification(title, {
    body:payload.body || '새 알림이 있습니다.',
    icon:'/icons/pin-together.svg',
    badge:'/icons/pin-together.svg',
    tag:payload.tag || `pin-together-${Date.now()}`,
    data:{ url:payload.url || '/' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(clients.matchAll({ type:'window', includeUncontrolled:true }).then(windows => {
    const existing = windows.find(window => window.url.startsWith(self.location.origin));
    if (existing) {
      existing.postMessage({ type:'open-notification', notificationId:event.notification.tag?.replace('notification-', '') });
      return existing.focus();
    }
    return clients.openWindow(target);
  }));
});
