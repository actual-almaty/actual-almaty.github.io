/* ACTUAL: приложение с экрана «Домой». Страницы — всегда свежие из сети (если сети нет — последняя сохранённая), фото — из кэша для скорости. */
const C = "actual-v1";
self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  const r = e.request; if (r.method !== "GET") return;
  const u = new URL(r.url);
  if (r.mode === "navigate" && u.origin === location.origin && (u.pathname === "/" || u.pathname === "/index.html")) {
    e.respondWith(fetch(r).then(res => { const cp = res.clone(); caches.open(C).then(c => c.put("/", cp)); return res; }).catch(() => caches.match("/")));
    return;
  }
  if (r.destination === "image" && (u.origin === location.origin && u.pathname.startsWith("/p/"))) {
    e.respondWith(caches.open(C).then(c => c.match(r).then(hit => hit || fetch(r).then(res => { if (res.ok || res.type === "opaque") c.put(r, res.clone()); return res; }))));
  }
});
