<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  resources: {
    type: Array,
    default: () => []
  },
  storedResources: {
    type: Object,
    default: () => ({})
  },
  allocatedResources: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['reduce-to-capacity', 'show-allocations', 'resource-clicked'])

const handleResourceClick = (resource) => {
  emit('resource-clicked', resource.id)
}

// Trackery pre odpočítavanie - { resourceId: { progress: 0-100, timeLeft: 10 } }
const countdowns = ref({})
let countdownIntervals = {}

// Trendy pre resource amounts
const trends = ref({})
const trendHistory = ref({})
const TREND_WINDOW = 30
const TREND_THRESHOLD = 0.5

// Funkcia na začatie odpočítavania pre resource
const startCountdown = (resourceId, durationSec = 60) => {
  if (countdownIntervals[resourceId]) return // Už beží
  
  countdowns.value[resourceId] = {
    progress: 100,
    timeLeft: durationSec
  }
  
  const startTime = Date.now()
  const duration = durationSec * 1000
  
  countdownIntervals[resourceId] = setInterval(() => {
    const elapsed = Date.now() - startTime
    const remaining = duration - elapsed
    
    if (remaining <= 0) {
      // Odpočítavanie skončilo
      clearInterval(countdownIntervals[resourceId])
      delete countdownIntervals[resourceId]
      delete countdowns.value[resourceId]
      
      // Emituj event na zníženie resources na kapacitu
      emit('reduce-to-capacity', resourceId)
    } else {
      countdowns.value[resourceId] = {
        progress: (remaining / duration) * 100,
        timeLeft: Math.ceil(remaining / 1000)
      }
    }
  }, 100) // Update každých 100ms pre plynulú animáciu
}

// Funkcia na zastavenie odpočítavania
const stopCountdown = (resourceId) => {
  if (countdownIntervals[resourceId]) {
    clearInterval(countdownIntervals[resourceId])
    delete countdownIntervals[resourceId]
    delete countdowns.value[resourceId]
  }
}

// Watch pre detekciu over-capacity
watch(() => [props.resources, props.storedResources, props.allocatedResources], () => {
  props.resources.forEach(resource => {
    const capacity = props.storedResources[resource.id]
    // Konvertuj capacity - ak je undefined, použi 0 ak sa zobrazuje /0
    const capacityNum = capacity !== undefined ? Number(capacity) : 0
    
    // Debug log
    const allocatedAmount = props.allocatedResources[resource.id] || 0
    const totalAmount = resource.amount + allocatedAmount
    if (totalAmount > 0 && (resource.mustBeStored || capacity !== undefined)) {
      console.log(`🔍 Resource: ${resource.name}, amount: ${resource.amount}, allocated: ${allocatedAmount}, totalAmount: ${totalAmount}, capacity: ${capacity}, capacityNum: ${capacityNum}, mustBeStored: ${resource.mustBeStored}, hasStorageDisplay: ${resource.mustBeStored || capacity !== undefined}`)
    }
    
    // Spusti countdown ak:
    // 1. resource.amount > capacity (nad kapacitou)
    // 2. capacity je 0 alebo undefined a zobrazuje sa /0 a má suroviny
    // 3. amount + allocated > capacity (alokované resources tiež potrebujú sklad)
    const hasStorageDisplay = resource.mustBeStored || capacity !== undefined
    const isOverCapacity = (hasStorageDisplay && totalAmount > capacityNum) || 
                           (hasStorageDisplay && capacityNum <= 0 && totalAmount > 0)
    
    if (isOverCapacity && !countdownIntervals[resource.id]) {
      // Začni odpočítavanie - 10s ak nie je žiadny sklad, 60s ak je len preplnený
      const countdownDuration = 10;
      console.log(`⏱️ Spúšťam countdown pre ${resource.name} (amount: ${resource.amount}, capacity: ${capacity}, capacityNum: ${capacityNum}, duration: ${countdownDuration}s)`)
      startCountdown(resource.id, countdownDuration)
    } else if (!isOverCapacity && countdownIntervals[resource.id]) {
      // Zastav odpočítavanie ak už nie je over capacity
      stopCountdown(resource.id)
    }

    // Trend vývoja (vyhladené cez okno)
    if (!trendHistory.value[resource.id]) {
      trendHistory.value[resource.id] = []
    }
    trendHistory.value[resource.id].push(resource.amount)
    if (trendHistory.value[resource.id].length > TREND_WINDOW) {
      trendHistory.value[resource.id].shift()
    }

    const history = trendHistory.value[resource.id]
    if (history.length >= Math.ceil(TREND_WINDOW / 2)) {
      const mid = Math.floor(history.length / 2)
      const firstHalf = history.slice(0, mid)
      const secondHalf = history.slice(mid)
      const avg = arr => arr.reduce((sum, v) => sum + v, 0) / (arr.length || 1)
      const diff = avg(secondHalf) - avg(firstHalf)

      if (diff > TREND_THRESHOLD) {
        trends.value[resource.id] = 'up'
      } else if (diff < -TREND_THRESHOLD) {
        trends.value[resource.id] = 'down'
      } else {
        trends.value[resource.id] = 'flat'
      }
    } else {
      trends.value[resource.id] = 'flat'
    }
  })
}, { deep: true })

