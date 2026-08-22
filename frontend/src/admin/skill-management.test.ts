import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import type { Server } from 'bun'
import {
  adminActivateSkill,
  adminArchiveSkill,
  adminCheckSkillUpdate,
  adminConfigureSkill,
  adminGetSkill,
  adminInstallGitSkill,
  adminListSkills,
  adminRestoreSkill,
  adminSaveSkillCandidate,
  adminUploadSkill,
  isAdminAuthError,
  setAdminToken,
} from '../services/api'
import type {
  AdminError,
  AdminSkillCapabilities,
  AdminSkillDetail,
  AdminSkillListResponse,
  AdminSkillSummary,
  AdminSkillVersion,
} from '../types'
import {
  ADMIN_SKILL_AGENT_IDS,
  adminSkillSourceKey,
  adminSkillStateKey,
  beginCandidateEdit,
  filterAdminSkills,
  localizeAdminSkillError,
  setSkillAssignment,
  skillActions,
  skillInstallSources,
  sortAdminSkillVersions,
  toSkillConfiguration,
  validateGitInstallInput,
  validateSkillArchive,
  validateZipSelection,
} from './skill-management'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value))
  }
}

const localStorage = new MemoryStorage()
const sessionStorage = new MemoryStorage()
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    dispatchEvent: () => true,
    localStorage,
    location: { origin: 'http://localhost' },
    sessionStorage,
  },
})

const version = (
  version_number: number,
  id = `version-${version_number}`,
  state: AdminSkillVersion['state'] = 'active',
): AdminSkillVersion => ({
  id,
  skill_id: 'museum-guide-id',
  version_number,
  state,
  content: `---\nname: museum-guide\ndescription: Version ${version_number}\n---`,
  name: 'museum-guide',
  description: `Version ${version_number}`,
  sha256: String(version_number).repeat(64).slice(0, 64),
  source_commit: null,
  created_at: `2026-08-22T00:0${version_number}:00.000Z`,
  activated_at: state === 'active' ? `2026-08-22T00:1${version_number}:00.000Z` : null,
})

const summary = (overrides: Partial<AdminSkillSummary> = {}): AdminSkillSummary => ({
  id: 'museum-guide-id',
  name: 'museum-guide',
  description: 'Museum and gallery planning',
  kind: 'custom',
  source: 'git',
  state: 'candidate',
  enabled: false,
  agent_ids: ['segment-planner', 'itinerary-reviewer'],
  active_version_id: 'version-1',
  candidate_version_id: 'version-2',
  repository_url: 'https://git.example.test/org/skills.git',
  source_ref: 'main',
  source_subdirectory: 'museum-guide',
  generation: 2,
  archived_at: null,
  ...overrides,
})

const detail = (overrides: Partial<AdminSkillDetail> = {}): AdminSkillDetail => ({
  ...summary(),
  active_version: version(1),
  candidate_version: version(2, 'version-2', 'candidate'),
  versions: [version(1), version(2, 'version-2', 'candidate')],
  ...overrides,
})

