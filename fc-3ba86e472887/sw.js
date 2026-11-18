// Share-link service worker (copied to the Pages folder as sw.js by deploy-pages.sh).
// GitHub Pages tells browsers to reuse files for 10 minutes, so a plain reload could show
// an old build. This asks GitHub on every load whether each page/code file changed
// (cheap: unchanged files come back "not modified"), so a normal refresh is always current.
// Music is left alone (audio uses range requests and never changes between builds).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.headers.has('range') || /\.mp3$/i.test(new URL(req.url).pathname)) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req.url, { cache: 'no-cache', credentials: 'same-origin', redirect: 'manual' })
      .then((r) => (r.type === 'opaqueredirect' ? fetch(req) : r))
      .catch(() => fetch(req)));
    return;
  }
  e.respondWith(fetch(new Request(req, { cache: 'no-cache' })).catch(() => fetch(req)));
});
