<script setup>
import { ref, computed } from 'vue'
import Modal from './Modal.vue'

const props = defineProps({
  buildings: {
    type: Array,
    default: () => []
  },
  selectedBuildingId: {
    type: String,
    default: null
  },
  filterResourceId: {
    type: String,
    default: null
  },
  resources: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['building-selected', 'clear-filter', 'reorder-buildings'])

// Info modal
const showInfoModal = ref(false)
const infoBuildingData = ref(null)

const openInfoModal = (event, building) => {
  event.stopPropagation()
  infoBuildingData.value = building
  showInfoModal.value = true
}

const closeInfoModal = () => {
  showInfoModal.value = false
  infoBuildingData.value = null
}

// Získanie ikony suroviny podľa resourceId
const getResourceIcon = (resourceId) => {
  const resource = props.resources.find(r => r.id === resourceId)
  return resource?.icon || null
}

// Drag and drop
const draggedItemId = ref(null)
const dragOverItemId = ref(null)

const onDragStart = (event, buildingId) => {
  draggedItemId.value = buildingId
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', buildingId)
  setTimeout(() => {
    const el = event.target.closest('.building-item')
    if (el) el.classList.add('dragging')
  }, 0)
}

const onDragOver = (event, buildingId) => {
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  dragOverItemId.value = buildingId
}

const onDragLeave = () => {
  dragOverItemId.value = null
}

const onDrop = (event, targetId) => {
  event.preventDefault()
  if (!draggedItemId.value || draggedItemId.value === targetId) {
    resetDrag()
    return
  }
  
  // Vytvor novú zoradenú kópiu
  const list = [...sortedBuildings.value]
  const draggedIdx = list.findIndex(b => b.id === draggedItemId.value)
  const targetIdx = list.findIndex(b => b.id === targetId)
  
  if (draggedIdx === -1 || targetIdx === -1) {
    resetDrag()
    return
  }
  
  const [movedItem] = list.splice(draggedIdx, 1)
  if (draggedIdx < targetIdx) {
    list.splice(targetIdx, 0, movedItem)
  } else {
    list.splice(targetIdx, 0, movedItem)
  }
  
  // Emit nové poradie (pole ID v správnom poradí)
  emit('reorder-buildings', list.map((b, index) => ({ id: b.id, order: index })))
  
  resetDrag()
}

const onDragEnd = (event) => {
  const el = event.target.closest('.building-item')
  if (el) el.classList.remove('dragging')
  resetDrag()
}

const resetDrag = () => {
  draggedItemId.value = null
  dragOverItemId.value = null
}

// Zoradené budovy podľa buildingOrder
const sortedBuildings = computed(() => {
  const sorted = [...props.buildings].sort((a, b) => {
    const orderA = a.buildingData?.buildingOrder ?? 9999
    const orderB = b.buildingData?.buildingOrder ?? 9999
    return orderA - orderB
  })
  return sorted
})

// Filter buildings by resource (production, stored)
const filteredBuildings = computed(() => {
  if (!props.filterResourceId) return sortedBuildings.value
  return sortedBuildings.value.filter(b => {
    const bd = b.buildingData
    if (!bd) return false
    const check = (arr) => arr && arr.some(r => r.resourceId === props.filterResourceId)
    return check(bd.production) || check(bd.stored)
  })
})

// Mapovanie buildingSize na počet políčok
const getSizeFromBuildingSize = (buildingSize) => {
  switch (buildingSize) {
    case '1x1': return { cellsX: 1, cellsY: 1 }
    case '2x2': return { cellsX: 2, cellsY: 2 }
    case '3x3': return { cellsX: 3, cellsY: 3 }
    case '4x4': return { cellsX: 4, cellsY: 4 }
    case '5x5': return { cellsX: 5, cellsY: 5 }
    default: return { cellsX: 1, cellsY: 1 } // default veľkosť
  }
}

const selectBuilding = (building) => {
  // Ak je budova už vybraná, odznač ju
  if (building.id === props.selectedBuildingId) {
    emit('building-selected', null)
    return
  }
  
  const size = getSizeFromBuildingSize(building.buildingData?.buildingSize || 'default')
  emit('building-selected', {
    building,
    cellsX: size.cellsX,
    cellsY: size.cellsY
  })
}

// Počet budov
const buildingCount = computed(() => filteredBuildings.value.length)
const totalCount = computed(() => props.buildings.length)
</script>

<template>
  <div class="building-selector">


    <!-- Filter indicator -->
    <div v-if="filterResourceId" class="filter-indicator">
      <span class="filter-text">🔍 Filtered by resource</span>
      <button class="clear-filter-btn" @click="emit('clear-filter')" title="Show all buildings">✕</button>
    </div>
    
    <div v-if="buildingCount === 0 && !filterResourceId" class="empty-state">
      <p>No buildings</p>
      <p class="hint">Load a project with buildings</p>
    </div>

    <div v-else-if="buildingCount === 0 && filterResourceId" class="empty-state">
      <p>No buildings for this resource</p>
      <button class="clear-filter-btn-large" @click="emit('clear-filter')">Show all</button>
    </div>
    
    <div v-else class="building-grid">
      <div
        v-for="building in filteredBuildings"
        :key="building.id"
        :class="['building-item', { selected: building.id === selectedBuildingId, 'drag-over': dragOverItemId === building.id }]"
        @click="selectBuilding(building)"
        :title="building.buildingData?.buildingName || 'Building'"
        draggable="true"
        @dragstart="onDragStart($event, building.id)"
        @dragover="onDragOver($event, building.id)"
        @dragleave="onDragLeave"
        @drop="onDrop($event, building.id)"
        @dragend="onDragEnd"
      >
        <img :src="building.url" :alt="building.buildingData?.buildingName || 'Building'" />
        <div class="building-info">
          <span class="building-name">{{ building.buildingData?.buildingName || 'Building' }}</span>
          <span class="building-size">{{ building.buildingData?.buildingSize || '1x1' }}</span>
        </div>
        <div v-if="building.id === selectedBuildingId" class="selected-indicator">✓</div>
        <button class="info-btn" @click="openInfoModal($event, building)" title="Building info">ℹ</button>
      </div>
    </div>

    <!-- Info Modal -->
    <Modal v-if="showInfoModal && infoBuildingData" :title="infoBuildingData.buildingData?.buildingName || 'Building info'" width="420px" @close="closeInfoModal">
      <div class="info-modal-content">
        <div class="info-header">
          <img :src="infoBuildingData.url" :alt="infoBuildingData.buildingData?.buildingName" class="info-preview" />
          <div class="info-title">
            <h3>{{ infoBuildingData.buildingData?.buildingName || 'Building' }}</h3>
            <span class="info-size-badge">{{ infoBuildingData.buildingData?.buildingSize || '1x1' }}</span>
          </div>
        </div>

        <!-- Cena stavby -->
        <div v-if="infoBuildingData.buildingData?.buildCost?.length" class="info-section">
          <div class="info-section-header">
            <span class="info-section-icon">🏗️</span>
            <span class="info-section-label">Build Cost</span>
          </div>
          <div class="resource-list">
            <div v-for="item in infoBuildingData.buildingData.buildCost" :key="item.resourceId" class="resource-item">
              <img v-if="getResourceIcon(item.resourceId)" :src="getResourceIcon(item.resourceId)" class="resource-icon-img" />
              <span class="resource-name">{{ item.resourceName || item.resourceId }}</span>
              <span class="resource-amount cost">-{{ item.amount }}</span>
            </div>
          </div>
        </div>

        <!-- Prevádzkové náklady -->
        <div v-if="infoBuildingData.buildingData?.operationalCost?.length" class="info-section">
          <div class="info-section-header">
            <span class="info-section-icon">⚡</span>
            <span class="info-section-label">Operating Cost</span>
          </div>
          <div class="resource-list">
            <div v-for="item in infoBuildingData.buildingData.operationalCost" :key="item.resourceId" class="resource-item">
              <img v-if="getResourceIcon(item.resourceId)" :src="getResourceIcon(item.resourceId)" class="resource-icon-img" />
              <span class="resource-name">{{ item.resourceName || item.resourceId }}</span>
              <span class="resource-amount cost">-{{ item.amount }}/cycle</span>
            </div>
          </div>
        </div>

        <!-- Produkcia -->
        <div v-if="infoBuildingData.buildingData?.production?.length" class="info-section">
          <div class="info-section-header">
            <span class="info-section-icon">📦</span>
            <span class="info-section-label">Production</span>
          </div>
          <div class="resource-list">
            <div v-for="item in infoBuildingData.buildingData.production" :key="item.resourceId" class="resource-item">
              <img v-if="getResourceIcon(item.resourceId)" :src="getResourceIcon(item.resourceId)" class="resource-icon-img" />
              <span class="resource-name">{{ item.resourceName || item.resourceId }}</span>
              <span class="resource-amount production">+{{ item.amount }}/cycle</span>
            </div>
          </div>
        </div>

        <!-- Skladovanie -->
        <div v-if="infoBuildingData.buildingData?.stored?.length" class="info-section">
          <div class="info-section-header">
            <span class="info-section-icon">🏚️</span>
            <span class="info-section-label">Storage</span>
          </div>
          <div class="resource-list">
            <div v-for="item in infoBuildingData.buildingData.stored" :key="item.resourceId" class="resource-item">
              <img v-if="getResourceIcon(item.resourceId)" :src="getResourceIcon(item.resourceId)" class="resource-icon-img" />
              <span class="resource-name">{{ item.resourceName || item.resourceId }}</span>
              <span class="resource-amount stored">{{ item.amount }}</span>
            </div>
          </div>
        </div>

        <!-- Prázdne info ak nič nemá -->
        <div v-if="!infoBuildingData.buildingData?.buildCost?.length && !infoBuildingData.buildingData?.operationalCost?.length && !infoBuildingData.buildingData?.production?.length && !infoBuildingData.buildingData?.stored?.length" class="info-empty">
          No economic data
        </div>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.building-selector {
  background: rgb(0 0 0 / 30%);
  padding: 1rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid #f0f0f0;
}

.section-header h3 {
  margin: 0;
  font-size: 1.1rem;
  color: #333;
}

.filter-indicator {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%);
  border: 1px solid #818cf8;
  border-radius: 8px;
  padding: 0.4rem 0.6rem;
  margin-bottom: 0.75rem;
  font-size: 0.8rem;
  color: #4338ca;
}