describe('admin Skill pure state helpers', () => {
  it('filters query, source, and candidate state without treating disabled as the display state', () => {
    const skills = Object.freeze([
      Object.freeze(summary()),
      Object.freeze(summary({
        id: 'builtin-id',
        name: 'trip-planning',
        description: 'General planning',
        kind: 'builtin',
        source: 'builtin',
        state: 'enabled',
        enabled: true,
        candidate_version_id: null,
      })),
    ])
    const snapshot = structuredClone(skills)

    const filtered = filterAdminSkills(skills, {
      query: '  MUSEUM  ',
      source: 'git',
      state: 'candidate',
    })

    expect(filtered.map((skill) => skill.name)).toEqual(['museum-guide'])
    expect(filtered).not.toBe(skills)
    expect(skills).toEqual(snapshot)
  })

  it('returns semantic source and badge keys for every source and state', () => {
    expect(adminSkillSourceKey(summary({ source: 'builtin' }))).toBe('builtin')
    expect(adminSkillSourceKey(summary({ source: 'upload' }))).toBe('upload')
    expect(adminSkillSourceKey(summary({ source: 'git' }))).toBe('git')

    expect(adminSkillStateKey(summary({
      state: 'archived',
      archived_at: '2026-08-22T01:00:00.000Z',
    }))).toBe('archived')
    expect(adminSkillStateKey(summary({ enabled: false, candidate_version_id: 'version-2' }))).toBe('candidate')
    expect(adminSkillStateKey(summary({
      state: 'enabled',
      enabled: true,
      candidate_version_id: null,
    }))).toBe('enabled')
    expect(adminSkillStateKey(summary({
      state: 'disabled',
      enabled: false,
      candidate_version_id: null,
    }))).toBe('disabled')
  })

  it('makes built-in and custom edit, archive, restore, update, and install decisions from semantic keys', () => {
    const builtin = summary({
      kind: 'builtin',
      source: 'builtin',
      state: 'disabled',
      enabled: false,
      candidate_version_id: null,
    })
    const enabledCustom = summary({ state: 'enabled', enabled: true, candidate_version_id: null })
    const disabledCustom = summary({ state: 'disabled', enabled: false, candidate_version_id: null })
    const archivedCustom = summary({
      state: 'archived',
      archived_at: '2026-08-22T01:00:00.000Z',
    })

    expect(skillActions(builtin)).toEqual([])
    expect(skillActions(enabledCustom)).toEqual(['edit', 'check-update'])
    expect(skillActions(disabledCustom)).toEqual(['edit', 'check-update', 'archive'])
    expect(skillActions(archivedCustom)).toEqual(['restore'])

    const capabilityCases = [
      [{ git_available: false, private_git_credentials_available: false }, ['upload']],
      [{ git_available: false, private_git_credentials_available: true }, ['upload']],
      [{ git_available: true, private_git_credentials_available: false }, ['upload', 'git']],
      [{ git_available: true, private_git_credentials_available: true }, ['upload', 'git']],
    ] as const
    for (const [capabilities, expected] of capabilityCases) {
      const frozen = Object.freeze(capabilities) satisfies AdminSkillCapabilities
      expect(skillInstallSources(frozen)).toEqual(expected)
      expect(frozen).toEqual(capabilities)
    }
    expect(skillActions(summary({
      source: 'upload',
      state: 'disabled',
      enabled: false,
      candidate_version_id: null,
    }))).toEqual(['edit', 'archive'])
  })

  it('sorts versions ascending, preserves tie order, and never mutates the caller array', () => {
    const versions = Object.freeze([
      Object.freeze(version(3)),
      Object.freeze(version(1)),
      Object.freeze(version(2, 'version-2-first')),
      Object.freeze(version(2, 'version-2-second')),
    ])

    const sorted = sortAdminSkillVersions(versions)

    expect(sorted.map((item) => item.id)).toEqual([
      'version-1',
      'version-2-first',
      'version-2-second',
      'version-3',
    ])
    expect(versions.map((item) => item.version_number)).toEqual([3, 1, 2, 2])
  })

  it('preserves and clones assignments while globally disabled', () => {
    const skill = summary()
    const configuration = toSkillConfiguration(skill, false)

    expect(configuration).toEqual({
      enabled: false,
      agent_ids: ['segment-planner', 'itinerary-reviewer'],
    })
    expect(configuration.agent_ids).not.toBe(skill.agent_ids)
    configuration.agent_ids.pop()
    expect(skill.agent_ids).toEqual(['segment-planner', 'itinerary-reviewer'])
  })

  it('does not replace active content when candidate editing begins', () => {
    const state = beginCandidateEdit(detail())

    expect(state.editorContent).toBe(detail().candidate_version?.content)
    expect(state.activeVersionId).toBe(detail().active_version?.id)
    expect(state.dirty).toBe(false)

    const withoutCandidate = detail({ candidate_version: null, candidate_version_id: null })
    expect(beginCandidateEdit(withoutCandidate).editorContent).toBe(withoutCandidate.active_version?.content)
  })

  it('requires a disabled custom skill before archive', () => {
    const customEnabled = summary({ state: 'enabled', enabled: true, candidate_version_id: null })
    const customDisabled = summary({ state: 'disabled', enabled: false, candidate_version_id: null })
    const builtinDisabled = summary({
      kind: 'builtin',
      source: 'builtin',
      state: 'disabled',
      enabled: false,
      candidate_version_id: null,
    })

    expect(skillActions(customEnabled)).not.toContain('archive')
    expect(skillActions(customDisabled)).toContain('archive')
    expect(skillActions(builtinDisabled)).not.toContain('archive')
    expect(validateSkillArchive(customEnabled)).toBe('skill_must_be_disabled')
    expect(validateSkillArchive(customDisabled)).toBeNull()
    expect(validateSkillArchive(builtinDisabled)).toBe('builtin_skill_immutable')
  })

  it('toggles only known assignments without mutating the current selection', () => {
    const selected = Object.freeze(['segment-planner', 'summary'] as const)
    const added = setSkillAssignment(selected, 'plan-editor', true)
    const removed = setSkillAssignment(added, 'summary', false)

    expect(ADMIN_SKILL_AGENT_IDS).toHaveLength(6)
    expect(added).toEqual(['segment-planner', 'summary', 'plan-editor'])
    expect(removed).toEqual(['segment-planner', 'plan-editor'])
    expect(selected).toEqual(['segment-planner', 'summary'])
  })

  it('accepts exactly one zip and validates credential-free HTTPS Git input', () => {
    const zip = new File(['zip'], 'museum-guide.zip', { type: 'application/zip' })
    expect(validateZipSelection([zip])).toBeNull()
    expect(validateZipSelection([])).toBe('zip_required')
    expect(validateZipSelection([zip, zip])).toBe('zip_single_file')
    expect(validateZipSelection([new File(['text'], 'SKILL.md')])).toBe('zip_extension')

    expect(validateGitInstallInput({ repository_url: 'https://example.test/skills.git' })).toBeNull()
    expect(validateGitInstallInput({ repository_url: 'http://example.test/skills.git' })).toBe('invalid_git_url')
    expect(validateGitInstallInput({ repository_url: 'https://token@example.test/skills.git' })).toBe('invalid_git_url')
    expect(validateGitInstallInput({
      repository_url: 'https://example.test/skills.git',
      subdirectory: '../private',
    })).toBe('invalid_git_subdirectory')
  })

  it('maps stable backend errors without rendering server details', () => {
    expect(localizeAdminSkillError({ code: 'invalid_skill_frontmatter' })).toBe(
      'admin.skills.errors.invalid_skill_frontmatter',
    )
    expect(localizeAdminSkillError({ code: 'unknown_backend_error' })).toBe(
      'admin.skills.errors.fallback',
    )
    expect(localizeAdminSkillError(new Error('secret token abc'))).toBe(
      'admin.skills.errors.fallback',
    )
    for (const code of [
      'skill_service_closed',
      'package_commit_failed',
      'skill_activation_failed',
      'invalid_zip_entry',
      'git_output_too_large',
      'internal_error',
    ]) {
      expect(localizeAdminSkillError({ code })).toBe(`admin.skills.errors.${code}`)
    }
  })
})

