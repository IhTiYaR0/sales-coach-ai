<script setup>
import { computed } from 'vue'

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  },
  activePage: {
    type: String,
    default: 'home',
  },
  currentRole: {
    type: String,
    default: 'manager',
  },
})

defineEmits(['close', 'navigate'])

const navItems = computed(() => {
  const items = []

  if (props.currentRole === 'leader') {
    items.push(
      { label: 'Аналитика', icon: 'analytics', page: 'leader' },
      { label: 'Команды', icon: 'groups', page: 'teams' },
    )
  } else {
    items.push(
      { label: 'Статистика', icon: 'dashboard', page: 'home' },
      { label: 'Звонки', icon: 'phone_in_talk', page: 'calls' },
    )
  }

  items.push({ label: 'Профиль', icon: 'account_circle', page: 'profile' })

  return items
})
</script>

<template>
  <aside class="sidebar" :class="{ 'sidebar--open': isOpen }">
    <div class="sidebar__brand">
      <div>
        <h1>CallAnalytics</h1>
        <p>SaaS 2.0 Платформа</p>
      </div>
      <button
        class="icon-button sidebar__close"
        type="button"
        aria-label="Закрыть меню"
        @click="$emit('close')"
      >
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>

    <nav class="sidebar__nav" aria-label="Основная навигация">
      <a
        v-for="item in navItems"
        :key="item.label"
        class="sidebar__link"
        :class="{ 'sidebar__link--active': activePage === item.page }"
        href="#"
        @click.prevent="$emit('navigate', item.page)"
      >
        <span class="material-symbols-outlined">{{ item.icon }}</span>
        <span>{{ item.label }}</span>
      </a>

      <a class="sidebar__link sidebar__settings" href="#">
        <span class="material-symbols-outlined">settings</span>
        <span>Настройки</span>
      </a>
    </nav>
  </aside>
</template>
