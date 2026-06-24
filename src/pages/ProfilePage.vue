<script setup>
import { computed, ref, watch, onMounted } from 'vue'

const props = defineProps({
  currentUser: {
    type: Object,
    default: null,
  },
})

defineEmits(['logout'])

const teamName = ref('Команда не назначена')
const teamLoading = ref(false)

// Состояние для аналитики звонков менеджера
const analyticsData = ref(null)
const analyticsLoading = ref(false)
const analyticsError = ref(null)

const roleLabel = computed(() => (props.currentUser?.role === 'leader' ? 'Руководитель' : 'Менеджер'))
const userName = computed(() => props.currentUser?.name || 'Пользователь')
const userEmail = computed(() => props.currentUser?.email || 'email не указан')
const isLeader = computed(() => props.currentUser?.role === 'leader')
const showTeam = computed(() => !isLeader.value)
const userTeam = computed(() => props.currentUser?.team || teamName.value)
const initials = computed(() =>
  userName.value
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase(),
)

async function loadTeamName(teamId) {
  if (!teamId) {
    teamName.value = props.currentUser?.team || 'Команда не назначена'
    return
  }
  teamLoading.value = true
  try {
    const response = await apiFetch('/teams', { method: 'GET' })
    if (!response.ok) throw new Error(response.statusText)
    const data = await response.json()
    const teams = Array.isArray(data) ? data : data?.teams || data?.data || []
    const myTeam = teams.find((t) => t.id === teamId || t._id === teamId)
    if (myTeam) {
      teamName.value = myTeam.name
    }
  } catch (err) {
    console.error('Ошибка загрузки команды:', err)
  } finally {
    teamLoading.value = false
  }
}

const ANALYTICS_CACHE_TTL = 1000 * 60 * 5 // 5 минут

const getAnalyticsCacheKey = () => {
  const user = props.currentUser
  const userId = user?.id || user?._id || user?.email || 'guest'
  return `profileAnalyticsCache:${userId}`
}

const loadCachedAnalytics = () => {
  try {
    const raw = localStorage.getItem(getAnalyticsCacheKey())
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.data || !parsed?.ts) return null
    if (Date.now() - parsed.ts > ANALYTICS_CACHE_TTL) return null
    return parsed.data
  } catch {
    return null
  }
}

const saveAnalyticsCache = (data) => {
  try {
    localStorage.setItem(getAnalyticsCacheKey(), JSON.stringify({ ts: Date.now(), data }))
  } catch {
    // ignore localStorage errors
  }
}

import { apiFetch } from '../api'

async function fetchAnalyticsFromServer() {
  const response = await apiFetch('/calls/analytics/me', { method: 'GET' })
  if (!response.ok) throw new Error('Не удалось загрузить аналитику звонков')
  const json = await response.json()
  analyticsData.value = json
  saveAnalyticsCache(json)
}

async function loadAnalytics() {
  if (isLeader.value) return
  analyticsError.value = null

  const cached = loadCachedAnalytics()
  if (cached) {
    analyticsData.value = cached
    analyticsLoading.value = false
    fetchAnalyticsFromServer().catch((err) => {
      console.error(err)
    })
    return
  }

  analyticsLoading.value = true
  try {
    await fetchAnalyticsFromServer()
  } catch (err) {
    console.error(err)
    analyticsError.value = err.message || 'Ошибка при загрузке данных'
  } finally {
    analyticsLoading.value = false
  }
}

watch(
  () => props.currentUser?.team_id,
  (newId) => {
    loadTeamName(newId)
  },
  { immediate: true },
)

