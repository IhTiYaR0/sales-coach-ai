<script setup>
import { computed, ref } from 'vue'

const emit = defineEmits(['login-success', 'show-register'])

const email = ref('')
const isSubmitting = ref(false)
const statusMessage = ref('')
const statusType = ref('')

const normalizedemail = computed(() => email.value.trim())
const canSubmit = computed(() => normalizedemail.value.length > 0 && !isSubmitting.value)

function setStatus(message, type) {
  statusMessage.value = message
  statusType.value = type
}

async function readErrorMessage(response) {
  try {
    const errorData = await response.json()
    return JSON.stringify(errorData.detail || errorData)
  } catch {
    return response.statusText || 'Ошибка входа'
  }
}

import { apiFetch } from '../api'

async function sendLoginRequest() {
  return apiFetch('/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email: normalizedemail.value }),
  })
}

async function requestLogin() {
  const response = await sendLoginRequest()

  if (!response.ok) {
    const errorMessage = await readErrorMessage(response)
    throw new Error(errorMessage)
  }

  try {
    return await response.json()
  } catch {
    return {}
  }
}

async function submitLogin() {
  if (!canSubmit.value) return

  isSubmitting.value = true
  setStatus('Проверяем email и создаем сессию...', 'info')

  try {
    const userData = await requestLogin()
    setStatus('Вход выполнен. Открываем кабинет.', 'success')
    emit('login-success', {
      email: normalizedemail.value,
      ...userData,
    })
  } catch (error) {
    setStatus(`Не удалось войти: ${error.message}`, 'error')
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <main class="auth-page">
    <section class="auth-form-panel">
      <div class="auth-form-card">
        <div class="auth-brand">
          <div class="auth-brand__mark">
            <span class="material-symbols-outlined">analytics</span>
          </div>
          <div>
            <h1>CallAnalytics</h1>
            <p>AI анализ звонков</p>
          </div>
        </div>

        <div class="auth-heading">
          <p class="page-heading__eyebrow">Вход</p>
          <h2>Войти в систему</h2>
          <p>Введите email, чтобы открыть рабочий кабинет менеджера.</p>
        </div>

        <form class="auth-form" @submit.prevent="submitLogin">
          <label class="auth-field" for="email">
            <span>email</span>
            <div class="auth-input">
              <span class="material-symbols-outlined">mail</span>
              <input
                id="email"
                v-model="email"
                autocomplete="email"
                inputmode="email"
                placeholder="name@email.com"
                type="email"
              />
            </div>
          </label>

          <div class="auth-role-note">
            <span class="material-symbols-outlined">badge</span>
            <div>
              <strong>Роль определит сервер</strong>
              <p>Менеджер попадет в кабинет звонков, руководитель откроет панель команды.</p>
            </div>
          </div>

          <button
            class="auth-submit"
            :class="{ 'auth-submit--loading': isSubmitting }"
            type="submit"
            :disabled="!canSubmit"
          >
            <span class="material-symbols-outlined">{{ isSubmitting ? 'sync' : 'login' }}</span>
            <span>{{ isSubmitting ? 'Входим...' : 'Войти' }}</span>
          </button>

          <p v-if="statusMessage" class="upload-status" :class="`upload-status--${statusType}`">
            {{ statusMessage }}
          </p>
        </form>

        <div class="auth-footer-link">
          <span>Нет аккаунта?</span>
          <button type="button" @click="$emit('show-register')">Зарегистрироваться</button>

        </div>
      </div>
    </section>

    <section class="auth-visual-panel" aria-label="Описание платформы">
      <div class="auth-visual-content">
        <div class="auth-pill">Enterprise Analytics</div>
        <h2>Глубокая аналитика звонков для отдела продаж.</h2>
        <p>
          AI помогает понять, где клиенты теряются, какие возражения повторяются и что
          менеджеру нужно улучшить в следующем разговоре.
        </p>

        <div class="auth-feature-list">
          <div class="auth-feature">
            <span class="material-symbols-outlined">verified</span>
            <strong>Автоматическая транскрибация звонков</strong>
          </div>
          <div class="auth-feature">
            <span class="material-symbols-outlined">psychology</span>
            <strong>Разбор ошибок, возражений и сильных сторон</strong>
          </div>
          <div class="auth-feature">
            <span class="material-symbols-outlined">trending_up</span>
            <strong>Инсайты для роста конверсии</strong>
          </div>
        </div>
      </div>

      <div class="auth-preview-card">
        <div>
          <span></span>
          <span></span>
          <span></span>
        </div>
        <strong>92%</strong>
        <p>вероятность сделки после корректного ответа на возражение клиента</p>
      </div>
    </section>
  </main>
</template>
