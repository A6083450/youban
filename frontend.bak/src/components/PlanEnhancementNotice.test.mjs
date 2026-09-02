import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const noticeSource = readFileSync(new URL('./PlanEnhancementNotice.vue', import.meta.url), 'utf8')

describe('PlanEnhancementNotice', () => {
  it('covers every enhancement outcome with the required copy', () => {
    expect(noticeSource).toContain('为了减少等待，已先为你生成快速版计划')
    expect(noticeSource).toContain('计划细节已补充完成')
    expect(noticeSource).toContain('当前计划可以正常使用，部分实时信息暂未补充')
    expect(noticeSource).toContain('已保留你的修改，后台补充内容没有覆盖当前计划')
  })

  it('uses a compact spinner while work continues and only permits terminal dismissal', () => {
    expect(noticeSource).toContain('<a-spin v-if="isWorking" size="small"')
    expect(noticeSource).toContain('const isTerminal = computed(() => TERMINAL_STATUSES.has(props.status))')
    expect(noticeSource).toContain('v-if="isTerminal"')
    expect(noticeSource).toContain("class=\"plan-enhancement-notice\"")
    expect(noticeSource).not.toContain('<a-card')
  })
})
