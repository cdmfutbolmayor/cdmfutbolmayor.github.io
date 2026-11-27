// Service worker de la app PÚBLICA (scope /). Guarda la web para abrirla sin conexión.
// No cachea ni intercepta nada bajo /admin/: el panel tiene su propio service worker (admin/sw.js).
// Subir CACHE_VERSION junto con VERSION de js/config.js, siempre en el mismo cambio.
const CACHE_VERSION = '1.2.0';
const PREFIJO = 'nocturno-publico-';
const CACHE = `${PREFIJO}${CACHE_VERSION}`;
const ADMIN = new URL('admin/', self.registration.scope).pathname; // '/admin/'

const APP = [
  './',
  './index.html',
  './css/app.css',
  './js/config.js',
  './js/util.js',
  './js/calculos.js',
  './js/fixture.js',
  './js/db.js',
  './js/db-supabase.js',
  './js/db-demo.js',
  './js/datos.js',
  './js/ui.js',
  './js/placas.js',
  './js/publico.js',
  './js/salida.js',
  './manifest.webmanifest',
  './assets/logo-mitre-75.jpg',
  './assets/icon-192.png',
  './assets/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      // Borra sus versiones viejas (y el cache de antes de separar las apps), nunca el del admin.
      .then((keys) => Promise.all(keys
        .filter((k) => k.startsWith('nocturno-') && !k.startsWith('nocturno-admin-') && k !== CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const CDN = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // El panel no es de esta app: ni se cachea ni se intercepta.
  if (url.origin === self.location.origin && url.pathname.startsWith(ADMIN)) return;

  // Fuentes y librerías: primero el cache.
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

  // La app (mismo origen): primero la red, si no hay, lo guardado.
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
  // El resto (datos del torneo) va directo a la red: los datos sin conexión los guarda la app.
});
