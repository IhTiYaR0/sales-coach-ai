<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { apiFetch } from '../api'

const props = defineProps({
  currentUser: {
    type: Object,
    default: null,
  },
})

// ── State ──────────────────────────────────────────────────────────────────
const teams       = ref([])
const myTeamIds   = ref([])
const isLoading   = ref(false)
const isCreating  = ref(false)
const isDeleting  = ref(false)
const isCriteriaSaving = ref(false)
const error       = ref('')
const newTeamName = ref('')
const criteriaText = ref('')
const criteriaError = ref('')
const searchQuery = ref('')
const activeFilter= ref('all')
const showCreateModal = ref(false)
const showCriteriaModal = ref(false)
const notification    = ref({ message: '', type: '' })

// Team detail view
const activeTeam   = ref(null)   // null → list view; object → detail view
const teamMembers  = ref([])
const membersLoading = ref(false)
const profileUser = ref(null)
const profileUserId = ref(null)
const profileLoading = ref(false)
const profileError = ref('')
const profileAnalytics = ref(null)
const profileAnalyticsLoading = ref(false)
const profileAnalyticsError = ref('')
const profileCallHistory = ref([])
const profileCallHistoryLoading = ref(false)
const profileCallHistoryError = ref('')
const selectedProfileCall = ref(null)
const selectedProfileCallLoading = ref(false)
const selectedProfileCallError = ref('')
const openingProfileCallId = ref(null)

// Member search
const memberQuery      = ref('')
const searchResults    = ref([])
const searchLoading    = ref(false)
const searchError      = ref('')
const allUsers         = ref([])
const addingUserId     = ref(null)
const searchFocused    = ref(false)
const searchInputEl    = ref(null)
const addedUserIds     = ref([])           // track already-added user ids
const currentSearchToken = ref(null)
let   searchDebounce   = null
let   lastQuery        = ''               // cancel stale responses

const currentUserId = computed(() => props.currentUser?.id ?? props.currentUser?.user_id ?? null)
const ownedTeamIdsStorageKey = computed(() => {
  const userKey = currentUserId.value || props.currentUser?.email || 'anonymous'
  return `callanalytics-owned-team-ids:${userKey}`
})

const showDropdown = computed(() =>
  searchFocused.value && memberQuery.value.trim().length > 0
)

// ── Computed ───────────────────────────────────────────────────────────────
const filteredTeams = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return teams.value
    .filter(t => myTeamIds.value.length === 0 || myTeamIds.value.includes(String(t.id ?? t._id)))
    .filter(t => {
      if (activeFilter.value === 'active')   return getTeamStatus(t) === 'active'
      if (activeFilter.value === 'archived') return getTeamStatus(t) === 'archived'
      return true
    })
    .filter(t => !q ||
      String(t.name || '').toLowerCase().includes(q)
    )
})

const canDeleteActiveTeam = computed(() => canDeleteTeam(activeTeam.value))
const isLeaderUser = computed(() => {
  const role = String(props.currentUser?.role || '').toLowerCase()
  return ['leader', 'admin', 'supervisor', 'руководитель'].includes(role)
})

const selectedProfileCallAnalysis = computed(() => selectedProfileCall.value?.result?.analysis || selectedProfileCall.value?.analysis || {})
const selectedProfileCallTranscript = computed(() => selectedProfileCall.value?.result?.transcript || selectedProfileCall.value?.transcript || '')
const selectedProfileCallSummary = computed(() =>
  selectedProfileCallAnalysis.value.call_summary
    || selectedProfileCallAnalysis.value.summary
    || selectedProfileCall.value?.result?.summary
    || ''
)
const selectedProfileCallMessages = computed(() => {
  return selectedProfileCallTranscript.value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      if (line.startsWith('Менеджер:')) return { role: 'manager', text: line.replace('Менеджер:', '').trim() }
      if (line.startsWith('Клиент:')) return { role: 'client', text: line.replace('Клиент:', '').trim() }
      return { role: 'unknown', text: line }
    })
})

// ── Helpers ────────────────────────────────────────────────────────────────
function getStoredOwnedTeamIds() {
  try {
    const ids = JSON.parse(window.localStorage.getItem(ownedTeamIdsStorageKey.value) || '[]')
    return Array.isArray(ids) ? ids.map(String) : []
  } catch {
    return []
  }
}

function saveOwnedTeamIds(ids) {
  window.localStorage.setItem(ownedTeamIdsStorageKey.value, JSON.stringify([...new Set(ids.map(String))]))
}

function markTeamAsOwned(team) {
  if (team?.id == null) return
  saveOwnedTeamIds([...getStoredOwnedTeamIds(), team.id])
}

function unmarkTeamAsOwned(teamId) {
  saveOwnedTeamIds(getStoredOwnedTeamIds().filter((id) => id !== String(teamId)))
}

function getTeamOwnerId(team = {}) {
  const owner = team.owner ?? team.creator ?? team.created_by ?? team.leader ?? team.user
  return team.owner_id
    ?? team.creator_id
    ?? team.created_by_id
    ?? team.leader_id
    ?? team.user_id
    ?? owner?.id
    ?? owner?.user_id
    ?? owner
}

function canDeleteTeam(team) {
  if (team?.id == null) return false

  const ownerId = getTeamOwnerId(team)
  if (ownerId != null && currentUserId.value != null) {
    return String(ownerId) === String(currentUserId.value)
  }

  return getStoredOwnedTeamIds().includes(String(team.id))
}

function extractTeamArray(data) {
  if (Array.isArray(data)) return data
  if (!data || typeof data !== 'object') return []

  for (const key of ['teams', 'my_teams', 'managed_teams', 'created_teams', 'data', 'results', 'items']) {
    if (Array.isArray(data[key])) return data[key]
  }

  for (const key of ['team', 'my_team', 'managed_team', 'created_team', 'result', 'item']) {
    if (data[key] && typeof data[key] === 'object') return [data[key]]
  }

  return data.id != null || data._id != null || data.team_id != null ? [data] : []
}

function getTeamId(team = {}) {
  return team.id ?? team._id ?? team.team_id ?? team.teamId ?? null
}

function extractTeamIds(data) {
  return extractTeamArray(data)
    .map(getTeamId)
    .filter(id => id != null)
    .map(String)
}

function getTeamStatus(team) {
  if (!team?.status) return 'active'
  return String(team.status).toLowerCase() === 'archived' ? 'archived' : 'active'
}

function getInitials(name = '') {
  const w = name.trim().split(/\s+/)
  return w.length >= 2
    ? (w[0][0] + w[1][0]).toUpperCase()
    : name.substring(0, 2).toUpperCase()
}

