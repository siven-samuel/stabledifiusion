<script setup>
import { useRouter } from 'vue-router'

const router = useRouter()
const goEditor = () => {
  router.push('/editor')
}

const goGameplay = () => {
  router.push('/gameplay')
}

const goPlay = () => {
  router.push({ path: '/gameplay', query: { autoload: '1' } })
}
</script>

<template>
  <div class="home-page">
    <div class="home-content">
      <h1 class="home-title">Isometric City Builder</h1>
      <p class="home-subtitle">Create, build, and play your isometric world</p>

      <div class="home-buttons">
        <button class="home-btn play-btn" @click="goPlay">
          <span class="btn-icon">▶️</span>
          <span class="btn-label">Play</span>
          <span class="btn-desc">Load demo project and start gameplay</span>
        </button>

        <button class="home-btn gameplay-btn" @click="goGameplay">
          <span class="btn-icon">🎮</span>
          <span class="btn-label">Gameplay</span>
          <span class="btn-desc">Start empty gameplay mode</span>
        </button>

        <button class="home-btn editor-btn" @click="goEditor">
          <span class="btn-icon">🎨</span>
          <span class="btn-label">Editor</span>
          <span class="btn-desc">Open the building editor</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.home-page {
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%);
  position: relative;
  overflow: hidden;
}

.home-content {
  text-align: center;
  z-index: 1;
}

.home-title {
  font-size: 3rem;
  font-weight: 800;
  color: #fff;
  margin: 0 0 0.5rem 0;
  text-shadow: 0 4px 20px rgba(102, 126, 234, 0.5);
}

.home-subtitle {
  font-size: 1.2rem;
  color: rgba(255, 255, 255, 0.7);
  margin: 0 0 3rem 0;
}

.home-buttons {
  display: flex;
  gap: 2rem;
  justify-content: center;
  flex-wrap: wrap;
}

.home-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2rem 2.5rem;
  border: 2px solid rgba(255, 255, 255, 0.15);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(10px);
  cursor: pointer;
  transition: all 0.3s ease;
  min-width: 200px;
}

.home-btn:hover {
  transform: translateY(-6px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
}

.play-btn { border-color: rgba(76, 175, 80, 0.4); }
.play-btn:hover { background: rgba(76, 175, 80, 0.2); border-color: rgba(76, 175, 80, 0.8); }

.gameplay-btn { border-color: rgba(102, 126, 234, 0.4); }
.gameplay-btn:hover { background: rgba(102, 126, 234, 0.2); border-color: rgba(102, 126, 234, 0.8); }

.editor-btn { border-color: rgba(255, 152, 0, 0.4); }
.editor-btn:hover { background: rgba(255, 152, 0, 0.2); border-color: rgba(255, 152, 0, 0.8); }

.btn-icon {
  font-size: 3rem;
}

.btn-label {
  font-size: 1.4rem;
  font-weight: 700;
  color: #fff;
}

.btn-desc {
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.5);
  max-width: 180px;
}

</style>
