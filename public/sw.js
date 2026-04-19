// Service Worker – Brajwasi Travels
const CACHE_NAME = 'brajwasi-v3';
const ASSETS = ['/', '/css/main.css', '/js/main.js', '/images/favicon.png', '/images/default-crysta.jpg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});

// ---- PUSH HANDLER ----
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch(err) {}

  const title = data.title || 'Brajwasi Travels';
  const body = data.body || 'You have a new notification';
  const type = data.type || 'general';
  const url = data.url || '/';

  const options = {
    body,
    icon: '/images/favicon.png',
    badge: '/images/favicon.png',
    vibrate: type === 'chat' ? [300, 100, 300, 100, 300] : [200, 100, 200],
    sound: '/sounds/notify.mp3', // will use default if not found
    data: { url },
    requireInteraction: type === 'booking',
    tag: type === 'chat' ? 'chat-' + (data.sessionId || Date.now()) : 'booking-' + Date.now(),
    actions: type === 'chat'
      ? [{ action: 'reply', title: '💬 Open Chat' }, { action: 'dismiss', title: 'Dismiss' }]
      : [{ action: 'view', title: '📋 View Booking' }, { action: 'dismiss', title: 'Dismiss' }],
    silent: false
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

// ---- NOTIFICATION CLICK ----
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;

  const urlToOpen = e.notification.data?.url || '/admin';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // Focus existing window if open
      for (const client of list) {
        if (client.url.includes(urlToOpen) && 'focus' in client) return client.focus();
      }
      // Open new window
      if (clients.openWindow) return clients.openWindow(urlToOpen);
    })
  );
});

// ---- NOTIFICATION CLOSE ----
self.addEventListener('notificationclose', e => {
  // analytics can go here
});
