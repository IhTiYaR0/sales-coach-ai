<script setup>
import { computed, ref, watch } from 'vue'

const emit = defineEmits(['show-login', 'register-success'])

const name = ref('')
const email = ref('')
const role = ref('manager')
const companyName = ref('')
const isSubmitting = ref(false)
const statusMessage = ref('')
const statusType = ref('')

const normalizedName = computed(() => name.value.trim())
const normalizedEmail = computed(() => email.value.trim())
const normalizedCompanyName = computed(() => companyName.value.trim())
const canSubmit = computed(
  () =>
    normalizedName.value.length > 0 &&
    normalizedEmail.value.length > 0 &&
    (role.value !== 'leader' || normalizedCompanyName.value.length > 0) &&
    !isSubmitting.value,
)

function setStatus(message, type) {
  statusMessage.value = message
  statusType.value = type
}

async function readErrorMessage(response) {
  try {
    const errorData = await response.json()
    return JSON.stringify(errorData.detail || errorData)
  } catch {
    return response.statusText || 'Ошибка регистрации'
  }
}

import { apiFetch } from '../api'

async function sendRegisterRequest() {
  return apiFetch('/auth/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: normalizedName.value,
      email: normalizedEmail.value,
      role: role.value,
      company_name: role.value === 'leader' ? normalizedCompanyName.value : null,
    }),
  })
}

watch(role, (newRole) => {
  if (newRole !== 'leader') {
    companyName.value = ''
  }
})

async function requestRegistration() {
  const response = await sendRegisterRequest()

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

async function submitRegistration() {
  if (!canSubmit.value) return

  isSubmitting.value = true
    setStatus('Создаем аккаунт...', 'info')

  try {
    await requestRegistration()
    setStatus('Аккаунт создан. Теперь можно войти в систему.', 'success')
    emit('register-success')
  } catch (error) {
    setStatus(`Не удалось зарегистрироваться: ${error.message}`, 'error')
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
          <p class="page-heading__eyebrow">Регистрация</p>
          <h2>Создать аккаунт</h2>
          <p>Добавьте пользователя и выберите роль для доступа к нужному кабинету.</p>
        </div>

        <form class="auth-form" @submit.prevent="submitRegistration">
          <label class="auth-field" for="register-name">
            <span>Имя</span>
            <div class="auth-input">
              <span class="material-symbols-outlined">person</span>
              <input
                id="register-name"
                v-model="name"
                autocomplete="name"
                placeholder="Константин"
                type="text"
              />
            </div>
          </label>

          <label class="auth-field" for="register-email">
            <span>Рабочий email</span>
            <div class="auth-input">
              <span class="material-symbols-outlined">mail</span>
              <input
                id="register-email"
                v-model="email"
                autocomplete="email"
                inputmode="email"
                placeholder="name@company.ru"
                type="email"
              />
            </div>
          </label>

          <label class="auth-field" for="register-role">
            <span>Роль</span>
            <div class="auth-input">
              <span class="material-symbols-outlined">badge</span>
              <select id="register-role" v-model="role">
                <option value="manager">Менеджер</option>
                <option value="leader">Руководитель</option>
              </select>
            </div>
          </label>

          <label
            v-if="role === 'leader'"
            class="auth-field"
            for="register-company"
          >
            <span>Название компании</span>
            <div class="auth-input">
              <span class="material-symbols-outlined">business</span>
              <input
                id="register-company"
                v-model="companyName"
                autocomplete="organization"
                placeholder="Acme Sales"
                type="text"
              />
            </div>
          </label>

          <div class="auth-role-note">
            <span class="material-symbols-outlined">verified_user</span>
            <div>
              <strong>После регистрации откроется вход</strong>
              <p>Сервер получит name, email, роль и company_name для руководителя.</p>
            </div>
          </div>

          <button
            class="auth-submit"
            :class="{ 'auth-submit--loading': isSubmitting }"
            type="submit"
            :disabled="!canSubmit"
          >
            <span class="material-symbols-outlined">{{ isSubmitting ? 'sync' : 'person_add' }}</span>
            <span>{{ isSubmitting ? 'Создаем...' : 'Зарегистрироваться' }}</span>
          </button>

          <p v-if="statusMessage" class="upload-status" :class="`upload-status--${statusType}`">
            {{ statusMessage }}
          </p>
        </form>

        <div class="auth-footer-link">
          <span>Уже есть аккаунт?</span>
          <button type="button" @click="$emit('show-login')">Войти</button>
        </div>
      </div>
    </section>

    <section class="auth-visual-panel" aria-label="Описание регистрации">
      <div class="auth-visual-content">
        <div class="auth-pill">Enterprise Analytics</div>
        <h2>Масштабируйте отдел продаж с помощью AI.</h2>
        <p>
          Каждый менеджер загружает звонки, а руководитель видит сильные стороны,
          ошибки, возражения и рекомендации по развитию команды.
        </p>

        <div class="auth-feature-list">
          <div class="auth-feature">
            <span class="material-symbols-outlined">phone_in_talk</span>
            <strong>Загрузка MP3 записей звонков</strong>
          </div>
          <div class="auth-feature">
            <span class="material-symbols-outlined">psychology</span>
            <strong>AI разбор качества разговора</strong>
          </div>
          <div class="auth-feature">
            <span class="material-symbols-outlined">groups</span>
            <strong>Понятная аналитика для команды</strong>
          </div>
        </div>
      </div>

      <div class="auth-preview-card">
        <div>
          <span></span>
          <span></span>
          <span></span>
        </div>
        <strong>24/7</strong>
        <p>автоматический разбор звонков без ручного прослушивания каждой записи</p>
      </div>
    </section>
  </main>
</template>
