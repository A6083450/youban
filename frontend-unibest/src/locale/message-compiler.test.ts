import { describe, expect, it } from 'vitest'
import { compileRuntimeMessage, formatRuntimeMessage } from './message-compiler'

function render(source: string, named: Record<string, unknown> = {}, list: unknown[] = []): string {
  const message = compileRuntimeMessage(source)
  return String(message({
    named: key => named[key],
    list: index => list[index],
    interpolate: value => String(value),
    normalize: values => values.join(''),
  }))
}

describe('runtime-safe locale message compiler', () => {
  it('interpolates named values without dynamic code generation', () => {
    expect(render('第 {day} 天 · {city}', { day: 2, city: '杭州' })).toBe('第 2 天 · 杭州')
    expect(render('Day {day}', { day: 3 })).toBe('Day 3')
  })

  it('resolves nested named values without evaluating the template', () => {
    const values = { name: '张三', detail: { height: 178, weight: '75kg' } }
    expect(render('{name}: {detail.height}, {detail.weight}', values)).toBe('张三: 178, 75kg')
    expect(formatRuntimeMessage('{detail.height}', values)).toBe('178')
  })

  it('supports positional values used by the bundled demo messages', () => {
    expect(render('{0}cm, {1}公斤', {}, [175, 65])).toBe('175cm, 65公斤')
    expect(formatRuntimeMessage('{0}cm, {1}公斤', [175, 65])).toBe('175cm, 65公斤')
  })

  it('keeps an unresolved placeholder visible for diagnosis', () => {
    expect(render('Hello {name}')).toBe('Hello {name}')
  })
})
