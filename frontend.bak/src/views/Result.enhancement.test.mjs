import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const resultSource = readFileSync(new URL('./Result.vue', import.meta.url), 'utf8')

describe('Result enhancement lifecycle', () => {
  it('owns and cleans up the one-second background poll', () => {
    expect(resultSource).toContain('startEnhancementPolling')
    expect(resultSource).toContain('stopEnhancementPolling')
    expect(resultSource).toContain('setInterval(() => {')
    expect(resultSource).toContain('}, 1_000)')
    expect(resultSource).toContain('if (isTerminalEnhancementStatus(enhancementStatus.value)) stopEnhancementPolling()')
    expect(resultSource).toContain('const loadPlanById = async (targetPlanId: string) => {\n  stopEnhancementPolling()')
    expect(resultSource).toContain('onBeforeUnmount(() => {\n  stopEnhancementPolling()')
  })

  it('never applies a late enhancement to a different Result operation or route', () => {
    expect(resultSource).toContain('const ownsEnhancementOperation = (operation: PlanOperation): boolean =>')
    expect(resultSource).toContain('operation.lookupId === planId.value')
    expect(resultSource).toContain('if (!ownsEnhancementOperation(operation)) return')
    expect(resultSource).toContain('await restoreTripPlanFromResponse(task.result, operation)')
    expect(resultSource).toContain('if (!props.readonly && planQuality.value === \'fast\'')
  })

  it('does not block a usable fast plan while enhancement runs', () => {
    const pollingSource = resultSource.slice(
      resultSource.indexOf('const startEnhancementPolling'),
      resultSource.indexOf('const refreshExecutionFromBackend'),
    )
    expect(pollingSource).not.toContain('loadingPlan.value')
    expect(pollingSource).not.toContain('retryingFailedPlan.value')
  })
})
