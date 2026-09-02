import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const workerPath = resolve(frontendRoot, 'public/sw.js')
const viteConfigPath = resolve(frontendRoot, 'vite.config.ts')

interface WorkerEvent {
  waitUntil: (promise: Promise<unknown>) => void
}

describe('retired service worker', () => {
  it('unregisters itself and deletes only the legacy Workbox precache', async () => {
    expect(existsSync(workerPath)).toBe(true)
    if (!existsSync(workerPath))
      return

    const listeners = new Map<string, (event: WorkerEvent) => void>()
    const deletedCaches: string[] = []
    const navigatedUrls: string[] = []
    let skipWaitingCalls = 0
    let unregisterCalls = 0

    const workerSelf = {
      addEventListener(type: string, listener: (event: WorkerEvent) => void) {
        listeners.set(type, listener)
      },
      async skipWaiting() {
        skipWaitingCalls += 1
      },
      registration: {
        async unregister() {
          unregisterCalls += 1
          return true
        },
      },
      clients: {
        async matchAll() {
          return [{
            url: 'https://youban.me/login',
            async navigate(url: string) {
              navigatedUrls.push(url)
            },
          }]
        },
      },
    }
    const cacheStorage = {
      async keys() {
        return [
          'workbox-precache-v2-https://youban.me/',
          'trip-history',
          'runtime-settings',
        ]
      },
      async delete(name: string) {
        deletedCaches.push(name)
        return true
      },
    }

    runInNewContext(readFileSync(workerPath, 'utf8'), {
      caches: cacheStorage,
      self: workerSelf,
    })

    const installPromises: Promise<unknown>[] = []
    listeners.get('install')?.({
      waitUntil(promise) {
        installPromises.push(promise)
      },
    })
    await Promise.all(installPromises)

    const activatePromises: Promise<unknown>[] = []
    listeners.get('activate')?.({
      waitUntil(promise) {
        activatePromises.push(promise)
      },
    })
    await Promise.all(activatePromises)

    expect(skipWaitingCalls).toBe(1)
    expect(unregisterCalls).toBe(1)
    expect(deletedCaches).toEqual(['workbox-precache-v2-https://youban.me/'])
    expect(navigatedUrls).toEqual(['https://youban.me/login'])
  })

  it('emits the retirement worker at the H5 root during production builds', () => {
    const viteConfig = readFileSync(viteConfigPath, 'utf8')
    expect(viteConfig).toContain('name: \'retire-legacy-service-worker\'')
    expect(viteConfig).toContain('fileName: \'sw.js\'')
    expect(viteConfig).toContain('\'./public/sw.js\'')
  })
})
