// 行程脉络图：从 TripPlan 构建固定布局（列=天、泳道=类型）的 ECharts 图谱
// 节点/边规则移植自已删除的后端 knowledge_graph_service.py

const NODE_COLORS = {
  city: '#4A90D9',
  day: '#5B8FF9',
  attraction: '#5AD8A6',
  hotel: '#F6BD16',
  meal: '#E8684A',
  weather: '#6DC8EC',
  budget: '#FF9845',
  preference: '#B37FEB',
}

const NODE_SIZES = {
  city: 70, day: 45, attraction: 35, hotel: 35,
  meal: 25, weather: 28, budget: 40, preference: 30,
}

const LANES = ['city', 'day', 'attraction', 'hotel', 'meal', 'weather', 'budget', 'preference']

// 转义 LLM 生成内容，避免 tooltip HTML 注入
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]))
const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack']

// 布局常量（像素）
const COLUMN_WIDTH = 280
const CITY_ROOT_Y = -390 // 多城市根节点
const CITY_Y = -280
const WEATHER_Y = -140
const DAY_Y = 0
const ATTRACTION_BASE_Y = 140
const ATTRACTION_GAP = 100
const MEAL_GAP = 90
const LANE_GAP = 40
const SIDE_NODE_GAP = 90 // 预算/建议列

