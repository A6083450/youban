import type { TripPlan } from '@/types'

export interface TripGraphNode {
  id: string
  name: string
  category: number
  symbolSize: number
  itemStyle: { color: string }
  value: string
  lane: string
  dayIndex: number | null
  slot: number
  daySpan: [number, number] | null
  arrayIndex?: number
}

export interface TripGraphEdge {
  source: string
  target: string
  label: string
  main: boolean
}

export interface TripGraphData {
  nodes: TripGraphNode[]
  edges: TripGraphEdge[]
  categories: { name: string }[]
}

export declare function buildTripGraph(
  tripPlan: TripPlan,
  t: (key: string, params?: Record<string, unknown>) => string,
): TripGraphData

export declare function buildGraphOption(graph: TripGraphData): Record<string, any> | null
