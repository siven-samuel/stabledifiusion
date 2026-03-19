<script setup>
const appVersion = __APP_VERSION__
</script>

<template>
  <router-view />
  <div class="app-version">v{{ appVersion }}</div>
</template>

<style>
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell,
    'Helvetica Neue', sans-serif;
  overflow: hidden;
}
.app-version {
  position: fixed;
  bottom: 4px;
  right: 8px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  pointer-events: none;
  z-index: 99999;
  font-family: monospace;
}
</style>
