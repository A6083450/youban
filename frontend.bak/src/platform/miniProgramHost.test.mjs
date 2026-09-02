import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isMiniProgramEmbedded,
  nativeActionPageUrl,
  nativeAccountActionPageUrl,
  shouldRegisterPwa,
  navigateToNativeAction,
  reLaunchMiniProgramLogin,
} from './miniProgramHost.ts'
import * as miniProgramHost from './miniProgramHost.ts'

test('detects only the explicit mini-program WebView host', () => {
  assert.equal(isMiniProgramEmbedded({ search: '?host=miniprogram' }), true)
  assert.equal(isMiniProgramEmbedded({ search: '?host=browser' }), false)
  assert.equal(isMiniProgramEmbedded({ search: '' }, 'miniprogram'), true)
  assert.equal(isMiniProgramEmbedded({ search: '' }, 'browser'), false)
  assert.equal(shouldRegisterPwa({ search: '?host=miniprogram' }), false)
  assert.equal(shouldRegisterPwa({ search: '' }), true)
})

test('builds one generic native action route and rejects malformed tickets', () => {
  const actionId = 'a'.repeat(43)
  assert.equal(nativeActionPageUrl(actionId), `/pages/native-action/index?action_id=${actionId}`)
  assert.throws(() => nativeActionPageUrl('bad/id'), /动作票据无效/)
  assert.equal(nativeAccountActionPageUrl('avatar'), '/pages/native-action/index?mode=avatar')
  assert.equal(nativeAccountActionPageUrl('logout'), '/pages/native-action/index?mode=logout')
})

test('uses the injected WeChat bridge for actions and expired-login recovery', () => {
  const calls = []
  const bridge = {
    navigateTo: ({ url }) => calls.push(['navigateTo', url]),
    reLaunch: ({ url }) => calls.push(['reLaunch', url]),
  }
  const actionId = 'b'.repeat(43)
  assert.equal(navigateToNativeAction(actionId, bridge), true)
  assert.equal(reLaunchMiniProgramLogin(bridge), true)
  assert.deepEqual(calls, [
    ['navigateTo', `/pages/native-action/index?action_id=${actionId}`],
    ['reLaunch', '/pages/login/index'],
  ])
  assert.equal(navigateToNativeAction(actionId, undefined), false)
})

test('maps routes to one shared mobile header contract', () => {
  const resolveMobileHeaderState = miniProgramHost.resolveMobileHeaderState
  assert.equal(typeof resolveMobileHeaderState, 'function')

  assert.deepEqual(resolveMobileHeaderState('ChatHome', false), {
    variant: 'private',
    showMenu: true,
    showHome: false,
    showNewPlan: true,
    showAccount: true,
  })
  assert.deepEqual(resolveMobileHeaderState('PlanView', true), {
    variant: 'private',
    showMenu: true,
    showHome: false,
    showNewPlan: true,
    showAccount: true,
  })
  assert.deepEqual(resolveMobileHeaderState('Share', true), {
    variant: 'public',
    showMenu: false,
    showHome: false,
    showNewPlan: false,
    showAccount: false,
  })
  assert.deepEqual(resolveMobileHeaderState('Privacy', false), {
    variant: 'public',
    showMenu: false,
    showHome: true,
    showNewPlan: false,
    showAccount: false,
  })
  assert.deepEqual(resolveMobileHeaderState('Login', true), {
    variant: 'hidden',
    showMenu: false,
    showHome: false,
    showNewPlan: false,
    showAccount: false,
  })
  assert.deepEqual(resolveMobileHeaderState('Admin', false), {
    variant: 'hidden',
    showMenu: false,
    showHome: false,
    showNewPlan: false,
    showAccount: false,
  })
})

test('uses the compact brand title only inside the mini-program WebView', () => {
  const resolveDocumentTitle = miniProgramHost.resolveDocumentTitle
  assert.equal(typeof resolveDocumentTitle, 'function')
  assert.equal(resolveDocumentTitle(true, '游伴', '游伴 · AI 旅行智能体'), '游伴')
  assert.equal(resolveDocumentTitle(false, '游伴', '游伴 · AI 旅行智能体'), '游伴 · AI 旅行智能体')
})

test('relaunches the mini-program shell with the current safe route when its navigation color changes', () => {
  const syncMiniProgramNavigationColor = miniProgramHost.syncMiniProgramNavigationColor
  assert.equal(typeof syncMiniProgramNavigationColor, 'function')

  const relaunches = []
  const bridge = {
    reLaunch: ({ url }) => relaunches.push(url),
  }
  const location = {
    pathname: '/plan/plan-123',
    search: '?host=miniprogram&section=weather',
  }

  assert.equal(syncMiniProgramNavigationColor('#eef7f9', location, '', bridge), true)
  assert.deepEqual(relaunches, [
    '/pages/web/index?nav_color=eef7f9&plan_id=plan-123&section=weather',
  ])
  assert.equal(syncMiniProgramNavigationColor('#eef7f9', {
    ...location,
    search: '?host=miniprogram&section=weather&mini_nav=eef7f9',
  }, '', bridge), false)
  assert.equal(syncMiniProgramNavigationColor('not-a-color', location, '', bridge), false)
  assert.equal(syncMiniProgramNavigationColor('#fffaf6', {
    ...location,
    pathname: '/',
    search: '',
  }, '', bridge), false)

  assert.equal(syncMiniProgramNavigationColor('#fffaf6', {
    pathname: '/',
    search: '?host=miniprogram&conversation=session-123',
  }, '', bridge), true)
  assert.equal(syncMiniProgramNavigationColor('#eef7f9', {
    pathname: `/share/${'a'.repeat(32)}`,
    search: '?host=miniprogram',
  }, '', bridge), true)
  assert.equal(syncMiniProgramNavigationColor('#eef7f9', {
    pathname: '/privacy',
    search: '?host=miniprogram',
  }, '', bridge), true)
  assert.deepEqual(relaunches.slice(1), [
    '/pages/web/index?nav_color=fffaf6&conversation=session-123',
    `/pages/web/index?nav_color=eef7f9&share=${'a'.repeat(32)}`,
    '/pages/web/index?nav_color=eef7f9&path=%2Fprivacy',
  ])
})
