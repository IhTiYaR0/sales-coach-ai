<script>
import { ref } from 'vue'

const CALLS_STORAGE_KEY = 'callanalytics-recent-calls'
const PENDING_CALL_ID_KEY = 'callanalytics-pending-call-id'
const AUDIO_DB_NAME = 'callanalytics-audio-cache'
const AUDIO_STORE_NAME = 'pending-audio'
const PENDING_AUDIO_KEY = 'latest'

const callsState = {
  selectedFile: ref(null),
  isDragging: ref(false),
  isUploading: ref(false),
  statusMessage: ref(''),
  statusType: ref(''),
  recentCalls: ref([]),
  selectedCallId: ref(null),
  isRestored: false,
}

let activeUploadPromise = null

function openAudioDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(AUDIO_DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(AUDIO_STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withAudioStore(mode, action) {
  const db = await openAudioDb()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(AUDIO_STORE_NAME, mode)
    const store = transaction.objectStore(AUDIO_STORE_NAME)
    const request = action(store)

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => db.close()
    transaction.onerror = () => {
      db.close()
      reject(transaction.error)
    }
  })
}

function savePendingAudio(file) {
  return withAudioStore('readwrite', (store) => store.put(file, PENDING_AUDIO_KEY))
}

function readPendingAudio() {
  return withAudioStore('readonly', (store) => store.get(PENDING_AUDIO_KEY))
}

function clearPendingAudio() {
  return withAudioStore('readwrite', (store) => store.delete(PENDING_AUDIO_KEY))
}
</script>

<script setup>
import { computed, onBeforeUnmount, onMounted } from 'vue'

const selectedFile = callsState.selectedFile
const isDragging = callsState.isDragging
const isUploading = callsState.isUploading
const statusMessage = callsState.statusMessage
const statusType = callsState.statusType
const recentCalls = callsState.recentCalls
const selectedCallId = callsState.selectedCallId

const fileName = computed(() => selectedFile.value?.name || 'MP3 файл не выбран')
const canUpload = computed(() => Boolean(selectedFile.value) && !isUploading.value)
const hasSelectedFile = computed(() => Boolean(selectedFile.value))
const selectedCall = computed(() => recentCalls.value.find((call) => call.id === selectedCallId.value))
const selectedAnalysis = computed(() => selectedCall.value?.result?.analysis || {})
const transcript = computed(() => selectedCall.value?.result?.transcript || '')
const selectedAudioId = computed(() => getCallAudioId(selectedCall.value))

const parsedMessages = computed(() => {
  return transcript.value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      if (line.startsWith('Менеджер:'))
        return { role: 'manager', text: line.replace('Менеджер:', '').trim() }
      if (line.startsWith('Клиент:'))
        return { role: 'client', text: line.replace('Клиент:', '').trim() }
      return null
    })
    .filter(Boolean)
})

const keyMoments = computed(() => {
  const moments = selectedAnalysis.value.key_moments || []
  const result = {}
  parsedMessages.value.forEach((msg, idx) => {
    moments.forEach(m => {
      const snippet = (m.text || '').slice(0, 30)
      if (snippet && msg.text.includes(snippet)) {
        result[idx] = m
      }
    })
  })
  return result
})

function revokeCallAudio(call) {
  if (call?.audioObjectUrl) {
    if (call.audioObjectUrl.startsWith('blob:')) {
      URL.revokeObjectURL(call.audioObjectUrl)
    }
    call.audioObjectUrl = ''
  }
}

function getCallAudioId(call) {
  return call?.backendCallId || call?.call_id || call?.callId || call?.result?.call_id || call?.result?.id || call?.id
}

const scoreColor = computed(() => {
  const s = Number(selectedCall.value?.score)
  if (s >= 80) return 'good'
  if (s >= 55) return 'medium'
  return 'bad'
})

function serializeCall(call) {
  return {
    ...call,
    createdAt: call.createdAt instanceof Date ? call.createdAt.toISOString() : call.createdAt,
  }
}

function normalizeStoredCall(call) {
  return {
    ...call,
    createdAt: call.createdAt ? new Date(call.createdAt) : new Date(),
    audioObjectUrl: '',
    audioLoading: false,
    audioError: '',
  }
}

function saveRecentCalls() {
  window.localStorage.setItem(
    CALLS_STORAGE_KEY,
    JSON.stringify(recentCalls.value.map(serializeCall)),
  )
}

function restoreRecentCalls() {
  if (callsState.isRestored) return

  try {
    const storedCalls = JSON.parse(window.localStorage.getItem(CALLS_STORAGE_KEY) || '[]')
    recentCalls.value = Array.isArray(storedCalls) ? storedCalls.map(normalizeStoredCall) : []
  } catch {
    recentCalls.value = []
  }

  callsState.isRestored = true
}

function getPendingCall() {
  const pendingId = window.localStorage.getItem(PENDING_CALL_ID_KEY)
  return recentCalls.value.find((call) => call.id === pendingId && call.isAnalyzing)
}

function setStatus(message, type) {
  statusMessage.value = message
  statusType.value = type
}

