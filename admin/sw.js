// Service worker del PANEL (scope /admin/). Solo guarda los archivos del panel para que abra
// rápido y aunque haya mala señal; NO guarda datos del torneo sin conexión.
// Subir CACHE_VERSION junto con ADMIN_VERSION de js/config.js, siempre en el mismo cambio.
const CACHE_VERSION = '1.4.0';
const PREFIJO = 'nocturno-admin-';
const CACHE = `${PREFIJO}${CACHE_VERSION}`;

const APP = [
  './',
  './index.html',
  './manifest.webmanifest',
  '../css/app.css',
  '../js/config.js',
  '../js/util.js',
  '../js/calculos.js',
  '../js/fixture.js',
  '../js/db.js',
  '../js/db-supabase.js',
  '../js/db-demo.js',
  '../js/datos.js',
  '../js/ui.js',
  '../js/placas.js',
  '../js/admin.js',
  '../js/salida.js',
  '../js/elegir-jugador.js',
  '../assets/logo-mitre-75.jpg',
  '../assets/icon-admin-192.png',
  '../assets/icon-admin-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIJO) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const CDN = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (CDN.includes(url.hostname)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copia));
        }
        return res;
      }))
    );
    return;
  }

  // Archivos del panel (mismo origen): primero la red, si no hay, lo guardado.
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copia));
        }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html')))
    );
  }
  // Supabase (datos, sesión, invitaciones): directo a la red, nunca se guarda.
});
