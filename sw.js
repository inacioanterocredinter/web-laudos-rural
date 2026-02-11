// sw.js — versão robusta (tolerante a falhas)
const CACHE = "laudo-cache-v1";

const ASSETS = [
  "/",
  "/index.html",
  /*"/static/css/style.css",*/
  /*"/static/js/script.js",*/
  /*"/static/json/estados-cidades.json",*/
  "/static/img/background_agro.jpg",
  "/static/img/logo_credinter.png",
];

const PRECACHE = [
  '/',
  '/index.html',
  '/static/img/background_agro.jpg',
  '/static/img/logo_credinter.png'
]


// INSTALL — cacheia arquivo a arquivo (não falha a instalação se 1 item der erro)
self.addEventListener("install", (event) => {
  console.log("[SW] install start");
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const url of ASSETS) {
      try {
        const res = await fetch(url, { cache: "no-cache" });
        if (res.ok) {
          await cache.put(url, res.clone());
          console.log("[SW] Cached:", url);
        } else {
          console.warn("[SW] Falhou ao baixar:", url, res.status);
        }
      } catch (err) {
        console.warn("[SW] Erro ao cachear:", url, err);
      }
    }
  })());
  self.skipWaiting();
});

// ACTIVATE — limpa caches antigos
self.addEventListener("activate", (e) => {
  console.log("[SW] activate");
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// FETCH — mesma origem: cache-first; se falhar, volta para /index.html (navegação)
self.addEventListener("fetch", (e) => {
  const req = e.request;

  // Para navegações (endereço digitado, reload, etc.) dê prioridade ao index do cache
  if (req.mode === "navigate") {
    e.respondWith(
      caches.match("/index.html").then((r) => r || fetch(req))
    );
    return;
  }

  // Demais requisições GET: cache-first
  if (req.method === "GET") {
    e.respondWith(
      caches.match(req).then((cacheRes) => {
        return (
          cacheRes ||
          fetch(req).then((netRes) => {
            // opcional: guarda em cache o que vier da rede
            const copy = netRes.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return netRes;
          }).catch(() => {
            // fallback mínimo: tenta servir o index
            if (req.destination === "document") {
              return caches.match("/index.html");
            }
          })
        );
      })
    );
  }
});

// Mensagens vindas da página (por exemplo: limpar caches)
self.addEventListener('message', (e) => {
  try {
    const data = e.data || {};
    if (data && data.type === 'CLEAR_CACHES') {
      console.log('[SW] Received CLEAR_CACHES message');
      caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => {
        console.log('[SW] All caches cleared by message');
        self.skipWaiting();
      });
    }
  } catch (err) {
    console.warn('[SW] Error handling message', err);
  }
});