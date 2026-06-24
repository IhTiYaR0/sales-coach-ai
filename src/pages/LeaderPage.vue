<script setup>
import { computed, onMounted, ref } from 'vue'

const analytics = ref(null)
const team = ref(null)
const loading = ref(true)
const refreshing = ref(false)
const error = ref(null)

function extractTeam(data) {
  if (Array.isArray(data)) return data[0] || null
  if (!data || typeof data !== 'object') return null

  if (getTeamId(data)) return data

  for (const key of ['team', 'my_team', 'managed_team', 'leader_team', 'data', 'result', 'item']) {
    if (Array.isArray(data[key])) return data[key][0] || null
    if (data[key] && typeof data[key] === 'object') return extractTeam(data[key])
  }

  return data
}

function getTeamId(teamData) {
  if (!teamData || typeof teamData !== 'object') return null

  return (
    teamData.id ??
    teamData.team_id ??
    teamData._id ??
    teamData.teamId ??
    teamData.team?.id ??
    teamData.team?.team_id ??
    teamData.data?.id ??
    teamData.data?.team_id ??
    null
  )
}

function clampPercent(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.min(Math.max(Math.round(number), 0), 100)
}

function asList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : []
}

function scoreTone(score) {
  const value = Number(score)
  if (value >= 80) return 'good'
  if (value >= 60) return 'warning'
  return 'danger'
}

async function fetchJson(url, message) {
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(message || `HTTP ${response.status}`)
  }

  return response.json()
}

