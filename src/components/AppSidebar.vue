<script setup>
defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  },
})

defineEmits(['close'])

const navItems = [
  { label: 'Главное', icon: 'dashboard', active: true },
  { label: 'Мои звонки', icon: 'phone_in_talk' },
]
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
        :class="{ 'sidebar__link--active': item.active }"
        href="#"
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
