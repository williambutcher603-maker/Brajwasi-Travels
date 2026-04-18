// Service Worker – Brajwasi Tour & Travels
const CACHE_NAME = 'brajwasi-v2';
const ASSETS = ['/', '/css/main.css', '/js/main.js', '/images/favicon.png'];

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

// Push notification handler with sound support
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch(err) {}

  const title = data.title || 'Brajwasi Tour & Travels';
  const isChat = data.isChat || false;
  
  const options = {
    body: data.body || 'You have a new notification',
    icon: '/images/favicon.png',
    badge: '/images/favicon.png',
    vibrate: isChat ? [100, 50, 100, 50, 200] : [200, 100, 200],
    sound: '/sounds/notify.mp3',
    tag: isChat ? 'chat-' + (data.sessionId || Date.now()) : 'booking-' + Date.now(),
    renotify: true,
    data: { url: data.url || '/admin', isChat },
    actions: isChat
      ? [{ action: 'reply', title: '💬 Reply' }, { action: 'close', title: 'Dismiss' }]
      : [{ action: 'view', title: '👁 View Booking' }, { action: 'close', title: 'Dismiss' }],
    requireInteraction: true,
    silent: false
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'close') return;
  const url = e.notification.data?.url || '/admin';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes(url) && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