async function loadLeaderAnalytics({ silent = false } = {}) {
  error.value = null
  if (silent) {
    refreshing.value = true
  } else {
    loading.value = true
  }

  try {
    const myTeam = extractTeam(await fetchJson('/teams/my', 'Не удалось загрузить вашу команду'))
    const teamId = getTeamId(myTeam)

    if (!teamId) {
      throw new Error('Сервер не вернул id команды руководителя')
    }

    team.value = myTeam
    analytics.value = await fetchJson(
      `/calls/analytics/team/${teamId}`,
      'Не удалось загрузить аналитику команды',
    )
  } catch (err) {
    console.error(err)
    error.value = err.message || 'Ошибка при загрузке данных'
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

const teamName = computed(() => team.value?.name || team.value?.title || 'Моя команда')
const avgScore = computed(() => clampPercent(analytics.value?.team_avg_score))
const dealProbability = computed(() => clampPercent(analytics.value?.team_avg_deal_probability))
const totalCalls = computed(() => Number(analytics.value?.total_calls ?? 0))
const topManagers = computed(() => asList(analytics.value?.top_managers))
const weakManagers = computed(() => asList(analytics.value?.weak_managers))
const teamProblems = computed(() => asList(analytics.value?.team_problems))
const dealLossReasons = computed(() => asList(analytics.value?.deal_loss_reasons))
const processRecommendations = computed(() => asList(analytics.value?.process_recommendations))
const summary = computed(() => analytics.value?.summary || 'Заключение по команде пока не сформировано.')

const metrics = computed(() => [
  {
    title: 'Средний балл команды',
    value: avgScore.value,
    suffix: '/ 100',
    icon: 'leaderboard',
    note: avgScore.value >= 70 ? 'Команда держит рабочий уровень' : 'Нужен фокус на качестве звонков',
    progress: avgScore.value,
  },
  {
    title: 'Вероятность сделки',
    value: dealProbability.value,
    suffix: '%',
    icon: 'trending_up',
    note: dealProbability.value >= 60 ? 'Хорошая база для роста продаж' : 'Стоит усилить закрытие сделки',
    progress: dealProbability.value,
  },
  {
    title: 'Всего звонков',
    value: totalCalls.value,
    suffix: '',
    icon: 'call',
    note: 'По команде руководителя',
    progress: Math.min(totalCalls.value * 12, 100),
  },
])

onMounted(() => {
  loadLeaderAnalytics()
})
</script>

<template>
  <section class="dashboard-page leader-page">
    <header class="leader-hero">
      <div class="leader-hero__left">
        <div class="leader-hero__badge">
          <span class="material-symbols-outlined">shield_person</span>
          Руководитель
        </div>
        <h2 class="leader-hero__title">Аналитика команды</h2>
        <p class="leader-hero__sub">
          Сводка по команде: качество звонков, вероятность сделки, сильные менеджеры, зоны риска и рекомендации.
        </p>
      </div>
      <button
        class="leader-refresh"
        type="button"
        :disabled="loading || refreshing"
        title="Обновить аналитику"
        @click="loadLeaderAnalytics({ silent: true })"
      >
        <span class="material-symbols-outlined" :class="{ 'spin-animation': refreshing }">refresh</span>
        Обновить
      </button>
    </header>

    <template v-if="loading">
      <div class="leader-skeleton-grid">
        <article v-for="n in 3" :key="n" class="skeleton-card">
          <div class="skeleton-avatar"></div>
          <div class="skeleton-content">
            <div class="skeleton-line skeleton-line--title"></div>
            <div class="skeleton-line skeleton-line--text"></div>
          </div>
        </article>
      </div>
      <section class="dashboard-card leader-skeleton-panel">
        <div class="skeleton-line skeleton-line--title"></div>
        <div class="skeleton-line skeleton-line--text"></div>
        <div class="skeleton-line skeleton-line--text"></div>
      </section>
    </template>

    <div v-else-if="error" class="teams-state-card teams-state-card--error">
      <span class="material-symbols-outlined teams-state-icon">wifi_off</span>
      <h3>Не удалось загрузить аналитику</h3>
      <p>{{ error }}</p>
      <button class="primary-button" type="button" @click="loadLeaderAnalytics()">
        Повторить
      </button>
    </div>

    <template v-else-if="analytics">
      <section class="leader-team-strip">
        <div class="leader-team-strip__avatar">
          <span class="material-symbols-outlined">groups</span>
        </div>
        <div class="leader-team-strip__info">
          <span class="leader-team-strip__label">Команда</span>
          <strong class="leader-team-strip__name">{{ teamName }}</strong>
        </div>
        <div class="leader-team-strip__divider"></div>
        <div class="leader-team-strip__info">
          <span class="leader-team-strip__label">ID команды</span>
          <strong class="leader-team-strip__name leader-team-strip__id">{{ getTeamId(team) }}</strong>
        </div>
      </section>

      <div class="metrics-grid">
        <article v-for="metric in metrics" :key="metric.title" class="metric-card leader-metric">
          <div class="metric-card__top">
            <div>
              <p>{{ metric.title }}</p>
              <strong>{{ metric.value }} <span>{{ metric.suffix }}</span></strong>
            </div>
            <span class="metric-card__icon material-symbols-outlined">{{ metric.icon }}</span>
          </div>
          <div class="metric-card__note">{{ metric.note }}</div>
          <div class="metric-progress">
            <span :style="{ width: `${metric.progress}%` }"></span>
          </div>
        </article>
      </div>

      <div class="leader-mid-row">
        <section class="dashboard-card leader-analytics-bar">
          <div class="leader-section-header">
            <div class="leader-section-icon">
              <span class="material-symbols-outlined">pulse_alert</span>
            </div>
            <div>
              <h3>Пульс команды</h3>
              <p>Качество звонков и вероятность сделки</p>
            </div>
          </div>

          <div class="leader-bars">
            <div class="leader-bar">
              <div class="leader-bar__head">
                <span>Средний балл</span>
                <strong :class="`score-chip score-chip--${scoreTone(avgScore)}`">{{ avgScore }}%</strong>
              </div>
              <div class="leader-bar__track">
                <span :class="`leader-bar__fill leader-bar__fill--${scoreTone(avgScore)}`" :style="{ width: `${avgScore}%` }"></span>
              </div>
            </div>

            <div class="leader-bar">
              <div class="leader-bar__head">
                <span>Вероятность сделки</span>
                <strong :class="`score-chip score-chip--${scoreTone(dealProbability)}`">{{ dealProbability }}%</strong>
              </div>
              <div class="leader-bar__track">
                <span :class="`leader-bar__fill leader-bar__fill--${scoreTone(dealProbability)}`" :style="{ width: `${dealProbability}%` }"></span>
              </div>
            </div>
          </div>
        </section>

        <section class="dashboard-card leader-summary">
          <div class="leader-summary__icon">
            <span class="material-symbols-outlined">auto_awesome</span>
          </div>
          <div>
            <h3>Краткое заключение</h3>
            <p>{{ summary }}</p>
          </div>
        </section>
      </div>

      <section class="leader-managers-grid">
        <article class="dashboard-card leader-manager-card">
          <div class="leader-card-title leader-card-title--good">
            <div class="leader-card-title__icon leader-card-title__icon--good">
              <span class="material-symbols-outlined">workspace_premium</span>
            </div>
            <h3>Топ-менеджеры</h3>
          </div>
          <div v-if="topManagers.length" class="leader-manager-list">
            <div v-for="(manager, i) in topManagers" :key="manager.name" class="leader-manager">
              <div class="leader-manager__rank">{{ i + 1 }}</div>
              <div class="leader-manager__score">
                <strong>{{ manager.avg_score }}</strong>
                <span>/100</span>
              </div>
              <div class="leader-manager__body">
                <h4>{{ manager.name }}</h4>
                <p>{{ manager.comment }}</p>
              </div>
            </div>
          </div>
          <p v-else class="leader-empty">Данных по топ-менеджерам пока нет.</p>
        </article>

        <article class="dashboard-card leader-manager-card">
          <div class="leader-card-title leader-card-title--risk">
            <div class="leader-card-title__icon leader-card-title__icon--risk">
              <span class="material-symbols-outlined">priority_high</span>
            </div>
            <h3>Зоны внимания</h3>
          </div>
          <div v-if="weakManagers.length" class="leader-manager-list">
            <div v-for="manager in weakManagers" :key="manager.name" class="leader-manager">
              <div class="leader-manager__rank leader-manager__rank--risk">!</div>
              <div class="leader-manager__score leader-manager__score--risk">
                <strong>{{ manager.avg_score }}</strong>
                <span>/100</span>
              </div>
              <div class="leader-manager__body">
                <h4>{{ manager.name }}</h4>
                <p>{{ manager.comment }}</p>
              </div>
            </div>
          </div>
          <p v-else class="leader-empty">Критичных зон по менеджерам пока нет.</p>
        </article>
      </section>

      <section class="leader-insights-grid">
        <article class="dashboard-card leader-insight leader-insight--problem">
          <div class="leader-card-title">
            <div class="leader-card-title__icon leader-card-title__icon--problem">
              <span class="material-symbols-outlined">report</span>
            </div>
            <h3>Проблемы команды</h3>
          </div>
          <ul class="leader-insight__list">
            <li v-for="item in teamProblems" :key="item">{{ item }}</li>
          </ul>
          <p v-if="!teamProblems.length" class="leader-empty">Проблемы не обнаружены.</p>
        </article>

        <article class="dashboard-card leader-insight leader-insight--loss">
          <div class="leader-card-title">
            <div class="leader-card-title__icon leader-card-title__icon--loss">
              <span class="material-symbols-outlined">leak_remove</span>
            </div>
            <h3>Причины потери сделок</h3>
          </div>
          <ul class="leader-insight__list">
            <li v-for="item in dealLossReasons" :key="item">{{ item }}</li>
          </ul>
          <p v-if="!dealLossReasons.length" class="leader-empty">Причины потерь пока не определены.</p>
        </article>

        <article class="dashboard-card leader-insight leader-insight--recommendation">
          <div class="leader-card-title">
            <div class="leader-card-title__icon leader-card-title__icon--rec">
              <span class="material-symbols-outlined">tips_and_updates</span>
            </div>
            <h3>Рекомендации</h3>
          </div>
          <ul class="leader-insight__list">
            <li v-for="item in processRecommendations" :key="item">{{ item }}</li>
          </ul>
          <p v-if="!processRecommendations.length" class="leader-empty">Рекомендации пока не сформированы.</p>
        </article>
      </section>
    </template>
  </section>
</template>

<style scoped>
/* ── Page ─────────────────────────────────────────────────── */
.leader-page {
  display: grid;
  gap: 1.25rem;
  padding-bottom: 2rem;
}

/* ── Hero ─────────────────────────────────────────────────── */
.leader-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
  padding: clamp(1.5rem, 3vw, 2rem) clamp(1.5rem, 3vw, 2rem);
  border-radius: 1.25rem;
  background: linear-gradient(135deg, rgba(47, 111, 237, 0.07) 0%, rgba(47, 111, 237, 0.02) 100%);
  border: 1px solid rgba(47, 111, 237, 0.14);
}

.leader-hero__badge {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.35rem 0.85rem 0.35rem 0.55rem;
  border-radius: 999px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 0.72rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 0.9rem;
}

.leader-hero__badge .material-symbols-outlined {
  font-size: 1rem;
}

.leader-hero__title {
  margin: 0 0 0.5rem;
  font-size: clamp(1.6rem, 3.5vw, 2.1rem);
  font-weight: 900;
  color: var(--on-surface);
  line-height: 1.1;
}

.leader-hero__sub {
  margin: 0;
  color: var(--secondary);
  line-height: 1.6;
  max-width: 42rem;
  font-size: 0.97rem;
}

/* ── Refresh button ───────────────────────────────────────── */
.leader-refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  min-height: 2.6rem;
  flex: 0 0 auto;
  border: 1px solid var(--outline);
  border-radius: 0.65rem;
  background: var(--surface-raised);
  color: var(--on-surface);
  padding: 0 1.1rem;
  font-weight: 800;
  font-size: 0.9rem;
  transition: border-color 160ms ease, color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
}