function selectFile(file) {
  if (!file) return
  const isMp3 = file.type === 'audio/mpeg' || file.name.toLowerCase().endsWith('.mp3')
  if (!isMp3) {
    selectedFile.value = null
    setStatus('Можно отправить только MP3 файл.', 'error')
    return
  }
  selectedFile.value = file
  setStatus('Файл выбран. После отправки анализ начнется автоматически.', 'success')
}

function handleFileChange(event) {
  selectFile(event.target.files?.[0])
}

function handleDrop(event) {
  isDragging.value = false
  selectFile(event.dataTransfer.files?.[0])
}

async function readErrorMessage(response) {
  try {
    const errorData = await response.json()
    return JSON.stringify(errorData.detail || errorData)
  } catch {
    try {
      const errorText = await response.text()
      return errorText || response.statusText || 'Ошибка анализа'
    } catch {
      return response.statusText || 'Ошибка анализа'
    }
  }
}

import { apiFetch } from '../api'

async function sendAnalyzeRequest(file) {
  const formData = new FormData()
  formData.append('audio_file', file, file.name)
  return apiFetch('/calls/analyze', {
    method: 'POST',
    body: formData,
  })
}

async function requestAnalysis(file) {
  const response = await sendAnalyzeRequest(file)
  if (!response.ok) {
    const errorMessage = await readErrorMessage(response)
    throw new Error(errorMessage)
  }
  return response.json()
}

function createCall(file) {
  return {
    id: crypto.randomUUID(),
    backendCallId: null,
    fileName: file.name,
    manager: 'Артем Волков',
    initials: 'АВ',
    client: 'Клиент из звонка',
    duration: '-',
    score: '-',
    dealProbability: '-',
    funnelStage: 'Анализируется',
    createdAt: new Date(),
    isAnalyzing: true,
    error: '',
    result: null,
  }
}

function applyAnalysisResult(call, result) {
  const analysis = result.analysis || {}
  call.result = result
  call.backendCallId = result.call_id ?? result.id ?? call.backendCallId ?? null
  call.score = analysis.score ?? '-'
  call.dealProbability = analysis.deal_probability ?? '-'
  call.funnelStage = analysis.sales_funnel_stage ?? 'Не определен'
  call.duration = analysis.duration || result.duration || '-'
  call.isAnalyzing = false
  call.error = ''
}

function applyAnalysisError(call, message) {
  call.error = message
  call.isAnalyzing = false
  call.funnelStage = 'Ошибка'
}

async function runAnalysisForCall(call, file) {
  isUploading.value = true
  window.localStorage.setItem(PENDING_CALL_ID_KEY, call.id)
  saveRecentCalls()

  try {
    const result = await requestAnalysis(file)
    applyAnalysisResult(call, result)
    setStatus(`Анализ для "${call.fileName}" готов. Нажми на карточку, чтобы открыть детали.`, 'success')
    await clearPendingAudio()
    window.localStorage.removeItem(PENDING_CALL_ID_KEY)
  } catch (error) {
    applyAnalysisError(call, error.message)
    setStatus(`Не удалось сделать анализ: ${error.message}`, 'error')
    window.localStorage.removeItem(PENDING_CALL_ID_KEY)
  } finally {
    isUploading.value = false
    activeUploadPromise = null
    saveRecentCalls()
  }
}

async function uploadFile() {
  if (!selectedFile.value) return
  if (activeUploadPromise) {
    setStatus('Один звонок уже анализируется. Дождись завершения текущего анализа.', 'info')
    return
  }

  const file = selectedFile.value
  const call = createCall(file)
  isUploading.value = true
  recentCalls.value.unshift(call)
  selectedFile.value = null
  setStatus(`Файл "${file.name}" отправлен. AI уже делает анализ.`, 'info')

  try {
    await savePendingAudio(file)
    activeUploadPromise = runAnalysisForCall(call, file)
    await activeUploadPromise
  } catch (error) {
    applyAnalysisError(call, error.message)
    isUploading.value = false
    activeUploadPromise = null
    window.localStorage.removeItem(PENDING_CALL_ID_KEY)
    saveRecentCalls()
    setStatus(`Не удалось сохранить или отправить файл: ${error.message}`, 'error')
  }
}

async function resumePendingAnalysis() {
  if (activeUploadPromise) return

  restoreRecentCalls()
  const pendingCall = getPendingCall()
  if (!pendingCall) return

  try {
    const file = await readPendingAudio()
    if (!file) {
      applyAnalysisError(pendingCall, 'Файл не найден после обновления страницы. Загрузите MP3 еще раз.')
      window.localStorage.removeItem(PENDING_CALL_ID_KEY)
      saveRecentCalls()
      return
    }

    pendingCall.error = ''
    pendingCall.isAnalyzing = true
    setStatus(`Продолжаем анализ "${pendingCall.fileName}" после обновления страницы.`, 'info')
    activeUploadPromise = runAnalysisForCall(pendingCall, file)
  } catch (error) {
    applyAnalysisError(pendingCall, error.message)
    window.localStorage.removeItem(PENDING_CALL_ID_KEY)
    saveRecentCalls()
    setStatus(`Не удалось продолжить анализ: ${error.message}`, 'error')
  }
}