function getUserName(user = {}) {
  return user.name || [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || 'Пользователь'
}

function getUserInitials(user) {
  const name = getUserName(user)
  return name ? getInitials(name) : '?'
}

function getUserRoleLabel(role) {
  const normalized = String(role || '').toLowerCase()
  if (['leader', 'admin', 'supervisor', 'руководитель'].includes(normalized)) return 'Руководитель'
  if (['manager', 'user', 'оператор'].includes(normalized)) return 'Менеджер'
  return role || 'Менеджер'
}

function isUserInTeam(user, teamId) {
  if (user?.team_id == null || teamId == null) return false
  return String(user.team_id) === String(teamId)
}

function getTeamMembersFromUsers(teamId) {
  return allUsers.value.filter(user => isUserInTeam(user, teamId))
}

function getTeamMemberCount(team) {
  return getTeamMembersFromUsers(team?.id).length
}

function formatDate(value) {
  if (!value) return 'Не указано'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Не указано'
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

function formatCallDate(value) {
  if (!value) return 'Дата не указана'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Дата не указана'
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : []
}

function extractCallHistoryArray(data) {
  if (Array.isArray(data)) return data
  if (!data || typeof data !== 'object') return []

  for (const key of ['calls', 'history', 'call_history', 'user_calls', 'data', 'results', 'items']) {
    if (Array.isArray(data[key])) return data[key]
  }

  for (const value of Object.values(data)) {
    if (Array.isArray(value)) return value
  }

  return []
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function normalizeProfileCall(call = {}) {
  const analysis = call.analysis || call.result?.analysis || {}
  const id = call.id ?? call.call_id ?? call.callId
  const score = toNumberOrNull(call.score ?? analysis.score)
  const dealProbability = toNumberOrNull(
    call.deal_probability
      ?? call.dealProbability
      ?? analysis.deal_probability
      ?? analysis.dealProbability
  )
  const audioPath = call.audio_path ?? call.file_path ?? call.filename ?? call.fileName ?? call.name ?? ''

  return {
    ...call,
    id,
    userId: getCallOwnerId(call),
    score,
    dealProbability,
    fileName: audioPath ? String(audioPath).split(/[\\/]/).pop() : `Звонок #${id ?? '—'}`,
    createdAt: call.created_at ?? call.createdAt ?? call.created ?? call.uploaded_at ?? null,
    funnelStage: call.sales_funnel_stage ?? call.funnelStage ?? analysis.sales_funnel_stage ?? 'Проанализирован',
    result: call.result ?? (call.analysis || call.transcript ? call : null),
  }
}

function getCallOwnerId(call = {}) {
  const user = call.user ?? call.manager ?? call.owner ?? call.employee
  return call.user_id
    ?? call.userId
    ?? call.manager_id
    ?? call.managerId
    ?? call.owner_id
    ?? call.employee_id
    ?? user?.id
    ?? user?.user_id
    ?? null
}

function isCallFromProfileUser(call, userId) {
  const ownerId = getCallOwnerId(call)
  return ownerId == null || String(ownerId) === String(userId)
}

function getScoreTone(score) {
  if (score == null) return 'muted'
  if (score >= 80) return 'good'
  if (score >= 60) return 'medium'
  return 'bad'
}

function getTeamCriteria(team = {}) {
  const value = team.criteria ?? team.additional_criteria ?? team.ai_criteria ?? team.analysis_criteria ?? ''
  if (Array.isArray(value)) return value.filter(Boolean).join('\n')
  if (value && typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value || '')
}

function showNotification(message, type) {
  notification.value = { message, type }
  setTimeout(() => { notification.value = { message: '', type: '' } }, 4000)
}

// ── API calls ──────────────────────────────────────────────────────────────

async function fetchTeams() {
  isLoading.value = true
  error.value = ''
  try {
    const [teamsRes, myTeamsRes] = await Promise.all([
      apiFetch('/teams', { method: 'GET' }),
      apiFetch('/teams/my', { method: 'GET' }),
    ])

    if (!teamsRes.ok) throw new Error(`Ошибка ${teamsRes.status}`)
    if (!myTeamsRes.ok) throw new Error(`Ошибка ${myTeamsRes.status}`)

    const teamsData = await teamsRes.json()
    const myTeamsData = await myTeamsRes.json()
    const allTeams = Array.isArray(teamsData) ? teamsData : (teamsData?.teams ?? teamsData?.data ?? [])
    const ownIds = extractTeamIds(myTeamsData)

    myTeamIds.value = ownIds
    teams.value = ownIds.length
      ? allTeams.filter(team => ownIds.includes(String(getTeamId(team))))
      : extractTeamArray(myTeamsData)

    await fetchUsers({ force: true })
  } catch (err) {
    error.value = err.message || 'Не удалось загрузить команды'
  } finally {
    isLoading.value = false
  }
}

async function createTeam() {
  const name = newTeamName.value.trim()
  if (!name) return
  isCreating.value = true
  try {
    const res = await apiFetch('/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) {
      let msg = 'Не удалось создать команду'
      try { const e = await res.json(); msg = e.detail || JSON.stringify(e) } catch {}
      throw new Error(msg)
    }
    const created = await res.json()
    closeCreateModal()
    showNotification('Команда успешно создана!', 'success')
    await fetchTeams()
    // open detail page of new team
    const team = teams.value.find(t => t.id === created.id) ?? created
    markTeamAsOwned(team)
    openTeam(team)
  } catch (err) {
    showNotification(err.message || 'Ошибка создания команды', 'error')
  } finally {
    isCreating.value = false
  }
}

async function fetchTeamMembers(teamId) {
  membersLoading.value = true
  teamMembers.value    = []
  try {
    await fetchUsers({ force: true })
    teamMembers.value = getTeamMembersFromUsers(teamId)
  } catch (err) {
    showNotification(err.message || 'Не удалось загрузить участников', 'error')
    teamMembers.value = []
  } finally {
    membersLoading.value = false
  }
}

async function readApiError(response) {
  try {
    const data = await response.json()
    if (typeof data?.detail === 'string') return data.detail
    if (data?.detail) return JSON.stringify(data.detail)
    return JSON.stringify(data)
  } catch {
    return response.statusText || `Ошибка ${response.status}`
  }
}

function collectStringValues(value) {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(collectStringValues)
  if (value && typeof value === 'object') return Object.values(value).flatMap(collectStringValues)
  return []
}

function extractUserArray(data) {
  if (Array.isArray(data)) return data
  if (!data || typeof data !== 'object') return []

  const preferredKeys = ['users', 'data', 'results', 'items']
  for (const key of preferredKeys) {
    if (Array.isArray(data[key])) return data[key]
  }

  for (const value of Object.values(data)) {
    if (Array.isArray(value)) return value
  }

  return []
}

function normalizeUserSearchText(user) {
  return collectStringValues(user)
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

async function fetchUsers({ force = false } = {}) {
  if (!force && allUsers.value.length) return allUsers.value

  const res = await apiFetch('/users', { method: 'GET' })
  if (!res.ok) {
    const errorBody = await res.text()
    throw new Error(errorBody || `Ошибка ${res.status}`)
  }

  const data = await res.json()
  allUsers.value = extractUserArray(data)
  return allUsers.value
}

async function searchUsers(query, token) {
  const q = query.trim().toLowerCase()
  if (!q) {
    if (token === currentSearchToken.value) {
      searchResults.value = []
      searchError.value = ''
      searchLoading.value = false
    }
    return
  }

  lastQuery = q
  searchError.value = ''

  const isLatest = () => token === currentSearchToken.value

  try {
    const users = await fetchUsers()
    if (!isLatest()) return

    searchResults.value = users.filter(u =>
      normalizeUserSearchText(u).includes(q)
    )
  } catch (err) {
    if (!isLatest()) return
    searchError.value = err.message || 'Ошибка поиска'
    searchResults.value = []
  } finally {
    if (isLatest()) searchLoading.value = false
  }
}

function getCookieValue(name) {
  return document.cookie
    .split(';')
    .map(cookie => cookie.trim())
    .find(cookie => cookie.startsWith(`${name}=`))
    ?.split('=')[1] || ''
}

function getCsrfHeaders() {
  const csrfToken = getCookieValue('csrftoken') || getCookieValue('csrf_token') || getCookieValue('csrf')
  if (csrfToken) {
    return { 'X-CSRFToken': csrfToken }
  }
  const xsrfToken = getCookieValue('XSRF-TOKEN') || getCookieValue('XSRF_TOKEN')
  if (xsrfToken) {
    return { 'X-XSRF-TOKEN': xsrfToken }
  }
  return {}
}

function makeAddMemberForm(userId) {
  const formData = new FormData()
  formData.append('user_id', userId)
  const csrfToken = getCookieValue('csrftoken') || getCookieValue('csrf_token') || getCookieValue('csrf')
  if (csrfToken) {
    formData.append('csrfmiddlewaretoken', csrfToken)
  }
  return formData
}

async function sendAddMemberRequest(url) {
  return apiFetch(url, {
    method: 'POST',
    headers: getCsrfHeaders(),
  })
}

async function addMember(user) {
  if (!activeTeam.value || !user?.id) return
  addingUserId.value = user.id
  const teamId = activeTeam.value.id
  const userId = user.id

  try {
    const res = await sendAddMemberRequest(`/teams/${teamId}/members/${userId}`)

    if (!res.ok) {
      const msg = await readApiError(res)
      throw new Error(msg || `Ошибка ${res.status}`)
    }

    if (!addedUserIds.value.includes(userId)) addedUserIds.value.push(userId)
    showNotification(`${getUserName(user)} добавлен в команду`, 'success')
    // keep dropdown open so user can add more — just mark this one as added
    allUsers.value = []
    await fetchTeamMembers(teamId)
  } catch (err) {
    showNotification(err.message, 'error')
  } finally {
    addingUserId.value = null
  }
}

async function saveTeamCriteria() {
  const teamId = getTeamId(activeTeam.value)
  const criteria = criteriaText.value.trim()

  if (!teamId) {
    criteriaError.value = 'Не удалось определить команду'
    return
  }

  if (!criteria) {
    criteriaError.value = 'Добавьте хотя бы один критерий для анализа'
    return
  }

  isCriteriaSaving.value = true
  criteriaError.value = ''

  try {
    const res = await apiFetch(`/teams/${teamId}/criteria`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...getCsrfHeaders(),
      },
      body: JSON.stringify({ criteria }),
    })

    if (!res.ok) {
      const msg = await readApiError(res)
      throw new Error(msg || 'Не удалось сохранить критерии')
    }

    let responseData = null
    try {
      responseData = await res.json()
    } catch {}

    const updatedTeam = responseData?.team ?? responseData?.data ?? responseData
    const nextTeam = {
      ...activeTeam.value,
      ...(updatedTeam && typeof updatedTeam === 'object' && !Array.isArray(updatedTeam) ? updatedTeam : {}),
      criteria,
    }

    activeTeam.value = nextTeam
    teams.value = teams.value.map(team => String(getTeamId(team)) === String(teamId) ? { ...team, ...nextTeam } : team)

    closeCriteriaModal()
    showNotification('Критерии для ИИ-анализа сохранены', 'success')
  } catch (err) {
    criteriaError.value = err.message || 'Ошибка сохранения критериев'
  } finally {
    isCriteriaSaving.value = false
  }
}

// ── UI actions ─────────────────────────────────────────────────────────────
function openTeam(team) {
  activeTeam.value    = team
  memberQuery.value   = ''
  searchResults.value = []
  addedUserIds.value  = []
  profileUser.value   = null
  profileUserId.value = null
  profileError.value  = ''
  profileAnalytics.value = null
  profileAnalyticsError.value = ''
  profileCallHistory.value = []
  profileCallHistoryError.value = ''
  selectedProfileCall.value = null
  selectedProfileCallError.value = ''
  openingProfileCallId.value = null
  closeCriteriaModal()
  fetchTeamMembers(team.id)
}

function backToList() {
  activeTeam.value    = null
  memberQuery.value   = ''
  searchResults.value = []
  addedUserIds.value  = []
  profileUser.value   = null
  profileUserId.value = null
  profileError.value  = ''
  profileLoading.value = false
  profileAnalytics.value = null
  profileAnalyticsError.value = ''
  profileAnalyticsLoading.value = false
  profileCallHistory.value = []
  profileCallHistoryError.value = ''
  profileCallHistoryLoading.value = false
  selectedProfileCall.value = null
  selectedProfileCallError.value = ''
  selectedProfileCallLoading.value = false
  openingProfileCallId.value = null
  closeCriteriaModal()
}

async function openUserProfile(user) {
  const userId = user?.id ?? user?.user_id
  if (!userId) return

  profileLoading.value = true
  profileError.value = ''
  profileUser.value = null
  profileUserId.value = userId
  profileAnalytics.value = null
  profileAnalyticsError.value = ''
  profileCallHistory.value = []
  profileCallHistoryError.value = ''
  selectedProfileCall.value = null
  selectedProfileCallError.value = ''
  openingProfileCallId.value = null

  try {
    const res = await apiFetch(`/users/${userId}`, { method: 'GET' })
    if (!res.ok) throw new Error(`Ошибка ${res.status}`)
    profileUser.value = await res.json()
    loadProfileAnalytics(userId)
    loadProfileCallHistory(userId)
  } catch (err) {
    profileError.value = err.message || 'Не удалось загрузить профиль'
  } finally {
    profileLoading.value = false
  }
}

function closeUserProfile() {
  profileUser.value = null
  profileUserId.value = null
  profileError.value = ''
  profileLoading.value = false
  profileAnalytics.value = null
  profileAnalyticsError.value = ''
  profileAnalyticsLoading.value = false
  profileCallHistory.value = []
  profileCallHistoryError.value = ''
  profileCallHistoryLoading.value = false
  selectedProfileCall.value = null
  selectedProfileCallError.value = ''
  selectedProfileCallLoading.value = false
  openingProfileCallId.value = null
}

function resolveProfileAnalyticsUserId(userId) {
  if (userId instanceof Event) return profileUserId.value ?? profileUser.value?.id ?? profileUser.value?.user_id
  return userId ?? profileUserId.value ?? profileUser.value?.id ?? profileUser.value?.user_id
}

async function loadProfileAnalytics(userId) {
  const analyticsUserId = resolveProfileAnalyticsUserId(userId)

  if (!analyticsUserId) {
    profileAnalyticsError.value = 'Не удалось определить пользователя для аналитики'
    return
  }

  profileAnalyticsLoading.value = true
  profileAnalyticsError.value = ''

  try {
    const res = await apiFetch(`/calls/analytics/${encodeURIComponent(analyticsUserId)}`, { method: 'GET' })
    if (!res.ok) throw new Error('Не удалось загрузить аналитику звонков')
    profileAnalytics.value = await res.json()
  } catch (err) {
    profileAnalyticsError.value = err.message || 'Ошибка при загрузке аналитики'
  } finally {
    profileAnalyticsLoading.value = false
  }
}

function resolveProfileHistoryUserId(userId) {
  if (userId instanceof Event) return profileUserId.value ?? profileUser.value?.id ?? profileUser.value?.user_id
  return userId ?? profileUserId.value ?? profileUser.value?.id ?? profileUser.value?.user_id
}

async function loadProfileCallHistory(userId) {
  const historyUserId = resolveProfileHistoryUserId(userId)

  if (!historyUserId) {
    profileCallHistoryError.value = 'Не удалось определить пользователя для истории звонков'
    return
  }

  profileCallHistoryLoading.value = true
  profileCallHistoryError.value = ''

  try {
    const res = await apiFetch(`/calls/history/user/${encodeURIComponent(historyUserId)}`, {
      method: 'GET',
    })
    if (!res.ok) throw new Error('Не удалось загрузить историю звонков')

    const data = await res.json()
    profileCallHistory.value = extractCallHistoryArray(data)
      .map(normalizeProfileCall)
      .filter(call => call.id != null)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
  } catch (err) {
    profileCallHistoryError.value = err.message || 'Ошибка при загрузке истории звонков'
    profileCallHistory.value = []
  } finally {
    profileCallHistoryLoading.value = false
  }
}

async function openProfileCall(call) {
  if (!call?.id || selectedProfileCallLoading.value) return

  selectedProfileCallLoading.value = true
  openingProfileCallId.value = call.id
  selectedProfileCallError.value = ''

  try {
    const res = await apiFetch(`/calls/history/${encodeURIComponent(call.id)}`, {
      method: 'GET',
    })
    if (!res.ok) throw new Error('Не удалось загрузить анализ звонка')

    const detail = await res.json()
    const ownerId = getCallOwnerId(detail)
    if (ownerId != null && String(ownerId) !== String(profileUserId.value)) {
      throw new Error('Этот звонок не принадлежит выбранному пользователю')
    }

    const normalized = normalizeProfileCall({ ...call, ...detail })
    selectedProfileCall.value = {
      ...normalized,
      result: detail,
      score: detail.analysis?.score ?? normalized.score,
      dealProbability: detail.analysis?.deal_probability ?? normalized.dealProbability,
      funnelStage: detail.analysis?.sales_funnel_stage ?? normalized.funnelStage,
    }
  } catch (err) {
    selectedProfileCallError.value = err.message || 'Ошибка при загрузке анализа звонка'
  } finally {
    selectedProfileCallLoading.value = false
    openingProfileCallId.value = null
  }
}

function closeProfileCall() {
  selectedProfileCall.value = null
  selectedProfileCallError.value = ''
  selectedProfileCallLoading.value = false
  openingProfileCallId.value = null
}

async function deleteTeam() {
  if (!activeTeam.value || !canDeleteActiveTeam.value || isDeleting.value) return
  const teamName = activeTeam.value.name
  const teamId = activeTeam.value.id
  if (!confirm(`Удалить команду «${teamName}»? Это действие нельзя отменить.`)) return

  isDeleting.value = true
  try {
    const res = await apiFetch(`/teams/${teamId}`, {
      method: 'DELETE',
      headers: getCsrfHeaders(),
    })
    if (!res.ok) {
      const msg = await readApiError(res)
      throw new Error(msg)
    }
    unmarkTeamAsOwned(teamId)
    backToList()
    await fetchTeams()
    showNotification(`Команда «${teamName}» удалена`, 'success')
  } catch (err) {
    showNotification(err.message || 'Не удалось удалить команду', 'error')
  } finally {
    isDeleting.value = false
  }
}

function onSearchBlur() {
  // small delay so click on result registers before dropdown hides
  setTimeout(() => { searchFocused.value = false }, 180)
}

function clearMemberSearch() {
  memberQuery.value   = ''
  searchResults.value = []
  searchError.value   = ''
  searchLoading.value = false
  lastQuery           = ''
  currentSearchToken.value = null
  searchInputEl.value?.focus()
}

function openCreateModal() { showCreateModal.value = true }
function closeCreateModal() { showCreateModal.value = false; newTeamName.value = '' }
function openCriteriaModal() {
  if (!activeTeam.value || !isLeaderUser.value) return
  criteriaText.value = getTeamCriteria(activeTeam.value)
  criteriaError.value = ''
  showCriteriaModal.value = true
}
function closeCriteriaModal() {
  if (isCriteriaSaving.value) return
  showCriteriaModal.value = false
  criteriaText.value = ''
  criteriaError.value = ''
}

// debounce member search — show spinner immediately, fire request after 300ms idle
watch(memberQuery, val => {
  clearTimeout(searchDebounce)
  if (!val.trim()) {
    searchResults.value = []
    searchError.value   = ''
    searchLoading.value = false
    lastQuery           = ''
    currentSearchToken.value = null
    return
  }
  const token = Symbol('member-search')
  currentSearchToken.value = token
  searchLoading.value = true   // optimistic spinner while user types
  searchDebounce = setTimeout(() => searchUsers(val, token), 300)
})

onMounted(fetchTeams)
</script>

<template>
  <section class="tp-page">

    <!-- ── Уведомление ── -->
    <transition name="tp-fade">
      <div v-if="notification.message" class="tp-notification" :class="`tp-notification--${notification.type}`">
        <span class="material-symbols-outlined">{{ notification.type === 'success' ? 'check_circle' : 'error' }}</span>
        {{ notification.message }}
      </div>
    </transition>

    <!-- ════════════════════════════════════════
         USER PROFILE VIEW — профиль участника
    ════════════════════════════════════════ -->
    <template v-if="profileLoading || profileError || profileUser">
      <div class="tp-detail-nav">
        <button class="tp-back-btn" type="button" @click="closeUserProfile">
          <span class="material-symbols-outlined">arrow_back</span>
          Участники команды
        </button>
      </div>

      <div v-if="profileLoading" class="tp-state">
        <span class="material-symbols-outlined tp-spin">sync</span>
        <div>
          <strong>Загружаем профиль</strong>
          <p>Получаем данные пользователя с сервера.</p>
        </div>
      </div>

      <div v-else-if="profileError" class="tp-state tp-state--error">
        <span class="material-symbols-outlined">error</span>
        <div>
          <strong>Не удалось загрузить профиль</strong>
          <p>{{ profileError }}</p>
        </div>
      </div>

      <template v-else>
        <template v-if="selectedProfileCall">
          <section class="tp-call-detail">
            <div class="tp-call-detail__top">
              <button class="tp-back-btn" type="button" @click="closeProfileCall">
                <span class="material-symbols-outlined">arrow_back</span>
                История звонков
              </button>
              <div class="tp-call-detail__title">
                <span class="material-symbols-outlined">audio_file</span>
                <div>
                  <h2>{{ selectedProfileCall.fileName }}</h2>
                  <p>{{ getUserName(profileUser) }} · {{ formatCallDate(selectedProfileCall.createdAt) }}</p>
                </div>
              </div>
            </div>

            <div v-if="selectedProfileCallLoading" class="tp-state">
              <span class="material-symbols-outlined tp-spin">sync</span>
              <div>
                <strong>Загружаем анализ</strong>
                <p>Получаем детали выбранного звонка.</p>
              </div>
            </div>

            <div v-if="selectedProfileCallError" class="tp-state tp-state--error">
              <span class="material-symbols-outlined">error</span>
              <div>
                <strong>Не удалось открыть анализ</strong>
                <p>{{ selectedProfileCallError }}</p>
              </div>
            </div>

            <div class="tp-call-detail__metrics">
              <article>
                <span>Оценка ИИ</span>
                <strong>{{ selectedProfileCall.score ?? selectedProfileCallAnalysis.score ?? '—' }}</strong>
              </article>
              <article>
                <span>Вероятность сделки</span>
                <strong>
                  {{
                    selectedProfileCall.dealProbability
                      ?? selectedProfileCallAnalysis.deal_probability
                      ?? '—'
                  }}{{ (selectedProfileCall.dealProbability ?? selectedProfileCallAnalysis.deal_probability) == null ? '' : '%' }}
                </strong>
              </article>
              <article>
                <span>Этап</span>
                <strong>{{ selectedProfileCall.funnelStage || selectedProfileCallAnalysis.sales_funnel_stage || '—' }}</strong>
              </article>
            </div>

            <div class="tp-call-detail__grid">
              <section class="tp-call-transcript">
                <div class="box-header">
                  <span class="material-symbols-outlined">record_voice_over</span>
                  <h4>Транскрипт звонка</h4>
                </div>

                <div v-if="selectedProfileCallMessages.length" class="tp-call-messages">
                  <div
                    v-for="(msg, index) in selectedProfileCallMessages"
                    :key="index"
                    class="tp-call-message"
                    :class="`tp-call-message--${msg.role}`"
                  >
                    <span>{{ msg.role === 'manager' ? 'М' : msg.role === 'client' ? 'К' : '•' }}</span>
                    <p>{{ msg.text }}</p>
                  </div>
                </div>

                <p v-else class="analytics-empty">Транскрипт для этого звонка не найден.</p>
              </section>

              <aside class="tp-call-analysis">
                <div class="analysis-box">
                  <div class="box-header">
                    <span class="material-symbols-outlined">summarize</span>
                    <h4>Резюме</h4>
                  </div>
                  <p>{{ selectedProfileCallSummary || 'Нет данных.' }}</p>
                </div>

                <div class="analysis-box strengths" v-if="getList(selectedProfileCallAnalysis.strengths).length">
                  <div class="box-header">
                    <span class="material-symbols-outlined">check_circle</span>
                    <h4>Сильные стороны</h4>
                  </div>
                  <ul>
                    <li v-for="(item, index) in getList(selectedProfileCallAnalysis.strengths)" :key="index">{{ item }}</li>
                  </ul>
                </div>

                <div class="analysis-box mistakes" v-if="getList(selectedProfileCallAnalysis.mistakes).length">
                  <div class="box-header">
                    <span class="material-symbols-outlined">cancel</span>
                    <h4>Ошибки менеджера</h4>
                  </div>
                  <ul>
                    <li v-for="(item, index) in getList(selectedProfileCallAnalysis.mistakes)" :key="index">{{ item }}</li>
                  </ul>
                </div>

                <div class="analysis-box recommendations" v-if="getList(selectedProfileCallAnalysis.recommendations).length">
                  <div class="box-header">
                    <span class="material-symbols-outlined">tips_and_updates</span>
                    <h4>Рекомендации</h4>
                  </div>
                  <ul>
                    <li v-for="(item, index) in getList(selectedProfileCallAnalysis.recommendations)" :key="index">{{ item }}</li>
                  </ul>
                </div>
              </aside>
            </div>
          </section>
        </template>

        <template v-else>
        <section class="tp-user-profile-hero">
          <div class="tp-user-profile-hero__avatar">{{ getUserInitials(profileUser) }}</div>
          <div class="tp-user-profile-hero__main">
            <span class="tp-user-profile-hero__eyebrow">Профиль участника</span>
            <h2>{{ getUserName(profileUser) }}</h2>
            <p>{{ profileUser.email }}</p>
          </div>
          <span class="tp-badge" :class="{ 'tp-badge--active': profileUser.role !== 'leader', 'tp-badge--archived': profileUser.role === 'leader' }">
            {{ getUserRoleLabel(profileUser.role) }}
          </span>
        </section>

        <section class="tp-profile-details">
          <article>
            <span>Email</span>
            <strong>{{ profileUser.email || 'Не указан' }}</strong>
          </article>
          <article>
            <span>Роль</span>
            <strong>{{ getUserRoleLabel(profileUser.role) }}</strong>
          </article>
          <article>
            <span>Команда</span>
            <strong>{{ activeTeam?.name || 'Не указана' }}</strong>
          </article>
          <article>
            <span>Компания</span>
            <strong>{{ profileUser.company_name || 'Не указана' }}</strong>
          </article>
          <article>
            <span>Дата создания</span>
            <strong>{{ formatDate(profileUser.created_at) }}</strong>
          </article>
        </section>

        <section class="tp-profile-analytics">
          <div class="analytics-header">
            <div class="analytics-title-group">
              <span class="material-symbols-outlined">monitoring</span>
              <h2 class="analytics-title">Аналитика звонков и эффективности</h2>
            </div>
            <button @click="loadProfileAnalytics()" class="refresh-btn" :disabled="profileAnalyticsLoading" title="Обновить данные">
              <span class="material-symbols-outlined" :class="{ 'tp-spin': profileAnalyticsLoading }">refresh</span>
            </button>
          </div>

          <div v-if="profileAnalyticsLoading" class="analytics-skeleton">
            <div class="skeleton-metrics">
              <div class="skeleton-card"><div class="skeleton-line"></div></div>
              <div class="skeleton-card"><div class="skeleton-line"></div></div>
              <div class="skeleton-card"><div class="skeleton-line"></div></div>
            </div>
            <div class="skeleton-line skeleton-line--title"></div>
            <div class="skeleton-line skeleton-line--text"></div>
          </div>

          <div v-else-if="profileAnalyticsError" class="analytics-error">
            <span class="material-symbols-outlined">error</span>
            <span>{{ profileAnalyticsError }}</span>
            <button @click="loadProfileAnalytics()" class="retry-btn">Повторить попытку</button>
          </div>

          <div v-else-if="profileAnalytics" class="analytics-content">
            <div class="profile-metrics-grid">
              <div class="profile-metric-card">
                <span class="profile-metric-value">{{ profileAnalytics.total_calls }}</span>
                <span class="profile-metric-label">Всего звонков</span>
              </div>
              <div class="profile-metric-card highlight-blue">
                <span class="profile-metric-value">{{ profileAnalytics.avg_score }}%</span>
                <span class="profile-metric-label">Средний балл ИИ</span>
              </div>
              <div class="profile-metric-card highlight-green">
                <span class="profile-metric-value">{{ profileAnalytics.avg_deal_probability }}%</span>
                <span class="profile-metric-label">Вероятность сделки</span>
              </div>
            </div>

            <div class="analytics-summary">
              <div class="summary-title-row">
                <span class="material-symbols-outlined">auto_awesome</span>
                <h3>Заключение ИИ-ассистента</h3>
              </div>
              <p>{{ profileAnalytics.summary }}</p>
            </div>

            <div class="analysis-sections">
              <div class="analysis-box strengths">
                <div class="box-header">
                  <span class="material-symbols-outlined">check_circle</span>
                  <h4>Сильные стороны</h4>
                </div>
                <ul>
                  <li v-for="(item, index) in getList(profileAnalytics.strengths)" :key="index">{{ item }}</li>
                </ul>
              </div>

              <div class="analysis-box mistakes">
                <div class="box-header">
                  <span class="material-symbols-outlined">cancel</span>
                  <h4>Повторяющиеся ошибки</h4>
                </div>
                <ul>
                  <li v-for="(item, index) in getList(profileAnalytics.recurring_mistakes)" :key="index">{{ item }}</li>
                </ul>
              </div>

              <div class="analysis-box loss-reasons">
                <div class="box-header">
                  <span class="material-symbols-outlined">warning</span>
                  <h4>Причины потери сделок</h4>
                </div>
                <ul>
                  <li v-for="(item, index) in getList(profileAnalytics.deal_loss_reasons)" :key="index">{{ item }}</li>
                </ul>
              </div>

              <div class="analysis-box recommendations">
                <div class="box-header">
                  <span class="material-symbols-outlined">tips_and_updates</span>
                  <h4>Рекомендации по улучшению</h4>
                </div>
                <ul>
                  <li v-for="(item, index) in getList(profileAnalytics.recommendations)" :key="index">{{ item }}</li>
                </ul>
              </div>
            </div>
          </div>

          <div v-else class="analytics-empty">
            Нет доступных данных аналитики за текущий период.
          </div>
        </section>

        <section class="tp-profile-history">
          <div class="analytics-header tp-history-header">
            <div class="analytics-title-group">
              <span class="material-symbols-outlined">history</span>
              <div>
                <h2 class="analytics-title">История звонков пользователя</h2>
                <p class="tp-history-header__sub">Только звонки выбранного участника команды</p>
              </div>
            </div>
            <span v-if="profileCallHistory.length" class="tp-history-count">{{ profileCallHistory.length }}</span>
            <button @click="loadProfileCallHistory()" class="refresh-btn" :disabled="profileCallHistoryLoading" title="Обновить историю">
              <span class="material-symbols-outlined" :class="{ 'tp-spin': profileCallHistoryLoading }">refresh</span>
            </button>
          </div>

          <template v-if="profileCallHistoryLoading">
            <div class="tp-history-skeleton">
              <div v-for="n in 3" :key="n" class="tp-history-skeleton__row">
                <div class="tp-history-skeleton__icon"></div>
                <div class="tp-history-skeleton__body">
                  <div class="skeleton-line skeleton-line--title"></div>
                  <div class="skeleton-line"></div>
                </div>
              </div>
            </div>
          </template>

          <template v-else-if="profileCallHistoryError">
            <div class="analytics-error">
              <span class="material-symbols-outlined">error</span>
              <span>{{ profileCallHistoryError }}</span>
              <button @click="loadProfileCallHistory()" class="retry-btn">Повторить попытку</button>
            </div>
          </template>

          <template v-else>
            <div v-if="selectedProfileCallError && !selectedProfileCall" class="tp-history-inline-error">
              <span class="material-symbols-outlined">error</span>
              <p>{{ selectedProfileCallError }}</p>
            </div>

          <div v-if="profileCallHistory.length" class="tp-history-list">
            <article
              v-for="call in profileCallHistory"
              :key="call.id"
              class="tp-history-call tp-history-call--clickable"
              :class="{ 'tp-history-call--loading': openingProfileCallId === call.id }"
              role="button"
              tabindex="0"
              @click="openProfileCall(call)"
              @keydown.enter.prevent="openProfileCall(call)"
              @keydown.space.prevent="openProfileCall(call)"
            >
              <div class="tp-history-call__icon">
                <span class="material-symbols-outlined">
                  {{ openingProfileCallId === call.id ? 'sync' : 'phone_in_talk' }}
                </span>
              </div>

              <div class="tp-history-call__main">
                <div class="tp-history-call__title-row">
                  <h3>{{ call.fileName }}</h3>
                  <span class="tp-history-call__stage">{{ call.funnelStage }}</span>
                </div>
                <p>
                  <span class="material-symbols-outlined">schedule</span>
                  {{ formatCallDate(call.createdAt) }}
                  <span class="tp-history-dot"></span>
                  ID {{ call.id }}
                </p>
              </div>

              <div class="tp-history-call__metrics">
                <div class="tp-history-call__metric" :class="`tp-history-call__metric--${getScoreTone(call.score)}`">
                  <span>Оценка</span>
                  <strong>{{ call.score ?? '—' }}</strong>
                </div>
                <div class="tp-history-call__metric">
                  <span>Сделка</span>
                  <strong>{{ call.dealProbability ?? '—' }}{{ call.dealProbability == null ? '' : '%' }}</strong>
                </div>
              </div>

              <span class="tp-history-call__open material-symbols-outlined">
                {{ openingProfileCallId === call.id ? 'hourglass_top' : 'chevron_right' }}
              </span>
            </article>
          </div>

          <div v-else class="tp-history-empty">
            <span class="material-symbols-outlined">call_end</span>
            <p>У пользователя пока нет проанализированных звонков.</p>
          </div>
          </template>
        </section>
        </template>
      </template>
    </template>

    <!-- ════════════════════════════════════════
         DETAIL VIEW — страница команды
    ════════════════════════════════════════ -->
    <template v-else-if="activeTeam">

      <!-- Навигация назад -->
      <div class="tp-detail-nav">
        <button class="tp-back-btn" type="button" @click="backToList">
          <span class="material-symbols-outlined">arrow_back</span>
          Все команды
        </button>
      </div>

      <!-- Hero карточка команды -->
      <div class="tp-team-hero">
        <div class="tp-team-hero__avatar">{{ getInitials(activeTeam.name) }}</div>
        <div class="tp-team-hero__info">
          <div class="tp-team-hero__name-row">
            <h2>{{ activeTeam.name }}</h2>
            <span v-if="getTeamStatus(activeTeam) === 'archived'" class="tp-badge tp-badge--archived">Архив</span>
            <span v-else class="tp-badge tp-badge--active">Активна</span>
          </div>
          <p class="tp-team-hero__id">Участники команды, профили менеджеров и настройки анализа</p>
        </div>
        <div class="tp-team-hero__actions">
          <div class="tp-team-hero__stats">
            <div class="tp-hero-stat">
              <strong>{{ teamMembers.length }}</strong>
              <span>Участников</span>
            </div>
          </div>
          <button
            v-if="isLeaderUser"
            class="tp-criteria-btn"
            type="button"
            @click="openCriteriaModal"
          >
            <span class="material-symbols-outlined">rule_settings</span>
            Добавить критерии
          </button>
          <button
            v-if="canDeleteActiveTeam"
            class="tp-delete-team-btn"
            type="button"
            @click="deleteTeam"
            :disabled="isDeleting"
            title="Удалить команду"
          >
            <span class="material-symbols-outlined" :class="{ 'tp-spin': isDeleting }">
              {{ isDeleting ? 'sync' : 'delete' }}
            </span>
            {{ isDeleting ? 'Удаляем...' : 'Удалить команду' }}
          </button>
        </div>
      </div>

      <section v-if="isLeaderUser" class="tp-criteria-panel">
        <div class="tp-criteria-panel__icon">
          <span class="material-symbols-outlined">psychology</span>
        </div>
        <div class="tp-criteria-panel__content">
          <div class="tp-criteria-panel__head">
            <div>
              <h3>Критерии ИИ-анализа</h3>
              <p>Эти правила будут учитываться при анализе звонков и качества общения.</p>
            </div>
            <button class="tp-btn-ghost" type="button" @click="openCriteriaModal">
              <span class="material-symbols-outlined">edit</span>
              Изменить
            </button>
          </div>
          <p v-if="getTeamCriteria(activeTeam)" class="tp-criteria-panel__text">{{ getTeamCriteria(activeTeam) }}</p>
          <p v-else class="tp-criteria-panel__empty">Критерии пока не добавлены. Добавьте фокус для ИИ: речь, паузы, работа с возражениями, тон и структуру диалога.</p>
        </div>
      </section>

      <!-- Секция участников -->
      <div class="tp-members-section">

        <!-- Заголовок секции -->
        <div class="tp-section-head">
          <div>
            <h3>Участники команды</h3>
            <p>Управляйте составом — добавляйте или удаляйте участников.</p>
          </div>
        </div>

        <!-- Добавление участника -->
        <div class="tp-add-member-panel">
          <div class="tp-add-member-panel__header">
            <span class="material-symbols-outlined">person_add</span>
            <div>
              <strong>Добавить участника</strong>
              <p>Начните вводить имя или email — результаты появятся автоматически</p>
            </div>
          </div>

          <div class="tp-member-search">
            <!-- Search input wrapper — relative для dropdown -->
            <div class="tp-member-search__wrap">
              <div
                class="tp-member-search__input"
                :class="{ 'tp-member-search__input--active': searchFocused && memberQuery }"
              >
                <span class="material-symbols-outlined">search</span>
                <input
                  ref="searchInputEl"
                  v-model="memberQuery"
                  type="text"
                  placeholder="Введите email пользователя..."
                  autocomplete="off"
                  spellcheck="false"
                  @focus="searchFocused = true"
                  @blur="onSearchBlur"
                />
                <!-- spinner во время печати -->
                <span v-if="searchLoading" class="material-symbols-outlined tp-spin tp-spin--sm">sync</span>
                <!-- clear button -->
                <button
                  v-if="memberQuery && !searchLoading"
                  class="tp-clear-btn"
                  type="button"
                  @mousedown.prevent
                  @click="clearMemberSearch"
                >
                  <span class="material-symbols-outlined">close</span>
                </button>
              </div>

              <!-- Dropdown результаты -->
              <transition name="tp-dropdown">
                <div v-if="showDropdown" class="tp-search-dropdown">

                  <!-- Идёт загрузка -->
                  <div v-if="searchLoading" class="tp-dropdown-loading">
                    <div v-for="i in 3" :key="i" class="tp-dropdown-skeleton">
                      <div class="tp-ds-avatar"></div>
                      <div class="tp-ds-lines">
                        <div class="tp-ds-line tp-ds-line--name"></div>
                        <div class="tp-ds-line"></div>
                      </div>
                    </div>
                  </div>

                  <!-- Ошибка -->
                  <div v-else-if="searchError" class="tp-dropdown-error">
                    <span class="material-symbols-outlined">error_outline</span>
                    {{ searchError }}
                  </div>

                  <!-- Нет результатов -->
                  <div v-else-if="searchResults.length === 0" class="tp-dropdown-empty">
                    <span class="material-symbols-outlined">person_search</span>
                    <span>Пользователь не найден</span>
                  </div>

                  <!-- Список -->
                  <template v-else>
                    <div class="tp-dropdown-hint">Найдено {{ searchResults.length }} пользователей</div>
                    <button
                      v-for="user in searchResults"
                      :key="user.id"
                      class="tp-dropdown-item"
                      :class="{
                        'tp-dropdown-item--added':   addedUserIds.includes(user.id) || isUserInTeam(user, activeTeam.id),
                        'tp-dropdown-item--loading':  addingUserId === user.id,
                      }"
                      type="button"
                      :disabled="addingUserId === user.id || addedUserIds.includes(user.id) || isUserInTeam(user, activeTeam.id)"
                      @mousedown.prevent
                      @click="addMember(user)"
                    >
                      <div class="tp-di-avatar">{{ getUserInitials(user) }}</div>
                      <div class="tp-di-info">
                        <strong>{{ getUserName(user) }}</strong>
                        <span>{{ user.email }}</span>
                      </div>
                      <div class="tp-di-action">
                        <span v-if="addingUserId === user.id" class="material-symbols-outlined tp-spin">sync</span>
                        <span v-else-if="addedUserIds.includes(user.id) || isUserInTeam(user, activeTeam.id)" class="material-symbols-outlined tp-added-icon">check_circle</span>
                        <span v-else class="material-symbols-outlined">add</span>
                      </div>
                    </button>
                  </template>

                </div>
              </transition>
            </div>
          </div>
        </div>

        <!-- Список участников -->
        <div class="tp-members-list">

          <!-- Загрузка участников — скелетон -->
          <div v-if="membersLoading" class="tp-members-skeleton">
            <div v-for="i in 3" :key="i" class="tp-member-skeleton">
              <div class="tp-skeleton-ava"></div>
              <div class="tp-skeleton-body">
                <div class="tp-skeleton-line tp-skeleton-line--name"></div>
                <div class="tp-skeleton-line"></div>
              </div>
            </div>
          </div>

          <!-- Нет участников -->
          <div v-else-if="teamMembers.length === 0" class="tp-members-empty">
            <span class="material-symbols-outlined">group</span>
            <span>В команде пока нет участников. Добавьте первого выше.</span>
          </div>

          <!-- Карточки участников -->
          <template v-else>
            <div class="tp-members-grid-head">
              <span>Участник</span>
              <span>Email</span>
              <span>Роль</span>
              <span>Профиль</span>
            </div>
            <div
              v-for="member in teamMembers"
              :key="member.id ?? member.user_id"
              class="tp-member-row"
            >
              <div class="tp-member-identity">
                <div class="tp-member-avatar">
                  {{ getUserInitials(member) }}
                </div>
                <div>
                  <strong>{{ getUserName(member) }}</strong>
                </div>
              </div>
              <span class="tp-member-email">{{ member.email }}</span>
              <span class="tp-member-role">{{ getUserRoleLabel(member.role) }}</span>
              <button class="tp-profile-btn" type="button" @click="openUserProfile(member)">
                Посмотреть профиль
                <span class="material-symbols-outlined">open_in_new</span>
              </button>
            </div>
          </template>
        </div>

        <section v-if="profileLoading || profileError || profileUser" class="tp-profile-panel">
          <div class="tp-profile-panel__header">
            <div>
              <h3>Профиль участника</h3>
              <p>{{ profileUser ? profileUser.email : 'Карточка сотрудника' }}</p>
            </div>
            <button class="tp-profile-close" type="button" @click="closeUserProfile">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>

          <div v-if="profileLoading" class="tp-profile-loading">
            <span class="material-symbols-outlined tp-spin">sync</span>
            Загружаем профиль...
          </div>

          <div v-else-if="profileError" class="tp-profile-error">
            <span class="material-symbols-outlined">error</span>
            {{ profileError }}
          </div>

          <div v-else-if="profileUser" class="tp-profile-card">
            <div class="tp-profile-card__avatar">{{ getUserInitials(profileUser) }}</div>
            <div class="tp-profile-card__main">
              <h4>{{ getUserName(profileUser) }}</h4>
              <p>{{ profileUser.email }}</p>
            </div>
            <div class="tp-profile-card__grid">
              <div>
                <span>Роль</span>
                <strong>{{ getUserRoleLabel(profileUser.role) }}</strong>
              </div>
              <div>
                <span>Команда</span>
                <strong>{{ activeTeam.name }}</strong>
              </div>
              <div>
                <span>Компания</span>
                <strong>{{ profileUser.company_name || 'Не указана' }}</strong>
              </div>
              <div>
                <span>Создан</span>
                <strong>{{ formatDate(profileUser.created_at) }}</strong>
              </div>
            </div>
          </div>
        </section>

      </div>
    </template>

    <!-- ════════════════════════════════════════
         LIST VIEW — список команд
    ════════════════════════════════════════ -->
    <template v-else>

      <!-- Шапка -->
      <header class="tp-header">
        <div class="tp-header__text">
          <h2>Команды</h2>
          <p>Управляйте командами, следите за показателями и создавайте новые отделы.</p>
        </div>
        <button class="tp-btn-primary" type="button" @click="openCreateModal">
          <span class="material-symbols-outlined">add</span>
          Создать команду
        </button>
      </header>

      <!-- Поиск и фильтр -->
      <div class="tp-toolbar">
        <div class="tp-search">
          <span class="material-symbols-outlined">search</span>
          <input v-model="searchQuery" type="search" placeholder="Поиск по названию команды..." />
          <button v-if="searchQuery" class="tp-search__clear" @click="searchQuery = ''" type="button">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <div class="tp-filters">
          <button
            v-for="f in [{ key: 'all', label: 'Все' }, { key: 'active', label: 'Активные' }, { key: 'archived', label: 'Архив' }]"
            :key="f.key"
            class="tp-filter-btn"
            :class="{ 'tp-filter-btn--active': activeFilter === f.key }"
            type="button"
            @click="activeFilter = f.key"
          >{{ f.label }}</button>
        </div>
      </div>

      <!-- Ошибка -->
      <div v-if="error" class="tp-state tp-state--error">
        <span class="material-symbols-outlined">cloud_off</span>
        <div>
          <strong>Не удалось загрузить команды</strong>
          <p>{{ error }}</p>
        </div>
        <button class="tp-btn-primary" @click="fetchTeams" type="button">Повторить</button>
      </div>

      <!-- Загрузка -->
      <div v-else-if="isLoading" class="tp-list">
        <div v-for="i in 4" :key="i" class="tp-skeleton">
          <div class="tp-skeleton__avatar"></div>
          <div class="tp-skeleton__body">
            <div class="tp-skeleton__line tp-skeleton__line--title"></div>
            <div class="tp-skeleton__line"></div>
          </div>
          <div class="tp-skeleton__meta">
            <div class="tp-skeleton__line tp-skeleton__line--sm"></div>
            <div class="tp-skeleton__line tp-skeleton__line--sm"></div>
            <div class="tp-skeleton__line tp-skeleton__line--sm"></div>
          </div>
        </div>
      </div>

      <!-- Пусто: команд нет -->
      <div v-else-if="teams.length === 0" class="tp-empty">
        <span class="material-symbols-outlined tp-empty__icon">group_add</span>
        <strong>Команд пока нет</strong>
        <p>Создайте первую команду — она появится здесь.</p>
        <button class="tp-btn-primary" type="button" @click="openCreateModal">
          <span class="material-symbols-outlined">add</span>
          Создать команду
        </button>
      </div>

      <!-- Пусто: поиск ничего не нашёл -->
      <div v-else-if="filteredTeams.length === 0" class="tp-empty">
        <span class="material-symbols-outlined tp-empty__icon">search_off</span>
        <strong>Ничего не найдено</strong>
        <p>Попробуйте изменить запрос или сбросьте фильтр.</p>
        <button class="tp-btn-ghost" type="button" @click="searchQuery = ''; activeFilter = 'all'">
          Сбросить поиск
        </button>
      </div>

      <!-- Список -->
      <div v-else class="tp-list">
        <div class="tp-list__header">
          Найдено команд: <strong>{{ filteredTeams.length }}</strong>
        </div>

        <article
          v-for="team in filteredTeams"
          :key="team.id"
          class="tp-card"
          :class="{ 'tp-card--archived': getTeamStatus(team) === 'archived' }"
        >
          <div class="tp-card__avatar">{{ getInitials(team.name) }}</div>

          <div class="tp-card__info">
            <div class="tp-card__name-row">
              <h4>{{ team.name }}</h4>
              <span v-if="getTeamStatus(team) === 'archived'" class="tp-badge tp-badge--archived">Архив</span>
              <span v-else class="tp-badge tp-badge--active">Активна</span>
            </div>
            <p class="tp-card__id">{{ getTeamMemberCount(team) }} участников</p>
          </div>

          <div class="tp-card__metrics">
            <div class="tp-metric">
              <span class="material-symbols-outlined">person</span>
              <div><strong>{{ getTeamMemberCount(team) }}</strong><small>Участников</small></div>
            </div>
          </div>

          <button class="tp-card__action" type="button" @click="openTeam(team)">
            Открыть
            <span class="material-symbols-outlined">chevron_right</span>
          </button>
        </article>
      </div>

    </template>

    <!-- ── Модалка создания ── -->
    <transition name="tp-modal">
      <div v-if="showCreateModal" class="tp-modal-backdrop" @click.self="closeCreateModal">
        <div class="tp-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">

          <div class="tp-modal__header">
            <div>
              <h3 id="modal-title">Новая команда</h3>
              <p>Введите название и сохраните.</p>
            </div>
            <button class="tp-modal__close" type="button" @click="closeCreateModal">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>

          <div class="tp-modal__body">
            <label class="tp-field">
              <span class="tp-field__label">Название команды</span>
              <div class="tp-input" :class="{ 'tp-input--disabled': isCreating }">
                <span class="material-symbols-outlined">groups</span>
                <input
                  v-model="newTeamName"
                  type="text"
                  placeholder="Например: Отдел продаж МСК"
                  :disabled="isCreating"
                  @keydown.enter="createTeam"
                  autofocus
                />
              </div>
            </label>
          </div>

          <div class="tp-modal__footer">
            <button class="tp-btn-ghost" type="button" @click="closeCreateModal" :disabled="isCreating">
              Отмена
            </button>
            <button
              class="tp-btn-primary"
              type="button"
              @click="createTeam"
              :disabled="isCreating || !newTeamName.trim()"
            >
              <span v-if="isCreating" class="material-symbols-outlined tp-spin">sync</span>
              <span v-else class="material-symbols-outlined">add</span>
              {{ isCreating ? 'Создаём...' : 'Создать' }}
            </button>
          </div>

        </div>
      </div>
    </transition>

    <!-- ── Модалка критериев ── -->
    <transition name="tp-modal">
      <div v-if="showCriteriaModal" class="tp-modal-backdrop" @click.self="closeCriteriaModal">
        <div class="tp-modal tp-modal--wide" role="dialog" aria-modal="true" aria-labelledby="criteria-modal-title">

          <div class="tp-modal__header">
            <div>
              <h3 id="criteria-modal-title">Критерии для ИИ-анализа</h3>
              <p>Добавьте дополнительные правила для оценки звонков команды.</p>
            </div>
            <button class="tp-modal__close" type="button" @click="closeCriteriaModal" :disabled="isCriteriaSaving">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>

          <div class="tp-modal__body">
            <label class="tp-field">
              <span class="tp-field__label">Дополнительные критерии</span>
              <div class="tp-textarea" :class="{ 'tp-input--disabled': isCriteriaSaving }">
                <span class="material-symbols-outlined">record_voice_over</span>
                <textarea
                  v-model="criteriaText"
                  rows="8"
                  placeholder="Например: оценивать уверенность голоса, паузы, работу с возражениями, полноту выявления потребности и следующий шаг после звонка."
                  :disabled="isCriteriaSaving"
                  autofocus
                ></textarea>
              </div>
            </label>

            <div class="tp-criteria-tips">
              <span class="material-symbols-outlined">tips_and_updates</span>
              <p>Можно писать списком: каждый критерий с новой строки. ИИ будет использовать их как дополнительный фокус при анализе.</p>
            </div>

            <p v-if="criteriaError" class="tp-modal-error">{{ criteriaError }}</p>
          </div>

          <div class="tp-modal__footer">
            <button class="tp-btn-ghost" type="button" @click="closeCriteriaModal" :disabled="isCriteriaSaving">
              Отмена
            </button>
            <button
              class="tp-btn-primary"
              type="button"
              @click="saveTeamCriteria"
              :disabled="isCriteriaSaving || !criteriaText.trim()"
            >
              <span v-if="isCriteriaSaving" class="material-symbols-outlined tp-spin">sync</span>
              <span v-else class="material-symbols-outlined">save</span>
              {{ isCriteriaSaving ? 'Сохраняем...' : 'Сохранить критерии' }}
            </button>
          </div>

        </div>
      </div>
    </transition>

  </section>
</template>

<style scoped>
/* ─── Base ──────────────────────────────────────────────────────────────── */
.tp-page {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  width: 100%;
  max-width: 72rem;
  margin: 0 auto;
}

/* ─── Header ────────────────────────────────────────────────────────────── */
.tp-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.tp-header__text h2 {
  margin: 0;
  font-size: clamp(1.75rem, 3vw, 2.4rem);
  color: var(--on-surface);
  line-height: 1.08;
}
.tp-header__text p {
  margin: 0.5rem 0 0;
  color: var(--secondary);
  line-height: 1.6;
}

/* ─── Buttons ───────────────────────────────────────────────────────────── */
.tp-btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 2.75rem;
  border: none;
  border-radius: 0.5rem;
  background: var(--primary);
  color: #fff;
  padding: 0 1.15rem;
  font: inherit;
  font-weight: 700;
  font-size: 0.95rem;
  cursor: pointer;
  transition: background 140ms, box-shadow 140ms, transform 140ms, opacity 140ms;
}
.tp-btn-primary:hover:not(:disabled) {
  background: #255fcf;
  box-shadow: 0 10px 22px rgba(47,111,237,.22);
  transform: translateY(-1px);
}
.tp-btn-primary:disabled { opacity: .55; cursor: not-allowed; }