.leader-refresh:hover:not(:disabled) {
  border-color: rgba(47, 111, 237, 0.45);
  color: var(--primary);
  box-shadow: 0 6px 18px rgba(47, 111, 237, 0.1);
  transform: translateY(-1px);
}

.leader-refresh:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

/* ── Skeletons ────────────────────────────────────────────── */
.leader-skeleton-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}

.leader-skeleton-panel {
  display: grid;
  gap: 1rem;
  padding: 1.5rem;
}

/* ── Team strip ───────────────────────────────────────────── */
.leader-team-strip {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  padding: 1rem 1.35rem;
  border: 1px solid var(--outline);
  border-radius: 0.9rem;
  background: var(--surface-raised);
  box-shadow: 0 2px 10px rgba(23, 32, 51, 0.04);
}

.leader-team-strip__avatar {
  display: grid;
  place-items: center;
  width: 2.6rem;
  height: 2.6rem;
  border-radius: 0.65rem;
  background: var(--primary-soft);
  color: var(--primary);
  flex: 0 0 auto;
}

.leader-team-strip__divider {
  width: 1px;
  height: 2rem;
  background: var(--outline);
  flex: 0 0 auto;
}

.leader-team-strip__info {
  display: grid;
  gap: 0.2rem;
}

.leader-team-strip__label {
  color: var(--secondary);
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.leader-team-strip__name {
  color: var(--on-surface);
  font-size: 0.97rem;
  font-weight: 700;
}

.leader-team-strip__id {
  font-family: ui-monospace, 'Cascadia Code', monospace;
  font-size: 0.88rem;
  color: var(--secondary);
}

/* ── Metric cards ─────────────────────────────────────────── */
.leader-metric {
  transition: transform 160ms ease, box-shadow 160ms ease;
}

.leader-metric:hover {
  transform: translateY(-3px);
  box-shadow: 0 20px 40px rgba(23, 32, 51, 0.09);
}

/* ── Mid row: pulse + summary ─────────────────────────────── */
.leader-mid-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  align-items: start;
}