interface CapturedRequest {
  method: string
  path: string
  token: string | null
  content_type: string | null
  body: unknown
}

const requests: CapturedRequest[] = []
const listResponse: AdminSkillListResponse = {
  items: [summary()],
  capabilities: {
    git_available: true,
    private_git_credentials_available: false,
  },
}
const mutationResponse = { skill: detail() }
const updateResponse = { changed: false, skill: detail() }
let server: Server<unknown>

const json = (body: unknown, status = 200): Response => Response.json(body, { status })

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname.endsWith('/invalid')) {
        return json({
          detail: '技能文档无效',
          code: 'invalid_skill_document',
          private_context: { token: 'must-not-escape' },
        }, 422)
      }
      if (url.pathname.endsWith('/unauthorized')) {
        return json({ detail: '后台密码校验失败，请重新登录', code: 'invalid_admin_token' }, 401)
      }
      if (url.pathname.endsWith('/malformed')) {
        return json({ detail: { token: 'must-not-escape' }, code: ['internal_error'] }, 500)
      }
      if (url.pathname.endsWith('/non-object')) {
        return new Response('private backend response', { status: 500 })
      }

      const contentType = request.headers.get('content-type')
      let body: unknown = null
      if (contentType?.startsWith('multipart/form-data')) {
        const form = await request.formData()
        const file = form.get('file')
        body = file instanceof File
          ? { field: 'file', name: file.name, size: file.size, type: file.type }
          : null
      } else if (request.method !== 'GET' && request.method !== 'DELETE') {
        const text = await request.text()
        body = text ? JSON.parse(text) : null
      }
      requests.push({
        method: request.method,
        path: `${url.pathname}${url.search}`,
        token: request.headers.get('x-admin-token'),
        content_type: contentType,
        body,
      })

      if (url.pathname === '/api/admin/skills') return json(listResponse)
      if (url.pathname.endsWith('/check-update')) return json(updateResponse)
      return json(mutationResponse, url.pathname.endsWith('/upload') || url.pathname.endsWith('/git') ? 201 : 200)
    },
  })
  localStorage.setItem('tripstar.runtime.api_base_url', server.url.origin)
})

