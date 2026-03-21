<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'

const AUTOSAVE_DB = 'isometric-autosave-db'
const AUTOSAVE_STORE = 'saves'
const AUTOSAVE_KEY = 'isometric-game-autosave'

const router = useRouter()
const hasSavedGame = ref(false)

const checkSavedGame = async () => {
  try {
    // Quick check via localStorage flag first
    if (localStorage.getItem(AUTOSAVE_KEY + '-exists') === '1') {
      hasSavedGame.value = true
      return
    }
    // Fallback: check IndexedDB directly
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(AUTOSAVE_DB, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(AUTOSAVE_STORE)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const data = await new Promise((resolve, reject) => {
      const tx = db.transaction(AUTOSAVE_STORE, 'readonly')
      const req = tx.objectStore(AUTOSAVE_STORE).get(AUTOSAVE_KEY)
      req.onsuccess = () => { db.close(); resolve(req.result || null) }
      req.onerror = () => { db.close(); reject(req.error) }
    })
    hasSavedGame.value = !!(data && data.images && data.images.length > 0)
  } catch {
    hasSavedGame.value = false
  }
}

onMounted(() => {
  checkSavedGame()
})

const goEditor = () => {
  router.push('/editor')
}

const goGameplay = () => {
  router.push('/gameplay')
}

const goPlay = () => {
  router.push({ path: '/gameplay', query: { autoload: '1' } })
}

const goLoadLastGame = () => {
  router.push({ path: '/gameplay', query: { restore: '1' } })
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

        <button v-if="hasSavedGame" class="home-btn load-btn" @click="goLoadLastGame">
          <span class="btn-icon">💾</span>
          <span class="btn-label">Load Last Game</span>
          <span class="btn-desc">Continue where you left off</span>
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

.load-btn { border-color: rgba(233, 30, 99, 0.4); }
.load-btn:hover { background: rgba(233, 30, 99, 0.2); border-color: rgba(233, 30, 99, 0.8); }

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
