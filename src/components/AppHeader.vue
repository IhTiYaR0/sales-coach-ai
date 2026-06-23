<script setup>
defineEmits(['open-sidebar'])
</script>

<template>
  <header class="topbar">
    <button
      class="icon-button topbar__menu"
      type="button"
      aria-label="Открыть меню"
      @click="$emit('open-sidebar')"
    >
      <span class="material-symbols-outlined">menu</span>
    </button>

    <div class="search">
      <span class="material-symbols-outlined">search</span>
      <input placeholder="Поиск по звонкам..." type="text" />
    </div>

    <div class="topbar__actions">
      <button class="icon-button notification" type="button" aria-label="Уведомления">
        <span class="material-symbols-outlined">notifications</span>
        <span class="notification__dot"></span>
      </button>

      <div class="profile" role="button" tabindex="0">
        <div class="profile__text">
          <p>Артем Волков</p>
          <span>Team Lead</span>
        </div>
        <img
          alt="Артем Волков"
          src="https://lh3.googleusercontent.com/aida-public/AB6AXuBr9Kh0cjflqURtyhcA4p554xoUaXmCewmQgEwg2RMPORXP3u-ULtbomssHhB0eQDRgIJaIcN8lvaXmRF8KwRdMQ-EQhD7t66KI2FM2XVyO-5yKhIp7cvxEoxkWkpDUBZg7agyU2Qsfhghf57EJx16BGy2Xy0mVYXuWgb8g2mt64xtVoOBYVuVJ-ifh2P1C2Yj0E2Cn0S29t_Ro062pu24zpS7Uu-8Igq8m7tenA2v-x6_LzlCEwbpN9MdpQeb963ZbOsgM8uN3BdiO"
        />
      </div>
    </div>
  </header>
</template>
