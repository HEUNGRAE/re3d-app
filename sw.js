// 최소 PWA 서비스워커: 셸은 network-first(항상 최신) + 캐시 폴백(오프라인 진입) — 데이터(/api)는 항상 네트워크
// (기존 캐시-우선은 app.js 갱신이 영영 안 먹는 staleness가 있어 v3에서 전략 전환)
const C = 're3d-v3';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(C).then((c) => c.addAll(['./', 'index.html', 'style.css', 'app.js'])));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {                 // 이전 버전 캐시 삭제 + 즉시 제어권
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.pathname.startsWith('/api/')) return;              // 데이터는 네트워크 직행
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok && u.origin === location.origin) {
      const cp = r.clone(); caches.open(C).then((c) => c.put(e.request, cp));
    }
    return r;
  }).catch(() => caches.match(e.request)));                // 오프라인: 마지막 캐시본
});
