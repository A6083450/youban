import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAmapNavigationUrl, hasUsableLocation } from './tripNavigation.ts'

test('rejects unusable coordinates', () => {
  assert.equal(hasUsableLocation(null), false)
  assert.equal(hasUsableLocation(undefined), false)
  assert.equal(hasUsableLocation({ longitude: 0, latitude: 0 }), false)
  assert.equal(hasUsableLocation({ longitude: 200, latitude: 30 }), false)
  assert.equal(hasUsableLocation({ longitude: 116, latitude: 95 }), false)
  assert.equal(hasUsableLocation({ longitude: Number.NaN, latitude: 30 }), false)
  assert.equal(hasUsableLocation({ longitude: '116', latitude: 30 }), false)
  assert.equal(hasUsableLocation({ longitude: 116.39, latitude: 39.9 }), true)
})

test('builds amap url with name and rounded coordinates', () => {
  const url = buildAmapNavigationUrl('黄果树大瀑布', {
    longitude: 105.6789123456,
    latitude: 25.987654321,
  })
  const params = new URL(url).searchParams
  assert.equal(params.get('to'), '105.678912,25.987654,黄果树大瀑布')
  assert.equal(params.get('coordinate'), 'gaode')
  assert.equal(params.get('callnative'), '1')
})

test('returns null instead of a broken link when coordinates are unusable', () => {
  assert.equal(buildAmapNavigationUrl('某处', { longitude: 0, latitude: 0 }), null)
  assert.equal(buildAmapNavigationUrl('某处', undefined), null)
})

test('falls back to a generic destination label for blank names', () => {
  const url = buildAmapNavigationUrl('  ', { longitude: 116.39, latitude: 39.9 })
  assert.equal(new URL(url).searchParams.get('to'), '116.39,39.9,目的地')
})
