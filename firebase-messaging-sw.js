/* Nearbite Rider — Firebase Cloud Messaging background handler.
   Receives delivery-assignment pushes when the rider's tab is closed or the
   screen is locked, and renders the notification itself (the backend sends
   data-only messages, so there is never a duplicate system + in-app alert).
   Registered under the ./fcm/ scope so it never collides with the PWA
   app-shell worker (sw.js) at the root scope — same convention as the
   Vendor portal's firebase-messaging-sw.js. */

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// Same Eatswada Firebase project as the Vendor portal — this is the public
// web config (not a secret) that Firebase's own docs say is safe to ship
// client-side; access is enforced by backend auth, not by hiding this.
firebase.initializeApp({
  apiKey: "AIzaSyA0bqVE3RCmiJORcufx-v6Gew16GMCfFp0",
  authDomain: "eatswada.firebaseapp.com",
  projectId: "eatswada",
  storageBucket: "eatswada.firebasestorage.app",
  messagingSenderId: "644274579271",
  appId: "1:644274579271:web:ba72c4cd4f81c568fa0e62"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function (payload) {
  const d = payload.data || {};
  const title = d.title || 'New delivery assigned';
  self.registration.showNotification(title, {
    body: d.body || 'Tap to view the order and respond before it reassigns.',
    icon: './icon-192.png',
    badge: './icon-192.png',
    // Tagging by orderId means a repeat push for the SAME order replaces the
    // existing notification instead of stacking a second one, while
    // renotify still re-alerts sound/vibration — this is the duplicate
    // protection for the background/closed-tab case.
    tag: d.orderId ? 'order-' + d.orderId : 'rider-order',
    renotify: true,
    requireInteraction: true,   // stays on screen until the rider taps it
    vibrate: [400, 200, 400, 200, 400],
    data: d
  });
});

// Tapping the notification focuses (or opens) the app and tells it which
// order to jump to — the open app decides how to highlight it.
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const orderId = (event.notification.data || {}).orderId || '';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (const c of list) {
        if ('focus' in c) {
          c.postMessage({ type: 'order-notification-click', orderId: orderId });
          return c.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(orderId ? './index.html?order=' + encodeURIComponent(orderId) : './');
      }
    })
  );
});