watch(
  () => props.currentUser,
  (user) => {
    if (user && user.role !== 'leader') {
      loadAnalytics()
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="pp-container">
    <!-- Основная карточка профиля -->
    <div class="pp-card">
      <div class="pp-header">
        <div class="pp-avatar">{{ initials }}</div>
        <div class="pp-meta">
          <h1 class="pp-name">{{ userName }}</h1>
          <span class="pp-badge" :class="{ 'pp-badge--leader': isLeader }">
            {{ roleLabel }}
          </span>
        </div>
      </div>

      <div class="pp-grid">
        <div class="pp-field">
          <span class="pp-field__label">Email адрес</span>
          <div class="pp-field__body">
            <strong>{{ userEmail }}</strong>
          </div>
        </div>

        <div v-if="showTeam" class="pp-field">
          <span class="pp-field__label">Ваша команда</span>
          <div class="pp-field__body">
            <span v-if="teamLoading" class="pp-field__loading">Загрузка...</span>
            <strong v-else>{{ userTeam }}</strong>
          </div>
        </div>
      </div>
    </div>

    <!-- БЛОК АНАЛИТИКИ ЗВОНКОВ -->
    <div v-if="!isLeader" class="pp-card manager-analytics">
      <div class="analytics-header">
        <div class="analytics-title-group">
          <!-- Иконка графика тренда -->
          <svg class="title-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="20" x2="18" y2="10"></line>
            <line x1="12" y1="20" x2="12" y2="4"></line>
            <line x1="6" y1="20" x2="6" y2="14"></line>
          </svg>
          <h2 class="analytics-title">Аналитика звонков и эффективности</h2>
        </div>
        <button @click="loadAnalytics" class="refresh-btn" :disabled="analyticsLoading" title="Обновить данные">
          <svg :class="{ 'spinning': analyticsLoading }" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
          </svg>
        </button>
      </div>

      <!-- Состояние Загрузки (Скелетон) -->
      <div v-if="analyticsLoading" class="analytics-skeleton">
        <div class="skeleton-metrics">
          <div class="skeleton-card"><div class="skeleton-line"></div></div>
          <div class="skeleton-card"><div class="skeleton-line"></div></div>
          <div class="skeleton-card"><div class="skeleton-line"></div></div>
        </div>
        <div class="skeleton-line skeleton-line--title"></div>
        <div class="skeleton-line skeleton-line--text"></div>
      </div>

      <!-- Состояние Ошибки -->
      <div v-else-if="analyticsError" class="analytics-error">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="error-icon">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <span>{{ analyticsError }}</span>
        <button @click="loadAnalytics" class="retry-btn">Повторить попытку</button>
      </div>

      <!-- Отображение Данных -->
      <div v-else-if="analyticsData" class="analytics-content">
        
        <!-- Сетка основных метрик -->
        <div class="metrics-grid">
          <div class="metric-card">
            <span class="metric-value">{{ analyticsData.total_calls }}</span>
            <span class="metric-label">Всего звонков</span>
          </div>
          <div class="metric-card highlight-blue">
            <span class="metric-value">{{ analyticsData.avg_score }}%</span>
            <span class="metric-label">Средний балл ИИ</span>
          </div>
          <div class="metric-card highlight-green">
            <span class="metric-value">{{ analyticsData.avg_deal_probability }}%</span>
            <span class="metric-label">Вероятность сделки</span>
          </div>
        </div>

        <!-- Краткое резюме от ИИ -->
        <div class="analytics-summary">
          <div class="summary-title-row">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
              <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
              <line x1="12" y1="22.08" x2="12" y2="12"></line>
            </svg>
            <h3>Заключение ИИ-ассистента</h3>
          </div>
          <p>{{ analyticsData.summary }}</p>
        </div>

        <!-- Детальный разбор -->
        <div class="analysis-sections">
          
          <!-- Сильные стороны -->
          <div class="analysis-box strengths">
            <div class="box-header">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <h4>Сильные стороны</h4>
            </div>
            <ul>
              <li v-for="(item, index) in analyticsData.strengths" :key="index">{{ item }}</li>
            </ul>
          </div>

          <!-- Повторяющиеся ошибки -->
          <div class="analysis-box mistakes">
            <div class="box-header">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="15" y1="9" x2="9" y2="15"></line>
                <line x1="9" y1="9" x2="15" y2="15"></line>
              </svg>
              <h4>Повторяющиеся ошибки</h4>
            </div>
            <ul>
              <li v-for="(item, index) in analyticsData.recurring_mistakes" :key="index">{{ item }}</li>
            </ul>
          </div>

          <!-- Причины срыва сделок -->
          <div class="analysis-box loss-reasons">
            <div class="box-header">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
                <polyline points="2 17 12 22 22 17"></polyline>
                <polyline points="2 12 12 17 22 12"></polyline>
              </svg>
              <h4>Причины потери сделок</h4>
            </div>
            <ul>
              <li v-for="(item, index) in analyticsData.deal_loss_reasons" :key="index">{{ item }}</li>
            </ul>
          </div>

          <!-- Рекомендации -->
          <div class="analysis-box recommendations">
            <div class="box-header">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
              </svg>
              <h4>Рекомендации по улучшению</h4>
            </div>
            <ul>
              <li v-for="(item, index) in analyticsData.recommendations" :key="index">{{ item }}</li>
            </ul>
          </div>

        </div>
      </div>

      <!-- Пустое состояние -->
      <div v-else class="analytics-empty">
        Нет доступных данных аналитики за текущий период.
      </div>
    </div>

    <!-- Зона выхода -->
    <div class="pp-card pp-danger">
      <div class="pp-danger__text">
        <strong>Завершить сессию</strong>
        <p>Выйдете из аккаунта, если это не ваш компьютер.</p>
      </div>
      <button class="pp-logout-full" @click="$emit('logout')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
        Выйти из системы
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Общие стили */
.pp-container {
  max-width: 48rem;
  margin: 2rem auto;
  padding: 0 1rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.pp-card {
  background: var(--surface-raised);
  border: 1px solid var(--outline);
  border-radius: 1.25rem;
  padding: 2rem;
  box-shadow: var(--shadow);
}

.pp-header {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  margin-bottom: 2rem;
  border-bottom: 1px solid var(--surface-low);
  padding-bottom: 1.5rem;
}
.pp-container {
  /* Увеличиваем максимальную ширину, чтобы страница могла растягиваться шире */
  max-width: 66rem; /* Было 48rem, стало ~900px */
  margin: 2rem auto;
  /* Минимальные отступы по бокам для мобилок, чтобы текст не прилипал к экрану */
  padding: 0 1rem; 
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

/* ── ОБЩИЕ КАРТОЧКИ ── */
.pp-card {
  background: var(--surface-raised);
  border: 1px solid var(--outline);
  border-radius: 1.25rem;
  /* Уменьшаем внутренние отступы карточки, чтобы контент подошел ближе к краям */
  padding: 1.5rem; /* Было 2rem — теперь убрали лишнюю пустоту по бокам */
  box-shadow: var(--shadow);
}

/* На больших экранах можно вернуть чуть больше отступа сверху/снизу, но оставить ширину */
@media (min-width: 868px) {
  .pp-card {
    padding: 1.75rem 2rem; /* Сверху/снизу 1.75rem, по бокам 2rem */
  }
}

.pp-avatar {
  width: 4.5rem;
  height: 4.5rem;
  border-radius: 1.25rem;
  background: var(--primary-soft);
  color: var(--primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.pp-meta {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  align-items: flex-start;
}

.pp-name {
  margin: 0;
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--on-surface);
  letter-spacing: -0.02em;
}

.pp-badge {
  display: inline-flex;
  padding: 0.3rem 0.75rem;
  border-radius: 2rem;
  font-size: 0.78rem;
  font-weight: 600;
  background: #f1f5f9;
  color: #475569;
}
.pp-badge--leader {
  background: var(--primary-soft);
  color: var(--primary);
}

.pp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1.5rem;
}

.pp-field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.pp-field__label {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--secondary);
  text-transform: uppercase;
  letter-spacing: .05em;
}
.pp-field__body strong {
  font-size: 0.97rem;
  color: var(--on-surface);
  overflow-wrap: anywhere;
}
.pp-field__loading { color: var(--secondary) !important; font-weight: 400 !important; }

/* ── Зона выхода ── */
.pp-danger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.1rem 1.35rem;
  border: 1px solid #e2e8f0;
  border-radius: 1rem;
  background: var(--surface-raised);
  flex-wrap: wrap;
}

.pp-danger__text strong {
  display: block;
  font-size: 0.95rem;
  color: var(--on-surface);
}
.pp-danger__text p {
  margin: 0.25rem 0 0;
  font-size: 0.85rem;
  color: var(--secondary);
}

.pp-logout-full {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 2.4rem;
  border: 1px solid #ef4444;
  border-radius: 0.5rem;
  background: transparent;
  color: #ef4444;
  font-weight: 600;
  font-size: 0.88rem;
  padding: 0 1rem;
  cursor: pointer;
  transition: all 0.2s ease;
}
.pp-logout-full:hover {
  background: #fef2f2;
}

/* 📊 ── НОВЫЙ СТРОГИЙ ДИЗАЙН АНАЛИТИКИ ── */
/* 📊 ── ОБНОВЛЕННЫЙ ИНТУИТИВНЫЙ ДИЗАЙН КАРТОЧЕК АНАЛИТИКИ ── */
.manager-analytics {
  background: var(--surface-raised);
}

.analytics-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.75rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--outline);
}

.analytics-title-group {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: var(--on-surface);
}

.title-icon {
  color: var(--secondary);
}

.analytics-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.refresh-btn {
  background: transparent;
  border: 1px solid var(--outline);
  color: var(--secondary);
  border-radius: 0.5rem;
  cursor: pointer;
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}
.refresh-btn:hover:not(:disabled) {
  background: var(--surface-low);
  color: var(--on-surface);
  border-color: var(--outline-strong);
}
.refresh-btn:disabled {
  opacity: 0.5;
}

.spinning {
  animation: rotate 1s linear infinite;
}
@keyframes rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Метрики */
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1.25rem;
  margin-bottom: 1.75rem;
}