async function retryCall(call) {
  if (activeUploadPromise || call.isAnalyzing) return

  try {
    const file = await readPendingAudio()
    if (!file) {
      applyAnalysisError(call, 'Файл не найден. Загрузите MP3 еще раз.')
      saveRecentCalls()
      return
    }

    call.error = ''
    call.result = null
    call.score = '-'
    call.dealProbability = '-'
    call.funnelStage = 'Анализируется'
    call.isAnalyzing = true
    setStatus(`Повторяем анализ "${call.fileName}".`, 'info')
    activeUploadPromise = runAnalysisForCall(call, file)
  } catch (error) {
    applyAnalysisError(call, error.message)
    saveRecentCalls()
  }
}

async function deleteCall(call) {
  if (!call) return

  revokeCallAudio(call)
  recentCalls.value = recentCalls.value.filter((item) => item.id !== call.id)
  if (selectedCallId.value === call.id) selectedCallId.value = null

  const pendingId = window.localStorage.getItem(PENDING_CALL_ID_KEY)
  if (pendingId === call.id) {
    window.localStorage.removeItem(PENDING_CALL_ID_KEY)
    await clearPendingAudio()
  }

  saveRecentCalls()
  setStatus(`Запись "${call.fileName}" удалена из списка.`, 'success')
}

async function loadCallAudio(call) {
  const callAudioId = getCallAudioId(call)
  if (!call || !callAudioId || call.audioObjectUrl || call.audioLoading) return

  call.audioLoading = true
  call.audioError = ''

  try {
    const response = await apiFetch(`/calls/${encodeURIComponent(callAudioId)}/audio`, {
      method: 'GET',
    })

    if (!response.ok) {
      throw new Error(`Не удалось загрузить запись: HTTP ${response.status}`)
    }

    revokeCallAudio(call)

    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      const data = await response.json()
      if (!data?.url) {
        throw new Error('Сервер не вернул ссылку на аудио')
      }
      call.audioObjectUrl = data.url
      return
    }

    const blob = await response.blob()
    call.audioObjectUrl = URL.createObjectURL(blob)
  } catch (error) {
    call.audioError = error.message || 'Не удалось загрузить голосовую запись'
  } finally {
    call.audioLoading = false
  }
}

function openCall(call) {
  if (call.result) {
    selectedCallId.value = call.id
    loadCallAudio(call)
    return
  }

  if (call.isHistory && !call.isHistoryLoading) {
    call.isHistoryLoading = true
    fetchHistoryCallDetails(call)
      .then(() => {
        if (call.result) {
          selectedCallId.value = call.id
          loadCallAudio(call)
        }
      })
      .finally(() => {
        call.isHistoryLoading = false
      })
  }
}

function closeCallDetails() {
  selectedCallId.value = null
}

function getList(value) {
  return Array.isArray(value) ? value : []
}

function formatDate(date) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date instanceof Date ? date : new Date(date))
}

function buildHistoryCall(call) {
  const callId = String(call.id ?? call.call_id ?? call.callId ?? '')
  const audioPath = call.audio_path ?? call.file_path ?? call.filename ?? call.fileName ?? call.name ?? ''

  return {
    id: callId,
    backendCallId: callId,
    fileName: audioPath ? audioPath.split(/[\\/]/).pop() : `Звонок #${callId}`,
    manager: 'История звонков',
    initials: 'ИС',
    client: 'Клиент',
    duration: '-',
    score: call.score ?? '-',
    dealProbability: '-',
    funnelStage: 'Проанализирован',
    createdAt: call.created_at ? new Date(call.created_at) : new Date(call.createdAt || Date.now()),
    isAnalyzing: false,
    isHistory: true,
    isHistoryLoading: true,
    error: '',
    result: null,
  }
}

async function fetchHistoryCallDetails(call) {
  try {
    const response = await apiFetch(`/calls/history/${call.id}`, {
      method: 'GET',
    })

    if (!response.ok) {
      call.isHistoryLoading = false
      return
    }

    const detail = await response.json()
    if (!detail) {
      call.isHistoryLoading = false
      return
    }

    call.result = detail
    call.score = detail.analysis?.score ?? call.score ?? '-'
    call.dealProbability = detail.analysis?.deal_probability ?? call.dealProbability ?? '-'
    call.funnelStage = detail.analysis?.sales_funnel_stage ?? call.funnelStage ?? 'Проанализирован'
    call.duration = detail.analysis?.duration || detail.duration || call.duration || '-'
    call.error = ''
  } catch (error) {
    console.warn(`Не удалось загрузить детали звонка ${call.id}:`, error)
  } finally {
    call.isHistoryLoading = false
  }
}

async function loadHistoryCalls() {
  try {
    const response = await apiFetch('/calls/history', {
      method: 'GET',
    })

    if (!response.ok) {
      return
    }

    const historyData = await response.json()
    if (!Array.isArray(historyData)) {
      return
    }

    const localCalls = recentCalls.value || []
    const localIds = new Set(localCalls.map((call) => String(call.id)))
    const historyCalls = []
    const mergedCalls = [...localCalls]

    for (const item of historyData) {
      const id = String(item.id ?? item.call_id ?? item.callId ?? '')
      if (!id) continue
      const existing = localCalls.find((call) => String(call.id) === id && call.isHistory)
      const historyCall = existing || buildHistoryCall(item)

      if (!existing) {
        mergedCalls.push(historyCall)
      }

      historyCalls.push(historyCall)
    }

    recentCalls.value = mergedCalls.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

    await Promise.all(historyCalls.map((call) => fetchHistoryCallDetails(call)))
    saveRecentCalls()
  } catch (error) {
    console.warn('Не удалось загрузить историю звонков:', error)
  }
}