/* ── Analytics bar ────────────────────────────────────────── */
.leader-analytics-bar {
  padding: clamp(1.25rem, 3vw, 1.75rem);
  display: grid;
  gap: 1.5rem;
}

.leader-section-header {
  display: flex;
  align-items: flex-start;
  gap: 0.9rem;
}

.leader-section-icon {
  display: grid;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  flex: 0 0 auto;
  border-radius: 0.65rem;
  background: var(--primary-soft);
  color: var(--primary);
}

.leader-section-header h3,
.leader-section-header p {
  margin: 0;
}

.leader-section-header p {
  margin-top: 0.25rem;
  color: var(--secondary);
  font-size: 0.88rem;
}

.leader-bars {
  display: grid;
  gap: 1.25rem;
}

.leader-bar {
  display: grid;
  gap: 0.6rem;
}

.leader-bar__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  color: var(--secondary);
  font-size: 0.9rem;
  font-weight: 600;
}

.leader-bar__track {
  height: 0.65rem;
  overflow: hidden;
  border-radius: 999px;
  background: var(--surface-low);
}

.leader-bar__fill {
  display: block;
  height: 100%;
  min-width: 0.25rem;
  border-radius: inherit;
  transition: width 400ms cubic-bezier(0.4, 0, 0.2, 1);
}