onMounted(() => {
  // Skontroluj po načítaní
  props.resources.forEach(resource => {
    const capacity = props.storedResources[resource.id]
    const capacityNum = capacity !== undefined ? Number(capacity) : 0
    const hasStorageDisplay = resource.mustBeStored || capacity !== undefined
    const allocatedAmount = props.allocatedResources[resource.id] || 0
    const totalAmount = resource.amount + allocatedAmount
    const isOverCapacity = (hasStorageDisplay && totalAmount > capacityNum) ||
                           (hasStorageDisplay && capacityNum <= 0 && totalAmount > 0)
    if (isOverCapacity) {
      const countdownDuration = (capacityNum <= 0) ? 10 : 60
      console.log(`⏱️ onMounted: Spúšťam countdown pre ${resource.name} (amount: ${resource.amount}, capacity: ${capacity}, capacityNum: ${capacityNum}, duration: ${countdownDuration}s)`)
      startCountdown(resource.id, countdownDuration)
    }

    // Init trend
    trendHistory.value[resource.id] = [resource.amount]
    trends.value[resource.id] = 'flat'
  })
})

onUnmounted(() => {
  // Vyčisti všetky intervaly
  Object.keys(countdownIntervals).forEach(resourceId => {
    clearInterval(countdownIntervals[resourceId])
  })
})
</script>

