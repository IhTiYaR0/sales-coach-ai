<script setup>
import { computed, defineEmits, ref, onMounted } from 'vue'

// ─── State ───────────────────────────────────────────────────────────────────
const activePeriod = ref('week')
const calls = ref([])
const loading = ref(true)
const error = ref(null)
const visible = ref(false)
const emit = defineEmits(['navigate'])
const topCalls = computed(() => {
  return [...calls.value]
    .filter((c) => typeof c.score === 'number')
    .sort((a, b) => b.score - a.score || new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5)
})

const goToCalls = () => emit('navigate', 'calls')

const CACHE_KEY = 'homePageCallsCache'
const CACHE_TTL = 1000 * 60 * 5 // 5 минут

const loadCachedCalls = () => {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.data || !parsed?.ts) return null
    if (Date.now() - parsed.ts > CACHE_TTL) return null
    return Array.isArray(parsed.data) ? parsed.data.map(normalizeCall) : null
  } catch {
    return null
  }
}

const saveCallsCache = (data) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }))
  } catch {
    // ignore localStorage errors
  }
}

const extractCallsArray = (data) => {
  if (Array.isArray(data)) return data
  if (!data || typeof data !== 'object') return []

  for (const key of ['calls', 'history', 'data', 'results', 'items']) {
    if (Array.isArray(data[key])) return data[key]
  }

  return []
}

const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const normalizeCall = (call = {}) => {
  const analysis = call.analysis || call.result?.analysis || {}
  const score = toNumberOrNull(call.score ?? analysis.score)
  const dealProbability = toNumberOrNull(
    call.deal_probability
      ?? call.dealProbability
      ?? analysis.deal_probability
      ?? analysis.dealProbability
  )

  return {
    ...call,
    id: call.id ?? call.call_id ?? call.callId ?? crypto.randomUUID(),
    score,
    deal_probability: dealProbability,
    created_at: call.created_at ?? call.createdAt ?? call.created ?? call.uploaded_at ?? new Date().toISOString(),
    audio_path: call.audio_path ?? call.file_path ?? call.filename ?? call.fileName ?? call.name ?? '',
  }
}

const normalizeCalls = (data) => extractCallsArray(data)
  .map(normalizeCall)
  .filter((call) => call.id != null)