.filter-text {
  font-weight: 600;
}

.clear-filter-btn {
  background: #818cf8;
  color: white;
  border: none;
  border-radius: 50%;
  width: 20px;
  height: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  font-weight: bold;
  transition: background 0.2s;
}

.clear-filter-btn:hover {
  background: #6366f1;
}

.clear-filter-btn-large {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 8px;
  padding: 0.4rem 0.8rem;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 600;
  margin-top: 0.5rem;
  transition: opacity 0.2s;
}

.clear-filter-btn-large:hover {
  opacity: 0.85;
}

.building-count {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 0.25rem 0.75rem;
  border-radius: 12px;
  font-size: 0.85rem;
  font-weight: 600;
}

.empty-state {
  text-align: center;
  padding: 2rem 1rem;
  color: #999;
}

.empty-state p {
  margin: 0.5rem 0;
}

.hint {
  font-size: 0.85rem;
  color: #bbb;
}

.building-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  gap: 0.75rem;
}

.building-item {
  position: relative;
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  cursor: grab;
  transition: all 0.2s;
  border: 1px solid #77eaff;
  background: linear-gradient(135deg, #1e1f1f24 0%, #f0f2f5 100%);
}

.building-item:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  border-color: #667eea;
}

.building-item.selected {
  border-color: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.2);
}