onMounted(async () => {
  restoreRecentCalls()
  await loadHistoryCalls()
  resumePendingAnalysis()
})

onBeforeUnmount(() => {
  recentCalls.value.forEach(revokeCallAudio)
})
</script>

<template>
  <!-- ─── Детальная страница звонка ─── -->
  <section v-if="selectedCall" class="cd-root">

    <header class="cd-header">
      <button class="cd-back" type="button" @click="closeCallDetails">
        <span class="material-symbols-outlined">arrow_back</span>
        Назад
      </button>
      <div class="cd-header__info">
        <span class="material-symbols-outlined cd-header__icon">audio_file</span>
        <div>
          <p class="cd-header__filename">{{ selectedCall.fileName }}</p>
          <p class="cd-header__sub">{{ selectedCall.manager }} · {{ formatDate(selectedCall.createdAt) }}</p>
        </div>
      </div>
      <div class="cd-header__scores">
        <div class="cd-score-pill" :class="`cd-score-pill--${scoreColor}`">
          <span class="material-symbols-outlined">stars</span>
          Оценка: <strong>{{ selectedCall.score }}/100</strong>
        </div>
        <div class="cd-score-pill cd-score-pill--neutral">
          <span class="material-symbols-outlined">show_chart</span>
          Сделка: <strong>{{ selectedCall.dealProbability }}{{ selectedCall.dealProbability === '-' ? '' : '%' }}</strong>
        </div>
        <div class="cd-score-pill cd-score-pill--neutral">
          <span class="material-symbols-outlined">filter_alt</span>
          {{ selectedCall.funnelStage }}
        </div>
      </div>
    </header>

    <section class="cd-audio">
      <div class="cd-audio__main">
        <span class="material-symbols-outlined cd-audio__icon">graphic_eq</span>
        <div class="cd-audio__text">
          <p>Голосовая запись</p>
          <span v-if="selectedAudioId">Call ID: {{ selectedAudioId }}</span>
          <span v-else>Не удалось определить ID звонка из истории.</span>
        </div>
      </div>

      <div class="cd-audio__player">
        <div v-if="selectedCall.audioLoading" class="cd-audio__state">
          <span class="material-symbols-outlined hp-spin">sync</span>
          Загружаем запись...
        </div>

        <audio
          v-else-if="selectedCall.audioObjectUrl"
          class="cd-audio__control"
          :src="selectedCall.audioObjectUrl"
          controls
          preload="metadata"
        ></audio>

        <button
          v-else
          class="cd-audio__button"
          type="button"
          :disabled="!selectedAudioId"
          @click="loadCallAudio(selectedCall)"
        >
          <span class="material-symbols-outlined">play_circle</span>
          Показать запись
        </button>
      </div>

      <p v-if="selectedCall.audioError" class="cd-audio__error">
        <span class="material-symbols-outlined">error</span>
        {{ selectedCall.audioError }}
        <button type="button" @click="loadCallAudio(selectedCall)">Повторить</button>
      </p>
    </section>

    <div class="cd-body">

      <!-- Чат -->
      <section class="cd-chat">
        <div class="cd-chat__label">
          <span class="material-symbols-outlined">record_voice_over</span>
          Транскрипт звонка
        </div>
        <div class="cd-messages">
          <template v-for="(msg, idx) in parsedMessages" :key="idx">

            <div v-if="keyMoments[idx]" class="cd-moment">
              <span class="material-symbols-outlined">warning_amber</span>
              <div>
                <p class="cd-moment__quote">«{{ keyMoments[idx].text }}»</p>
                <p class="cd-moment__note">{{ keyMoments[idx].problem }}</p>
              </div>
            </div>

            <div class="cd-msg cd-msg--manager" v-if="msg.role === 'manager'">
              <div class="cd-bubble cd-bubble--manager">{{ msg.text }}</div>
              <div class="cd-msg__avatar cd-msg__avatar--manager">АВ</div>
            </div>

            <div class="cd-msg cd-msg--client" v-else>
              <div class="cd-msg__avatar cd-msg__avatar--client">К</div>
              <div class="cd-bubble cd-bubble--client">{{ msg.text }}</div>
            </div>

          </template>
        </div>
      </section>

      <!-- Аналитика -->
      <aside class="cd-analytics">

        <div class="cd-card">
          <div class="cd-card__head">
            <span class="material-symbols-outlined">summarize</span>Резюме
          </div>
          <p class="cd-card__text">{{ selectedAnalysis.call_summary || 'Нет данных.' }}</p>
        </div>

        <div class="cd-card">
          <div class="cd-card__head">
            <span class="material-symbols-outlined">trending_up</span>Вероятность сделки
          </div>
          <div class="cd-prob">
            <div class="cd-prob__track">
              <div
                class="cd-prob__fill"
                :style="{ width: selectedCall.dealProbability === '-' ? '0%' : selectedCall.dealProbability + '%' }"
                :class="{
                  'cd-prob__fill--good':   Number(selectedCall.dealProbability) >= 70,
                  'cd-prob__fill--medium': Number(selectedCall.dealProbability) >= 40 && Number(selectedCall.dealProbability) < 70,
                  'cd-prob__fill--bad':    Number(selectedCall.dealProbability) < 40,
                }"
              ></div>
            </div>
            <span class="cd-prob__label">{{ selectedCall.dealProbability }}{{ selectedCall.dealProbability === '-' ? '' : '%' }}</span>
          </div>
        </div>

        <div class="cd-card" v-if="getList(selectedAnalysis.strengths).length">
          <div class="cd-card__head cd-card__head--good">
            <span class="material-symbols-outlined">thumb_up</span>Сильные стороны
          </div>
          <ul class="cd-tag-list">
            <li v-for="item in getList(selectedAnalysis.strengths)" :key="item" class="cd-tag cd-tag--good">
              <span class="material-symbols-outlined">check_circle</span>{{ item }}
            </li>
          </ul>
        </div>

        <div class="cd-card" v-if="getList(selectedAnalysis.mistakes).length">
          <div class="cd-card__head cd-card__head--bad">
            <span class="material-symbols-outlined">error</span>Ошибки менеджера
          </div>
          <ul class="cd-tag-list">
            <li v-for="item in getList(selectedAnalysis.mistakes)" :key="item" class="cd-tag cd-tag--bad">
              <span class="material-symbols-outlined">cancel</span>{{ item }}
            </li>
          </ul>
        </div>

        <div class="cd-card" v-if="getList(selectedAnalysis.objections).length">
          <div class="cd-card__head cd-card__head--warn">
            <span class="material-symbols-outlined">help</span>Возражения клиента
          </div>
          <ul class="cd-tag-list">
            <li v-for="item in getList(selectedAnalysis.objections)" :key="item" class="cd-tag cd-tag--warn">
              <span class="material-symbols-outlined">info</span>{{ item }}
            </li>
          </ul>
        </div>

        <div class="cd-card" v-if="getList(selectedAnalysis.recommendations).length">
          <div class="cd-card__head cd-card__head--blue">
            <span class="material-symbols-outlined">lightbulb</span>Что улучшить
          </div>
          <ul class="cd-tag-list">
            <li v-for="item in getList(selectedAnalysis.recommendations)" :key="item" class="cd-tag cd-tag--blue">
              <span class="material-symbols-outlined">arrow_forward</span>{{ item }}
            </li>
          </ul>
        </div>

      </aside>
    </div>
  </section>

  <!-- ─── Главная страница ─── -->
  <section v-else class="home-page">

    <div class="page-heading">
      <h2>Загрузка звонка</h2>
      <p>Добавь MP3 запись — AI сам сделает анализ сразу после отправки.</p>
    </div>

    <form class="upload-panel" @submit.prevent="uploadFile">

      <label
        class="upload-zone"
        :class="{
          'upload-zone--active': isDragging,
          'upload-zone--selected': hasSelectedFile,
        }"
        @dragenter.prevent="isDragging = true"
        @dragover.prevent="isDragging = true"
        @dragleave.prevent="isDragging = false"
        @drop.prevent="handleDrop"
      >
        <input accept=".mp3,audio/mpeg" type="file" @change="handleFileChange" />
        <span class="upload-zone__icon">
          <span class="material-symbols-outlined">{{ hasSelectedFile ? 'audio_file' : 'upload_file' }}</span>
        </span>
        <span class="upload-zone__title">
          {{ hasSelectedFile ? 'Файл выбран' : 'Перетащи MP3 файл сюда' }}
        </span>
        <span class="upload-zone__text">
          {{ hasSelectedFile ? fileName : 'или выбери запись звонка на компьютере' }}
        </span>
        <span class="upload-zone__button">
          {{ hasSelectedFile ? 'Выбрать другой' : 'Выбрать MP3' }}
        </span>
      </label>

      <div class="upload-details">
        <div class="selected-file">
          <span class="material-symbols-outlined">audio_file</span>
          <div>
            <p>{{ fileName }}</p>
            <span>Формат: MP3</span>
          </div>
        </div>
        <button class="primary-button" type="submit" :disabled="!canUpload">
          <span class="material-symbols-outlined" :class="{ 'hp-spin': isUploading }">
            {{ isUploading ? 'sync' : 'smart_toy' }}
          </span>
          <span>{{ isUploading ? 'Анализируем...' : 'Отправить на анализ' }}</span>
        </button>
      </div>

      <transition name="hp-fade">
        <p v-if="statusMessage" class="upload-status" :class="`upload-status--${statusType}`">
          <span class="material-symbols-outlined hp-status-icon">
            {{ statusType === 'success' ? 'check_circle' : statusType === 'error' ? 'error' : 'info' }}
          </span>
          {{ statusMessage }}
        </p>
      </transition>

    </form>

    <section class="recent-calls">
      <div class="section-title-row">
        <div class="best-calls__title">
          <span></span>
          <h3>Проанализированные звонки</h3>
        </div>
        <span v-if="recentCalls.length" class="hp-count-badge">{{ recentCalls.length }}</span>
      </div>

      <div v-if="recentCalls.length" class="recent-call-list">
        <article
          v-for="call in recentCalls"
          :key="call.id"
          class="recent-call-card"
          :class="{
            'recent-call-card--loading': call.isAnalyzing,
            'recent-call-card--clickable': call.result,
            'recent-call-card--error': call.error,
          }"
          role="button"
          tabindex="0"
          @click="openCall(call)"
          @keydown.enter.prevent="openCall(call)"
          @keydown.space.prevent="openCall(call)"
        >
          <div class="recent-call-card__main">
            <div class="best-call__person">
              <div class="best-call__avatar">
                {{ call.initials }}
                <span class="material-symbols-outlined">
                  {{ call.error ? 'close' : call.isAnalyzing ? 'sync' : 'check' }}
                </span>
              </div>
              <div>
                <h4>{{ call.fileName }}</h4>
                <p>
                  {{
                    call.isAnalyzing
                      ? 'AI анализирует звонок…'
                      : call.error
                        ? 'Ошибка анализа'
                        : call.result
                          ? 'Анализ готов — нажми чтобы открыть'
                          : call.isHistoryLoading
                            ? 'Загрузка истории…'
                            : 'Нет данных'
                  }}
                </p>
                <small>{{ call.manager }} · {{ formatDate(call.createdAt) }}</small>
              </div>
            </div>

            <div class="best-call__meta">
              <div>
                <span>Оценка AI</span>
                <strong>{{ call.score }}</strong>
              </div>
              <div>
                <span>Сделка</span>
                <strong>{{ call.dealProbability }}{{ call.dealProbability === '-' ? '' : '%' }}</strong>
              </div>
              <div>
                <span>Этап</span>
                <strong>{{ call.funnelStage }}</strong>
              </div>
            </div>

            <div class="hp-card-actions">
              <button
                v-if="call.error"
                class="hp-card-action"
                type="button"
                title="Повторить анализ"
                :disabled="isUploading"
                @click.stop="retryCall(call)"
              >
                <span class="material-symbols-outlined">refresh</span>
              </button>
              <button
                class="hp-card-action hp-card-action--danger"
                type="button"
                title="Удалить запись"
                @click.stop="deleteCall(call)"
              >
                <span class="material-symbols-outlined">delete</span>
              </button>
              <span class="open-call-icon material-symbols-outlined">
                {{ call.isAnalyzing ? 'hourglass_top' : call.result ? 'chevron_right' : 'error' }}
              </span>
            </div>
          </div>

          <p v-if="call.error" class="upload-status upload-status--error">
            {{ call.error }}
          </p>
        </article>
      </div>

      <div v-else class="empty-calls">
        <span class="material-symbols-outlined">phone_in_talk</span>
        <p>Пока звонков нет. Добавь MP3 файл выше — после анализа карточка появится здесь.</p>
      </div>
    </section>

  </section>
