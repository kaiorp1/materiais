// Service Worker — Requisições de Materiais Metro I (Painel Admin)
const CACHE = 'req-materiais-admin-v1';
const ASSETS = [
  '/materiais/admin/',
  '/materiais/admin/index.html',
  '/materiais/admin/css/admin.css',
  '/materiais/admin/js/admin.js',
  '/materiais/css/style.css',
  '/materiais/js/supabaseClient.js',
];

// Instala e faz cache dos assets estáticos
self.addEventListener('install', ev => {
  ev.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// Ativa e limpa caches antigos
self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Estratégia: Network first, cache como fallback
// (garante dados sempre atualizados quando há internet)
self.addEventListener('fetch', ev => {
  // Ignora requisições para o Supabase (dados sempre frescos)
  if (ev.request.url.includes('supabase.co')) return;

  ev.respondWith(
    fetch(ev.request)
      .then(response => {
        // Atualiza cache com resposta nova
        if (response.ok && ev.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(ev.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(ev.request))
  );
});
