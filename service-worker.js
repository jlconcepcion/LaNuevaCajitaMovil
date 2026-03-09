/* ============================================================
   SERVICE WORKER — La Cajita TV PWA
   Estrategia:
     · Archivos estáticos  → Cache First (rápido, sin red)
     · Llamadas a la API   → Network First (contenido siempre fresco)
     · Fallback offline    → página de aviso cuando no hay red
============================================================ */

const CACHE_NAME = 'lacajita-v1';
const STATIC_ASSETS = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './manifest.json',
    './imges/102.png',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap',
    'https://cdn.jsdelivr.net/npm/hls.js@latest/dist/hls.min.js',
];

/* ── Instalación: pre-cachear archivos estáticos ───────── */
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            // Se ignoran errores individuales para no bloquear la instalación
            return Promise.allSettled(
                STATIC_ASSETS.map(url => cache.add(url).catch(() => { }))
            );
        })
    );
    self.skipWaiting();
});

/* ── Activación: eliminar cachés antiguas ──────────────── */
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            )
        )
    );
    self.clients.claim();
});

/* ── Fetch: estrategia según tipo de recurso ───────────── */
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);

    // 1. Llamadas a la API → Network First (siempre datos frescos)
    if (url.hostname === 'tvappbuilder.com') {
        event.respondWith(networkFirst(request));
        return;
    }

    // 2. CDN de fuentes Google / jsDelivr → Cache First
    if (
        url.hostname === 'fonts.googleapis.com' ||
        url.hostname === 'fonts.gstatic.com' ||
        url.hostname === 'cdn.jsdelivr.net'
    ) {
        event.respondWith(cacheFirst(request));
        return;
    }

    // 3. Recursos estáticos propios → Cache First con fallback de red
    if (request.method === 'GET') {
        event.respondWith(cacheFirst(request));
    }
});

/* ── Helpers de estrategia ─────────────────────────────── */
async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        // Si falla y es navegación → página offline
        if (request.mode === 'navigate') return offlinePage();
        return new Response('', { status: 408 });
    }
}

async function networkFirst(request) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        const cached = await caches.match(request);
        return cached || new Response(JSON.stringify({ error: 'Sin conexión' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

function offlinePage() {
    return new Response(`
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Sin conexión — La Cajita TV</title>
  <style>
    body{margin:0;background:#07070f;color:#f0efff;font-family:Inter,sans-serif;
         display:flex;flex-direction:column;align-items:center;justify-content:center;
         min-height:100vh;text-align:center;padding:24px}
    h1{font-size:2rem;margin-bottom:12px}
    p{color:#8585aa;font-size:1rem;max-width:340px}
    button{margin-top:24px;background:#7c3aed;color:#fff;border:none;
           padding:12px 28px;border-radius:12px;font-size:1rem;cursor:pointer}
  </style>
</head>
<body>
  <h1>📡 Sin conexión</h1>
  <p>Parece que no tienes conexión a internet. Revisa tu red e intenta de nuevo.</p>
  <button onclick="location.reload()">Reintentar</button>
</body>
</html>`, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
}