@media (max-width: 560px) {
  .metrics-grid { grid-template-columns: 1fr; }
}

.metric-card {
  background: var(--surface-low);
  border: 1px solid var(--outline);
  border-radius: 0.75rem;
  padding: 1.25rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.metric-value {
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--on-surface);
  line-height: 1;
}

.metric-label {
  font-size: 0.8rem;
  color: var(--secondary);
  font-weight: 500;
}

.metric-card.highlight-blue {
  border-left: 3px solid var(--primary);
}
.metric-card.highlight-green {
  border-left: 3px solid #10b981;
}

/* Блок резюме ИИ */
.analytics-summary {
  background: var(--surface-low);
  border: 1px solid var(--outline);
  border-radius: 0.75rem;
  padding: 1.25rem;
  margin-bottom: 1.75rem;
}

.summary-title-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--primary);
  margin-bottom: 0.5rem;
}

.analytics-summary h3 {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
}

.analytics-summary p {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--on-surface);
  opacity: 0.85;
}

/* 🚀 Секции списков — Изменено: теперь во всю ширину, читать стало удобнее */
.analysis-sections {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.analysis-box {
  padding: 1.5rem;
  border-radius: 1rem;
  border: 1px solid var(--outline);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.analysis-box:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.02);
}

.box-header {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 1rem;
}

