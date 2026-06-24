<script setup>
import { computed, ref } from 'vue'

const activePeriod = ref('week')

const metrics = [
  {
    title: 'Средний балл команды',
    value: '4.7',
    suffix: '/ 5.0',
    icon: 'grade',
    note: '+0.4 к прошлому периоду',
    progress: 94,
  },
  {
    title: 'Конверсия продаж',
    value: '38.2%',
    suffix: '',
    icon: 'rocket_launch',
    note: 'Цель отдела: 40%',
    progress: 76,
  },
  {
    title: 'Всего звонков',
    value: '3,842',
    suffix: '',
    icon: 'call',
    note: '+18% по всем командам',
    progress: 82,
  },
]

const chartData = {
  week: [
    { label: 'Пн', calls: 52 },
    { label: 'Вт', calls: 68 },
    { label: 'Ср', calls: 91, active: true, value: '428 звонков' },
    { label: 'Чт', calls: 64 },
    { label: 'Пт', calls: 78 },
    { label: 'Сб', calls: 42 },
    { label: 'Вс', calls: 34 },
  ],
  month: [
    { label: '1', calls: 48 },
    { label: '2', calls: 73 },
    { label: '3', calls: 66 },
    { label: '4', calls: 88, active: true, value: '1,640 звонков' },
    { label: '5', calls: 76 },
    { label: '6', calls: 58 },
    { label: '7', calls: 69 },
  ],
  year: [
    { label: 'Янв', calls: 64 },
    { label: 'Фев', calls: 58 },
    { label: 'Мар', calls: 72 },
    { label: 'Апр', calls: 94, active: true, value: '18,420 звонков' },
    { label: 'Май', calls: 70 },
    { label: 'Июн', calls: 82 },
    { label: 'Июл', calls: 76 },
  ],
}

const teamCalls = [
  {
    initials: 'ОП',
    name: 'Отдел продаж',
    client: 'Артем Волков',
    duration: '428 звонков',
    score: '4.9',
    icon: 'trending_up',
  },
  {
    initials: 'VIP',
    name: 'VIP-департамент',
    client: 'Игорь Петров',
    duration: '214 звонков',
    score: '4.8',
    icon: 'workspace_premium',
  },
  {
    initials: 'СП',
    name: 'Служба поддержки',
    client: 'Дмитрий Волков',
    duration: '512 звонков',
    score: '4.5',
    icon: 'support_agent',
  },
]

const activeChart = computed(() => chartData[activePeriod.value])
</script>

<template>
  <section class="dashboard-page">
    <header class="dashboard-hero">
      <div>
        <div class="live-label">
          <span></span>
          Live Analytics
        </div>
        <h2>Продуктивность продаж</h2>
        <p>
          Общая аналитика по всем командам и менеджерам: качество звонков, конверсия,
          активность отдела и точки роста для руководителя.
        </p>
      </div>

      <div class="period-switch" aria-label="Период аналитики">
        <button
          v-for="period in ['week', 'month', 'year']"
          :key="period"
          type="button"
          :class="{ 'period-switch__button--active': activePeriod === period }"
          @click="activePeriod = period"
        >
          {{ period === 'week' ? 'Неделя' : period === 'month' ? 'Месяц' : 'Год' }}
        </button>
      </div>
    </header>

    <div class="metrics-grid">
      <article v-for="metric in metrics" :key="metric.title" class="metric-card">
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

    <section class="dashboard-card chart-card">
      <div class="section-title-row">
        <div>
          <h3>Тренд продаж</h3>
          <p>Динамика звонков и сделок по всем менеджерам за выбранный период</p>
        </div>
        <div class="chart-legend">
          <span><i></i> Звонки</span>
          <span><i></i> Сделки</span>
        </div>
      </div>

      <div class="bar-chart">
        <div v-for="bar in activeChart" :key="bar.label" class="bar-chart__item">
          <div class="bar-chart__track">
            <span v-if="bar.active" class="bar-chart__tooltip">{{ bar.value }}</span>
            <div
              class="bar-chart__bar"
              :class="{ 'bar-chart__bar--active': bar.active }"
              :style="{ height: `${bar.calls}%` }"
            ></div>
          </div>
          <span class="bar-chart__label" :class="{ 'bar-chart__label--active': bar.active }">
            {{ bar.label }}
          </span>
        </div>
      </div>
    </section>

    <section class="best-calls">
      <div class="section-title-row">
        <div class="best-calls__title">
          <span></span>
          <h3>Звонки по командам</h3>
        </div>
      </div>

      <div class="best-call-list">
        <article v-for="call in teamCalls" :key="call.name" class="best-call">
          <div class="best-call__person">
            <div class="best-call__avatar">
              {{ call.initials }}
              <span class="material-symbols-outlined">{{ call.icon }}</span>
            </div>
            <div>
              <h4>{{ call.name }}</h4>
              <p>Ответственный: {{ call.client }}</p>
            </div>
          </div>

          <div class="best-call__meta">
            <div>
              <span>Активность</span>
              <strong>{{ call.duration }}</strong>
            </div>
            <div>
              <span>Средний балл</span>
              <strong>{{ call.score }}</strong>
            </div>
          </div>

          <button class="best-call__play" type="button" aria-label="Открыть команду">
            <span class="material-symbols-outlined">chevron_right</span>
          </button>
        </article>
      </div>
    </section>
  </section>
</template>
