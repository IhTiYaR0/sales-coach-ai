<script setup>
import { computed, onMounted, ref } from 'vue'
import AppHeader from './components/AppHeader.vue'
import AppSidebar from './components/AppSidebar.vue'
import HomePage from './pages/HomePage.vue'
import LoginPage from './pages/LoginPage.vue'
import MyCallsPage from './pages/MyCallsPage.vue'
import ProfilePage from './pages/ProfilePage.vue'
import RegisterPage from './pages/RegisterPage.vue'
import SupervisorPage from './pages/SupervisorPage.vue'
import LeaderPage from './pages/LeaderPage.vue'
import TeamsPage from './pages/TeamsPage.vue'

const isSidebarOpen = ref(false)

function getStoredValue(key) {
  return window.localStorage.getItem(key) ?? sessionStorage.getItem(key)
}

function setStoredValue(key, value) {
  window.localStorage.setItem(key, value)
  sessionStorage.setItem(key, value)
}

function removeStoredValue(key) {
  window.localStorage.removeItem(key)
  sessionStorage.removeItem(key)
}

const activePage = ref(getStoredValue('callanalytics-active-page') || 'home')
const authPage = ref(getStoredValue('callanalytics-auth-page') || 'login')
const isAuthenticated = ref(getStoredValue('callanalytics-authenticated') === 'true')
const currentRole = ref(normalizeRole(getStoredValue('callanalytics-role') || 'manager'))
const currentUser = ref(readStoredUser() || createFallbackUser())

const isLeader = computed(() => currentRole.value === 'leader')
const userId = computed(() => currentUser.value?.user_id || currentUser.value?.id)

function readStoredUser() {
  try {
    const json = getStoredValue('callanalytics-user')
    const user = JSON.parse(json) || null

    return user
      ? {
          ...user,
          role: normalizeRole(user.role),
        }
      : null
  } catch {
    return null
  }
}

function createFallbackUser(email = '') {
  const name = email ? email.split('@')[0] : 'Пользователь'

  return {
    name,
    email,
    role: currentRole.value,
  }
}

function normalizeRole(role) {
  const normalizedRole = String(role || '').toLowerCase()

  if (['leader', 'admin', 'supervisor', 'руководитель'].includes(normalizedRole)) {
    return 'leader'
  }

  return 'manager'
}

function normalizeUser(user = {}) {
  const email = user.email || ''
  return {
    ...createFallbackUser(email),
    ...user,
    id: user.id ?? user.user_id,
    role: normalizeRole(user.role),
  }
}

function saveUser(user) {
  const normalizedUser = normalizeUser(user)

  currentRole.value = normalizedUser.role
  currentUser.value = normalizedUser
  setStoredValue('callanalytics-role', currentRole.value)
  setStoredValue('callanalytics-user', JSON.stringify(normalizedUser))
}

function extractUserArray(data) {
  if (Array.isArray(data)) return data
  if (!data || typeof data !== 'object') return []

  for (const key of ['users', 'data', 'results', 'items']) {
    if (Array.isArray(data[key])) return data[key]
  }

  return []
}

async function loadUsers() {
  const response = await fetch('/users', {
    method: 'GET',
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(response.statusText || 'Не удалось загрузить профиль')
  }

  return extractUserArray(await response.json())
}

async function loadUserByEmail(email) {
  if (!email) return null

  const users = await loadUsers()
  const normalizedEmail = email.trim().toLowerCase()

  return users.find((user) => String(user.email || '').trim().toLowerCase() === normalizedEmail) || null
}

async function refreshUserProfile(user = currentUser.value) {
  if (!user?.email) return user

  try {
    const freshUser = await loadUserByEmail(user.email)
    const normalizedUser = normalizeUser({
      ...user,
      ...(freshUser || {}),
    })
    saveUser(normalizedUser)
    return normalizedUser
  } catch {
    saveUser(user)
    return user
  }
}

function setActivePage(page) {
  if (page === 'leader' && !isLeader.value) {
    activePage.value = 'home'
    setStoredValue('callanalytics-active-page', 'home')
    isSidebarOpen.value = false
    return
  }

  if (['home', 'calls'].includes(page) && isLeader.value) {
    activePage.value = 'leader'
    setStoredValue('callanalytics-active-page', 'leader')
    isSidebarOpen.value = false
    return
  }

  activePage.value = page
  setStoredValue('callanalytics-active-page', page)
  isSidebarOpen.value = false
}

async function handleLoginSuccess(userData = {}) {
  const responseUser = {
    email: userData.email,
    ...(userData.user || userData),
  }
  const user = normalizeUser(responseUser)

  isAuthenticated.value = true
  setStoredValue('callanalytics-authenticated', 'true')
  saveUser(user)
  const freshUser = await refreshUserProfile(user)
  const initialPage = freshUser?.role === 'leader' ? 'leader' : 'home'
  activePage.value = initialPage
  setStoredValue('callanalytics-active-page', initialPage)
}

function showLoginPage() {
  authPage.value = 'login'
  setStoredValue('callanalytics-auth-page', 'login')
}

function showRegisterPage() {
  authPage.value = 'register'
  setStoredValue('callanalytics-auth-page', 'register')
}

function logout() {
  isAuthenticated.value = false
  currentRole.value = 'manager'
  currentUser.value = null
  activePage.value = 'home'
  authPage.value = 'login'
  removeStoredValue('callanalytics-authenticated')
  removeStoredValue('callanalytics-role')
  removeStoredValue('callanalytics-user')
  removeStoredValue('callanalytics-active-page')
  removeStoredValue('callanalytics-auth-page')
}

onMounted(() => {
  if (isAuthenticated.value) {
    if (isLeader.value && ['home', 'calls'].includes(activePage.value)) {
      setActivePage('leader')
    }

    refreshUserProfile()
  }
})
</script>

<template>
  <template v-if="!isAuthenticated">
    <LoginPage
      v-if="authPage === 'login'"
      @login-success="handleLoginSuccess"
      @show-register="showRegisterPage"
    />
    <RegisterPage
      v-else
      @register-success="showLoginPage"
      @show-login="showLoginPage"
    />
  </template>

  <div v-else class="app-shell">
    <div
      v-if="isSidebarOpen"
      class="mobile-overlay"
      aria-hidden="true"
      @click="isSidebarOpen = false"
    ></div>

    <AppSidebar
      :active-page="activePage"
      :current-role="currentRole"
      :is-open="isSidebarOpen"
      @close="isSidebarOpen = false"
      @navigate="setActivePage"
    />

    <div class="workspace">
      <AppHeader
        :current-user="currentUser"
        @open-sidebar="isSidebarOpen = true"
        @open-profile="setActivePage('profile')"
      />

      <main class="content">
        <HomePage v-if="activePage === 'home' && currentRole === 'manager'" @navigate="setActivePage" />
        <MyCallsPage v-else-if="activePage === 'calls' && currentRole === 'manager'" />
        <LeaderPage v-else-if="activePage === 'leader' && isLeader" />
        <TeamsPage
          v-else-if="activePage === 'teams' && isLeader"
          :current-user="currentUser"
        />
        <ProfilePage
          v-else-if="activePage === 'profile'"
          :current-user="currentUser"
          @logout="logout"
        />
        <HomePage v-else @navigate="setActivePage" />
      </main>
    </div>
  </div>
</template>