.analysis-box h4 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
}

.analysis-box ul {
  margin: 0;
  padding-left: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.analysis-box li {
  font-size: 0.92rem;
  line-height: 1.5;
}

/* 🎨 Цветовое кодирование фонов и рамок для явного понимания категорий */

/* Сильные стороны (Благородный приглушенный зеленый) */
.analysis-box.strengths { 
  background-color: #f0fdf4; 
  border-color: #bbf2d1; 
  color: #14532d;
}
.strengths .box-header { color: #16a34a; }
.strengths li { color: #166534; }

/* Повторяющиеся ошибки (Приглушенный красный) */
.analysis-box.mistakes { 
  background-color: #fef2f2; 
  border-color: #fecaca; 
  color: #7f1d1d;
}
.mistakes .box-header { color: #dc2626; }
.mistakes li { color: #991b1b; }

/* Причины потери сделок (Мягкий пастельный оранжевый) */
.analysis-box.loss-reasons { 
  background-color: #fff7ed; 
  border-color: #ffedd5; 
  color: #7c2d12;
}
.loss-reasons .box-header { color: #ea580c; }
.loss-reasons li { color: #9a3412; }

/* Рекомендации (Информационный мягкий синий) */
.analysis-box.recommendations { 
  background-color: #f0f9ff; 
  border-color: #bae6fd; 
  color: #0c4a6e;
}
.recommendations .box-header { color: #0284c7; }
.recommendations li { color: #075985; }


/* Остальные стили (ошибки, скелетоны) */
.analytics-error {
  text-align: center;
  padding: 2.5rem;
  color: #ef4444;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}
.error-icon { color: #ef4444; }
.retry-btn {
  margin-top: 0.5rem;
  background: var(--surface-low);
  border: 1px solid var(--outline);
  color: var(--on-surface);
  padding: 0.4rem 1rem;
  border-radius: 0.5rem;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 500;
}
.retry-btn:hover { background: var(--outline); }

.analytics-skeleton {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
.skeleton-metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1.25rem;
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
  animation: shimmer 1.5s infinite;
}
.skeleton-line--title { width: 40%; height: 1.1rem; }
.skeleton-line--text { width: 100%; height: 2.5rem; }

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.analytics-empty {
  text-align: center;
  color: var(--secondary);
  padding: 2rem;
  font-size: 0.9rem;
}

/* Цветовое кодирование только для иконок категорий для сохранения строгости */
.strengths .box-header { color: #10b981; }
.mistakes .box-header { color: #ef4444; }
.loss-reasons .box-header { color: #f97316; }
.recommendations .box-header { color: var(--primary); }

/* Состояние ошибки */
.analytics-error {
  text-align: center;
  padding: 2.5rem;
  color: #ef4444;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}
.error-icon { color: #ef4444; }
.retry-btn {
  margin-top: 0.5rem;
  background: var(--surface-low);
  border: 1px solid var(--outline);
  color: var(--on-surface);
  padding: 0.4rem 1rem;
  border-radius: 0.5rem;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 500;
  transition: background 0.2s;
}
.retry-btn:hover { background: var(--outline); }

/* Скелетон */
.analytics-skeleton {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
.skeleton-metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1.25rem;
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
  animation: shimmer 1.5s infinite;
}
.skeleton-line--title { width: 40%; height: 1.1rem; }
.skeleton-line--text { width: 100%; height: 2.5rem; }

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.analytics-empty {
  text-align: center;
  color: var(--secondary);
  padding: 2rem;
  font-size: 0.9rem;
}
</style>