<script setup>
const appVersion = __APP_VERSION__
</script>

<template>
  <div class="version-page">
    <h1>App Version</h1>
    <p class="version">{{ appVersion }}</p>
  </div>
</template>

<style scoped>
.version-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  background: #1a1a2e;
  color: #fff;
  font-family: monospace;
}
h1 {
  font-size: 24px;
  margin-bottom: 16px;
}
.version {
  font-size: 20px;
  color: #0ff;
}
</style>
