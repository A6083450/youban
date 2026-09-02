import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const homeSource = readFileSync(resolve(process.cwd(), 'src/pages/index/index.vue'), 'utf8')
const planSource = readFileSync(resolve(process.cwd(), 'src/pages/plan/index.vue'), 'utf8')

describe('legacy Youban generation loading experience', () => {
  it('restores the full staged progress card in chat', () => {
    expect(homeSource).toContain('details?: TripTaskDetailDto[]')
    expect(homeSource).toContain('progressItem.details = event.details || progressItem.details || []')
    expect(homeSource).toMatch(/<YoubanGenerationProgress[\s\S]*?:message="item\.text"[\s\S]*?:progress="item\.progress \|\| 0"[\s\S]*?:stage="item\.stage \|\| 'submitted'"[\s\S]*?:details="item\.details \|\| \[\]"/)

    const progressTemplate = homeSource.match(/<YoubanGenerationProgress[\s\S]*?<button v-if="item\.kind === 'done'"/)?.[0] || ''
    expect(progressTemplate).not.toContain('progress-track')
    expect(progressTemplate).not.toContain('progress-value')
  })

  it('restores stages and details when the plan page resumes polling', () => {
    expect(planSource).toContain('const progressStage = ref<TripTaskStageDto>(\'submitted\')')
    expect(planSource).toContain('const progressDetails = ref<TripTaskDetailDto[]>([])')
    expect(planSource).toContain('progressStage.value = status.stage')
    expect(planSource).toContain('progressDetails.value = status.details || []')
    expect(planSource).toMatch(/<YoubanGenerationProgress[\s\S]*?:message="progressText"[\s\S]*?:progress="progress"[\s\S]*?:stage="progressStage"[\s\S]*?:details="progressDetails"/)

    const processingTemplate = planSource.match(/<view v-if="state === 'loading' \|\| state === 'processing'"[\s\S]*?<view v-else-if="state === 'failed'"/)?.[0] || ''
    expect(processingTemplate).not.toContain('progress-track')
    expect(processingTemplate).not.toContain('progress-value')
    expect(processingTemplate).not.toContain('progress-label')
  })
})
