importScripts('/ui/pending-share.js');
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data.json();
  } catch (e) {
    data = { title: 'New file', body: 'There is new content in AirdropShare.' };
  }

  const options = {
    body: data.body || '',
    icon: undefined,
    badge: undefined,
    tag: 'airdrop-file',
    data: { fileName: data.fileName, size: data.size },
    actions: [
      { action: 'accept', title: 'Accept' },
      { action: 'reject', title: 'Reject' }
    ],
    requireInteraction: true
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'New file received', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const fileName = event.notification.data && event.notification.data.fileName;

  if (event.action === 'reject') {
    // Do nothing - file stays on server, just dismiss
    return;
  }

  const targetPath = 'index.html?accept=' + encodeURIComponent(fileName || '');
  const targetUrl = new URL(targetPath, self.registration.scope).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Look for an already-open window in our scope and reuse it
      for (const client of clientList) {
        if (client.url.startsWith(self.registration.scope)) {
          // Tell the page directly (works even if navigate() below is restricted)
          client.postMessage({ type: 'incoming-file', fileName: fileName || '' });
          if ('focus' in client) client.focus();
          if ('navigate' in client) {
            return client.navigate(targetUrl);
          }
          return;
        }
      }
      // No open window found — open a new one
      return clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// --- Share Target: handle files shared from other apps (Android) ---
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname === '/ui/share-target.html') {
    event.respondWith(handleShareTarget(event.request));
  }
});

async function handleShareTarget(request) {
  try {
    await AirdropShares.cleanup();
    const formData = await request.formData();
    const files = formData.getAll('files').filter(file => file instanceof File && file.name);
    if (!files.length) throw new Error('No files received');
    const id = await AirdropShares.stage(files);
    return Response.redirect(new URL('index.html?pending=' + encodeURIComponent(id), self.registration.scope).href, 303);
  } catch (error) {
    return Response.redirect(new URL('index.html?shared_error=1', self.registration.scope).href, 303);
  }
}
