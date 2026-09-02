import type {
  AttractionMutationInputDto,
  AuthResponseDto,
  BudgetItemInputDto,
  BudgetLedgerResponseDto,
  ChatMessageDto,
  ConversationRecordDto,
  ConversationSessionDetailDto,
  ItemExecutionPatchDto,
  ItemExecutionResponseDto,
  ItineraryMutationResponseDto,
  NativeActionDto,
  NativeActionTicketDto,
  ParsedTripDraftDto,
  PoiSearchItemDto,
  PoiSearchResponseDto,
  PublicRuntimeSettingsDto,
  PublicRuntimeSettingsResponseDto,
  SubmitTripPlanResponseDto,
  TripChatEditResponseDto,
  TripConfirmReplyResponseDto,
  TripHistoryItemDto,
  TripParseResponseDto,
  TripPlanRequestDto,
  TripTaskStatusResponseDto,
  UserInfoDto,
  UserMemoryDto,
  UserPreferencesDto,
  UserPreferencesPatchDto,
  WebLoginChallengeCreateDto,
  WebLoginChallengeExchangeDto,
  WebLoginChallengeStatusDto,
  WechatLoginResponseDto,
} from '@youban/contracts'
import { ApiV2Routes } from '@youban/contracts'
import { ApiError, apiRequest, getApiBaseUrl, handleUnauthorizedResponse } from '@/http/client'
import { t } from '@/locale'

function errorMessage(data: unknown, fallback: string): string {
  if (typeof data === 'object' && data !== null && 'detail' in data) {
    const detail = (data as { detail?: unknown }).detail
    if (typeof detail === 'string' && detail.trim())
      return detail
  }
  return fallback
}

function fillRoute(template: string, name: string, value: string): string {
  return template.replace(`:${name}`, encodeURIComponent(value))
}

export function taskStatusPath(taskId: string): string {
  return fillRoute(ApiV2Routes.tripStatus, 'taskId', taskId)
}

export function taskEventsPath(taskId: string): string {
  return fillRoute(ApiV2Routes.tripEvents, 'taskId', taskId)
}

export function tripRetryPath(planId: string): string {
  return fillRoute(ApiV2Routes.tripRetry, 'planId', planId)
}

export function tripPlanResourcePath(planId: string): string {
  return fillRoute(ApiV2Routes.tripPlanResource, 'planId', planId)
}

export function tripPlanConversationPath(planId: string): string {
  return fillRoute(ApiV2Routes.tripPlanConversation, 'planId', planId)
}

export function tripBudgetItemsPath(planId: string): string {
  return fillRoute(ApiV2Routes.tripBudgetItems, 'planId', planId)
}

export function tripBudgetItemPath(planId: string, itemId: string): string {
  return fillRoute(fillRoute(ApiV2Routes.tripBudgetItem, 'planId', planId), 'itemId', itemId)
}

export function tripItemStatusPath(planId: string, itemId: string): string {
  return fillRoute(fillRoute(ApiV2Routes.tripItemStatus, 'planId', planId), 'itemId', itemId)
}

export function tripAttractionsPath(planId: string): string {
  return fillRoute(ApiV2Routes.tripAttractions, 'planId', planId)
}

export function tripAttractionPath(planId: string, itemId: string): string {
  return fillRoute(fillRoute(ApiV2Routes.tripAttraction, 'planId', planId), 'itemId', itemId)
}

export function conversationPath(sessionId: string): string {
  return fillRoute(ApiV2Routes.conversation, 'sessionId', sessionId)
}

export function authMemoryPath(memoryId: string): string {
  return fillRoute(ApiV2Routes.authMemory, 'memoryId', memoryId)
}

export function tripSharePath(identifier: string): string {
  return fillRoute(ApiV2Routes.tripShare, 'shareCode', identifier)
}

export function miniProgramActionPath(actionId: string): string {
  return fillRoute(ApiV2Routes.miniProgramAction, 'actionId', actionId)
}

export async function authMe(): Promise<UserInfoDto | null> {
  try {
    const response = await apiRequest<AuthResponseDto>(ApiV2Routes.authMe)
    return response.user
  }
  catch {
    return null
  }
}

