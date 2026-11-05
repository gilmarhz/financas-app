// ============================================
// Service Worker - Finanças PWA
// ============================================
const CACHE_NAME = 'financas-v1';
const CACHE_VERSION = '1.0.0';

// Recursos essenciais que devem funcionar offline
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icon-512.png',
  // Bibliotecas externas (CDN)
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdn.sheetjs.com/xlsx-0.20.2/package/dist/xlsx.full.min.js'
];

// ============ INSTALAÇÃO ============
// Baixa e armazena em cache todos os recursos essenciais
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pré-cacheando recursos');
      // Usa addAll com Promise.allSettled para não falhar se um recurso não existir
      return Promise.allSettled(
        PRECACHE_URLS.map(url =>
          cache.add(url).catch(err => {
            console.warn('[SW] Falha ao cachear:', url, err);
          })
        )
      );
    }).then(() => {
      // Ativa imediatamente sem esperar abas antigas fecharem
      return self.skipWaiting();
    })
  );
});

// ============ ATIVAÇÃO ============
// Remove caches antigos quando a versão muda
self.addEventListener('activate', (event) => {
  console.log('[SW] Ativando...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            console.log('[SW] Removendo cache antigo:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => {
      // Assume o controle de todas as abas abertas imediatamente
      return self.clients.claim();
    })
  );
});

// ============ FETCH ============
// Estratégia: Cache First com fallback para rede
// Para navegação (HTML): Network First com fallback para cache
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignora requisições não-GET (POST, etc.)
  if (request.method !== 'GET') return;

  // Ignora requisições de extensões do navegador
  if (!url.protocol.startsWith('http')) return;

  // Navegação (abrir o app): tenta rede primeiro, cai para cache se offline
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Atualiza o cache com a versão mais nova
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
          return response;
        })
        .catch(() => {
          // Offline: serve o index.html do cache
          return caches.match('./index.html').then((cached) => {
            return cached || caches.match('./');
          });
        })
    );
    return;
  }

  // Demais recursos: cache primeiro, rede como fallback
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        // Retorna do cache, mas atualiza em background (stale-while-revalidate)
        fetch(request).then((response) => {
          if (response && response.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, response);
            });
          }
        }).catch(() => { /* silencia erros de rede */ });
        return cached;
      }

      // Não está no cache: busca na rede e armazena
      return fetch(request).then((response) => {
        // Só cacheia respostas válidas
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseClone);
        });
        return response;
      }).catch((err) => {
        console.warn('[SW] Fetch falhou:', url.href, err);
        // Fallback específico por tipo
        if (url.pathname.endsWith('.json')) {
          return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
        }
        // Último recurso: retorna uma resposta vazia para não quebrar
        return new Response('', { status: 408, statusText: 'Offline' });
      });
    })
  );
});

// ============ MENSAGENS DO APP ============
// Permite que o app force atualização do cache
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() => {
      event.ports[0]?.postMessage({ ok: true });
    });
  }
});
