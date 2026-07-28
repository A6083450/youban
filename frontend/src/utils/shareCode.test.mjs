import test from 'node:test'
import assert from 'node:assert/strict'
import { isValidShareCode, normalizeShareCode } from './shareCode.ts'

test('normalizes share codes by removing whitespace and lowercasing', () => {
  assert.equal(
    normalizeShareCode(' 0F321B25 9A867C4D 10293847 56ABCDEF\n'),
    '0f321b259a867c4d1029384756abcdef',
  )
  assert.equal(normalizeShareCode(null), '')
})

test('accepts only 32 hexadecimal characters', () => {
  assert.equal(isValidShareCode('0f321b259a867c4d1029384756abcdef'), true)
  assert.equal(isValidShareCode('0F321B259A867C4D1029384756ABCDEF'), true)
  assert.equal(isValidShareCode(' 0f321b25 9a867c4d 10293847 56abcdef '), true)
  assert.equal(isValidShareCode('0f321b259a867c4d1029384756abcde'), false)
  assert.equal(isValidShareCode('0f321b259a867c4d1029384756abcdef0'), false)
  assert.equal(isValidShareCode('0f321b259a867c4d1029384756abcdez'), false)
  assert.equal(isValidShareCode(''), false)
})