</template>

<style scoped>
/* ── Спиннер ── */
.hp-spin { animation: hp-rotate 1s linear infinite; display: inline-flex; }
@keyframes hp-rotate { to { transform: rotate(360deg); } }

.upload-status { display: flex; align-items: flex-start; gap: 0.55rem; }
.hp-status-icon { flex-shrink: 0; font-size: 1.15rem; width: 1.15rem; height: 1.15rem; margin-top: 0.05rem; }

.hp-count-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 1.6rem; height: 1.6rem; border-radius: 999px; background: var(--primary-soft); color: var(--primary); font-size: 0.78rem; font-weight: 800; padding: 0 0.45rem; }

.hp-card-actions { display: inline-flex; align-items: center; justify-content: flex-end; gap: 0.45rem; }
.hp-card-action { display: inline-flex; align-items: center; justify-content: center; width: 2.5rem; height: 2.5rem; border: 1px solid var(--outline); border-radius: 999px; background: #fff; color: var(--secondary); cursor: pointer; transition: border-color 140ms, color 140ms, background 140ms, transform 140ms; }
.hp-card-action:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); transform: translateY(-1px); }
.hp-card-action:disabled { cursor: not-allowed; opacity: .55; }
.hp-card-action--danger { color: #b91c1c; border-color: #fecaca; background: #fff5f5; }
.hp-card-action--danger:hover:not(:disabled) { color: #991b1b; border-color: #f87171; background: #fee2e2; }
.hp-card-action .material-symbols-outlined { font-size: 1.1rem; }

.hp-fade-enter-active, .hp-fade-leave-active { transition: opacity 220ms, transform 220ms; }
.hp-fade-enter-from, .hp-fade-leave-to { opacity: 0; transform: translateY(-4px); }

/* ── Детальная страница ── */
.cd-root { display: flex; flex-direction: column; width: 100%; max-width: 82rem; margin: 0 auto; min-height: calc(100vh - 4rem); }

.cd-header { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; padding: 1rem 1.5rem; border-bottom: 1px solid var(--outline); background: rgba(255,255,255,.9); backdrop-filter: blur(12px); position: sticky; top: 4rem; z-index: 30; }
.cd-back { display: inline-flex; align-items: center; gap: .4rem; height: 2.5rem; border: 1px solid var(--outline); border-radius: 999px; background: #fff; color: var(--on-surface); padding: 0 1rem; font-size: .9rem; font-weight: 700; cursor: pointer; flex-shrink: 0; transition: border-color 150ms, color 150ms; }
.cd-back:hover { border-color: var(--primary); color: var(--primary); }
.cd-back .material-symbols-outlined { font-size: 1.2rem; }
.cd-header__info { display: flex; align-items: center; gap: .65rem; flex: 1; min-width: 0; }
.cd-header__icon { color: var(--primary); font-size: 1.5rem; flex-shrink: 0; }
.cd-header__filename { margin: 0; font-size: .95rem; font-weight: 800; color: var(--on-surface); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cd-header__sub { margin: .15rem 0 0; font-size: .78rem; color: var(--secondary); }
.cd-header__scores { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; flex-shrink: 0; }
.cd-score-pill { display: inline-flex; align-items: center; gap: .35rem; height: 2.25rem; border-radius: 999px; padding: 0 .85rem; font-size: .82rem; font-weight: 700; border: 1px solid transparent; }
.cd-score-pill .material-symbols-outlined { font-size: 1rem; }
.cd-score-pill strong { font-weight: 900; }
.cd-score-pill--good   { background: #e9f8ef; border-color: #bbf7d0; color: #166534; }
.cd-score-pill--medium { background: #fef9c3; border-color: #fde68a; color: #854d0e; }
.cd-score-pill--bad    { background: #fee2e2; border-color: #fecaca; color: #991b1b; }
.cd-score-pill--neutral { background: var(--primary-soft); border-color: rgba(47,111,237,.18); color: #1e4db7; }

.cd-audio { display: grid; grid-template-columns: minmax(0, 1fr) minmax(18rem, 28rem); align-items: center; gap: 1rem; padding: .85rem 1.5rem; border-bottom: 1px solid var(--outline); background: linear-gradient(135deg, rgba(47,111,237,.08), rgba(34,197,94,.08)); }
.cd-audio__main { display: flex; align-items: center; gap: .75rem; min-width: 0; }
.cd-audio__icon { display: inline-flex; align-items: center; justify-content: center; width: 2.5rem; height: 2.5rem; border-radius: .75rem; background: #fff; color: var(--primary); border: 1px solid rgba(47,111,237,.18); box-shadow: 0 4px 14px rgba(23,32,51,.06); flex-shrink: 0; }
.cd-audio__text { min-width: 0; }
.cd-audio__text p { margin: 0; color: var(--on-surface); font-size: .92rem; font-weight: 900; }
.cd-audio__text span { display: block; margin-top: .15rem; color: var(--secondary); font-size: .78rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cd-audio__player { display: flex; align-items: center; justify-content: flex-end; min-width: 0; }
.cd-audio__control { width: 100%; height: 2.5rem; }
.cd-audio__state { display: inline-flex; align-items: center; gap: .45rem; height: 2.5rem; padding: 0 .9rem; border-radius: 999px; background: #fff; border: 1px solid var(--outline); color: var(--secondary); font-size: .85rem; font-weight: 700; }
.cd-audio__state .material-symbols-outlined { font-size: 1.1rem; color: var(--primary); }
.cd-audio__button { display: inline-flex; align-items: center; justify-content: center; gap: .45rem; height: 2.5rem; border: 1px solid rgba(47,111,237,.28); border-radius: 999px; background: #fff; color: var(--primary); padding: 0 1rem; font-size: .86rem; font-weight: 800; cursor: pointer; transition: transform 140ms, border-color 140ms, box-shadow 140ms; }
.cd-audio__button:hover:not(:disabled) { transform: translateY(-1px); border-color: var(--primary); box-shadow: 0 8px 20px rgba(47,111,237,.14); }
.cd-audio__button:disabled { cursor: not-allowed; opacity: .55; }
.cd-audio__button .material-symbols-outlined { font-size: 1.15rem; }
.cd-audio__error { grid-column: 1 / -1; display: flex; align-items: center; gap: .45rem; margin: -.25rem 0 0 3.25rem; color: #991b1b; font-size: .82rem; line-height: 1.4; }
.cd-audio__error .material-symbols-outlined { font-size: 1rem; color: #ef4444; }
.cd-audio__error button { border: none; background: transparent; color: var(--primary); font: inherit; font-weight: 800; cursor: pointer; padding: 0 .15rem; }

.cd-body { display: grid; grid-template-columns: 1fr 22rem; align-items: start; }

.cd-chat { display: flex; flex-direction: column; border-right: 1px solid var(--outline); min-height: calc(100vh - 8.5rem); }
.cd-chat__label { display: flex; align-items: center; gap: .5rem; padding: .85rem 1.5rem; font-size: .75rem; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: var(--secondary); border-bottom: 1px solid var(--outline); background: var(--surface-low); }
.cd-chat__label .material-symbols-outlined { font-size: 1.1rem; color: var(--primary); }
.cd-messages { display: flex; flex-direction: column; gap: .65rem; padding: 1.25rem 1.5rem 2rem; }

.cd-msg { display: flex; align-items: flex-end; gap: .6rem; max-width: 82%; }
.cd-msg--manager { align-self: flex-end; flex-direction: row-reverse; }
.cd-msg--client  { align-self: flex-start; }
.cd-msg__avatar { width: 2rem; height: 2rem; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: .72rem; font-weight: 900; flex-shrink: 0; }
.cd-msg__avatar--manager { background: var(--primary-soft); color: var(--primary); }
.cd-msg__avatar--client  { background: #e9f8ef; color: #166534; }
.cd-bubble { padding: .7rem 1rem; font-size: .92rem; line-height: 1.6; max-width: 100%; }
.cd-bubble--manager { background: var(--primary); color: #fff; border-radius: 1rem .25rem 1rem 1rem; }
.cd-bubble--client  { background: #fff; color: var(--on-surface); border: 1px solid var(--outline); border-radius: .25rem 1rem 1rem 1rem; box-shadow: 0 2px 8px rgba(23,32,51,.05); }

.cd-moment { align-self: center; display: flex; align-items: flex-start; gap: .6rem; max-width: 88%; background: #fffbeb; border: 1px solid #fde68a; border-radius: .5rem; padding: .7rem .9rem; margin: .35rem 0; }
.cd-moment .material-symbols-outlined { color: #d97706; font-size: 1.1rem; flex-shrink: 0; margin-top: .1rem; }
.cd-moment__quote { margin: 0; font-size: .82rem; font-weight: 700; color: #92400e; font-style: italic; }
.cd-moment__note  { margin: .25rem 0 0; font-size: .8rem; color: #b45309; line-height: 1.45; }

.cd-analytics { display: flex; flex-direction: column; background: var(--surface-low); position: sticky; top: calc(4rem + 3.5rem); max-height: calc(100vh - 8.5rem); overflow-y: auto; }
.cd-card { padding: 1rem 1.25rem; border-bottom: 1px solid var(--outline); background: transparent; }
.cd-card:last-child { border-bottom: none; }
.cd-card__head { display: flex; align-items: center; gap: .45rem; font-size: .75rem; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: var(--secondary); margin-bottom: .75rem; }
.cd-card__head .material-symbols-outlined { font-size: 1rem; }
.cd-card__head--good { color: #166534; } .cd-card__head--good .material-symbols-outlined { color: #22c55e; }
.cd-card__head--bad  { color: #991b1b; } .cd-card__head--bad  .material-symbols-outlined { color: #ef4444; }
.cd-card__head--warn { color: #92400e; } .cd-card__head--warn .material-symbols-outlined { color: #f59e0b; }
.cd-card__head--blue { color: #1e4db7; } .cd-card__head--blue .material-symbols-outlined { color: var(--primary); }
.cd-card__text { font-size: .88rem; color: var(--secondary); line-height: 1.65; margin: 0; }
.cd-tag-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: .5rem; }
.cd-tag { display: flex; align-items: flex-start; gap: .5rem; font-size: .84rem; line-height: 1.5; padding: .55rem .75rem; border-radius: .5rem; border: 1px solid transparent; }
.cd-tag .material-symbols-outlined { font-size: 1rem; flex-shrink: 0; margin-top: .1rem; }
.cd-tag--good { background: #f0fdf4; border-color: #bbf7d0; color: #14532d; } .cd-tag--good .material-symbols-outlined { color: #16a34a; }
.cd-tag--bad  { background: #fff1f2; border-color: #fecdd3; color: #881337; } .cd-tag--bad  .material-symbols-outlined { color: #e11d48; }
.cd-tag--warn { background: #fffbeb; border-color: #fde68a; color: #78350f; } .cd-tag--warn .material-symbols-outlined { color: #d97706; }
.cd-tag--blue { background: var(--primary-soft); border-color: rgba(47,111,237,.2); color: #1e3a8a; } .cd-tag--blue .material-symbols-outlined { color: var(--primary); }
.cd-prob { display: flex; align-items: center; gap: .75rem; }
.cd-prob__track { flex: 1; height: .5rem; border-radius: 999px; background: var(--outline); overflow: hidden; }
.cd-prob__fill { height: 100%; border-radius: 999px; transition: width 600ms ease; }
.cd-prob__fill--good   { background: #22c55e; }
.cd-prob__fill--medium { background: #f59e0b; }
.cd-prob__fill--bad    { background: #ef4444; }
.cd-prob__label { font-size: 1rem; font-weight: 900; color: var(--on-surface); min-width: 2.5rem; text-align: right; }

@media (max-width: 860px) {
  .cd-body { grid-template-columns: 1fr; }
  .cd-audio { grid-template-columns: 1fr; }
  .cd-audio__player { justify-content: stretch; }
  .cd-chat { border-right: none; border-bottom: 1px solid var(--outline); min-height: auto; }
  .cd-analytics { position: static; max-height: none; overflow-y: visible; }
  .cd-header { position: static; }
  .cd-msg { max-width: 90%; }
}
@media (max-width: 560px) {
  .cd-header { padding: .75rem 1rem; }
  .cd-audio { padding: .75rem 1rem; }
  .cd-audio__error { margin-left: 0; align-items: flex-start; }
  .cd-header__scores { gap: .35rem; }
  .cd-score-pill { font-size: .75rem; padding: 0 .65rem; }
  .cd-messages { padding: 1rem 1rem 1.5rem; }
  .cd-msg { max-width: 95%; }
  .cd-card { padding: .85rem 1rem; }
}
</style>