<template>
  <div class="resource-display">
    <div v-if="resources.length === 0" class="empty-state">
      <p>No resources</p>
    </div>

    <!-- Row 1: Materials -->
    <div v-if="resources.filter(r => !r.workResource && !r.isComponent).length > 0" class="resource-row">
      <div class="resource-block">
        <div class="section-header">
          <span class="section-icon">📦</span>
        </div>
        <div class="block-scroll-wrapper">
        <div class="block-scroll">
          <div 
            v-for="resource in resources.filter(r => !r.workResource && !r.isComponent)" 
            :key="resource.id" 
            class="resource-item"
            :class="{ 
              'over-capacity-blink': (storedResources[resource.id] !== undefined && resource.amount > storedResources[resource.id]) || 
                                      (storedResources[resource.id] === 0 && resource.amount > 0)
            }"
          >
            <div class="resource-icon clickable-resource" @click="handleResourceClick(resource)" :title="'Show buildings for ' + resource.name">
              <img 
                v-if="resource.icon" 
                :src="resource.icon" 
                :alt="resource.name"
                class="icon-image"
              />
              <span v-else class="icon-placeholder">📦</span>
            </div>
            <div class="resource-info">
              <span class="resource-name clickable-resource" @click="handleResourceClick(resource)" :title="'Show buildings for ' + resource.name">{{ resource.name }}</span>
              <div class="resource-amounts">
                <span class="amount-current">{{ resource.amount }}</span>
                <span
                  class="trend-arrow"
                  :class="{
                    'trend-up': trends[resource.id] === 'up',
                    'trend-down': trends[resource.id] === 'down'
                  }"
                  v-if="trends[resource.id] && trends[resource.id] !== 'flat'"
                >{{ trends[resource.id] === 'up' ? '▲' : '▼' }}</span>
                <span 
                  v-if="resource.mustBeStored || (storedResources && storedResources[resource.id] !== undefined)" 
                  class="amount-stored"
                  :class="{ 
                    'storage-full': resource.amount >= (storedResources[resource.id] || 0),
                    'no-storage': resource.mustBeStored && (storedResources[resource.id] === 0 || storedResources[resource.id] === undefined)
                  }"
                >/{{ storedResources[resource.id] !== undefined ? storedResources[resource.id] : 0 }}</span>
              </div>
            </div>
            <!-- Pie chart odpočítavanie -->
            <div v-if="countdowns[resource.id]" class="countdown-pie">
              <svg viewBox="0 0 36 36" class="pie-chart">
                <circle cx="18" cy="18" r="16" fill="none" stroke="#fee" stroke-width="3"></circle>
                <circle cx="18" cy="18" r="16" fill="none" stroke="#ef4444" stroke-width="3" stroke-dasharray="100" :stroke-dashoffset="100 - countdowns[resource.id].progress" stroke-linecap="round" transform="rotate(-90 18 18)"></circle>
                <text x="18" y="21" text-anchor="middle" class="pie-text">{{ countdowns[resource.id].timeLeft }}</text>
              </svg>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>

    <!-- Row 2: Work-force + Components side by side -->
    <div class="resource-row resource-row-split">
      <!-- Work-force block -->
      <div v-if="resources.filter(r => r.workResource).length > 0" class="resource-block">
        <div class="section-header">
          <span class="section-icon">👷</span>
        </div>
        <div class="block-scroll-wrapper">
        <div class="block-scroll">
          <div 
            v-for="resource in resources.filter(r => r.workResource)" 
            :key="resource.id" 
            class="resource-item"
            :class="{ 
              'over-capacity-blink': (storedResources[resource.id] !== undefined && resource.amount > storedResources[resource.id]) || 
                                      (storedResources[resource.id] === 0 && resource.amount > 0)
            }"
          >
            <div class="resource-icon clickable-resource" @click="handleResourceClick(resource)" :title="'Show buildings for ' + resource.name">
              <img 
                v-if="resource.icon" 
                :src="resource.icon" 
                :alt="resource.name"
                class="icon-image"
              />
              <span v-else class="icon-placeholder">📦</span>
            </div>
            <div class="resource-info">
              <span class="resource-name clickable-resource" @click="handleResourceClick(resource)" :title="'Show buildings for ' + resource.name">{{ resource.name }}</span>
              <div class="resource-amounts">
                <span class="amount-current">{{ resource.amount }}</span>
                <span
                  class="trend-arrow"
                  :class="{
                    'trend-up': trends[resource.id] === 'up',
                    'trend-down': trends[resource.id] === 'down'
                  }"
                  v-if="trends[resource.id] && trends[resource.id] !== 'flat'"
                >{{ trends[resource.id] === 'up' ? '▲' : '▼' }}</span>
                <span 
                  v-if="resource.workResource && allocatedResources[resource.id]"
                  class="amount-allocated clickable-allocated"
                  :title="`Click to show work force allocations`"
                  @click.stop="emit('show-allocations', resource.id)"
                >({{ allocatedResources[resource.id] }})</span>
                <span 
                  v-if="resource.mustBeStored || (storedResources && storedResources[resource.id] !== undefined)" 
                  class="amount-stored"
                  :class="{ 
                    'storage-full': resource.amount >= (storedResources[resource.id] || 0),
                    'no-storage': resource.mustBeStored && (storedResources[resource.id] === 0 || storedResources[resource.id] === undefined)
                  }"
                >/{{ storedResources[resource.id] !== undefined ? storedResources[resource.id] : 0 }}</span>
              </div>
            </div>
            <!-- Pie chart odpočítavanie -->
            <div v-if="countdowns[resource.id]" class="countdown-pie">
              <svg viewBox="0 0 36 36" class="pie-chart">
                <circle cx="18" cy="18" r="16" fill="none" stroke="#fee" stroke-width="3"></circle>
                <circle cx="18" cy="18" r="16" fill="none" stroke="#ef4444" stroke-width="3" stroke-dasharray="100" :stroke-dashoffset="100 - countdowns[resource.id].progress" stroke-linecap="round" transform="rotate(-90 18 18)"></circle>
                <text x="18" y="21" text-anchor="middle" class="pie-text">{{ countdowns[resource.id].timeLeft }}</text>
              </svg>
            </div>
          </div>
        </div>
        </div>
      </div>

      <!-- Components block -->
      <div v-if="resources.filter(r => r.isComponent).length > 0" class="resource-block component-block">
        <div class="section-header component-header">
          <span class="section-icon">⚙️</span>
        </div>
        <div class="block-scroll-wrapper">
        <div class="block-scroll">
          <div 
            v-for="resource in resources.filter(r => r.isComponent)" 
            :key="resource.id" 
            class="resource-item component-item"
            :class="{ 
              'over-capacity-blink': (storedResources[resource.id] !== undefined && resource.amount > storedResources[resource.id]) || 
                                      (storedResources[resource.id] === 0 && resource.amount > 0)
            }"
          >
            <div class="resource-icon clickable-resource" @click="handleResourceClick(resource)" :title="'Show buildings for ' + resource.name">
              <img 
                v-if="resource.icon" 
                :src="resource.icon" 
                :alt="resource.name"
                class="icon-image"
              />
              <span v-else class="icon-placeholder">⚙️</span>
            </div>
            <div class="resource-info">
              <span class="resource-name clickable-resource" @click="handleResourceClick(resource)" :title="'Show buildings for ' + resource.name">{{ resource.name }}</span>
              <div class="resource-amounts">
                <span class="amount-current">{{ resource.amount }}</span>
                <span
                  class="trend-arrow"
                  :class="{
                    'trend-up': trends[resource.id] === 'up',
                    'trend-down': trends[resource.id] === 'down'
                  }"
                  v-if="trends[resource.id] && trends[resource.id] !== 'flat'"
                >{{ trends[resource.id] === 'up' ? '▲' : '▼' }}</span>
                <span 
                  v-if="resource.mustBeStored || (storedResources && storedResources[resource.id] !== undefined)" 
                  class="amount-stored"
                  :class="{ 
                    'storage-full': resource.amount >= (storedResources[resource.id] || 0),
                    'no-storage': resource.mustBeStored && (storedResources[resource.id] === 0 || storedResources[resource.id] === undefined)
                  }"
                >/{{ storedResources[resource.id] !== undefined ? storedResources[resource.id] : 0 }}</span>
              </div>
            </div>
            <!-- Pie chart odpočítavanie -->
            <div v-if="countdowns[resource.id]" class="countdown-pie">
              <svg viewBox="0 0 36 36" class="pie-chart">
                <circle cx="18" cy="18" r="16" fill="none" stroke="#fee" stroke-width="3"></circle>
                <circle cx="18" cy="18" r="16" fill="none" stroke="#ef4444" stroke-width="3" stroke-dasharray="100" :stroke-dashoffset="100 - countdowns[resource.id].progress" stroke-linecap="round" transform="rotate(-90 18 18)"></circle>
                <text x="18" y="21" text-anchor="middle" class="pie-text">{{ countdowns[resource.id].timeLeft }}</text>
              </svg>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.resource-display {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
  padding: 10px;
}

