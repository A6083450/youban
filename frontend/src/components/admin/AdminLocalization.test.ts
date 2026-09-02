import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/locale'
import type { AdminSkillDetail } from '@/services/admin'
import AdminRuntimeSettings from './AdminRuntimeSettings.vue'
import AdminSkills from './AdminSkills.vue'
import AdminTrips from './AdminTrips.vue'

const mocks = vi.hoisted(() => ({
  getAdminSettings: vi.fn(),
  saveAdminSettings: vi.fn(),
  getAdminRecords: vi.fn(),
  listAdminSkills: vi.fn(),
  getAdminSkill: vi.fn(),
}))

vi.mock('@/services/admin', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/services/admin')
  return {
    ...actual,
    getAdminSettings: mocks.getAdminSettings,
    saveAdminSettings: mocks.saveAdminSettings,
    getAdminRecords: mocks.getAdminRecords,
    listAdminSkills: mocks.listAdminSkills,
    getAdminSkill: mocks.getAdminSkill,
  }
})

const runtimeSettings = {
  vite_amap_web_key: 'amap-rest',
  vite_amap_web_js_key: 'amap-js',
  google_maps_api_key: 'legacy-google',
  google_maps_proxy: 'legacy-proxy',
  xhs_cookie: 'legacy-cookie',
  openai_api_key: 'secret',
  openai_base_url: 'https://api.example.com/v1',
  openai_model: 'model',
  trip_segment_days: 5,
  trip_segment_concurrency: 8,
  trip_review_enabled: true,
  llm_thinking_enabled: false,
  llm_thinking_visible: false,
  trip_planner_timeout: 120,
  trip_duplicate_repair_rounds: 2,
  pi_parent_session_limit: 64,
  pi_parent_session_idle_seconds: 1800,
  llm_api_style: 'responses' as const,
  chat_edit_agent: 'pi' as const,
}

const skill: AdminSkillDetail = {
  id: 'skill-1',
  name: 'budget-control',
  description: 'Keep travel recommendations within explicit budget constraints without inventing prices.',
  kind: 'builtin' as const,
  source: 'builtin' as const,
  state: 'candidate' as const,
  enabled: false,
  agent_ids: [],
  active_version_id: null,
  candidate_version_id: 'version-1',
  repository_url: null,
  source_ref: null,
  source_subdirectory: null,
  generation: 1,
  archived_at: null,
  active_version: null,
  candidate_version: {
    id: 'version-1',
    skill_id: 'skill-1',
    version_number: 1,
    state: 'candidate' as const,
    content: '# budget-control',
    name: 'budget-control',
    description: 'Keep travel recommendations within explicit budget constraints without inventing prices.',
    sha256: 'hash',
    source_commit: null,
    created_at: '2026-09-01T08:00:00.000Z',
    activated_at: null,
  },
  versions: [],
}
skill.versions = [skill.candidate_version!]

const mountOptions = {
  global: {
    plugins: [i18n],
    stubs: {
      'wd-icon': { template: '<span />' },
      'picker': { template: '<div><slot /></div>' },
      'checkbox': { template: '<input type="checkbox">' },
    },
  },
}

beforeEach(() => {
  mocks.getAdminSettings.mockResolvedValue(runtimeSettings)
  mocks.saveAdminSettings.mockResolvedValue(runtimeSettings)
  mocks.getAdminRecords.mockResolvedValue([])
  mocks.listAdminSkills.mockResolvedValue({
    items: [skill],
    capabilities: { git_available: true, private_git_credentials_available: false },
  })
  mocks.getAdminSkill.mockResolvedValue(skill)
})

describe('后台中文说明', () => {
  it('运行时配置只展示活动字段和中文说明', async () => {
    const wrapper = mount(AdminRuntimeSettings, mountOptions)
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain('模型服务')
    expect(text).toContain('地图配置')
    expect(text).toContain('行程规划流程')
    expect(text).toContain('启用行程复核')
    expect(text).toContain('单次规划天数')
    expect(text).not.toContain('Google Maps')
    expect(text).not.toContain('小红书')
    expect(text).not.toContain('RUNTIME')
    expect(text).not.toContain('MAPS & SOURCES')
    expect(text).not.toContain('PLANNING PIPELINE')
    expect(text).not.toContain('Segment days')
    wrapper.unmount()
  })

  it('技能和记录页不再显示英文栏目名、智能体名或版本状态', async () => {
    const trips = mount(AdminTrips, mountOptions)
    const skills = mount(AdminSkills, mountOptions)
    await flushPromises()

    await skills.get('.skills-list button').trigger('click')
    await flushPromises()

    expect(trips.text()).toContain('用户对话与游玩计划')
    expect(trips.text()).not.toContain('RECORDS')
    expect(skills.text()).not.toContain('SKILLS')
    expect(skills.text()).not.toContain('BUILTIN')
    expect(skills.text()).not.toContain('Parent assistant')
    expect(skills.text()).not.toContain('candidate')
    expect(skills.text()).not.toContain('budget-control')
    expect(skills.text()).not.toContain('Keep travel recommendations')
    expect(skills.text()).toContain('主助手')
    expect(skills.text()).toContain('待审核')
    expect(skills.text()).toContain('预算约束')
    expect(skills.text()).toContain('确保行程建议遵守明确预算')
    trips.unmount()
    skills.unmount()
  })
})