export function buildTripGraph(tripPlan, t) {
  const days = Array.isArray(tripPlan?.days) ? tripPlan.days : []
  const nodes = []
  const edges = []
  const nodeIds = new Set()
  const categories = LANES.map((lane) => ({ name: t(`result.graph.cat.${lane}`) }))

  const addNode = (id, name, lane, value = '', extra = {}) => {
    if (!name || nodeIds.has(id)) return
    nodeIds.add(id)
    nodes.push({
      id,
      name,
      category: LANES.indexOf(lane),
      symbolSize: NODE_SIZES[lane] ?? 30,
      itemStyle: { color: NODE_COLORS[lane] ?? '#999' },
      value,
      lane,
      dayIndex: extra.dayIndex ?? null,
      slot: extra.slot ?? 0,
      daySpan: extra.daySpan ?? null,
      arrayIndex: extra.arrayIndex,
    })
  }
  const addEdge = (source, target, label = '', main = false) => {
    edges.push({ source, target, label, main })
  }

  // ---- 1. 城市节点（支持多城市）----
  const cities = Array.isArray(tripPlan?.cities) && tripPlan.cities.length
    ? tripPlan.cities
    : [tripPlan?.city || '']
  const dateRange = `${tripPlan?.start_date || ''} ~ ${tripPlan?.end_date || ''}`
  const allSpan = days.length ? [days[0].day_index, days[days.length - 1].day_index] : [0, 0]
  const cityNodeIds = {}
  let rootId

  if (cities.length > 1) {
    rootId = 'trip_root'
    addNode(rootId, cities.join(' → '), 'city', dateRange, { daySpan: allSpan, slot: -1 })
    cities.forEach((name, i) => {
      const cid = `city_${name}`
      const cityDays = days.filter((d) => (d.city || tripPlan.city) === name)
      const span = cityDays.length
        ? [cityDays[0].day_index, cityDays[cityDays.length - 1].day_index]
        : allSpan
      addNode(cid, name, 'city', '', { daySpan: span, slot: i })
      addEdge(rootId, cid, t('result.graph.edge.itinerary'))
      cityNodeIds[name] = cid
    })
  } else {
    rootId = `city_${cities[0]}`
    addNode(rootId, cities[0], 'city', dateRange, { daySpan: allSpan, slot: 0 })
    cityNodeIds[cities[0]] = rootId
  }

  // ---- 2. 每日节点 + 景点/酒店/餐饮 + 天与天主线 ----
  days.forEach((day, arrayIndex) => {
    const dayId = `day_${day.day_index}`
    const parentId = cityNodeIds[day.city || tripPlan.city] || rootId
    addNode(dayId, t('result.graph.dayN', { n: day.day_index + 1 }), 'day', day.date || '', {
      dayIndex: day.day_index,
      arrayIndex,
    })
    addEdge(parentId, dayId, t('result.graph.edge.itinerary'))
    if (arrayIndex > 0) {
      addEdge(`day_${days[arrayIndex - 1].day_index}`, dayId, '', true)
    }

    const attractions = Array.isArray(day.attractions) ? day.attractions : []
    attractions.forEach((attr, i) => {
      const attrId = `attr_${day.day_index}_${i}_${attr.name}`
      const parts = []
      if (attr.address) parts.push(attr.address)
      if (attr.visit_duration) parts.push(t('result.graph.visitDuration', { min: attr.visit_duration }))
      if (attr.ticket_price) parts.push(t('result.graph.ticketPrice', { price: attr.ticket_price }))
      addNode(attrId, attr.name, 'attraction', parts.join(' | '), { dayIndex: day.day_index, slot: i })
      addEdge(dayId, attrId, t('result.graph.edge.visit'))
      if (i > 0) {
        addEdge(`attr_${day.day_index}_${i - 1}_${attractions[i - 1].name}`, attrId, t('result.graph.edge.next'))
      }
    })

    if (day.hotel?.name) {
      const hotelId = `hotel_${day.day_index}_${day.hotel.name}`
      const value = day.hotel.estimated_cost
        ? t('result.graph.hotelCost', { range: day.hotel.price_range || '', cost: day.hotel.estimated_cost })
        : day.hotel.price_range || ''
      addNode(hotelId, day.hotel.name, 'hotel', value, { dayIndex: day.day_index, slot: 0 })
      addEdge(dayId, hotelId, t('result.graph.edge.checkin'))
    }

    const meals = Array.isArray(day.meals) ? day.meals : []
    meals.forEach((meal, j) => {
      const typeLabel = MEAL_TYPES.includes(meal.type) ? t(`result.meals.${meal.type}`) : meal.type || ''
      const mealId = `meal_${day.day_index}_${j}_${meal.name}`
      addNode(mealId, `${typeLabel}: ${meal.name}`, 'meal',
        meal.estimated_cost ? `¥${meal.estimated_cost}` : '', { dayIndex: day.day_index, slot: j })
      addEdge(dayId, mealId, typeLabel)
    })
  })

  // ---- 3. 天气（关联到对应天）----
  const weatherList = Array.isArray(tripPlan?.weather_info) ? tripPlan.weather_info : []
  for (const w of weatherList) {
    const day = days.find((d) => d.date === w.date)
    if (!day) continue
    const wId = `weather_${w.date}`
    addNode(wId, `${w.day_weather || ''} ${w.day_temp ?? ''}°C`, 'weather', w.date || '', {
      dayIndex: day.day_index,
    })
    addEdge(`day_${day.day_index}`, wId, t('result.graph.edge.weather'))
  }

  // ---- 4. 预算（挂最右端一列）----
  const sideColumn = days.length ? days[days.length - 1].day_index + 1 : 0
  if (tripPlan?.budget) {
    const b = tripPlan.budget
    addNode('budget_total', t('result.graph.totalBudget', { total: b.total }), 'budget', '', {
      dayIndex: sideColumn, slot: 0,
    })
    addEdge(rootId, 'budget_total', t('result.graph.edge.budget'))
    const subItems = [
      ['attraction', b.total_attractions],
      ['hotel', b.total_hotels],
      ['meal', b.total_meals],
      ['transport', b.total_transportation],
      ['interCity', b.total_inter_city_transport],
    ]
    let slot = 1
    for (const [key, value] of subItems) {
      if (!value) continue
      const label = key === 'interCity' ? t('result.graph.budgetItem.interCity') : t(`result.budget.${key}`)
      addNode(`budget_${key}`, `${label} ¥${value}`, 'budget', '', { dayIndex: sideColumn, slot })
      addEdge('budget_total', `budget_${key}`, label)
      slot += 1
    }
  }

  // ---- 5. 总体建议 ----
  if (tripPlan?.overall_suggestions) {
    const text = String(tripPlan.overall_suggestions)
    addNode('suggestion_overall', text.length > 30 ? `${text.slice(0, 30)}...` : text,
      'preference', text, { dayIndex: sideColumn, slot: 99 })
    addEdge(rootId, 'suggestion_overall', t('result.graph.edge.suggestion'))
  }

  return { nodes, edges, categories }
}