const fetchCalls = async () => {
  const res = await fetch('/calls/history', { method: 'GET', credentials: 'include' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  const normalized = normalizeCalls(json)
  calls.value = normalized
  saveCallsCache(normalized)
}

onMounted(async () => {
  const cached = loadCachedCalls()
  if (cached) {
    calls.value = cached
    loading.value = false
    visible.value = true
  }

  try {
    await fetchCalls()
    error.value = null
  } catch (e) {
    if (!cached) error.value = e.message
  } finally {
    if (!cached) loading.value = false
    setTimeout(() => { visible.value = true }, 60)
  }
})

// ─── Helpers ─────────────────────────────────────────────────────────────────
const avg = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0

const formatDate = (iso) => {
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const scoreColor = (score) => {
  if (score >= 80) return '#22c55e'
  if (score >= 60) return '#eab308'
  return '#ef4444'
}

const scoreLabel = (score) => {
  if (score >= 80) return 'Отлично'
  if (score >= 60) return 'Хорошо'
  return 'Нужна работа'
}

// ─── Metrics ─────────────────────────────────────────────────────────────────
const avgScore = computed(() => {
  const scores = calls.value.map(c => c.score).filter(score => typeof score === 'number')
  if (!scores.length) return '—'
  return avg(scores).toFixed(1)
})

const avgScoreProgress = computed(() => {
  const scores = calls.value.map(c => c.score).filter(score => typeof score === 'number')
  if (!scores.length) return 0
  return Math.round(avg(scores))
})

const totalCalls = computed(() => calls.value.length)

const bestCall = computed(() => {
  const scoredCalls = calls.value.filter((c) => typeof c.score === 'number')
  if (!scoredCalls.length) return null
  return scoredCalls.reduce((best, c) => c.score > best.score ? c : best, scoredCalls[0])
})

const scoreDelta = computed(() => {
  const sorted = [...calls.value]
    .filter((c) => typeof c.score === 'number')
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  if (sorted.length < 2) return null
  const half = Math.floor(sorted.length / 2)
  const prev = avg(sorted.slice(0, half).map(c => c.score))
  const curr = avg(sorted.slice(half).map(c => c.score))
  const delta = curr - prev
  return { value: delta.toFixed(1), positive: delta >= 0 }
})

const streak = computed(() => {
  const sorted = [...calls.value]
    .filter((c) => typeof c.score === 'number')
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  let count = 0
  for (const c of sorted) {
    if (c.score >= 70) count++
    else break
  }
  return count
})

// ─── Chart ───────────────────────────────────────────────────────────────────
// Заглушки меток для каждого периода
const PERIOD_PLACEHOLDERS = {
  week:  ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
  month: ['1–5', '6–10', '11–15', '16–20', '21–25', '26–30'],
  year:  ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'],
}

const chartData = computed(() => {
  const now = new Date()

  const filtered = calls.value.filter(c => {
    if (typeof c.score !== 'number') return false
    const diff = (now - new Date(c.created_at)) / (1000 * 60 * 60 * 24)
    if (activePeriod.value === 'week') return diff <= 7
    if (activePeriod.value === 'month') return diff <= 30
    return diff <= 365
  })

  const groupKey = (c) => {
    const d = new Date(c.created_at)
    if (activePeriod.value === 'week') return d.toLocaleDateString('ru-RU', { weekday: 'short' })
    if (activePeriod.value === 'month') return `${Math.ceil(d.getDate() / 5)}`
    return d.toLocaleDateString('ru-RU', { month: 'short' })
  }

  // Группируем реальные данные
  const groups = {}
  filtered.forEach(c => {
    const key = groupKey(c)
    if (!groups[key]) groups[key] = []
    groups[key].push(c.score)
  })

  const realEntries = Object.entries(groups).map(([label, scores]) => ({
    label,
    count: scores.length,
    avgScore: avg(scores),
    isReal: true,
  }))

  // Дополняем пустыми барами до полного набора меток
  const placeholders = PERIOD_PLACEHOLDERS[activePeriod.value]
  const realLabels = new Set(realEntries.map(e => e.label))

  const allEntries = [...realEntries]
  for (const label of placeholders) {
    if (!realLabels.has(label)) {
      allEntries.push({ label, count: 0, avgScore: 0, isReal: false })
    }
  }

  // Сортируем по порядку заглушек
  allEntries.sort((a, b) => {
    const ai = placeholders.indexOf(a.label)
    const bi = placeholders.indexOf(b.label)
    if (ai === -1 && bi === -1) return 0
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })

  const maxCount = Math.max(...allEntries.map(e => e.count), 1)
  const maxIdx = allEntries.reduce((mi, e, i) =>
    e.count > allEntries[mi].count ? i : mi, 0)

  return allEntries.map((e, i) => ({
    label: e.label,
    height: e.isReal && e.count > 0
      ? Math.round((e.count / maxCount) * 88) + 12
      : 6,
    active: e.isReal && i === maxIdx && e.count > 0,
    tooltip: e.isReal && e.count > 0
      ? `${e.count} зв. · avg ${e.avgScore.toFixed(0)}б`
      : null,
    isReal: e.isReal && e.count > 0,
  }))
})

// ─── Recent calls ─────────────────────────────────────────────────────────────
const recentCalls = computed(() => {
  return [...calls.value]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 10)
})
</script>

<template>
  <section class="mgr-page" :class="{ 'mgr-page--visible': visible }">

    <!-- Loading -->
    <template v-if="loading">
      <div class="mgr-skeleton-grid">
        <div class="skeleton-card" v-for="n in 4" :key="n">
          <div class="skeleton-avatar"></div>
          <div class="skeleton-content">
            <div class="skeleton-line skeleton-line--title"></div>
            <div class="skeleton-line skeleton-line--text"></div>
          </div>
        </div>
      </div>
    </template>

    <!-- Error -->
    <div v-else-if="error" class="teams-state-card teams-state-card--error">
      <span class="material-symbols-outlined teams-state-icon">wifi_off</span>
      <h3>Не удалось загрузить данные</h3>
      <p>{{ error }}</p>
    </div>

    <!-- Content -->
    <template v-else>

      <!-- Hero ---------------------------------------------------------------->
      <header class="mgr-hero mgr-anim mgr-anim--1">
        <div class="mgr-hero__text">
          <div class="live-label">
            <span class="live-label__dot"></span>
            Моя статистика
          </div>
          <h2>Личный дашборд</h2>
          <p>Твои звонки, прогресс и результаты — всё в одном месте.</p>
        </div>

        <div class="period-switch" aria-label="Период">
          <button
            v-for="p in ['week', 'month', 'year']"
            :key="p"
            type="button"
            :class="{ 'period-switch__button--active': activePeriod === p }"
            @click="activePeriod = p"
          >
            {{ p === 'week' ? 'Неделя' : p === 'month' ? 'Месяц' : 'Год' }}
          </button>
        </div>
      </header>

      <!-- Metric cards -------------------------------------------------------->
      <div class="mgr-metrics mgr-anim mgr-anim--2">

        <!-- <article class="metric-card mgr-metric-card">
          <div class="metric-card__top">
            <div>
              <p>Всего звонков</p>
              <strong>{{ totalCalls }}<span></span></strong>
            </div>
            <span class="metric-card__icon material-symbols-outlined">call</span>
          </div>
          <div class="metric-card__note">Из истории звонков</div>
          <div class="metric-progress">
            <span :style="{ width: `${Math.min(totalCalls * 5, 100)}%` }"></span>
          </div>
        </article> -->

        <article class="metric-card mgr-metric-card">
          <div class="metric-card__top">
            <div>
              <p>Средний балл</p>
              <strong>{{ avgScore }}<span>/ 100</span></strong>
            </div>
            <span class="metric-card__icon material-symbols-outlined">grade</span>
          </div>
          <div class="metric-card__note">
            <template v-if="scoreDelta">
              <span :style="{ color: scoreDelta.positive ? '#22c55e' : '#ef4444' }">
                {{ scoreDelta.positive ? '↑' : '↓' }} {{ Math.abs(scoreDelta.value) }}б
              </span>
              к прошлому периоду
            </template>
            <template v-else>Недостаточно данных</template>
          </div>
          <div class="metric-progress">
            <span :style="{ width: `${avgScoreProgress}%` }"></span>
          </div>
        </article>

        <article class="metric-card mgr-metric-card">
          <div class="metric-card__top">
            <div>
              <p>Лучший результат</p>
              <strong>{{ bestCall ? bestCall.score : '—' }}<span>/ 100</span></strong>
            </div>
            <span class="metric-card__icon material-symbols-outlined">emoji_events</span>
          </div>
          <div class="metric-card__note">
            {{ bestCall ? formatDate(bestCall.created_at) : '—' }}
          </div>
          <div class="metric-progress">
            <span :style="{ width: `${bestCall ? bestCall.score : 0}%`, background: '#22c55e' }"></span>
          </div>
        </article>

        <article class="metric-card mgr-metric-card">
          <div class="metric-card__top">
            <div>
              <p>Серия успехов</p>
              <strong>{{ streak }}<span>звонков</span></strong>
            </div>
            <span class="metric-card__icon material-symbols-outlined">local_fire_department</span>
          </div>
          <div class="metric-card__note">Подряд с оценкой ≥ 70</div>
          <div class="metric-progress">
            <span :style="{ width: `${Math.min(streak * 10, 100)}%`, background: streak >= 5 ? '#f97316' : 'var(--primary)' }"></span>
          </div>
        </article>

      </div>

      <!-- Chart --------------------------------------------------------------->
      <section class="dashboard-card chart-card mgr-anim mgr-anim--3">
        <div class="section-title-row">
          <div>
            <h3>Мой тренд</h3>
            <p>Активность по звонкам за выбранный период</p>
          </div>
          <div class="chart-legend">
            <span><i></i> Звонки</span>
            <span><i class="chart-legend__empty"></i> Нет данных</span>
          </div>
        </div>

        <div class="bar-chart">
          <div v-for="bar in chartData" :key="bar.label" class="bar-chart__item">
            <div class="bar-chart__track">
              <span v-if="bar.active && bar.tooltip" class="bar-chart__tooltip">{{ bar.tooltip }}</span>
              <div
                class="bar-chart__bar"
                :class="{
                  'bar-chart__bar--active': bar.active,
                  'bar-chart__bar--empty': !bar.isReal,
                }"
                :style="{ height: `${bar.height}%` }"
              ></div>
            </div>
            <span class="bar-chart__label" :class="{ 'bar-chart__label--active': bar.active }">
              {{ bar.label }}
            </span>
          </div>
        </div>
      </section>

      <!-- Top calls ----------------------------------------------------------->
      <section class="mgr-recent mgr-anim mgr-anim--4">
        <div class="section-title-row">
          <div class="best-calls__title">
            <span class="best-calls__title-bar"></span>
            <h3>Проанализированные звонки</h3>
          </div>
          <button class="best-calls__action" type="button" @click="goToCalls">
            Все звонки
            <span class="material-symbols-outlined">arrow_right_alt</span>
          </button>
        </div>

        <div v-if="topCalls.length" class="best-call-list">
          <article
            v-for="call in topCalls"
            :key="call.id"
            class="best-call best-call--compact"
            @click="goToCalls"
            role="button"
            tabindex="0"
            @keydown.enter.prevent="goToCalls"
            @keydown.space.prevent="goToCalls"
          >
            <div class="best-call__person">
              <div class="best-call__avatar">
                {{ call.id }}
                <span class="material-symbols-outlined">check</span>
              </div>
              <div>
                <h4>{{ call.audio_path ? call.audio_path.split('/').pop() : `Звонок #${call.id}` }}</h4>
                <p>{{ scoreLabel(call.score) }} · {{ formatDate(call.created_at) }}</p>
              </div>
            </div>

            <div class="best-call__meta">
              <div>
                <span>Оценка AI</span>
                <strong :style="{ color: scoreColor(call.score) }">{{ call.score }}</strong>
              </div>
              <div>
                <span>Сделка</span>
                <strong>{{ call.deal_probability ?? '—' }}{{ call.deal_probability == null ? '' : '%' }}</strong>
              </div>
            </div>

            <button class="best-call__play" type="button" aria-label="Открыть звонок">
              <span class="material-symbols-outlined">chevron_right</span>
            </button>
          </article>
        </div>

        <div v-else class="empty-calls">
          <span class="material-symbols-outlined">call_end</span>
          <p>Лучших звонков пока нет</p>
        </div>
      </section>

    </template>
  </section>
</template>

<style scoped>
/* ─── Page animations ───────────────────────────────────────────── */
.mgr-page {
  display: grid;
  gap: 1.5rem;
  width: 100%;
  max-width: 76rem;
  margin: 0 auto;
}

.mgr-anim {
  opacity: 0;
  transform: translateY(1.25rem);
  transition: opacity 0.55s ease, transform 0.55s ease;
}

.mgr-page--visible .mgr-anim { opacity: 1; transform: translateY(0); }
.mgr-page--visible .mgr-anim--1 { transition-delay: 0.05s; }
.mgr-page--visible .mgr-anim--2 { transition-delay: 0.15s; }
.mgr-page--visible .mgr-anim--3 { transition-delay: 0.25s; }
.mgr-page--visible .mgr-anim--4 { transition-delay: 0.35s; }

/* ─── Hero ──────────────────────────────────────────────────────── */
.mgr-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1.5rem;
}

