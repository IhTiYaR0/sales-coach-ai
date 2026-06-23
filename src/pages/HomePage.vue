<script setup>
import { computed, ref } from 'vue'

const selectedFile = ref(null)
const isDragging = ref(false)
const isUploading = ref(false)
const statusMessage = ref('')
const statusType = ref('')
const analysisResult = ref(null)

const fileName = computed(() => selectedFile.value?.name || 'MP3 файл не выбран')
const canUpload = computed(() => Boolean(selectedFile.value) && !isUploading.value)
const hasSelectedFile = computed(() => Boolean(selectedFile.value))
const analysis = computed(() => analysisResult.value?.analysis)

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
  setStatus('Файл выбран и готов к отправке.', 'success')
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
    return response.statusText
  }
}

async function sendAnalyzeRequest(fieldName) {
  const formData = new FormData()
  formData.append(fieldName, selectedFile.value)

  return fetch('/analysis/analyze', {
    method: 'POST',
    body: formData,
  })
}

async function uploadFile() {
  if (!selectedFile.value) return

  isUploading.value = true
  analysisResult.value = null
  setStatus('Отправляем файл на анализ...', 'info')

  try {
    const fileFieldNames = ['file', 'audio_file', 'audio', 'upload_file']
    let response = null

    for (const fieldName of fileFieldNames) {
      response = await sendAnalyzeRequest(fieldName)

      if (response.ok || response.status !== 422) {
        break
      }
    }

    if (!response?.ok) {
      const errorMessage = response ? await readErrorMessage(response) : 'Нет ответа от сервера'
      throw new Error(errorMessage)
    }

    analysisResult.value = await response.json()
    setStatus('Анализ готов. Результат отображен ниже.', 'success')
    selectedFile.value = null
  } catch (error) {
    setStatus(`Не удалось отправить файл: ${error.message}`, 'error')
  } finally {
    isUploading.value = false
  }
}
</script>

<template>
  <section class="home-page">
    <div class="page-heading">
      <p class="page-heading__eyebrow">Главное</p>
      <h2>Загрузка звонка менеджера</h2>
      <p>Добавь MP3 запись звонка, чтобы отправить ее на анализ качества общения.</p>
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
          <span class="material-symbols-outlined">upload_file</span>
        </span>

        <span class="upload-zone__title">
          {{ hasSelectedFile ? 'Файл выбран' : 'Перетащи MP3 файл сюда' }}
        </span>
        <span class="upload-zone__text">
          {{ hasSelectedFile ? fileName : 'или выбери запись звонка на компьютере' }}
        </span>
        <span class="upload-zone__button">{{ hasSelectedFile ? 'Выбрать другой' : 'Выбрать MP3' }}</span>
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
          <span class="material-symbols-outlined">cloud_upload</span>
          <span>{{ isUploading ? 'Отправка...' : 'Отправить на анализ' }}</span>
        </button>
      </div>

      <p v-if="statusMessage" class="upload-status" :class="`upload-status--${statusType}`">
        {{ statusMessage }}
      </p>
    </form>

    <section v-if="analysisResult && analysis" class="analysis-result">
      <div class="analysis-result__header">
        <div>
          <p class="page-heading__eyebrow">Результат анализа</p>
          <h3>Оценка качества звонка</h3>
        </div>

        <div class="score-grid">
          <div class="score-card">
            <span>Оценка</span>
            <strong>{{ analysis.score }}</strong>
          </div>
          <div class="score-card">
            <span>Вероятность сделки</span>
            <strong>{{ analysis.deal_probability }}%</strong>
          </div>
          <div class="score-card">
            <span>Этап воронки</span>
            <strong>{{ analysis.sales_funnel_stage }}</strong>
          </div>
        </div>
      </div>

      <div class="analysis-section">
        <h4>Краткое резюме</h4>
        <p>{{ analysis.call_summary }}</p>
      </div>

      <div class="analysis-section">
        <h4>Транскрипт</h4>
        <p class="transcript-text">{{ analysisResult.transcript }}</p>
      </div>

      <div class="analysis-columns">
        <div class="analysis-section">
          <h4>Сильные стороны</h4>
          <ul>
            <li v-for="item in analysis.strengths" :key="item">{{ item }}</li>
          </ul>
        </div>

        <div class="analysis-section">
          <h4>Ошибки</h4>
          <ul>
            <li v-for="item in analysis.mistakes" :key="item">{{ item }}</li>
          </ul>
        </div>
      </div>

      <div class="analysis-section">
        <h4>Ключевые моменты</h4>
        <div class="key-moments">
          <article v-for="moment in analysis.key_moments" :key="moment.text" class="key-moment">
            <p>{{ moment.text }}</p>
            <span>{{ moment.problem }}</span>
          </article>
        </div>
      </div>

      <div class="analysis-columns">
        <div class="analysis-section">
          <h4>Возражения</h4>
          <ul>
            <li v-for="item in analysis.objections" :key="item">{{ item }}</li>
          </ul>
        </div>

        <div class="analysis-section">
          <h4>Рекомендации</h4>
          <ul>
            <li v-for="item in analysis.recommendations" :key="item">{{ item }}</li>
          </ul>
        </div>
      </div>
    </section>
  </section>
</template>