.leader-bar__fill--good { background: linear-gradient(90deg, #16a34a, #22c55e); }
.leader-bar__fill--warning { background: linear-gradient(90deg, #d97706, #eab308); }
.leader-bar__fill--danger { background: linear-gradient(90deg, #dc2626, #ef4444); }

/* Score chip badges */
.score-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  font-size: 0.82rem;
  font-weight: 800;
}

.score-chip--good { background: #dcfce7; color: #15803d; }
.score-chip--warning { background: #fef9c3; color: #92400e; }
.score-chip--danger { background: #fee2e2; color: #b91c1c; }

/* ── Summary ──────────────────────────────────────────────── */
.leader-summary {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  padding: clamp(1.25rem, 3vw, 1.75rem);
}

.leader-summary__icon {
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  flex: 0 0 auto;
  border-radius: 0.65rem;
  background: var(--primary-soft);
  color: var(--primary);
}

.leader-summary h3 { margin: 0; }
.leader-summary p {
  margin: 0.45rem 0 0;
  color: var(--secondary);
  line-height: 1.65;
  font-size: 0.95rem;
}

/* ── Managers grid ────────────────────────────────────────── */
.leader-managers-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.leader-manager-card {
  display: grid;
  gap: 1.1rem;
  padding: clamp(1.25rem, 3vw, 1.5rem);
}

/* Card title with icon container */
.leader-card-title {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.leader-card-title h3 { margin: 0; font-size: 1rem; }

.leader-card-title__icon {
  display: grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 0.55rem;
  flex: 0 0 auto;
}

.leader-card-title__icon--good {
  background: #dcfce7;
  color: #16a34a;
}

.leader-card-title__icon--risk {
  background: #fee2e2;
  color: #dc2626;
}

.leader-card-title__icon--problem {
  background: #fee2e2;
  color: #dc2626;
}

.leader-card-title__icon--loss {
  background: #fff7ed;
  color: #c2410c;
}

.leader-card-title__icon--rec {
  background: #dcfce7;
  color: #16a34a;
}

.leader-manager-list {
  display: grid;
  gap: 0.75rem;
}

.leader-manager {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  gap: 0.9rem;
  align-items: center;
  padding: 0.9rem 1rem;
  border: 1px solid var(--outline);
  border-radius: 0.75rem;
  background: var(--surface-low);
  transition: background 160ms ease, border-color 160ms ease;
}

.leader-manager:hover {
  background: var(--surface-raised);
  border-color: var(--outline-strong);
}

/* Rank badge */
.leader-manager__rank {
  display: grid;
  place-items: center;
  width: 1.7rem;
  height: 1.7rem;
  border-radius: 999px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 0.78rem;
  font-weight: 900;
  flex: 0 0 auto;
}

.leader-manager__rank--risk {
  background: #fee2e2;
  color: #dc2626;
}

.leader-manager__score {
  display: grid;
  place-items: center;
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 0.65rem;
  background: #ecfdf5;
  color: #15803d;
  flex: 0 0 auto;
}

.leader-manager__score--risk {
  background: #fff7ed;
  color: #c2410c;
}

.leader-manager__score strong {
  font-size: 1.1rem;
  line-height: 1;
}

.leader-manager__score span {
  font-size: 0.65rem;
  font-weight: 800;
}

.leader-manager__body h4,
.leader-manager__body p {
  margin: 0;
}

.leader-manager__body h4 {
  color: var(--on-surface);
  font-size: 0.95rem;
}

.leader-manager__body p {
  margin-top: 0.3rem;
  color: var(--secondary);
  font-size: 0.88rem;
  line-height: 1.5;
}

/* ── Insights grid ────────────────────────────────────────── */
.leader-insights-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}

.leader-insight {
  display: grid;
  gap: 1rem;
  padding: clamp(1.25rem, 3vw, 1.5rem);
  border-top: 3px solid transparent;
}

.leader-insight--problem { border-top-color: #ef4444; }
.leader-insight--loss    { border-top-color: #f97316; }
.leader-insight--recommendation { border-top-color: #22c55e; }

.leader-insight__list {
  display: grid;
  gap: 0.6rem;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--secondary);
  line-height: 1.55;
  font-size: 0.93rem;
}

.leader-insight__list li {
  display: flex;
  gap: 0.6rem;
  align-items: flex-start;
}

.leader-insight__list li::before {
  content: '—';
  color: var(--outline-strong);
  flex: 0 0 auto;
  font-weight: 700;
}

.leader-empty {
  margin: 0;
  color: var(--secondary);
  font-size: 0.92rem;
  line-height: 1.55;
}

/* ── Responsive ───────────────────────────────────────────── */
@media (max-width: 1100px) {
  .leader-mid-row {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 960px) {
  .leader-skeleton-grid,
  .leader-insights-grid,
  .leader-managers-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 860px) {
  .leader-hero {
    flex-direction: column;
    align-items: flex-start;
  }

  .leader-refresh {
    align-self: flex-start;
  }
}

@media (max-width: 560px) {
  .leader-team-strip {
    flex-wrap: wrap;
  }

  .leader-manager {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .leader-manager__rank {
    display: none;
  }
}
</style>