export function buildGraphOption(graph) {
  const dayNodes = graph.nodes.filter((n) => n.lane === 'day')
  const numDays = dayNodes.length
  if (!numDays) return null

  // 各泳道全局最大堆叠数，用于推算泳道基准 y，保证任意列不重叠
  const maxStack = (lane) => Math.max(0, ...graph.nodes.filter((n) => n.lane === lane).map((n) => n.slot + 1))
  const mealBaseY = ATTRACTION_BASE_Y + maxStack('attraction') * ATTRACTION_GAP + LANE_GAP
  const hotelBaseY = mealBaseY + maxStack('meal') * MEAL_GAP + LANE_GAP
  const budgetSlots = maxStack('budget')

  const positionOf = (node) => {
    switch (node.lane) {
      case 'city': {
        const span = node.daySpan || [0, 0]
        return [((span[0] + span[1]) / 2) * COLUMN_WIDTH, node.slot < 0 ? CITY_ROOT_Y : CITY_Y]
      }
      case 'weather':
        return [node.dayIndex * COLUMN_WIDTH, WEATHER_Y]
      case 'day':
        return [node.dayIndex * COLUMN_WIDTH, DAY_Y]
      case 'attraction':
        return [node.dayIndex * COLUMN_WIDTH, ATTRACTION_BASE_Y + node.slot * ATTRACTION_GAP]
      case 'meal':
        return [node.dayIndex * COLUMN_WIDTH, mealBaseY + node.slot * MEAL_GAP]
      case 'hotel':
        return [node.dayIndex * COLUMN_WIDTH, hotelBaseY]
      case 'budget':
        return [node.dayIndex * COLUMN_WIDTH, DAY_Y + node.slot * SIDE_NODE_GAP]
      case 'preference':
        return [node.dayIndex * COLUMN_WIDTH, DAY_Y + (budgetSlots + 1) * SIDE_NODE_GAP]
      default:
        return [0, 0]
    }
  }

  const data = graph.nodes.map((node) => {
    const [x, y] = positionOf(node)
    return { ...node, x, y }
  })

  return {
    tooltip: {
      formatter: (params) => (params.dataType === 'node'
        ? `<b>${escapeHtml(params.data.name)}</b>${params.data.value ? `<br/>${escapeHtml(params.data.value)}` : ''}`
        : ''),
    },
    legend: { data: graph.categories.map((c) => c.name), top: 8, textStyle: { fontSize: 12 } },
    series: [{
      type: 'graph',
      layout: 'none',
      roam: true,
      // ponytail: 初始 zoom 按 1080px 视口估算，用户可 roam 调整；不理想再按容器实测
      zoom: Math.min(1, 1080 / ((numDays + 1) * COLUMN_WIDTH)),
      data,
      edges: graph.edges.map((e) => ({
        source: e.source,
        target: e.target,
        lineStyle: e.main
          ? { width: 4, color: '#C4603D', curveness: 0 }
          : { width: 1.5, color: '#C9BFAF', curveness: 0.05 },
      })),
      categories: graph.categories,
      label: { show: true, position: 'bottom', fontSize: 11, width: 110, overflow: 'truncate' },
      emphasis: { focus: 'adjacency' },
    }],
  }
}