beforeEach(() => {
  requests.length = 0
  localStorage.setItem('tripstar.runtime.api_base_url', server.url.origin)
  sessionStorage.clear()
  setAdminToken(' live-admin-token ')
})

afterAll(async () => {
  await server.stop(true)
  Reflect.deleteProperty(globalThis, 'window')
})

describe('admin Skill API client', () => {
  it('uses the shared client for all ten exact method, encoded path, body, header, and response contracts', async () => {
    const encodedId = 'museum%2Fguide%20%3F%23'
    const skillId = 'museum/guide ?#'
    const frozenConfiguration = Object.freeze({
      enabled: false,
      agent_ids: Object.freeze(['segment-planner', 'itinerary-reviewer'] as const),
    })

    const filters = Object.freeze({
      archived: true,
      query: ' museum & art ',
      source: 'git' as const,
      state: 'candidate' as const,
    })
    const gitInput = Object.freeze({
      repository_url: 'https://git.example.test/org/skills.git',
      ref: '   ',
      subdirectory: ' skills/museum-guide ',
    })

    expect(await adminListSkills(filters)).toEqual(listResponse)
    expect(await adminGetSkill(skillId)).toEqual(mutationResponse)
    expect(await adminUploadSkill(new File(['zip'], 'museum guide.zip', { type: 'application/zip' })))
      .toEqual(mutationResponse)
    expect(await adminInstallGitSkill(gitInput)).toEqual(mutationResponse)
    expect(await adminCheckSkillUpdate(skillId)).toEqual(updateResponse)
    expect(await adminSaveSkillCandidate(skillId, '  exact candidate content\n')).toEqual(mutationResponse)
    expect(await adminActivateSkill(skillId, frozenConfiguration)).toEqual(mutationResponse)
    expect(await adminConfigureSkill(skillId, frozenConfiguration)).toEqual(mutationResponse)
    expect(await adminArchiveSkill(skillId)).toEqual(mutationResponse)
    expect(await adminRestoreSkill(skillId)).toEqual(mutationResponse)

    expect(requests.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
      {
        method: 'GET',
        path: '/api/admin/skills?query=museum+%26+art&source=git&state=candidate&archived=true',
        body: null,
      },
      { method: 'GET', path: `/api/admin/skills/${encodedId}`, body: null },
      {
        method: 'POST',
        path: '/api/admin/skills/upload',
        body: { field: 'file', name: 'museum guide.zip', size: 3, type: 'application/zip' },
      },
      {
        method: 'POST',
        path: '/api/admin/skills/git',
        body: {
          repository_url: 'https://git.example.test/org/skills.git',
          subdirectory: 'skills/museum-guide',
        },
      },
      { method: 'POST', path: `/api/admin/skills/${encodedId}/check-update`, body: null },
      {
        method: 'PUT',
        path: `/api/admin/skills/${encodedId}/candidate`,
        body: { content: '  exact candidate content\n' },
      },
      {
        method: 'POST',
        path: `/api/admin/skills/${encodedId}/activate`,
        body: { enabled: false, agent_ids: ['segment-planner', 'itinerary-reviewer'] },
      },
      {
        method: 'PUT',
        path: `/api/admin/skills/${encodedId}/configuration`,
        body: { enabled: false, agent_ids: ['segment-planner', 'itinerary-reviewer'] },
      },
      { method: 'DELETE', path: `/api/admin/skills/${encodedId}`, body: null },
      { method: 'POST', path: `/api/admin/skills/${encodedId}/restore`, body: null },
    ])
    expect(requests.every((request) => request.token === 'live-admin-token')).toBeTrue()
    expect(requests[2]?.content_type).toStartWith('multipart/form-data; boundary=')
    expect(frozenConfiguration.agent_ids).toEqual(['segment-planner', 'itinerary-reviewer'])
    expect(filters).toEqual({
      archived: true,
      query: ' museum & art ',
      source: 'git',
      state: 'candidate',
    })
    expect(gitInput).toEqual({
      repository_url: 'https://git.example.test/org/skills.git',
      ref: '   ',
      subdirectory: ' skills/museum-guide ',
    })
  })

  it('omits empty optional filters and Git inputs', async () => {
    await adminListSkills({ archived: false, query: '   ' })
    await adminInstallGitSkill({
      repository_url: ' https://git.example.test/org/skills.git ',
      ref: '',
      subdirectory: '   ',
    })

    expect(requests[0]?.path).toBe('/api/admin/skills')
    expect(requests[1]?.body).toEqual({
      repository_url: 'https://git.example.test/org/skills.git',
    })
  })

  it('normalizes backend errors without exposing raw response objects', async () => {
    const invalid = await captureAdminError(() => adminGetSkill('invalid'))
    expect(invalid).toBeInstanceOf(Error)
    expect(invalid.message).toBe('技能文档无效')
    expect(invalid.status).toBe(422)
    expect(invalid.code).toBe('invalid_skill_document')
    expect(invalid.unauthorized).toBeFalse()
    expect(isAdminAuthError(invalid)).toBeFalse()
    expect((invalid as unknown as Record<string, unknown>).response).toBeUndefined()
    expect(JSON.stringify(invalid)).not.toContain('must-not-escape')

    const unauthorized = await captureAdminError(() => adminGetSkill('unauthorized'))
    expect(unauthorized.status).toBe(401)
    expect(unauthorized.code).toBe('invalid_admin_token')
    expect(unauthorized.unauthorized).toBeTrue()
    expect(isAdminAuthError(unauthorized)).toBeTrue()
  })

  it('uses safe fallbacks for malformed, non-object, and network responses', async () => {
    for (const id of ['malformed', 'non-object']) {
      const error = await captureAdminError(() => adminGetSkill(id))
      expect(error.message).toBe('读取技能详情失败')
      expect(error.status).toBe(500)
      expect(error.code).toBeNull()
      expect(error.unauthorized).toBeFalse()
      expect(JSON.stringify(error)).not.toContain('private backend response')
      expect(JSON.stringify(error)).not.toContain('must-not-escape')
    }

    const closedServer = Bun.serve({ port: 0, fetch: () => new Response() })
    const closedOrigin = closedServer.url.origin
    await closedServer.stop(true)
    localStorage.setItem('tripstar.runtime.api_base_url', closedOrigin)
    const network = await captureAdminError(() => adminGetSkill('network'))
    expect(network.message).toBe('读取技能详情失败')
    expect(network.status).toBeNull()
    expect(network.code).toBeNull()
    expect(network.unauthorized).toBeFalse()
  })
})

async function captureAdminError(operation: () => Promise<unknown>): Promise<AdminError> {
  try {
    await operation()
    throw new Error('Expected Admin request to fail')
  } catch (error) {
    return error as AdminError
  }
}
