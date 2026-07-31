import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTripGraph, buildGraphOption } from './tripGraph.js'

// 桩翻译函数：返回 key 本身，带参数时附加参数
const t = (key, params) => (params ? `${key}${JSON.stringify(params)}` : key)

const plan = {
  city: '东京',
  cities: ['东京'],
  start_date: '2026-08-01',
  end_date: '2026-08-03',
  days: [
    {
      day_index: 0, date: '2026-08-01', city: '东京',
      attractions: [
        { name: '浅草寺', address: '台东区', visit_duration: 120, ticket_price: 0 },
        { name: '东京塔' },
      ],
      hotel: { name: '新宿酒店', price_range: '中档', estimated_cost: 800 },
      meals: [{ type: 'lunch', name: '一兰拉面', estimated_cost: 100 }],
    },
    { day_index: 1, date: '2026-08-02', city: '东京', attractions: [{ name: '上野公园' }], meals: [] },
    { day_index: 2, date: '2026-08-03', city: '东京', attractions: [], meals: [] },
  ],
  weather_info: [{ date: '2026-08-01', day_weather: '晴', day_temp: 30 }],
  budget: {
    total: 5000, total_attractions: 500, total_hotels: 1600,
    total_meals: 900, total_transportation: 1000, total_inter_city_transport: 0,
  },
  overall_suggestions: '建议提前预约热门景点',
}

test('builds city, day and attraction nodes with hierarchy edges', () => {
  const g = buildTripGraph(plan, t)
  assert.equal(g.nodes.filter((n) => n.lane === 'city').length, 1)
  assert.equal(g.nodes.filter((n) => n.lane === 'day').length, 3)
  assert.equal(g.nodes.filter((n) => n.lane === 'attraction').length, 3)
  assert.equal(g.nodes.filter((n) => n.lane === 'hotel').length, 1)
  assert.equal(g.nodes.filter((n) => n.lane === 'meal').length, 1)
  // 城市→天、天→景点、景点顺序边
  assert.ok(g.edges.some((e) => e.source === 'city_东京' && e.target === 'day_0'))
  assert.ok(g.edges.some((e) => e.source === 'day_0' && e.target === 'attr_0_0_浅草寺'))
  assert.ok(g.edges.some((e) => e.source === 'attr_0_0_浅草寺' && e.target === 'attr_0_1_东京塔'))
})

test('main line connects consecutive days', () => {
  const g = buildTripGraph(plan, t)
  const main = g.edges.filter((e) => e.main)
  assert.deepEqual(main.map((e) => [e.source, e.target]), [['day_0', 'day_1'], ['day_1', 'day_2']])
})

test('budget and suggestion nodes sit on the right extra column', () => {
  const g = buildTripGraph(plan, t)
  const side = g.nodes.filter((n) => n.lane === 'budget' || n.lane === 'preference')
  assert.ok(side.length >= 2)
  assert.ok(side.every((n) => n.dayIndex === 3))
  // total_inter_city_transport 为 0，不生成 interCity 子节点
  assert.ok(!g.nodes.some((n) => n.id === 'budget_interCity'))
})

test('layout keeps x ascending by day and no y overlap within a lane column', () => {
  const option = buildGraphOption(buildTripGraph(plan, t))
  const data = option.series[0].data
  assert.deepEqual(data.filter((n) => n.lane === 'day').map((n) => n.x), [0, 280, 560])
  const seen = new Set()
  for (const n of data) {
    if (n.lane === 'city') continue
    const key = `${n.lane}:${n.x}:${n.y}`
    assert.ok(!seen.has(key), `overlap at ${key}`)
    seen.add(key)
  }
})

test('multi-city plan creates root node and per-city nodes', () => {
  const multi = {
    ...plan,
    cities: ['东京', '大阪'],
    days: [
      { ...plan.days[0] },
      { ...plan.days[1] },
      { ...plan.days[2], city: '大阪' },
    ],
  }
  const g = buildTripGraph(multi, t)
  assert.ok(g.nodes.some((n) => n.id === 'trip_root'))
  assert.ok(g.edges.some((e) => e.source === 'trip_root' && e.target === 'city_大阪'))
  assert.ok(g.edges.some((e) => e.source === 'city_大阪' && e.target === 'day_2'))
  const option = buildGraphOption(g)
  const osaka = option.series[0].data.find((n) => n.id === 'city_大阪')
  assert.equal(osaka.x, 560) // 大阪只有 day_index=2，居中即该列
})

test('returns null option when no days', () => {
  assert.equal(buildGraphOption(buildTripGraph({ city: '东京', days: [] }, t)), null)
})

test('tooltip formatter escapes html in node name and value', () => {
  const xss = { ...plan, days: [{
    day_index: 0, date: '2026-08-01', city: '东京',
    attractions: [{ name: '<img src=x onerror=alert(1)>', address: '<b>addr</b>' }],
    meals: [],
  }] }
  const option = buildGraphOption(buildTripGraph(xss, t))
  const node = option.series[0].data.find((n) => n.lane === 'attraction')
  const html = option.tooltip.formatter({ dataType: 'node', data: node })
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'))
  assert.ok(html.includes('&lt;b&gt;addr&lt;/b&gt;'))
  assert.ok(!html.includes('<img'))
})