.building-item img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  padding: 0.25rem;
}

.building-info {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.8), transparent);
  padding: 0.5rem 0.25rem 0.25rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  opacity: 0;
  transition: opacity 0.2s;
}

.building-item:hover .building-info {
  opacity: 1;
}

.building-name {
  color: white;
  font-size: 0.7rem;
  font-weight: 600;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.building-size {
  color: rgba(255, 255, 255, 0.8);
  font-size: 0.65rem;
  font-weight: 500;
}

.selected-indicator {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: bold;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
}

/* Drag and drop */
.building-item.dragging {
  opacity: 0.4;
  transform: scale(0.95);
}

.building-item.drag-over {
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.4);
  transform: scale(1.05);
}

.building-item:active {
  cursor: grabbing;
}

/* Info button */
.info-btn {
  position: absolute;
  top: 4px;
  left: 4px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.5);
  color: white;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  font-weight: bold;
  opacity: 0;
  transition: opacity 0.2s, background 0.2s;
  z-index: 2;
  padding: 0;
  line-height: 1;
}

.building-item:hover .info-btn {
  opacity: 1;
}

.info-btn:hover {
  background: #667eea;
  transform: scale(1.1);
}

/* Info Modal Content */
.info-modal-content {
  padding: 0.5rem;
}

.info-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 2px solid #f0f0f0;
}

.info-preview {
  width: 80px;
  height: 80px;
  object-fit: contain;
  border-radius: 8px;
  background: #f8f9fa;
  border: 1px solid #e0e0e0;
  padding: 4px;
}

.info-title h3 {
  margin: 0 0 0.3rem 0;
  font-size: 1.1rem;
  color: #333;
}

.info-size-badge {
  display: inline-block;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 0.15rem 0.5rem;
  border-radius: 10px;
  font-size: 0.75rem;
  font-weight: 600;
}

.info-section {
  margin-bottom: 0.75rem;
}

.info-section-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.4rem;
  padding-bottom: 0.25rem;
  border-bottom: 1px solid #e5e7eb;
}

.info-section-icon {
  font-size: 0.9rem;
}

.info-section-label {
  font-weight: 700;
  font-size: 0.85rem;
  color: #374151;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.resource-list {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.resource-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.3rem 0.5rem;
  background: #f9fafb;
  border-radius: 6px;
  gap: 0.4rem;
}

.resource-icon-img {
  width: 20px;
  height: 20px;
  object-fit: contain;
  flex-shrink: 0;
}

.resource-name {
  font-size: 0.82rem;
  color: #4b5563;
  font-weight: 500;
  flex: 1;
}

.resource-amount {
  font-size: 0.82rem;
  font-weight: 700;
  border-radius: 4px;
  padding: 0.1rem 0.4rem;
}

.resource-amount.cost {
  color: #dc2626;
  background: #fef2f2;
}

.resource-amount.production {
  color: #16a34a;
  background: #f0fdf4;
}

.resource-amount.stored {
  color: #2563eb;
  background: #eff6ff;
}

.info-empty {
  text-align: center;
  color: #9ca3af;
  font-size: 0.85rem;
  padding: 1rem;
  font-style: italic;
}
</style>
