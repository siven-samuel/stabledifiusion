<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { db } from './firebase'
import { collection, getDocs, addDoc, deleteDoc, doc } from 'firebase/firestore'

const router = useRouter()
const scores = ref([])
const loading = ref(true)
const saving = ref(false)
const error = ref('')

const newEntry = ref({ name: '', score: 0, level: '' })
const showForm = ref(false)

const scoresCollection = collection(db, 'scoreboard')

const loadScores = async () => {
  loading.value = true
  error.value = ''
  try {
    console.log('Fetching scores...')
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Firestore timeout - make sure Firestore Database is created in Firebase Console')), 8000)
    )
    const snapshot = await Promise.race([getDocs(scoresCollection), timeout])
    console.log('Got scores:', snapshot.size)
    scores.value = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.score || 0) - (a.score || 0))
  } catch (e) {
    error.value = e.message
    console.error('loadScores error:', e)
  } finally {
    loading.value = false
  }
}

const addScore = async () => {
  if (!newEntry.value.name.trim()) return
  saving.value = true
  error.value = ''
  try {
    console.log('Adding score...', newEntry.value)
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Write timeout - check Firestore rules: allow read, write: if true;')), 8000)
    )
    const docRef = await Promise.race([
      addDoc(scoresCollection, {
        name: newEntry.value.name.trim(),
        score: Number(newEntry.value.score),
        level: newEntry.value.level.trim(),
        date: new Date().toISOString()
      }),
      timeout
    ])
    console.log('Score added with ID:', docRef.id)
    newEntry.value = { name: '', score: 0, level: '' }
    showForm.value = false
    await loadScores()
  } catch (e) {
    error.value = 'Failed to add score: ' + e.message
    console.error('addScore error:', e)
    alert('Error saving score: ' + e.message)
  } finally {
    saving.value = false
  }
}

const removeScore = async (id) => {
  if (!confirm('Remove this score entry?')) return
  try {
    await deleteDoc(doc(db, 'scoreboard', id))
    await loadScores()
  } catch (e) {
    error.value = 'Failed to remove score: ' + e.message
    console.error('removeScore error:', e)
  }
}

onMounted(loadScores)
</script>

<template>
  <div class="scoreboard-page">
    <div class="scoreboard-content">
    <header class="scoreboard-header">
      <button class="back-btn" @click="router.push('/')">← Back</button>
      <h1>Scoreboard</h1>
      <button class="add-btn" @click="showForm = !showForm">
        {{ showForm ? 'Cancel' : '+ Add Score' }}
      </button>
    </header>

    <div v-if="showForm" class="add-form">
      <input v-model="newEntry.name" placeholder="Player name" class="form-input" />
      <input v-model.number="newEntry.score" type="number" placeholder="Score" class="form-input" />
      <input v-model="newEntry.level" placeholder="Level (optional)" class="form-input" />
      <button class="submit-btn" @click="addScore" :disabled="saving">
        {{ saving ? 'Saving...' : 'Save' }}
      </button>
    </div>

    <div v-if="error" class="error-msg">{{ error }}</div>

    <div v-if="loading" class="loading">Loading scores...</div>

    <table v-else-if="scores.length" class="score-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Player</th>
          <th>Score</th>
          <th>Level</th>
          <th>Date</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(entry, i) in scores" :key="entry.id">
          <td class="rank">{{ i + 1 }}</td>
          <td>{{ entry.name }}</td>
          <td class="score-val">{{ entry.score }}</td>
          <td>{{ entry.level || '—' }}</td>
          <td class="date">{{ entry.date ? new Date(entry.date).toLocaleDateString() : '—' }}</td>
          <td>
            <button class="remove-btn" @click="removeScore(entry.id)" title="Remove">✕</button>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-else class="empty">No scores yet. Add one!</div>
    </div>
  </div>
</template>

<style scoped>
.scoreboard-page {
  position: fixed;
  inset: 0;
  overflow-y: auto;
  padding: 0 16px 24px;
  font-family: 'Segoe UI', sans-serif;
  color: #e0e0e0;
  background: #1a1a2e;
}

.scoreboard-content {
  max-width: 700px;
  margin: 0 auto;
}

.scoreboard-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 0;
  margin-bottom: 8px;
  background: #1a1a2e;
}

.scoreboard-header h1 {
  flex: 1;
  margin: 0;
  font-size: 1.8rem;
  color: #fff;
  text-align: center;
}

.back-btn, .add-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
  background: #16213e;
  color: #e0e0e0;
  transition: background 0.2s;
  white-space: nowrap;
}

.back-btn:hover, .add-btn:hover {
  background: #0f3460;
}

.add-form {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.form-input {
  flex: 1;
  min-width: 120px;
  padding: 8px 12px;
  border: 1px solid #333;
  border-radius: 6px;
  background: #16213e;
  color: #e0e0e0;
  font-size: 0.9rem;
}

.submit-btn {
  padding: 8px 20px;
  border: none;
  border-radius: 6px;
  background: #e94560;
  color: #fff;
  cursor: pointer;
  font-size: 0.9rem;
}

.submit-btn:hover {
  background: #c73e54;
}

.score-table {
  width: 100%;
  border-collapse: collapse;
}

.score-table th {
  text-align: left;
  padding: 10px 8px;
  border-bottom: 2px solid #333;
  color: #aaa;
  font-size: 0.85rem;
  text-transform: uppercase;
}

.score-table td {
  padding: 10px 8px;
  border-bottom: 1px solid #222;
}

.score-table tbody tr:hover {
  background: #16213e;
}

.rank {
  font-weight: bold;
  color: #e94560;
  width: 40px;
}

.score-val {
  font-weight: bold;
  color: #53d769;
}

.date {
  color: #888;
  font-size: 0.85rem;
}

.remove-btn {
  background: none;
  border: none;
  color: #666;
  cursor: pointer;
  font-size: 1rem;
  padding: 2px 6px;
}

.remove-btn:hover {
  color: #e94560;
}

.error-msg {
  background: #3a1a1e;
  color: #e94560;
  padding: 10px 14px;
  border-radius: 6px;
  margin-bottom: 16px;
}

.loading, .empty {
  text-align: center;
  padding: 40px;
  color: #888;
  font-size: 1.1rem;
}
</style>