.resource-row {
  display: flex;
  width: 100%;
}

.resource-row-split {
  gap: 4px;
}

.resource-block {
  display: flex;
  align-items: stretch;
  gap: 0.15rem;
  min-width: 0;
  flex: 1;
}

.resource-block .section-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.block-scroll-wrapper {
  flex: 1;
  min-width: 0;
  position: relative;
  -webkit-mask-image: linear-gradient(to right, transparent 0%, black 20px, black calc(100% - 20px), transparent 100%);
  mask-image: linear-gradient(to right, transparent 0%, black 20px, black calc(100% - 20px), transparent 100%);
}

.block-scroll {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  overflow-x: auto;
  overflow-y: hidden;
  min-width: 0;
  padding: 0 16px 2px 16px;
}

/* Thin horizontal scrollbar */
.block-scroll::-webkit-scrollbar {
  height: 4px;
}

.block-scroll::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.05);
  border-radius: 2px;
}

.block-scroll::-webkit-scrollbar-thumb {
  background: rgba(102, 126, 234, 0.4);
  border-radius: 2px;
}

.block-scroll::-webkit-scrollbar-thumb:hover {
  background: rgba(102, 126, 234, 0.7);
}

.empty-state {
  text-align: center;
  padding: 2rem;
  color: #999;
}

