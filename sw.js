// オフラインでも開けるようにアプリのファイルを保存しておく
const CACHE = 'ouen-v3';
const FILES = ['./', './index.html', './style.css', './app.js', './gas/Code.gs', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
// ネットにつながる時は最新版、つながらない時は保存しておいた版を使う
self.addEventListener('fetch', (e) => {
  // 自分のサイトのファイルだけ扱う（スプレッドシートとの通信には手を出さない）
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then((res) => {
    const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