export function authLogout(token = ''): Promise<void> {
  return apiRequest<void>(ApiV2Routes.authLogout, {
    method: 'POST',
    data: {},
    public: Boolean(token),
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
}

export async function getPublicRuntimeSettings(): Promise<PublicRuntimeSettingsDto> {
  const response = await apiRequest<PublicRuntimeSettingsResponseDto>(ApiV2Routes.runtimeSettings, { public: true })
  return response.data
}

export async function getPoiPhoto(name: string, city: string): Promise<string> {
  const response = await apiRequest<{
    success: true
    data: { name: string, photo_url: string }
  }>('/api/poi/photo', { data: { name, city }, public: true })
  return response.data.photo_url || ''
}

export function getAuthPreferences(): Promise<UserPreferencesDto> {
  return apiRequest(ApiV2Routes.authPreferences)
}

export function patchAuthPreferences(patch: UserPreferencesPatchDto): Promise<UserPreferencesDto> {
  return apiRequest(ApiV2Routes.authPreferences, { method: 'PATCH', data: patch })
}

export async function getUserMemories(): Promise<UserMemoryDto[]> {
  const response = await apiRequest<{ success: true, items: UserMemoryDto[] }>(ApiV2Routes.authMemories)
  return response.items
}

export function deleteUserMemory(memoryId: string): Promise<void> {
  return apiRequest(authMemoryPath(memoryId), { method: 'DELETE' })
}

export function loginWechat(code: string): Promise<WechatLoginResponseDto> {
  return apiRequest(ApiV2Routes.authWechatLogin, {
    method: 'POST',
    data: { code },
    public: true,
  })
}

export function loginNickname(nickname: string): Promise<AuthResponseDto> {
  return apiRequest(ApiV2Routes.authNicknameLogin, {
    method: 'POST',
    data: { nickname },
    public: true,
  })
}

export function uploadAccountAvatar(filePath: string, token: string): Promise<UserInfoDto> {
  return new Promise<UserInfoDto>((resolve, reject) => {
    uni.uploadFile({
      url: `${getApiBaseUrl()}${ApiV2Routes.accountAvatar}`,
      filePath,
      name: 'avatar',
      header: { Authorization: `Bearer ${token}` },
      success(response) {
        let payload: unknown = response.data
        try {
          payload = typeof response.data === 'string' ? JSON.parse(response.data) : response.data
        }
        catch {
          reject(new ApiError(t('api.avatarInvalidResponse'), response.statusCode, response.data))
          return
        }
        const status = Number(response.statusCode)
        if (status < 200 || status >= 300) {
          handleUnauthorizedResponse(status)
          reject(new ApiError(errorMessage(payload, t('api.avatarUploadFailedWithStatus', { status })), status, payload))
          return
        }
        const user = (payload as { user?: UserInfoDto })?.user
        if (!user) {
          reject(new ApiError(t('api.avatarMissingUser'), status, payload))
          return
        }
        resolve(user)
      },
      fail(error) {
        reject(new ApiError(error.errMsg || t('api.avatarUploadFailed'), 0, error))
      },
    })
  })
}

export function createWebLoginChallenge(): Promise<WebLoginChallengeCreateDto> {
  return apiRequest(ApiV2Routes.authWebChallengeCreate, {
    method: 'POST',
    data: {},
    public: true,
  })
}

export function getWebLoginChallengeStatus(challengeId: string): Promise<WebLoginChallengeStatusDto> {
  return apiRequest(fillRoute(ApiV2Routes.authWebChallengeStatus, 'challengeId', challengeId), { public: true })
}

export function approveWebLoginChallenge(challengeId: string): Promise<{ success: true }> {
  return apiRequest(fillRoute(ApiV2Routes.authWebChallengeApprove, 'challengeId', challengeId), {
    method: 'POST',
    data: {},
  })
}

export function exchangeWebLoginChallenge(challengeId: string): Promise<WebLoginChallengeExchangeDto> {
  return apiRequest(fillRoute(ApiV2Routes.authWebChallengeExchange, 'challengeId', challengeId), {
    method: 'POST',
    data: {},
    public: true,
  })
}

export async function getTripHistory(limit = 50): Promise<TripHistoryItemDto[]> {
  const response = await apiRequest<{ items: TripHistoryItemDto[] }>(
    `${ApiV2Routes.tripHistory}?limit=${encodeURIComponent(String(limit))}`,
  )
  return response.items
}

export function submitTripPlan(input: TripPlanRequestDto): Promise<SubmitTripPlanResponseDto> {
  return apiRequest<SubmitTripPlanResponseDto>(ApiV2Routes.tripPlan, {
    method: 'POST',
    data: input,
  })
}

export function retryTripPlan(planId: string, restartAll = false): Promise<SubmitTripPlanResponseDto> {
  return apiRequest(tripRetryPath(planId), {
    method: 'POST',
    data: { restart_all: restartAll },
  })
}

export function getTaskStatus(taskId: string): Promise<TripTaskStatusResponseDto> {
  return apiRequest<TripTaskStatusResponseDto>(taskStatusPath(taskId))
}

export function getConversations(limit = 50): Promise<{ items: ConversationRecordDto[] }> {
  return apiRequest(`${ApiV2Routes.conversations}?limit=${encodeURIComponent(String(limit))}`)
}

export function getConversation(sessionId: string): Promise<ConversationSessionDetailDto> {
  return apiRequest(conversationPath(sessionId))
}

export async function getPlanConversation(planId: string): Promise<ChatMessageDto[]> {
  const response = await apiRequest<{ plan_id: string, messages: ChatMessageDto[] }>(tripPlanConversationPath(planId))
  return response.messages
}

export function createConversation(input: {
  session_id: string
  first_message: string
  snapshot: Record<string, unknown>
}): Promise<ConversationRecordDto> {
  return apiRequest(ApiV2Routes.conversations, { method: 'POST', data: input })
}

export function replaceConversationSnapshot(
  sessionId: string,
  revision: number,
  snapshot: Record<string, unknown>,
): Promise<ConversationSessionDetailDto> {
  return apiRequest(conversationPath(sessionId), {
    method: 'PUT',
    data: { revision, snapshot },
  })
}

export function deleteConversation(sessionId: string): Promise<{ success: true }> {
  return apiRequest(conversationPath(sessionId), { method: 'DELETE' })
}

export function deleteTripPlan(planId: string): Promise<{ success: true, removed_images: number }> {
  return apiRequest(tripPlanResourcePath(planId), { method: 'DELETE' })
}

function localToday(): string {
  const today = new Date()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  return `${today.getFullYear()}-${month}-${day}`
}

export function parseTripText(
  text: string,
  language: string,
  history: ChatMessageDto[] = [],
): Promise<TripParseResponseDto> {
  return apiRequest(ApiV2Routes.tripParse, {
    method: 'POST',
    data: { text, language, today: localToday(), history: history.slice(-10) },
  })
}

export function confirmTripReply(
  text: string,
  draft: ParsedTripDraftDto,
  language: string,
  history: ChatMessageDto[] = [],
  readinessToken = '',
): Promise<TripConfirmReplyResponseDto> {
  return apiRequest(ApiV2Routes.tripConfirmReply, {
    method: 'POST',
    data: {
      text,
      draft,
      language,
      today: localToday(),
      history: history.slice(-10),
      readiness_token: readinessToken,
    },
  })
}

export function createTripShare(planId: string): Promise<{ plan_id: string, share_code: string }> {
  return apiRequest(tripSharePath(planId), { method: 'POST', data: {} })
}

export function getSharedTripPlan(shareCode: string): Promise<{ status: 'completed', result: unknown }> {
  return apiRequest(tripSharePath(shareCode), { public: true })
}

export function chatEditPlan(
  message: string,
  tripPlan: Record<string, unknown>,
  history: ChatMessageDto[],
  planId: string,
): Promise<TripChatEditResponseDto> {
  return apiRequest(ApiV2Routes.tripChatEdit, {
    method: 'POST',
    data: {
      message,
      trip_plan: tripPlan,
      history: history.slice(-20),
      plan_id: planId,
    },
  })
}

export function getBudgetItems(planId: string): Promise<BudgetLedgerResponseDto> {
  return apiRequest(tripBudgetItemsPath(planId))
}

export function createBudgetItem(planId: string, input: BudgetItemInputDto): Promise<BudgetLedgerResponseDto> {
  return apiRequest(tripBudgetItemsPath(planId), { method: 'POST', data: input })
}

export function updateBudgetItem(
  planId: string,
  itemId: string,
  input: Partial<BudgetItemInputDto> & { deleted?: boolean },
): Promise<BudgetLedgerResponseDto> {
  return apiRequest(tripBudgetItemPath(planId, itemId), { method: 'PATCH', data: input })
}

export function deleteBudgetItem(planId: string, itemId: string): Promise<BudgetLedgerResponseDto> {
  return apiRequest(tripBudgetItemPath(planId, itemId), { method: 'DELETE' })
}

export async function searchAttractionPois(keywords: string, city: string): Promise<PoiSearchItemDto[]> {
  const query = `keywords=${encodeURIComponent(keywords)}&city=${encodeURIComponent(city)}&types=110000`
  const response = await apiRequest<PoiSearchResponseDto>(`${ApiV2Routes.poiSearch}?${query}`)
  return response.data
}

export function createItineraryAttraction(
  planId: string,
  input: AttractionMutationInputDto,
): Promise<ItineraryMutationResponseDto> {
  return apiRequest(tripAttractionsPath(planId), { method: 'POST', data: input })
}

export function updateItineraryAttraction(
  planId: string,
  itemId: string,
  input: AttractionMutationInputDto,
): Promise<ItineraryMutationResponseDto> {
  return apiRequest(tripAttractionPath(planId, itemId), { method: 'PUT', data: input })
}

export function deleteItineraryAttraction(planId: string, itemId: string): Promise<ItineraryMutationResponseDto> {
  return apiRequest(tripAttractionPath(planId, itemId), { method: 'DELETE' })
}

export function updateTripItemStatus(
  planId: string,
  itemId: string,
  input: ItemExecutionPatchDto,
): Promise<ItemExecutionResponseDto> {
  return apiRequest(tripItemStatusPath(planId, itemId), { method: 'PATCH', data: input })
}

export function createMiniProgramAction(input: {
  type: 'share' | 'save_guide' | 'add_calendar'
  plan_id: string
  title?: string
  image_data_url?: string
}): Promise<NativeActionTicketDto> {
  return apiRequest(ApiV2Routes.miniProgramActions, { method: 'POST', data: input })
}

export function getMiniProgramAction(actionId: string): Promise<NativeActionDto> {
  return apiRequest(miniProgramActionPath(actionId))
}

export function completeMiniProgramAction(actionId: string): Promise<{ success: true }> {
  return apiRequest(fillRoute(ApiV2Routes.miniProgramActionComplete, 'actionId', actionId), {
    method: 'POST',
    data: {},
  })
}
