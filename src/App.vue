<script setup>
import { ref } from 'vue'
import AppHeader from './components/AppHeader.vue'
import AppSidebar from './components/AppSidebar.vue'
import HomePage from './pages/HomePage.vue'

const isSidebarOpen = ref(false)
</script>

<template>
  <div class="app-shell">
    <div
      v-if="isSidebarOpen"
      class="mobile-overlay"
      aria-hidden="true"
      @click="isSidebarOpen = false"
    ></div>

    <AppSidebar :is-open="isSidebarOpen" @close="isSidebarOpen = false" />

    <div class="workspace">
      <AppHeader @open-sidebar="isSidebarOpen = true" />

      <main class="content">
        <HomePage />
      </main>
    </div>
  </div>
</template>
