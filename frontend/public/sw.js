const LEGACY_PRECACHE_PREFIX = 'workbox-precache-v2-'

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys()
    await Promise.all(
      cacheNames
        .filter(name => name.startsWith(LEGACY_PRECACHE_PREFIX))
        .map(name => caches.delete(name)),
    )

    await self.registration.unregister()
    const windowClients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    })
    await Promise.all(windowClients.map(client => client.navigate(client.url)))
  })())
})