.tp-btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 2.75rem;
  border: 1px solid var(--outline);
  border-radius: 0.5rem;
  background: #fff;
  color: var(--on-surface);
  padding: 0 1.15rem;
  font: inherit;
  font-weight: 600;
  font-size: 0.95rem;
  cursor: pointer;
  transition: border-color 140ms, color 140ms;
}
.tp-btn-ghost:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); }
.tp-btn-ghost:disabled { opacity: .55; cursor: not-allowed; }

/* ─── Notification ──────────────────────────────────────────────────────── */
.tp-notification {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.85rem 1rem;
  border-radius: 0.5rem;
  font-weight: 600;
  font-size: 0.92rem;
}
.tp-notification--success { background: #ecfdf5; border: 1px solid #6ee7b7; color: #065f46; }
.tp-notification--error   { background: #fef2f2; border: 1px solid #fca5a5; color: #991b1b; }

/* ─── Toolbar ───────────────────────────────────────────────────────────── */
.tp-toolbar {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  align-items: center;
}
.tp-search {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex: 1;
  min-width: 16rem;
  border: 1px solid var(--outline);
  border-radius: 0.5rem;
  background: #fff;
  padding: 0 0.9rem;
  height: 2.75rem;
  transition: border-color 140ms, box-shadow 140ms;
}
.tp-search:focus-within { border-color: rgba(47,111,237,.5); box-shadow: 0 0 0 3px rgba(47,111,237,.1); }
.tp-search .material-symbols-outlined { color: var(--secondary); flex-shrink: 0; }
.tp-search input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; color: var(--on-surface); font: inherit; font-size: 0.92rem; }
.tp-search input::placeholder { color: #9aa6b8; }
.tp-search__clear { display: inline-flex; align-items: center; border: none; background: transparent; cursor: pointer; color: var(--secondary); padding: 0; transition: color 140ms; }
.tp-search__clear:hover { color: var(--on-surface); }

.tp-filters { display: flex; gap: 0.35rem; border: 1px solid var(--outline); border-radius: 0.5rem; background: var(--surface-low); padding: 0.25rem; }
.tp-filter-btn { min-height: 2.2rem; border: none; border-radius: 0.35rem; background: transparent; color: var(--secondary); padding: 0 0.85rem; font: inherit; font-size: 0.88rem; font-weight: 600; cursor: pointer; transition: background 140ms, color 140ms; }
.tp-filter-btn--active { background: #fff; color: var(--primary); font-weight: 700; box-shadow: 0 2px 8px rgba(23,32,51,.08); }

/* ─── States ────────────────────────────────────────────────────────────── */
.tp-state { display: flex; align-items: center; gap: 1rem; padding: 1.25rem; border-radius: 0.75rem; border: 1px solid var(--outline); background: #fff; flex-wrap: wrap; }
.tp-state--error { border-color: #fca5a5; background: #fef2f2; }
.tp-state--error > .material-symbols-outlined { color: var(--error); font-size: 2rem; flex-shrink: 0; }
.tp-state > div { flex: 1; }
.tp-state strong { color: var(--on-surface); }
.tp-state p { margin: 0.25rem 0 0; color: var(--secondary); font-size: 0.9rem; }

.tp-empty { display: flex; flex-direction: column; align-items: center; gap: 0.75rem; text-align: center; padding: 3.5rem 2rem; border: 2px dashed var(--outline-strong); border-radius: 0.75rem; background: rgba(255,255,255,.6); }
.tp-empty__icon { font-size: 3rem; color: var(--outline-strong); }
.tp-empty strong { color: var(--on-surface); font-size: 1.15rem; }
.tp-empty p { margin: 0; color: var(--secondary); font-size: 0.92rem; max-width: 22rem; }

/* ─── List ──────────────────────────────────────────────────────────────── */
.tp-list { display: flex; flex-direction: column; gap: 0.65rem; }
.tp-list__header { font-size: 0.85rem; color: var(--secondary); padding: 0 0.25rem; }
.tp-list__header strong { color: var(--on-surface); }

/* ─── Card ──────────────────────────────────────────────────────────────── */
.tp-card {
  display: grid;
  grid-template-columns: auto minmax(0,1fr) auto auto;
  align-items: center;
  gap: 1rem;
  padding: 1.1rem 1.25rem;
  border: 1px solid var(--outline);
  border-radius: 0.75rem;
  background: #fff;
  box-shadow: 0 2px 12px rgba(23,32,51,.04);
  transition: border-color 140ms, box-shadow 140ms, transform 140ms;
}
.tp-card:hover { border-color: rgba(47,111,237,.35); box-shadow: 0 8px 28px rgba(47,111,237,.1); transform: translateY(-1px); }
.tp-card--archived { opacity: .65; }

.tp-card__avatar { width: 3rem; height: 3rem; border-radius: 0.65rem; background: var(--primary-soft); color: var(--primary); font-weight: 900; font-size: 0.95rem; display: grid; place-items: center; flex-shrink: 0; border: 1px solid rgba(47,111,237,.15); }
.tp-card__info { min-width: 0; }
.tp-card__name-row { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
.tp-card__name-row h4 { margin: 0; font-size: 0.98rem; color: var(--on-surface); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tp-card__id { margin: 0.2rem 0 0; font-size: 0.8rem; color: var(--secondary); }
.tp-card__metrics { display: flex; gap: 1.5rem; }
.tp-card__action { display: inline-flex; align-items: center; gap: 0.25rem; min-height: 2.2rem; border: 1px solid var(--outline); border-radius: 999px; background: #fff; color: var(--primary); padding: 0 0.85rem; font: inherit; font-size: 0.88rem; font-weight: 700; cursor: pointer; white-space: nowrap; flex-shrink: 0; transition: background 140ms, border-color 140ms, color 140ms; }
.tp-card__action:hover { background: var(--primary); border-color: var(--primary); color: #fff; }

.tp-metric { display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; }
.tp-metric .material-symbols-outlined { font-size: 1.25rem; color: var(--secondary); }
.tp-metric strong { display: block; color: var(--on-surface); font-size: 0.9rem; line-height: 1.1; }
.tp-metric small { display: block; color: var(--secondary); font-size: 0.7rem; text-transform: uppercase; letter-spacing: .05em; font-weight: 600; }

/* ─── Badges ────────────────────────────────────────────────────────────── */
.tp-badge { flex-shrink: 0; display: inline-flex; align-items: center; padding: 0.2rem 0.55rem; border-radius: 999px; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; }
.tp-badge--active   { background: #ecfdf5; color: #16a34a; border: 1px solid #6ee7b7; }
.tp-badge--archived { background: var(--surface-low); color: var(--secondary); border: 1px solid var(--outline); }

/* ─── Skeleton ──────────────────────────────────────────────────────────── */
.tp-skeleton { display: grid; grid-template-columns: auto minmax(0,1fr) auto; align-items: center; gap: 1rem; padding: 1.1rem 1.25rem; border: 1px solid var(--outline); border-radius: 0.75rem; background: #fff; }
.tp-skeleton__avatar { width: 3rem; height: 3rem; border-radius: 0.65rem; background: var(--surface-low); animation: tp-shimmer 1.4s ease-in-out infinite; }
.tp-skeleton__body { display: flex; flex-direction: column; gap: 0.5rem; }
.tp-skeleton__meta { display: flex; gap: 1.5rem; }
.tp-skeleton__line { height: 0.7rem; border-radius: 4px; background: linear-gradient(90deg, var(--surface-low) 25%, var(--outline) 50%, var(--surface-low) 75%); background-size: 200% 100%; animation: tp-shimmer 1.4s ease-in-out infinite; width: 60%; }
.tp-skeleton__line--title { width: 40%; height: 0.9rem; }
.tp-skeleton__line--sm { width: 3rem; }

/* ─── Modal ─────────────────────────────────────────────────────────────── */
.tp-modal-backdrop { position: fixed; inset: 0; background: rgba(15,23,42,.45); display: grid; place-items: center; z-index: 100; padding: 1.5rem; }
.tp-modal { width: min(100%, 28rem); background: #fff; border-radius: 1rem; box-shadow: 0 24px 64px rgba(15,23,42,.18); display: flex; flex-direction: column; }
.tp-modal--wide { width: min(100%, 34rem); }
.tp-modal__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; padding: 1.35rem 1.35rem 0; }
.tp-modal__header h3 { margin: 0; font-size: 1.2rem; color: var(--on-surface); }
.tp-modal__header p { margin: 0.35rem 0 0; color: var(--secondary); font-size: 0.9rem; }
.tp-modal__close { display: inline-flex; align-items: center; justify-content: center; width: 2.2rem; height: 2.2rem; border: 1px solid var(--outline); border-radius: 999px; background: transparent; color: var(--secondary); cursor: pointer; flex-shrink: 0; transition: border-color 140ms, color 140ms; }
.tp-modal__close:hover { border-color: var(--on-surface); color: var(--on-surface); }
.tp-modal__body   { padding: 1.25rem 1.35rem; }
.tp-modal__footer { display: flex; justify-content: flex-end; gap: 0.65rem; padding: 0 1.35rem 1.35rem; }

.tp-field { display: flex; flex-direction: column; gap: 0.55rem; }
.tp-field__label { font-size: 0.88rem; font-weight: 700; color: var(--on-surface); }
.tp-input { display: flex; align-items: center; gap: 0.65rem; height: 3rem; border: 1px solid var(--outline); border-radius: 0.5rem; background: #fff; padding: 0 0.9rem; transition: border-color 140ms, box-shadow 140ms; }
.tp-input:focus-within { border-color: rgba(47,111,237,.5); box-shadow: 0 0 0 3px rgba(47,111,237,.1); }
.tp-input--disabled { opacity: .6; pointer-events: none; }
.tp-input .material-symbols-outlined { color: var(--secondary); flex-shrink: 0; }
.tp-input input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; color: var(--on-surface); font: inherit; font-size: 0.95rem; }
.tp-input input::placeholder { color: #9aa6b8; }
.tp-textarea {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: flex-start;
  gap: 0.65rem;
  border: 1px solid var(--outline);
  border-radius: 0.6rem;
  background: #fff;
  padding: 0.85rem 0.9rem;
  transition: border-color 140ms, box-shadow 140ms;
}
.tp-textarea:focus-within { border-color: rgba(47,111,237,.5); box-shadow: 0 0 0 3px rgba(47,111,237,.1); }
.tp-textarea .material-symbols-outlined { color: var(--secondary); flex-shrink: 0; margin-top: 0.1rem; }
.tp-textarea textarea {
  width: 100%;
  min-width: 0;
  border: none;
  outline: none;
  resize: vertical;
  background: transparent;
  color: var(--on-surface);
  font: inherit;
  font-size: 0.94rem;
  line-height: 1.55;
}
.tp-textarea textarea::placeholder { color: #9aa6b8; }
.tp-criteria-tips {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  margin-top: 0.85rem;
  border: 1px solid #bfdbfe;
  border-radius: 0.65rem;
  background: #eff6ff;
  color: #1e40af;
  padding: 0.85rem;
}
.tp-criteria-tips .material-symbols-outlined { font-size: 1.15rem; flex-shrink: 0; }
.tp-criteria-tips p,
.tp-modal-error { margin: 0; font-size: 0.86rem; line-height: 1.5; }
.tp-modal-error { margin-top: 0.85rem; color: var(--error); font-weight: 700; }

/* ─── Detail View ───────────────────────────────────────────────────────── */
.tp-detail-nav { display: flex; align-items: center; }
.tp-back-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border: 1px solid var(--outline);
  border-radius: 999px;
  background: #fff;
  color: var(--secondary);
  padding: 0.55rem 1rem;
  font: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: color 140ms, border-color 140ms;
}
.tp-delete-team-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 2.5rem;
  border: 1px solid #fca5a5;
  border-radius: 0.5rem;
  background: #fff5f5;
  color: #b91c1c;
  padding: 0 1rem;
  font: inherit;
  font-size: 0.88rem;
  font-weight: 700;
  cursor: pointer;
  flex-shrink: 0;
  align-self: flex-start;
  transition: background 140ms, border-color 140ms, transform 140ms;
}
.tp-delete-team-btn:hover {
  background: #fee2e2;
  border-color: #f87171;
  transform: translateY(-1px);
}
.tp-delete-team-btn:disabled {
  cursor: not-allowed;
  opacity: .65;
  transform: none;
}
.tp-delete-team-btn .material-symbols-outlined { font-size: 1.1rem; }
.tp-back-btn:hover { color: var(--primary); border-color: var(--primary); }

.tp-criteria-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  min-height: 2.5rem;
  border: 1px solid rgba(47,111,237,.35);
  border-radius: 0.5rem;
  background: var(--primary-soft);
  color: var(--primary);
  padding: 0 1rem;
  font: inherit;
  font-size: 0.88rem;
  font-weight: 800;
  cursor: pointer;
  white-space: nowrap;
  transition: background 140ms, border-color 140ms, transform 140ms;
}
.tp-criteria-btn:hover {
  background: #dbeafe;
  border-color: rgba(47,111,237,.55);
  transform: translateY(-1px);
}
.tp-criteria-btn .material-symbols-outlined { font-size: 1.1rem; }

.tp-team-hero {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 1.25rem;
  padding: 1.5rem;
  border: 1px solid var(--outline);
  border-radius: 0.75rem;
  background: #fff;
  box-shadow: 0 2px 16px rgba(23,32,51,.05);
}
.tp-team-hero__avatar {
  width: 4rem;
  height: 4rem;
  border-radius: 1rem;
  background: var(--primary-soft);
  color: var(--primary);
  font-weight: 900;
  font-size: 1.1rem;
  display: grid;
  place-items: center;
  border: 1px solid rgba(47,111,237,.2);
  flex-shrink: 0;
}
.tp-team-hero__info { min-width: 0; }
.tp-team-hero__name-row { display: flex; align-items: center; gap: 0.65rem; flex-wrap: wrap; }
.tp-team-hero__name-row h2 { margin: 0; font-size: clamp(1.3rem, 2.5vw, 1.75rem); color: var(--on-surface); }
.tp-team-hero__id { margin: 0.3rem 0 0; font-size: 0.82rem; color: var(--secondary); }
.tp-team-hero__actions { display: flex; align-items: center; justify-content: flex-end; gap: 0.75rem; flex-wrap: wrap; }
.tp-team-hero__stats { display: flex; gap: 2rem; flex-shrink: 0; }
.tp-hero-stat { text-align: center; }
.tp-hero-stat strong { display: block; font-size: 1.35rem; color: var(--on-surface); line-height: 1; }
.tp-hero-stat span { display: block; margin-top: 0.25rem; font-size: 0.72rem; text-transform: uppercase; letter-spacing: .06em; font-weight: 700; color: var(--secondary); }

.tp-criteria-panel {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 1rem;
  border: 1px solid var(--outline);
  border-radius: 0.75rem;
  background: #fff;
  padding: 1.25rem;
  box-shadow: 0 2px 16px rgba(23,32,51,.04);
}
.tp-criteria-panel__icon {
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 0.7rem;
  background: #f0f9ff;
  color: #0369a1;
  border: 1px solid #bae6fd;
}
.tp-criteria-panel__content { min-width: 0; display: grid; gap: 0.85rem; }
.tp-criteria-panel__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
.tp-criteria-panel__head h3 { margin: 0; color: var(--on-surface); font-size: 1.05rem; }
.tp-criteria-panel__head p { margin: 0.25rem 0 0; color: var(--secondary); font-size: 0.88rem; line-height: 1.5; }
.tp-criteria-panel__text,
.tp-criteria-panel__empty {
  margin: 0;
  border: 1px solid var(--outline);
  border-radius: 0.65rem;
  background: var(--surface-low);
  color: var(--on-surface);
  padding: 0.9rem;
  font-size: 0.9rem;
  line-height: 1.6;
  white-space: pre-wrap;
}
.tp-criteria-panel__empty { color: var(--secondary); }

/* ─── Members section ───────────────────────────────────────────────────── */
.tp-members-section { display: flex; flex-direction: column; gap: 1rem; }
.tp-section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
.tp-section-head h3 { margin: 0; font-size: 1.15rem; color: var(--on-surface); }
.tp-section-head p  { margin: 0.3rem 0 0; color: var(--secondary); font-size: 0.9rem; }

/* Add member panel */
.tp-add-member-panel {
  border: 1px solid var(--outline);
  border-radius: 0.75rem;
  background: #fff;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.tp-add-member-panel__header {
  display: flex;
  align-items: flex-start;
  gap: 0.9rem;
}
.tp-add-member-panel__header > .material-symbols-outlined {
  width: 2.5rem; height: 2.5rem;
  border-radius: 0.6rem;
  background: var(--primary-soft);
  color: var(--primary);
  display: grid; place-items: center;
  flex-shrink: 0;
  font-size: 1.25rem;
}
.tp-add-member-panel__header strong { display: block; font-size: 0.95rem; color: var(--on-surface); }
.tp-add-member-panel__header p { margin: 0.2rem 0 0; font-size: 0.85rem; color: var(--secondary); }

.tp-member-search { display: flex; flex-direction: column; gap: 0.75rem; }

/* Wrapper для position: relative dropdown */
.tp-member-search__wrap { position: relative; }

.tp-member-search__input {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  height: 3rem;
  border: 1px solid var(--outline);
  border-radius: 0.5rem;
  background: #fff;
  padding: 0 0.9rem;
  transition: border-color 140ms, box-shadow 140ms;
}
.tp-member-search__input:focus-within,
.tp-member-search__input--active {
  border-color: rgba(47,111,237,.5);
  box-shadow: 0 0 0 3px rgba(47,111,237,.1);
}
.tp-member-search__input .material-symbols-outlined { color: var(--secondary); flex-shrink: 0; }
.tp-member-search__input input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; color: var(--on-surface); font: inherit; font-size: 0.92rem; }
.tp-member-search__input input::placeholder { color: #9aa6b8; }

.tp-spin--sm { font-size: 1.1rem; width: 1.1rem; height: 1.1rem; color: var(--primary); }

.tp-clear-btn {
  display: inline-flex; align-items: center;
  border: none; background: transparent; cursor: pointer;
  color: var(--secondary); padding: 0;
  transition: color 140ms;
}
.tp-clear-btn:hover { color: var(--on-surface); }

/* ── Dropdown ───────────────────────────────────────────────────────────── */
.tp-search-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  left: 0; right: 0;
  z-index: 50;
  border: 1px solid var(--outline);
  border-radius: 0.65rem;
  background: #fff;
  box-shadow: 0 8px 32px rgba(23,32,51,.12), 0 2px 8px rgba(23,32,51,.06);
  overflow: hidden;
  max-height: 22rem;
  overflow-y: auto;
}

.tp-dropdown-hint {
  padding: 0.55rem 1rem;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: var(--secondary);
  border-bottom: 1px solid var(--outline);
  background: var(--surface-low);
}

/* Result item — button так что keyboard-friendly */
.tp-dropdown-item {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.85rem;
  width: 100%;
  padding: 0.75rem 1rem;
  border: none;
  border-bottom: 1px solid var(--outline);
  background: #fff;
  text-align: left;
  cursor: pointer;
  transition: background 100ms;
}
.tp-dropdown-item:last-child { border-bottom: none; }
.tp-dropdown-item:hover:not(:disabled) { background: var(--surface-low); }
.tp-dropdown-item:disabled { cursor: default; }
.tp-dropdown-item--added { background: #f0fdf4; }
.tp-dropdown-item--added:hover { background: #dcfce7 !important; }

.tp-di-avatar {
  width: 2.1rem; height: 2.1rem;
  border-radius: 999px;
  background: var(--primary-soft);
  color: var(--primary);
  font-weight: 800; font-size: 0.78rem;
  display: grid; place-items: center;
  flex-shrink: 0;
}
.tp-di-info { min-width: 0; }
.tp-di-info strong { display: block; font-size: 0.88rem; color: var(--on-surface); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tp-di-info span   { display: block; font-size: 0.8rem;  color: var(--secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.tp-di-action { flex-shrink: 0; display: grid; place-items: center; width: 1.75rem; height: 1.75rem; }
.tp-di-action .material-symbols-outlined { font-size: 1.2rem; color: var(--secondary); }
.tp-dropdown-item:hover:not(:disabled) .tp-di-action .material-symbols-outlined { color: var(--primary); }
.tp-added-icon { color: #16a34a !important; }

/* Loading skeleton inside dropdown */
.tp-dropdown-loading { display: flex; flex-direction: column; }
.tp-dropdown-skeleton { display: flex; align-items: center; gap: 0.85rem; padding: 0.75rem 1rem; border-bottom: 1px solid var(--outline); }
.tp-dropdown-skeleton:last-child { border-bottom: none; }
.tp-ds-avatar { width: 2.1rem; height: 2.1rem; border-radius: 999px; background: var(--surface-low); animation: tp-shimmer 1.4s ease-in-out infinite; flex-shrink: 0; }
.tp-ds-lines { flex: 1; display: flex; flex-direction: column; gap: 0.4rem; }
.tp-ds-line { height: 0.6rem; border-radius: 4px; background: linear-gradient(90deg, var(--surface-low) 25%, var(--outline) 50%, var(--surface-low) 75%); background-size: 200% 100%; animation: tp-shimmer 1.4s ease-in-out infinite; width: 60%; }
.tp-ds-line--name { width: 38%; height: 0.75rem; }

.tp-dropdown-error { display: flex; align-items: center; gap: 0.5rem; padding: 1rem; font-size: 0.88rem; color: var(--error); }
.tp-dropdown-empty { display: flex; align-items: center; gap: 0.6rem; padding: 1rem; font-size: 0.88rem; color: var(--secondary); }

/* Dropdown animation */
.tp-dropdown-enter-active { transition: opacity 120ms, transform 120ms; }
.tp-dropdown-leave-active { transition: opacity 100ms, transform 100ms; }
.tp-dropdown-enter-from, .tp-dropdown-leave-to { opacity: 0; transform: translateY(-4px); }

/* Members list */
.tp-members-list {
  border: 1px solid var(--outline);
  border-radius: 0.75rem;
  background: #fff;
  overflow: hidden;
}
.tp-members-grid-head {
  display: grid;
  grid-template-columns: minmax(0,1fr) minmax(0,1fr) 8rem auto;
  gap: 1rem;
  padding: 0.65rem 1.25rem;
  background: var(--surface-low);
  border-bottom: 1px solid var(--outline);
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: var(--secondary);
}
.tp-member-row {
  display: grid;
  grid-template-columns: minmax(0,1fr) minmax(0,1fr) 8rem auto;
  align-items: center;
  gap: 1rem;
  padding: 0.9rem 1.25rem;
  border-bottom: 1px solid var(--outline);
  transition: background 120ms;
}
.tp-member-row:last-child { border-bottom: none; }
.tp-member-row:hover { background: var(--surface-low); }

.tp-member-identity { display: flex; align-items: center; gap: 0.75rem; min-width: 0; }
.tp-member-avatar { width: 2.25rem; height: 2.25rem; border-radius: 0.5rem; background: var(--primary-soft); color: var(--primary); font-size: 0.8rem; font-weight: 800; display: grid; place-items: center; flex-shrink: 0; }
.tp-member-identity strong { font-size: 0.9rem; color: var(--on-surface); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tp-member-email { font-size: 0.85rem; color: var(--secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tp-member-role  { font-size: 0.82rem; color: var(--secondary); }

.tp-profile-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  min-height: 2rem;
  border: 1px solid var(--outline);
  border-radius: 999px;
  background: #fff;
  color: var(--primary);
  padding: 0 0.8rem;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  transition: background 140ms, border-color 140ms, color 140ms;
}
.tp-profile-btn .material-symbols-outlined { font-size: 1rem; }
.tp-profile-btn:hover { background: var(--primary); border-color: var(--primary); color: #fff; }

.tp-remove-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem; height: 2rem;
  border: 1px solid transparent;
  border-radius: 0.4rem;
  background: transparent;
  color: var(--secondary);
  cursor: pointer;
  transition: background 140ms, color 140ms, border-color 140ms;
}
.tp-remove-btn:hover { background: #fef2f2; color: var(--error); border-color: #fca5a5; }

.tp-members-empty {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 2rem 1.25rem;
  color: var(--secondary);
  font-size: 0.9rem;
}
.tp-members-empty .material-symbols-outlined { font-size: 1.75rem; color: var(--outline-strong); flex-shrink: 0; }

/* Profile panel */
.tp-profile-panel {
  display: grid;
  gap: 1rem;
  border: 1px solid var(--outline);
  border-radius: 0.75rem;
  background: #fff;
  padding: 1.25rem;
}
.tp-profile-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}
.tp-profile-panel__header h3 {
  margin: 0;
  color: var(--on-surface);
  font-size: 1.05rem;
}
.tp-profile-panel__header p {
  margin: 0.25rem 0 0;
  color: var(--secondary);
  font-size: 0.88rem;
}
.tp-profile-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--outline);
  border-radius: 999px;
  background: #fff;
  color: var(--secondary);
  cursor: pointer;
  flex: 0 0 auto;
}
.tp-profile-close:hover { color: var(--on-surface); border-color: var(--outline-strong); }
.tp-profile-loading,
.tp-profile-error {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  color: var(--secondary);
  font-size: 0.92rem;
}
.tp-profile-error { color: var(--error); }
.tp-profile-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 1rem;
  align-items: center;
}
.tp-profile-card__avatar {
  display: grid;
  place-items: center;
  width: 4rem;
  height: 4rem;
  border-radius: 1rem;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 1rem;
  font-weight: 900;
  border: 1px solid rgba(47,111,237,.2);
}
.tp-profile-card__main {
  min-width: 0;
}
.tp-profile-card__main h4 {
  margin: 0;
  color: var(--on-surface);
  font-size: 1.15rem;
}
.tp-profile-card__main p {
  margin: 0.3rem 0 0;
  color: var(--secondary);
  overflow-wrap: anywhere;
}
.tp-profile-card__grid {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
}
.tp-profile-card__grid div {
  display: grid;
  gap: 0.35rem;
  padding: 0.85rem;
  border: 1px solid var(--outline);
  border-radius: 0.65rem;
  background: var(--surface-low);
}
.tp-profile-card__grid span {
  color: var(--secondary);
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: .06em;
  text-transform: uppercase;
}
.tp-profile-card__grid strong {
  color: var(--on-surface);
  font-size: 0.9rem;
  overflow-wrap: anywhere;
}

/* Full user profile view */
.tp-user-profile-hero,
.tp-profile-analytics,
.tp-profile-history {
  border: 1px solid var(--outline);
  border-radius: 1rem;
  background: #fff;
  box-shadow: 0 2px 16px rgba(23,32,51,.05);
}

.tp-user-profile-hero {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 1.25rem;
  padding: 1.5rem;
}

.tp-user-profile-hero__avatar {
  display: grid;
  place-items: center;
  width: 4.5rem;
  height: 4.5rem;
  border-radius: 1.1rem;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 1.25rem;
  font-weight: 900;
  border: 1px solid rgba(47,111,237,.2);
}

.tp-user-profile-hero__main {
  min-width: 0;
}

.tp-user-profile-hero__eyebrow {
  color: var(--primary);
  font-size: 0.72rem;
  font-weight: 900;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.tp-user-profile-hero h2 {
  margin: 0.35rem 0 0;
  color: var(--on-surface);
  font-size: clamp(1.45rem, 3vw, 2rem);
}

.tp-user-profile-hero p {
  margin: 0.35rem 0 0;
  color: var(--secondary);
  overflow-wrap: anywhere;
}

.tp-profile-details {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.75rem;
}

.tp-profile-details article {
  display: grid;
  gap: 0.4rem;
  border: 1px solid var(--outline);
  border-radius: 0.75rem;
  background: #fff;
  padding: 1rem;
}

.tp-profile-details span {
  color: var(--secondary);
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.tp-profile-details strong {
  color: var(--on-surface);
  font-size: 0.92rem;
  overflow-wrap: anywhere;
}

.tp-profile-analytics {
  padding: clamp(1.25rem, 3vw, 1.5rem);
}

.tp-profile-history {
  padding: clamp(1.25rem, 3vw, 1.5rem);
}

.tp-history-header {
  align-items: flex-start;
}

.tp-history-header .analytics-title-group {
  flex: 1;
  min-width: 0;
}

.tp-history-header__sub {
  margin: 0.25rem 0 0;
  color: var(--secondary);
  font-size: 0.84rem;
}

.tp-history-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2rem;
  height: 2rem;
  border-radius: 999px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 0.82rem;
  font-weight: 900;
  padding: 0 0.6rem;
}

.analytics-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--outline);
}

.analytics-title-group {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: var(--on-surface);
}

.analytics-title-group > .material-symbols-outlined {
  color: var(--primary);
}

.analytics-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
}

.refresh-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.15rem;
  height: 2.15rem;
  border: 1px solid var(--outline);
  border-radius: 0.55rem;
  background: #fff;
  color: var(--secondary);
  cursor: pointer;
}

.refresh-btn:hover:not(:disabled) {
  color: var(--primary);
  border-color: rgba(47,111,237,.45);
}

.profile-metrics-grid,
.skeleton-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.profile-metric-card {
  display: grid;
  gap: 0.35rem;
  border: 1px solid var(--outline);
  border-left: 3px solid var(--outline-strong);
  border-radius: 0.75rem;
  background: var(--surface-low);
  padding: 1.1rem;
}

.profile-metric-card.highlight-blue { border-left-color: var(--primary); }
.profile-metric-card.highlight-green { border-left-color: #10b981; }

.profile-metric-value {
  color: var(--on-surface);
  font-size: 1.8rem;
  font-weight: 800;
  line-height: 1;
}

.profile-metric-label {
  color: var(--secondary);
  font-size: 0.8rem;
  font-weight: 700;
}

.analytics-summary {
  border: 1px solid var(--outline);
  border-radius: 0.75rem;
  background: var(--surface-low);
  padding: 1.15rem;
  margin-bottom: 1.25rem;
}

.summary-title-row,
.box-header {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  margin-bottom: 0.65rem;
}

.summary-title-row {
  color: var(--primary);
}

.summary-title-row h3,
.box-header h4 {
  margin: 0;
  font-size: 0.95rem;
}

.analytics-summary p {
  margin: 0;
  color: var(--on-surface);
  line-height: 1.6;
}

.analysis-sections {
  display: grid;
  gap: 1rem;
}

.analysis-box {
  border: 1px solid var(--outline);
  border-radius: 0.85rem;
  padding: 1.15rem;
}

.analysis-box ul {
  display: grid;
  gap: 0.55rem;
  margin: 0;
  padding-left: 1.2rem;
  line-height: 1.55;
}

.analysis-box.strengths { background: #f0fdf4; border-color: #bbf7d0; color: #166534; }
.analysis-box.mistakes { background: #fef2f2; border-color: #fecaca; color: #991b1b; }
.analysis-box.loss-reasons { background: #fff7ed; border-color: #fed7aa; color: #9a3412; }
.analysis-box.recommendations { background: #f0f9ff; border-color: #bae6fd; color: #075985; }

.analytics-error,
.analytics-empty,
.analytics-skeleton {
  color: var(--secondary);
}

.analytics-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 2rem;
  color: var(--error);
  text-align: center;
}

.retry-btn {
  min-height: 2.25rem;
  border: 1px solid var(--outline);
  border-radius: 0.5rem;
  background: #fff;
  color: var(--on-surface);
  padding: 0 0.9rem;
  font: inherit;
  font-weight: 700;
}

.analytics-empty {
  padding: 2rem;
  text-align: center;
}

.analytics-skeleton {
  display: grid;
  gap: 1rem;
}

.skeleton-card {
  height: 4.5rem;
  border: 1px solid var(--outline);
  border-radius: 0.75rem;
  background: var(--surface-low);
  padding: 1rem;
}

.skeleton-line {
  height: 0.75rem;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--surface-low) 25%, var(--outline) 50%, var(--surface-low) 75%);
  background-size: 200% 100%;
  animation: tp-shimmer 1.4s ease-in-out infinite;
}

.skeleton-line--title { width: 40%; height: 1rem; }
.skeleton-line--text { width: 100%; height: 2.5rem; }

.tp-history-list,
.tp-history-skeleton {
  display: grid;
  gap: 0.75rem;
}

.tp-history-call {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 1rem;
  border: 1px solid #dbe4f0;
  border-radius: 0.75rem;
  background: #fff;
  padding: 1rem;
  box-shadow: 0 1px 2px rgba(23,32,51,.04);
  transition: border-color 140ms, transform 140ms, box-shadow 140ms, background 140ms;
}

.tp-history-call--clickable {
  cursor: pointer;
}

.tp-history-call:hover {
  border-color: rgba(47,111,237,.35);
  transform: translateY(-1px);
  box-shadow: 0 12px 26px rgba(23,32,51,.08);
  background: #fbfdff;
}

.tp-history-call__open {
  color: var(--secondary);
  font-size: 1.35rem;
}

.tp-history-call--loading {
  border-color: rgba(47,111,237,.45);
  background: var(--primary-soft);
  pointer-events: none;
}

.tp-history-call--loading .tp-history-call__icon .material-symbols-outlined {
  animation: tp-rotate 1s linear infinite;
}

.tp-history-call__icon {
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 0.75rem;
  background: var(--primary-soft);
  color: var(--primary);
  border: 1px solid rgba(47,111,237,.18);
  flex-shrink: 0;
}

.tp-history-call__icon .material-symbols-outlined {
  font-size: 1.25rem;
}

.tp-history-call__main {
  min-width: 0;
}

.tp-history-call__title-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
}

.tp-history-call__title-row h3 {
  margin: 0;
  color: var(--on-surface);
  font-size: 1rem;
  font-weight: 850;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tp-history-call__stage {
  flex-shrink: 0;
  border: 1px solid #bbf7d0;
  border-radius: 999px;
  background: #f0fdf4;
  color: #166534;
  padding: 0.2rem 0.55rem;
  font-size: 0.7rem;
  font-weight: 800;
  max-width: 11rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tp-history-call__main p {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
  margin: 0.25rem 0 0;
  color: var(--secondary);
  font-size: 0.82rem;
  overflow-wrap: anywhere;
}

.tp-history-call__main p .material-symbols-outlined {
  font-size: 0.95rem;
}

.tp-history-dot {
  width: 0.25rem;
  height: 0.25rem;
  border-radius: 999px;
  background: var(--outline-strong);
}

.tp-history-call__metrics {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.55rem;
}

.tp-history-call__metric {
  display: grid;
  gap: 0.15rem;
  min-width: 5rem;
  border: 1px solid #dbe4f0;
  border-radius: 0.65rem;
  background: #f8fafc;
  padding: 0.55rem 0.65rem;
}

.tp-history-call__metric span {
  color: var(--secondary);
  font-size: 0.66rem;
  font-weight: 800;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.tp-history-call__metric strong {
  color: var(--on-surface);
  font-size: 1rem;
  font-weight: 900;
  line-height: 1;
}

.tp-history-call__metric--good strong { color: #16a34a; }
.tp-history-call__metric--medium strong { color: #d97706; }
.tp-history-call__metric--bad strong { color: #dc2626; }
.tp-history-call__metric--muted strong { color: var(--secondary); }

.tp-history-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.65rem;
  min-height: 8rem;
  border: 1px dashed var(--outline-strong);
  border-radius: 0.85rem;
  color: var(--secondary);
  background: var(--surface-low);
  text-align: center;
  padding: 1.25rem;
}

.tp-history-inline-error {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  border: 1px solid #fecaca;
  border-radius: 0.75rem;
  background: #fff5f5;
  color: #991b1b;
  padding: 0.85rem 1rem;
  margin-bottom: 0.85rem;
}

.tp-history-inline-error p {
  margin: 0;
  line-height: 1.45;
}

.tp-history-inline-error .material-symbols-outlined {
  font-size: 1.15rem;
  color: #ef4444;
}

.tp-history-empty p {
  margin: 0;
}

.tp-history-empty .material-symbols-outlined {
  color: var(--outline-strong);
  font-size: 1.6rem;
}

.tp-history-skeleton__row {
  display: flex;
  align-items: center;
  gap: 1rem;
  border: 1px solid var(--outline);
  border-radius: 0.8rem;
  background: var(--surface-low);
  padding: 0.95rem;
}

.tp-history-skeleton__icon {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.65rem;
  background: linear-gradient(90deg, var(--surface-low) 25%, var(--outline) 50%, var(--surface-low) 75%);
  background-size: 200% 100%;
  animation: tp-shimmer 1.4s ease-in-out infinite;
  flex-shrink: 0;
}

.tp-history-skeleton__body {
  display: grid;
  gap: 0.55rem;
  flex: 1;
}

.tp-call-detail {
  display: grid;
  gap: 1rem;
  width: 100%;
}

.tp-call-detail__top {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 1rem;
  border: 1px solid #dbe4f0;
  border-radius: 1rem;
  background: #fff;
  padding: 1rem;
  box-shadow: 0 10px 30px rgba(23,32,51,.06);
}

.tp-call-detail__title {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.tp-call-detail__title > .material-symbols-outlined {
  display: grid;
  place-items: center;
  width: 3rem;
  height: 3rem;
  border-radius: 0.85rem;
  background: var(--primary-soft);
  color: var(--primary);
  flex-shrink: 0;
}

.tp-call-detail__title h2 {
  margin: 0;
  color: var(--on-surface);
  font-size: clamp(1.2rem, 2vw, 1.55rem);
  font-weight: 900;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tp-call-detail__title p {
  margin: 0.2rem 0 0;
  color: var(--secondary);
  font-size: 0.84rem;
}

.tp-call-detail__metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}

.tp-call-detail__metrics article {
  display: grid;
  gap: 0.35rem;
  border: 1px solid #dbe4f0;
  border-radius: 0.85rem;
  background: #fff;
  padding: 1rem;
  box-shadow: 0 1px 2px rgba(23,32,51,.04);
}

.tp-call-detail__metrics span {
  color: var(--secondary);
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.tp-call-detail__metrics strong {
  color: var(--on-surface);
  font-size: 1.35rem;
  font-weight: 900;
  overflow-wrap: anywhere;
}

.tp-call-detail__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 22rem;
  align-items: start;
  gap: 1rem;
}

.tp-call-transcript,
.tp-call-analysis {
  border: 1px solid #dbe4f0;
  border-radius: 1rem;
  background: #fff;
  padding: 1.1rem;
  box-shadow: 0 10px 30px rgba(23,32,51,.05);
}

.tp-call-analysis {
  display: grid;
  gap: 0.85rem;
}

.tp-call-analysis .analysis-box {
  margin: 0;
}

.tp-call-messages {
  display: grid;
  gap: 0.7rem;
}

.tp-call-message {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  max-width: 86%;
}

.tp-call-message span {
  display: grid;
  place-items: center;
  width: 1.9rem;
  height: 1.9rem;
  border-radius: 999px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 0.72rem;
  font-weight: 900;
  flex-shrink: 0;
}

.tp-call-message p {
  margin: 0;
  border: 1px solid #dbe4f0;
  border-radius: 0.85rem;
  background: #f8fafc;
  color: var(--on-surface);
  padding: 0.65rem 0.85rem;
  line-height: 1.55;
}

.tp-call-message--manager {
  justify-self: end;
  flex-direction: row-reverse;
}

.tp-call-message--manager p {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}

.tp-call-message--client span {
  background: #e9f8ef;
  color: #166534;
}

/* Members skeleton */
.tp-members-skeleton { display: flex; flex-direction: column; }
.tp-member-skeleton { display: flex; align-items: center; gap: 1rem; padding: 0.9rem 1.25rem; border-bottom: 1px solid var(--outline); }
.tp-skeleton-ava { width: 2.25rem; height: 2.25rem; border-radius: 0.5rem; background: var(--surface-low); animation: tp-shimmer 1.4s ease-in-out infinite; flex-shrink: 0; }
.tp-skeleton-body { flex: 1; display: flex; flex-direction: column; gap: 0.45rem; }
.tp-skeleton-line { height: 0.65rem; border-radius: 4px; background: linear-gradient(90deg, var(--surface-low) 25%, var(--outline) 50%, var(--surface-low) 75%); background-size: 200% 100%; animation: tp-shimmer 1.4s ease-in-out infinite; width: 55%; }
.tp-skeleton-line--name { width: 35%; height: 0.8rem; }

/* ─── Animations ────────────────────────────────────────────────────────── */
.tp-spin { animation: tp-rotate 1s linear infinite; display: inline-flex; }
@keyframes tp-rotate { to { transform: rotate(360deg); } }
@keyframes tp-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
.tp-fade-enter-active, .tp-fade-leave-active { transition: opacity 220ms; }
.tp-fade-enter-from, .tp-fade-leave-to { opacity: 0; }
.tp-modal-enter-active, .tp-modal-leave-active { transition: opacity 200ms; }
.tp-modal-enter-from, .tp-modal-leave-to { opacity: 0; }
.tp-modal-enter-active .tp-modal, .tp-modal-leave-active .tp-modal { transition: transform 200ms; }
.tp-modal-enter-from .tp-modal { transform: translateY(12px) scale(.98); }
.tp-modal-leave-to .tp-modal { transform: translateY(8px) scale(.98); }

/* ─── Responsive ────────────────────────────────────────────────────────── */
@media (max-width: 768px) {
  .tp-team-hero { grid-template-columns: auto 1fr; grid-template-rows: auto auto; }
  .tp-team-hero__actions { grid-column: 1 / -1; justify-content: flex-start; }
  .tp-team-hero__stats { justify-content: flex-start; gap: 1.5rem; }
  .tp-user-profile-hero { grid-template-columns: auto minmax(0, 1fr); }
  .tp-user-profile-hero .tp-badge { grid-column: 1 / -1; justify-self: start; }
  .tp-profile-details { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .tp-history-call { grid-template-columns: auto minmax(0, 1fr) auto; }
  .tp-history-call__metrics { grid-column: 1 / -1; justify-content: flex-start; }
  .tp-history-call__open { grid-column: 3; grid-row: 1; }
  .tp-call-detail__grid { grid-template-columns: 1fr; }
  .tp-call-detail__metrics { grid-template-columns: 1fr; }
  .profile-metrics-grid,
  .skeleton-metrics { grid-template-columns: 1fr; }
  .tp-card { grid-template-columns: auto minmax(0,1fr) auto; grid-template-rows: auto auto; }
  .tp-card__metrics { grid-column: 1 / -1; gap: 1rem; }
  .tp-card__action { grid-column: 3; grid-row: 1; }
  .tp-members-grid-head,
  .tp-member-row { grid-template-columns: minmax(0,1fr) minmax(0,1fr) auto; }
  .tp-members-grid-head span:nth-child(3),
  .tp-member-role { display: none; }
  .tp-profile-card__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 520px) {
  .tp-header { flex-direction: column; align-items: flex-start; }
  .tp-btn-primary { width: 100%; justify-content: center; }
  .tp-toolbar { flex-direction: column; }
  .tp-search { width: 100%; }
  .tp-filters { width: 100%; }
  .tp-filter-btn { flex: 1; }
  .tp-user-profile-hero { grid-template-columns: 1fr; }
  .tp-user-profile-hero__avatar { width: 100%; }
  .tp-history-call { grid-template-columns: 1fr; }
  .tp-history-call__icon { width: 100%; }
  .tp-history-call__open { display: none; }
  .tp-history-call__title-row { align-items: flex-start; flex-direction: column; }
  .tp-history-call__title-row h3 { white-space: normal; }
  .tp-history-call__stage { max-width: 100%; }
  .tp-history-call__metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); width: 100%; }
  .tp-call-detail__top { grid-template-columns: 1fr; align-items: stretch; }
  .tp-call-detail__title h2 { white-space: normal; }
  .tp-call-message { max-width: 100%; }
  .tp-team-hero__actions,
  .tp-criteria-panel,
  .tp-criteria-panel__head { grid-template-columns: 1fr; flex-direction: column; align-items: stretch; }
  .tp-criteria-btn,
  .tp-delete-team-btn,
  .tp-criteria-panel__head .tp-btn-ghost { width: 100%; justify-content: center; }
  .tp-profile-details { grid-template-columns: 1fr; }
  .analytics-header { align-items: flex-start; flex-direction: column; }
  .tp-card { grid-template-columns: auto minmax(0,1fr); grid-template-rows: auto auto auto; }
  .tp-card__action { grid-column: 1 / -1; justify-content: center; }
  .tp-card__metrics { flex-wrap: wrap; gap: 0.75rem; }
  .tp-modal__footer { flex-direction: column-reverse; }
  .tp-modal__footer .tp-btn-primary,
  .tp-modal__footer .tp-btn-ghost { width: 100%; justify-content: center; }
  .tp-members-grid-head,
  .tp-member-row { grid-template-columns: minmax(0,1fr); }
  .tp-members-grid-head span:nth-child(2),
  .tp-member-email { display: none; }
  .tp-members-grid-head span:nth-child(4) { display: none; }
  .tp-profile-btn { width: 100%; }
  .tp-profile-card { grid-template-columns: 1fr; }
  .tp-profile-card__avatar { width: 100%; }
  .tp-profile-card__grid { grid-template-columns: 1fr; }
  .tp-search-result-item { grid-template-columns: auto 1fr; }
  .tp-add-btn { grid-column: 1 / -1; justify-content: center; }
}
</style>