.empty-state p {
  margin: 0;
  font-size: 0.9rem;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.2rem 0.5rem;
  background: linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%);
  border-radius: 4px;
  border: 1px solid #d1d5db;
  white-space: nowrap;
}

.section-icon {
  font-size: 1rem;
  line-height: 1;
}

.section-title {
  font-weight: 700;
  font-size: 0.8rem;
  color: #374151;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.resource-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.5rem;
  margin-bottom: 0.25rem;
  background: linear-gradient(135deg, #f8fafb1f 0%, #f0f2f5 100%);
  border-radius: 6px;
  border: 1px solid #9effea;
  transition: all 0.2s;
}

.resource-item:hover {
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  transform: translateY(-1px);
}

.resource-item.over-capacity-blink {
  animation: gentle-red-blink 2s ease-in-out infinite;
}

@keyframes gentle-red-blink {
  0%, 100% { background: #f8f9fa; }
  50% { background: #ffe5e5; }
}

.resource-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: white;
  border-radius: 6px;
  border: 1px solid #e0e0e0;
  flex-shrink: 0;
}

.icon-image {
  width: 28px;
  height: 28px;
  object-fit: contain;
  border-radius: 3px;
}

.icon-placeholder {
  font-size: 1rem;
}

.resource-info {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.resource-name {
  font-weight: 600;
  color: #000;
  font-size: 0.75rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 0;
}

.resource-amounts {
  display: flex;
  align-items: baseline;
  gap: 3px;
  flex-shrink: 0;
}

.trend-arrow {
  font-size: 0.85rem;
  font-weight: 900;
  line-height: 1;
}

.trend-arrow.trend-up {
  color: #10b981;
}

.trend-arrow.trend-down {
  color: #ef4444;
}

.amount-current {
  font-weight: 700;
  font-size: 0.95rem;
  color: #518a85;
}

.amount-stored {
  font-weight: 700;
  font-size: 0.95rem;
  color: #000; /* čierna farba pre stored hodnotu */
  transition: color 0.3s ease;
}

.amount-stored.storage-full {
  color: #ff0000; /* červená farba keď je sklad plný */
}

.amount-stored.no-storage {
  color: #ff6600; /* oranžová farba keď nie je žiadny sklad */
  font-weight: 900;
  animation: blink-warning 1.5s infinite;
}

.amount-allocated {
  font-weight: 700;
  font-size: 0.85rem;
  color: #f59e0b; /* oranžová farba pre alokované */
  margin-left: 2px;
}

.clickable-allocated {
  cursor: pointer;
  transition: color 0.2s, text-shadow 0.2s;
}

.clickable-allocated:hover {
  color: #fbbf24;
  text-shadow: 0 0 6px rgba(251, 191, 36, 0.6);
}

@keyframes blink-warning {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.countdown-pie {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  margin-left: 0.5rem;
}

.pie-chart {
  width: 100%;
  height: 100%;
}

.pie-text {
  font-size: 12px;
  font-weight: bold;
  fill: #ef4444;
}

/* Component section */
.component-header {
  background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
  border-color: #f59e0b;
}

.component-item {
  border-left: 3px solid #f59e0b;
}

/* Clickable resource icon/name */
.clickable-resource {
  cursor: pointer;
  transition: opacity 0.2s, transform 0.15s;
}

.clickable-resource:hover {
  opacity: 0.7;
  transform: scale(1.05);
}

.resource-icon.clickable-resource:hover {
  border-color: #667eea;
  box-shadow: 0 0 6px rgba(102, 126, 234, 0.4);
}
</style>