.mgr-hero h2 {
  margin: 0.55rem 0 0;
  color: var(--on-surface);
  font-size: clamp(1.9rem, 3vw, 2.7rem);
  line-height: 1.05;
}

.mgr-hero p {
  max-width: 42rem;
  margin: 0.8rem 0 0;
  color: var(--secondary);
  line-height: 1.65;
}

.live-label {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--primary);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.live-label__dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  background: var(--primary);
  box-shadow: 0 0 0 5px rgba(47, 111, 237, 0.12);
  animation: pulse-dot 2s ease-in-out infinite;
}

@keyframes pulse-dot {
  0%, 100% { box-shadow: 0 0 0 5px rgba(47, 111, 237, 0.12); }
  50%       { box-shadow: 0 0 0 8px rgba(47, 111, 237, 0.04); }
}

/* ─── Metrics ───────────────────────────────────────────────────── */
.mgr-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}

.mgr-metric-card {
  transition: transform 200ms ease, box-shadow 200ms ease;
}

.mgr-metric-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 24px 48px rgba(47, 111, 237, 0.1);
}

/* ─── Skeleton ──────────────────────────────────────────────────── */
.mgr-skeleton-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}

/* ─── Chart — пустые бары ───────────────────────────────────────── */
.bar-chart__bar--empty {
  background: var(--outline) !important;
  opacity: 0.4;
  box-shadow: none !important;
}

.chart-legend__empty {
  background: var(--outline) !important;
  opacity: 0.6;
}

/* ─── Recent / top calls ────────────────────────────────────────── */
.mgr-recent {
  display: grid;
  gap: 1rem;
}

.best-calls__title {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.best-calls__title-bar {
  width: 0.35rem;
  height: 1.9rem;
  border-radius: 999px;
  background: var(--primary);
}

.best-calls__action {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border: 0;
  background: transparent;
  color: var(--primary);
  font-weight: 800;
  cursor: pointer;
}

/* ─── Responsive ────────────────────────────────────────────────── */
@media (max-width: 960px) {
  .mgr-metrics, .mgr-skeleton-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 860px) {
  .mgr-hero {
    align-items: stretch;
    flex-direction: column;
  }
}

@media (max-width: 560px) {
  .mgr-metrics, .mgr-skeleton-grid {
    grid-template-columns: 1fr;
  }
}
</style>
