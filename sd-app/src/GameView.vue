<script setup>
import { ref, watch, nextTick, computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import PhaserCanvas from './components/PhaserCanvas.vue'
import ProjectManager from './components/ProjectManager.vue'
import GameClock from './components/GameClock.vue'
import ResourceDisplay from './components/ResourceDisplay.vue'
import BuildingSelector from './components/BuildingSelector.vue'
import RoadSelector from './components/RoadSelector.vue'
import Modal from './components/Modal.vue'
import AstronautSprite from './components/AstronautSprite.vue'
import { buildRoad, regenerateRoadTilesOnCanvas } from './utils/roadBuilder.js'
import { loadProject } from './utils/projectLoader.js'
import { 
  calculateResourceUsage,
  calculateStoredResources,
  checkBuildingResources as checkResources,
  deductBuildCost as deductCost,
  returnBuildWorkforce,
  refundBuildCostOnDelete,
  canStartProduction as checkProductionResources,
  executeProduction,
  getMissingOperationalResources,
  canStoreProduction
} from './utils/resourceCalculator.js'
import {
  buildConsumptionMap,
  evaluateResourcePriority
} from './utils/resourcePriorityService.js'

const route = useRoute()

const BASE_URL = import.meta.env.BASE_URL

const images = ref([])
const lastImageCellsX = ref(1)
const lastImageCellsY = ref(1)
const selectedImageId = ref(null)
const selectedImageData = ref(null)
const templateSelected = ref(false)
const selectedCell = ref({ row: -1, col: -1 })
const canvasRef = ref(null)
const showNumbering = ref(false)
const showGallery = ref(true)
const showGrid = ref(true)
const showPerson = ref(true)
const deleteMode = ref(false)
const environmentColors = ref({ hue: 0, saturation: 100, brightness: 100 })
const textureSettings = ref({ tilesPerImage: 1, tileResolution: 512, customTexture: null })
const roadBuildingMode = ref(false)
const roadDeleteMode = ref(false)
const recycleMode = ref(false)
const recyclingBuildings = ref({}) // Budovy v procese recyklácie: { 'row-col': { buildingData, workerCount } }
const roadTiles = ref([])
const isLoading = ref(false)
const loadingProgress = ref(0)
const loadingStatus = ref('')
const personSpawnEnabled = ref(false)
const personSpawnCount = ref(0)
const resources = ref([])
const workforce = ref([])
const roadSpriteUrl = ref(BASE_URL + 'templates/roads/sprites/pastroad.png')
const roadOpacity = ref(100)
const canvasImagesMap = ref({}) // Mapa budov na canvase (pre vypočítanie použitých resources)
const gameTime = ref(0) // Herný čas v milisekundách
const buildingProductionStates = ref({}) // Mapa stavov auto produkcie pre každú budovu: { 'row-col': { enabled: boolean, interval: number, buildingData: {...}, progress: 0, progressInterval: null } }
const allocatedResources = ref({}) // Tracking alokovaných work force resources { resourceId: amount }
const workforceAllocations = ref({}) // Detailný tracking alokácií { resourceId: [{row, col, amount, type: 'build'|'production', buildingName}] }
const productionProgress = ref({}) // Progress pre každú budovu { 'row-col': 0-100 }
const animatingBuildings = ref(new Map()) // Budovy aktuálne v stavebnej animácii: Map<'row-col', 'waiting'|'building'>
const BUILDING_ANIMATION_DURATION = 10000 // ms - musí byť rovnaká ako v buildingAnimationService.js
const pendingBuildAllocations = ref({}) // Čakajúce alokácie work-force pre budovy v animácii: { 'row-col': allocatedWorkItems }
const buildingWorkerCount = ref({}) // Počet pracovníkov na stavbe: { 'row-col': count }
const stoppedByResources = ref({}) // Budovy zastavené kvôli nedostatku surovín: { 'row-col': { row, col, buildingData } }
const selectedBuildingId = ref(null) // Vybraná budova z BuildingSelector
const sidebarTab = ref('resources') // 'resources' | 'buildings'
const filterResourceId = ref(null) // Filter pre BuildingSelector podľa resource
const selectedBuildingDestinationTiles = ref([]) // Destination tiles pre vybranú budovu
const selectedBuildingCanBuildOnlyInDestination = ref(false) // Či vybraná budova môže byť postavená len na destination tiles
const showBuildingModal = ref(false) // Či sa má zobraziť modal s metadátami budovy
const clickedBuilding = ref(null) // Údaje o kliknutej budove
const portPayload = ref([]) // Payload pre port budovu: [{resourceId, resourceName, amount}]
const selectedPayloadResource = ref('') // Vybraná resource pre payload
const payloadAmount = ref(1) // Množstvo pre payload
const payloadDropdownOpen = ref(false) // Či je custom dropdown otvorený
const showInsufficientResourcesModal = ref(false) // Modal pre nedostatok resources
const insufficientResourcesData = ref({ 
  buildingName: '',
  missingBuildResources: [],
  missingOperationalResources: []
})
const ignoreResourceCheck = ref(false) // Checkbox pre ignorovanie kontroly resources
const gameEvents = ref([]) // Zoznam herných eventov
const manuallyStoppedBuildings = ref({}) // Budovy manuálne zastavené používateľom: { 'row-col': true }
const consumptionMap = ref({}) // Mapa spotreby surovín pre priority service: { resourceId: [{ key, row, col, consumption, buildingData }] }

// Hamburger menu state
const hamburgerOpen = ref(false)

// Fullscreen state
const isFullscreen = ref(false)

const toggleFullscreen = () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen()
  } else {
    document.exitFullscreen()
  }
}

const onFullscreenChange = () => {
  isFullscreen.value = !!document.fullscreenElement
}

// Event trigger system
const showEventModal = ref(false) // Whether the event modal is shown
const triggeredEvent = ref(null) // Currently triggered event data
const firedEventIds = ref(new Set()) // IDs of already fired events (fire once per session)
const eventQueue = ref([]) // Queue of events waiting to be shown

// Astronaut sprite
const astronautActive = ref(false)
const advisorSpriteUrl = ref(BASE_URL + 'templates/all/advisor3.png')
const astronautRef = ref(null)
const overproductionCycles = ref({}) // Consecutive full-storage cycles per building: { 'row-col': count }

// Filtrované budovy z galérie (zoradené podľa buildingOrder)
const buildings = computed(() => {
  return images.value
    .filter(img => img.buildingData?.isBuilding === true)
    .sort((a, b) => {
      const orderA = a.buildingData?.buildingOrder ?? 9999
      const orderB = b.buildingData?.buildingOrder ?? 9999
      return orderA - orderB
    })
})

// Computed property pre zistenie či má aktuálna budova zapnutú auto produkciu
const currentBuildingAutoEnabled = computed(() => {
  if (!clickedBuilding.value) return false
  const key = `${clickedBuilding.value.row}-${clickedBuilding.value.col}`
  return buildingProductionStates.value[key]?.enabled || false
})

// Computed property pre progress aktuálnej budovy
const currentBuildingProgress = computed(() => {
  if (!clickedBuilding.value) return 0
  const key = `${clickedBuilding.value.row}-${clickedBuilding.value.col}`
  return productionProgress.value[key] || 0
})

// Computed property pre zistenie či sa kliknutá budova práve stavia (animácia)
const currentBuildingIsAnimating = computed(() => {
  if (!clickedBuilding.value) return false
  const key = `${clickedBuilding.value.row}-${clickedBuilding.value.col}`
  return animatingBuildings.value.has(key)
})

// Computed property pre stav animácie kliknutej budovy: 'waiting' | 'building' | null
const currentBuildingAnimState = computed(() => {
  if (!clickedBuilding.value) return null
  const key = `${clickedBuilding.value.row}-${clickedBuilding.value.col}`
  return animatingBuildings.value.get(key) || null
})

// Computed property pre počet pracovníkov na aktuálne kliknutej budove
const currentBuildingWorkers = computed(() => {
  if (!clickedBuilding.value) return 1
  const key = `${clickedBuilding.value.row}-${clickedBuilding.value.col}`
  return buildingWorkerCount.value[key] || 1
})

// Computed property pre maximálny počet pracovníkov (dostupné + aktuálne alokované)
const maxBuildingWorkers = computed(() => {
  const vehicleRes = resources.value.find(r => r.vehicleAnimation)
  if (!vehicleRes) return 1
  if (!clickedBuilding.value) return 1
  const key = `${clickedBuilding.value.row}-${clickedBuilding.value.col}`
  const currentWorkers = buildingWorkerCount.value[key] || 1
  return currentWorkers + vehicleRes.amount // dostupné + už alokované
})

// Computed property pre aktuálnu váhu payloadu v porte (súčet weight * amount)
const currentPortWeight = computed(() => {
  let totalWeight = 0
  for (const item of portPayload.value) {
    const res = resources.value.find(r => r.id === item.resourceId)
    const weight = res ? (Number(res.weight) || 0) : 0
    totalWeight += weight * item.amount
  }
  return totalWeight
})

// Computed property pre maximálnu kapacitu portu
const portMaxCapacity = computed(() => {
  if (!clickedBuilding.value) return 0
  return Number(clickedBuilding.value.portCapacity) || 0
})

// Computed property pre percentuálne naplnenie portu
const portFillPercent = computed(() => {
  if (portMaxCapacity.value <= 0) return 0
  return Math.min(100, (currentPortWeight.value / portMaxCapacity.value) * 100)
})

// Computed properties pre usedResources a producedResources - používa resourceCalculator service
const usedResources = computed(() => {
  const { usedResources } = calculateResourceUsage(canvasImagesMap.value, images.value)
  return usedResources
})

const producedResources = computed(() => {
  const { producedResources } = calculateResourceUsage(canvasImagesMap.value, images.value)
  return producedResources
})

// Aggregované skladované resources z budov umiestnených na canvase (preskočí budovy v stavebnej animácii)
const storedResources = computed(() => {
  return calculateStoredResources(canvasImagesMap.value, images.value, buildingProductionStates.value, animatingBuildings.value)
})

// Funkcia na kontrolu dostupnosti resources pre budovu - používa resourceCalculator service
const checkBuildingResources = (buildingData) => {
  return checkResources(buildingData, resources.value)
}

// Funkcia na odpočítanie build cost resources - používa resourceCalculator service
const deductBuildCost = (buildingData, row = 0, col = 0) => {
  return deductCost(buildingData, resources.value, allocatedResources.value, workforceAllocations.value, row, col)
}

const handleDelete = (id) => {
  images.value = images.value.filter(img => img.id !== id)
  if (selectedImageId.value === id) {
    selectedImageId.value = images.value.length > 0 ? images.value[0].id : null
  }
}

const handleSelectImage = ({ id, imageData }) => {
  selectedImageId.value = id
  selectedImageData.value = imageData
  console.log(`🖼️ GameView: Vybraný obrázok ID: ${id}`)
}

const handleGridSizeChanged = ({ cellsX, cellsY }) => {
  lastImageCellsX.value = cellsX
  lastImageCellsY.value = cellsY
}

const handleDeleteModeChanged = (isDeleteMode) => {
  deleteMode.value = isDeleteMode
  if (isDeleteMode) {
    selectedImageId.value = null
  }
}

const handleRoadBuildingModeChanged = (isRoadMode) => {
  roadBuildingMode.value = isRoadMode
}

const handleRoadTilesReady = (tiles) => {
  roadTiles.value = tiles
}

const handlePersonSpawnSettingsChanged = ({ enabled, count }) => {
  personSpawnEnabled.value = !!enabled
  const parsed = Number.isFinite(count) ? count : 0
  personSpawnCount.value = Math.max(0, Math.min(500, Math.round(parsed)))
}

watch(roadTiles, (newTiles, oldTiles) => {
  if (oldTiles && oldTiles.length > 0 && newTiles.length > 0) {
    const oldOpacity = oldTiles[0]?.opacity || 100
    const newOpacity = newTiles[0]?.opacity || 100
    
    if (oldOpacity !== newOpacity && canvasRef.value) {
      regenerateRoadTilesOnCanvas(canvasRef.value, newTiles)
    }
  }
}, { deep: true })

// ============================================================
// Shared production helpers (eliminates code duplication)
// ============================================================

// Rebuild consumption map (called when buildings change on canvas)
const rebuildConsumptionMap = () => {
  const result = buildConsumptionMap(
    canvasImagesMap.value, images.value, buildingProductionStates.value,
    animatingBuildings.value, resources.value
  )
  consumptionMap.value = result.consumptionMap
  console.log('📊 Consumption map rebuilt, resources tracked:', Object.keys(consumptionMap.value).length)
}

// Check if enough free work-force for a building (only free, not allocated)
const hasEnoughWorkforceFor = (buildingData) => {
  const operationalCost = buildingData.operationalCost || []
  for (const cost of operationalCost) {
    const resource = resources.value.find(r => r.id === cost.resourceId)
    if (resource && resource.workResource && resource.amount < cost.amount) {
      return false
    }
  }
  return true
}

// Allocate work-force for a building's operational cost
const allocateWorkforceFor = (row, col, buildingData) => {
  const operationalCost = buildingData.operationalCost || []
  operationalCost.forEach(cost => {
    const resource = resources.value.find(r => r.id === cost.resourceId)
    if (resource && resource.workResource) {
      resource.amount -= cost.amount
      if (!allocatedResources.value[cost.resourceId]) allocatedResources.value[cost.resourceId] = 0
      allocatedResources.value[cost.resourceId] += cost.amount
      if (!workforceAllocations.value[cost.resourceId]) workforceAllocations.value[cost.resourceId] = []
      workforceAllocations.value[cost.resourceId].push({
        row, col, amount: cost.amount, type: 'production',
        buildingName: buildingData.buildingName || 'Building'
      })
    }
  })
}

// Deallocate work-force when stopping a building
const deallocateWorkforceFor = (row, col, buildingData) => {
  if (!buildingData?.operationalCost) return
  buildingData.operationalCost.forEach(cost => {
    const resource = resources.value.find(r => r.id === cost.resourceId)
    if (resource && resource.workResource) {
      resource.amount += cost.amount
      if (allocatedResources.value[cost.resourceId]) {
        allocatedResources.value[cost.resourceId] -= cost.amount
        if (allocatedResources.value[cost.resourceId] <= 0) delete allocatedResources.value[cost.resourceId]
      }
      if (workforceAllocations.value[cost.resourceId]) {
        const idx = workforceAllocations.value[cost.resourceId].findIndex(
          a => a.row === row && a.col === col && a.type === 'production'
        )
        if (idx !== -1) {
          workforceAllocations.value[cost.resourceId].splice(idx, 1)
          if (workforceAllocations.value[cost.resourceId].length === 0) delete workforceAllocations.value[cost.resourceId]
        }
      }
    }
  })
}

// Show resource warning indicator on canvas (includes work-force resources)
const showResourceWarning = (row, col, buildingData) => {
  const missingResources = []
  if (buildingData?.operationalCost) {
    buildingData.operationalCost.forEach(cost => {
      const resource = resources.value.find(r => r.id === cost.resourceId)
      if (!resource || resource.amount < cost.amount) {
        missingResources.push({
          id: cost.resourceId, name: cost.resourceName || resource?.name || 'Unknown',
          icon: resource?.icon || '', needed: cost.amount, available: resource?.amount || 0
        })
      }
    })
  }
  if (missingResources.length > 0) {
    canvasRef.value?.showWarningIndicator(row, col, 'resources', missingResources)
  }
}

// Create production interval for a building (simplified - just produce or skip)
const createProductionInterval = (row, col, buildingData) => {
  const key = `${row}-${col}`
  const interval = setInterval(() => {
    const state = buildingProductionStates.value[key]
    if (!state?.enabled) return

    productionProgress.value[key] = 0

    // If not enough resources, just skip this cycle
    // The 3-second priority check will handle stopping if needed
    if (!checkProductionResources(buildingData, resources.value)) return

    canvasRef.value?.hideWarningIndicator(row, col)
    const storageCheck = canStoreProduction(buildingData, resources.value, storedResources.value)
    const opCost = buildingData.operationalCost || []
    const hasAnyOperationalCost = opCost.length > 0
    if (!storageCheck.hasSpace) {
      // Only show storage warning icon if the building has Operating Cost
      if (hasAnyOperationalCost) {
        canvasRef.value?.showWarningIndicator(row, col, 'storage')
      }
      // Track consecutive overproduction cycles
      if (!overproductionCycles.value[key]) overproductionCycles.value[key] = 0
      if (overproductionCycles.value[key] !== 'shown') overproductionCycles.value[key]++
      // Show astronaut warning only after 3+ consecutive cycles (~15s), then once until resolved
      if (overproductionCycles.value[key] >= 3) {
        const opCost = buildingData.operationalCost || []
        const hasNonWorkCost = opCost.length > 0 && opCost.some(c => {
          const res = resources.value.find(r => r.id === c.resourceId)
          return res && !res.workResource
        })
        if (hasNonWorkCost && astronautRef.value && storageCheck.fullResources?.length > 0) {
          const fullRes = storageCheck.fullResources[0]
          const resObj = resources.value.find(r => r.id === fullRes.resourceId)
          const icon = resObj?.icon || null
          const bName = buildingData.buildingName || 'Building'
          astronautRef.value.showMessage(`${bName} produces more ${fullRes.resourceName} than can be stored! Build more storage or reduce production.`, icon, 'storage', astronautRef.value.PRIORITY.STORAGE_FULL, fullRes.resourceId)
          overproductionCycles.value[key] = 'shown' // Mark as shown — won't repeat until storage has space again
        }
      }
    } else {
      // Storage has space again — reset counter
      delete overproductionCycles.value[key]
    }
    executeProduction(buildingData, resources.value, storedResources.value)
  }, 5000)

  productionProgress.value[key] = 0
  const progressInterval = setInterval(() => {
    if (productionProgress.value[key] !== undefined) {
      productionProgress.value[key] = (productionProgress.value[key] + 2) % 100
    }
  }, 100)

  return { interval, progressInterval }
}

// Try to start production for a building (returns true if started)
const tryStartProduction = (row, col, buildingData) => {
  const key = `${row}-${col}`
  if (buildingProductionStates.value[key]?.enabled) return true
  if (manuallyStoppedBuildings.value[key]) return false

  // Check workforce (free resources only)
  if (!hasEnoughWorkforceFor(buildingData)) {
    stoppedByResources.value[key] = { row, col, buildingData }
    showResourceWarning(row, col, buildingData)
    canvasRef.value?.showDisabledOverlay(row, col)
    return false
  }

  // Check material resources
  if (!checkProductionResources(buildingData, resources.value)) {
    stoppedByResources.value[key] = { row, col, buildingData }
    showResourceWarning(row, col, buildingData)
    canvasRef.value?.showDisabledOverlay(row, col)
    return false
  }

  // Allocate workforce and create interval
  allocateWorkforceFor(row, col, buildingData)
  const { interval, progressInterval } = createProductionInterval(row, col, buildingData)
  buildingProductionStates.value[key] = { enabled: true, interval, progressInterval, buildingData }

  // Show indicators
  canvasRef.value?.showAutoProductionIndicator(row, col)
  canvasRef.value?.showProductionEffects(row, col)
  canvasRef.value?.hideDisabledOverlay(row, col)
  canvasRef.value?.hideWarningIndicator(row, col)
  delete stoppedByResources.value[key]

  console.log(`✅ Production started for ${buildingData.buildingName} at [${row}, ${col}]`)
  return true
}

// Fully stop production (for manual stop, delete, recycle, or resource deficit)
// deficitResources: optional array of {resourceId, resourceName, icon, needed, available}
const fullStopProduction = (row, col, reason = 'manual', deficitResources = null) => {
  const key = `${row}-${col}`
  const state = buildingProductionStates.value[key]
  if (!state) return

  if (state.interval) clearInterval(state.interval)
  if (state.progressInterval) clearInterval(state.progressInterval)
  deallocateWorkforceFor(row, col, state.buildingData)
  productionProgress.value[key] = 0
  delete buildingProductionStates.value[key]

  canvasRef.value?.hideAutoProductionIndicator(row, col)
  canvasRef.value?.hideProductionEffects(row, col)

  if (reason === 'manual') {
    manuallyStoppedBuildings.value[key] = true
    delete stoppedByResources.value[key]
    canvasRef.value?.hideWarningIndicator(row, col)
    canvasRef.value?.showDisabledOverlay(row, col)
  } else if (reason === 'resources') {
    stoppedByResources.value[key] = { row, col, buildingData: state.buildingData }
    // Show warning for all deficit resources (including work-force)
    if (deficitResources && deficitResources.length > 0) {
      canvasRef.value?.showWarningIndicator(row, col, 'resources', deficitResources)
    } else {
      showResourceWarning(row, col, state.buildingData)
    }
    canvasRef.value?.showDisabledOverlay(row, col)
  } else if (reason === 'recycle' || reason === 'delete') {
    canvasRef.value?.hideWarningIndicator(row, col)
    delete stoppedByResources.value[key]
  }

  console.log(`⏹️ Production stopped at [${row}, ${col}], reason: ${reason}`)
}

// ============================================================
// 3-second resource priority check
// ============================================================
const resourceCheckInterval = setInterval(() => {
  if (resources.value.length === 0 || Object.keys(canvasImagesMap.value).length === 0) return

  // Clean up invalid stoppedByResources entries
  for (const key of Object.keys(stoppedByResources.value)) {
    if (manuallyStoppedBuildings.value[key] || !canvasImagesMap.value[key]) {
      delete stoppedByResources.value[key]
    }
  }

  // Evaluate priority: which buildings to pause/resume
  const { toPause, toResume } = evaluateResourcePriority(
    resources.value, consumptionMap.value, buildingProductionStates.value,
    manuallyStoppedBuildings.value, stoppedByResources.value
  )

  // Stop buildings with highest consumption of deficit resource
  for (const [key, deficitResources] of toPause) {
    const [row, col] = key.split('-').map(Number)
    console.log(`⛔ Priority stop: [${row}, ${col}] - highest consumer of deficit resource`)
    // Show astronaut warning only for non-work-force resource shortages
    const bldState = buildingProductionStates.value[key]
    const bldName = bldState?.buildingData?.buildingName || 'Building'
    const nonWorkDeficit = deficitResources?.filter(d => {
      const res = resources.value.find(r => r.id === d.id)
      return !res?.workResource
    }) || []
    if (nonWorkDeficit.length > 0 && astronautRef.value) {
      const deficit = nonWorkDeficit[0]
      const resObj = resources.value.find(r => r.id === deficit.id)
      const icon = resObj?.icon || null
      astronautRef.value.showMessage(`Not enough ${deficit.name} to keep ${bldName} running!`, icon, 'resources', astronautRef.value.PRIORITY.RESOURCE_DEFICIT, deficit.id)
    }
    fullStopProduction(row, col, 'resources', deficitResources)
  }

  // Restart buildings that now have enough resources (lowest consumers first)
  for (const key of toResume) {
    const data = stoppedByResources.value[key]
    if (!data) continue
    const { row, col, buildingData } = data
    if (!hasEnoughWorkforceFor(buildingData)) {
      // Update warning to show current missing resources (e.g. workforce deficit instead of old material deficit)
      showResourceWarning(row, col, buildingData)
      continue
    }

    console.log(`🔄 Priority restart: [${row}, ${col}] - resources available`)
    canvasRef.value?.hideWarningIndicator(row, col)
    canvasRef.value?.hideDisabledOverlay(row, col)
    const started = tryStartProduction(row, col, buildingData)
    // Only show astronaut message if production actually started
    if (started && astronautRef.value) {
      astronautRef.value.showMessage(`${buildingData.buildingName || 'Building'} is back in operation!`, null, null, astronautRef.value.PRIORITY.BUILDING_RESUME)
    }
  }
}, 3000)

// Sledovanie predchádzajúcich hodnôt vehicleAnimation/personAnimation resources
const prevAnimationAmounts = ref({})

// Watch na resources - aktualizácia počtu osôb na canvase podľa personAnimation resources
watch(resources, (newResources) => {
  if (!canvasRef.value || !newResources || newResources.length === 0) return

  for (const resource of newResources) {
    if (!resource.personAnimation) continue

    const key = resource.id
    const currentAmount = resource.amount || 0
    const prevAmount = prevAnimationAmounts.value[key] ?? currentAmount

    if (currentAmount === prevAmount) continue

    const diff = currentAmount - prevAmount

    if (diff > 0) {
      console.log(`🚶 Resource '${resource.name}' vzrástol o ${diff} → spawning ${diff} persons`)
      canvasRef.value.spawnPersonsOnAllRoads(diff)
    } else {
      const toRemove = Math.abs(diff)
      console.log(`🚶 Resource '${resource.name}' klesol o ${toRemove} → removing ${toRemove} persons`)
      canvasRef.value.removePersons(toRemove)
    }

    prevAnimationAmounts.value[key] = currentAmount
  }
}, { deep: true })

// ============================================================
// Game Event Trigger System
// ============================================================

const MS_PER_GAME_DAY = 60000
const currentGameDay = computed(() => Math.floor(gameTime.value / MS_PER_GAME_DAY) + 1)

// Fire a game event - show modal and execute actions
const fireGameEvent = (event) => {
  if (firedEventIds.value.has(event.id)) return
  firedEventIds.value.add(event.id)
  
  // If modal is already showing, queue this event
  if (showEventModal.value) {
    eventQueue.value.push(event)
    return
  }
  
  triggeredEvent.value = event
  showEventModal.value = true
  
  // Execute event actions
  executeEventActions(event)
  
  console.log(`🎯 Event triggered: "${event.name}"`)
}

// Execute actions associated with an event
const executeEventActions = (event) => {
  if (!event.actions || event.actions.length === 0) return
  
  for (const action of event.actions) {
    switch (action.type) {
      case 'add_resource': {
        const res = resources.value.find(r => r.id === action.resourceId)
        if (res) {
          res.amount = (res.amount || 0) + (action.amount || 0)
          console.log(`   ➕ Added ${action.amount} to resource "${res.name}"`)
        }
        break
      }
      case 'remove_resource': {
        const res = resources.value.find(r => r.id === action.resourceId)
        if (res) {
          res.amount = Math.max(0, (res.amount || 0) - (action.amount || 0))
          console.log(`   ➖ Removed ${action.amount} from resource "${res.name}"`)
        }
        break
      }
      case 'show_message':
        console.log(`   💬 Event message: ${action.message}`)
        break
      case 'unlock_building':
        console.log(`   🔓 Building unlocked: ${action.buildingId}`)
        break
    }
  }
}

// Close event modal and show next queued event if any
const closeEventModal = () => {
  showEventModal.value = false
  triggeredEvent.value = null
  
  // Show next queued event
  if (eventQueue.value.length > 0) {
    const nextEvent = eventQueue.value.shift()
    setTimeout(() => {
      triggeredEvent.value = nextEvent
      showEventModal.value = true
      executeEventActions(nextEvent)
    }, 300)
  }
}

// Check day events when game day changes
watch(currentGameDay, (newDay, oldDay) => {
  if (newDay === oldDay) return
  
  for (const event of gameEvents.value) {
    if (!event.enabled || event.trigger !== 'day') continue
    if (event.triggerConfig?.day === newDay) {
      fireGameEvent(event)
    }
  }
})

// Check resource events when resources change
watch(resources, (newResources) => {
  if (!newResources || newResources.length === 0) return
  
  for (const event of gameEvents.value) {
    if (!event.enabled || event.trigger !== 'resource') continue
    if (firedEventIds.value.has(event.id)) continue
    
    const config = event.triggerConfig
    if (!config || !config.resourceId) continue
    
    const res = newResources.find(r => r.id === config.resourceId)
    if (!res) continue
    
    // Total amount = available + allocated (allocated are already deducted from amount)
    const allocated = allocatedResources.value[res.id] || 0
    const amount = (res.amount || 0) + allocated
    let shouldFire = false
    
    switch (config.condition) {
      case 'reaches':
        shouldFire = amount >= config.value
        break
      case 'drops_below':
        shouldFire = amount < config.value
        break
      case 'exceeds':
        shouldFire = amount > config.value
        break
      case 'equals':
        shouldFire = amount === config.value
        break
    }
    
    if (shouldFire) {
      fireGameEvent(event)
    }
  }
}, { deep: true })

// Check building events - called from building handlers
const checkBuildingEvents = (conditionType, buildingId = null) => {
  for (const event of gameEvents.value) {
    if (!event.enabled || event.trigger !== 'building') continue
    if (firedEventIds.value.has(event.id)) continue
    
    const config = event.triggerConfig
    if (!config || config.condition !== conditionType) continue
    
    // If event specifies a building, check it matches
    if (config.buildingId && buildingId && config.buildingId !== buildingId) continue
    
    fireGameEvent(event)
  }
}

// ============================================================

const handleRoadOpacityChanged = (newOpacity) => {
  roadOpacity.value = newOpacity
}

const handleRoadPlaced = ({ path }) => {
  buildRoad(canvasRef.value, roadTiles.value, path)
}

const handlePlaceOnBoard = (image) => {
  if (canvasRef.value && selectedCell.value.row !== -1 && selectedCell.value.col !== -1) {
    const cellsX = image.cellsX || lastImageCellsX.value
    const cellsY = image.cellsY || lastImageCellsY.value
    const isRoadTile = image.id?.startsWith('road_tile_')
    
    const tileMetadata = isRoadTile ? {
      name: image.name,
      tileIndex: image.tileIndex,
      x: image.x,
      y: image.y,
      width: image.width,
      height: image.height,
      rotation: image.rotation
    } : null
    
    if (isRoadTile && canvasRef.value.placeImageAtCell) {
      canvasRef.value.placeImageAtCell(
        selectedCell.value.row,
        selectedCell.value.col,
        image.url,
        cellsX,
        cellsY,
        false,
        true,
        image.bitmap || null,
        image.name || '',
        tileMetadata
      )
    } else {
      canvasRef.value.placeImageAtSelectedCell(image.url, cellsX, cellsY, image)
    }
  } else if (canvasRef.value) {
    const cellsX = image.cellsX || lastImageCellsX.value
    const cellsY = image.cellsY || lastImageCellsY.value
    selectedCell.value = { row: 0, col: 0 }
    canvasRef.value.placeImageAtSelectedCell(image.url, cellsX, cellsY, image)
  }
}

const handleCellSelected = ({ row, col }) => {
  selectedCell.value = { row, col }
  
  if (deleteMode.value && canvasRef.value) {
    const cellImages = canvasRef.value.cellImages ? canvasRef.value.cellImages() : {}
    const directKey = `${row}-${col}`
    let targetData = cellImages[directKey]

    if (targetData?.isSecondary && targetData.originRow !== undefined && targetData.originCol !== undefined) {
      const originKey = `${targetData.originRow}-${targetData.originCol}`
      targetData = cellImages[originKey] || targetData
    }

    if (targetData?.buildingData?.isBuilding && !targetData.isRoadTile) {
      // Suroviny sa NEVRACAJU pri zmazaní budovy
    }

    canvasRef.value.deleteImageAtCell(row, col)
    selectedImageId.value = null
    selectedImageData.value = null
    // Aktualizuj canvas mapu pre prepočítanie resources
    handleCanvasUpdated()
    return
  }
  
  if (selectedImageId.value && canvasRef.value) {
    let selectedImage = images.value.find(img => img.id === selectedImageId.value)
    
    if (!selectedImage && selectedImageData.value) {
      selectedImage = selectedImageData.value
    }
    
    if (selectedImage) {
      // Kontrola resources pre budovy - len ak nie je zapnutý ignore checkbox
      if (!ignoreResourceCheck.value && selectedImage.buildingData && selectedImage.buildingData.isBuilding) {
        const resourceCheck = checkBuildingResources(selectedImage.buildingData)
        
        // === Kontrola vehicleAnimation resources (cars) ===
        const hasVehicleResources = resources.value.some(r => r.vehicleAnimation)
        const availableVehicle = hasVehicleResources ? resources.value.find(r => r.vehicleAnimation && r.amount > 0) : null
        const missingVehicle = hasVehicleResources && !availableVehicle
        
        if (!resourceCheck.hasEnough || missingVehicle) {
          // Zobraz modal s chýbajúcimi resources
          const missingBuild = [...resourceCheck.missingBuild]
          if (missingVehicle) {
            const vehicleRes = resources.value.find(r => r.vehicleAnimation)
            missingBuild.push({
              name: vehicleRes.name + ' (vozidlo)',
              needed: 1,
              available: 0,
              isWorkResource: true
            })
          }
          insufficientResourcesData.value = {
            buildingName: selectedImage.buildingData.buildingName || 'Building',
            missingBuildResources: missingBuild,
            missingOperationalResources: resourceCheck.missingOperational
          }
          showInsufficientResourcesModal.value = true
          console.log('⛔ GameView: Nedostatok resources:', resourceCheck, missingVehicle ? '(žiadne dostupné vozidlo)' : '')
          return // Nezakladať budovu
        }
        
        // Odpočítaj build cost resources
        const row = canvasRef.value ? selectedCell.value.row : 0
        const col = canvasRef.value ? selectedCell.value.col : 0
        const allocatedWorkItems = deductBuildCost(selectedImage.buildingData, row, col)
        
        // Zobraz plávajúci efekt mínus resources na canvase
        const buildCostItems = selectedImage.buildingData.buildCost || []
        if (buildCostItems.length > 0 && canvasRef.value) {
          const floatingResources = buildCostItems.map(cost => {
            const resource = resources.value.find(r => r.id === cost.resourceId)
            return {
              id: cost.resourceId,
              name: cost.resourceName || resource?.name || 'Unknown',
              icon: resource?.icon || '',
              amount: cost.amount
            }
          })
          // Odložíme zobrazenie o 300ms aby sa budova stihla umiestniť na canvas
          setTimeout(() => {
            canvasRef.value?.showFloatingResourceCost(row, col, floatingResources)
          }, 300)
        }
        
        // === Alokácia vehicleAnimation resource (car) pre stavbu ===
        if (availableVehicle) {
          availableVehicle.amount -= 1
          if (!allocatedResources.value[availableVehicle.id]) {
            allocatedResources.value[availableVehicle.id] = 0
          }
          allocatedResources.value[availableVehicle.id] += 1
          if (!workforceAllocations.value[availableVehicle.id]) {
            workforceAllocations.value[availableVehicle.id] = []
          }
          workforceAllocations.value[availableVehicle.id].push({
            row, col, amount: 1, type: 'build',
            buildingName: selectedImage.buildingData.buildingName || 'Building'
          })
          allocatedWorkItems.push({
            resourceId: availableVehicle.id,
            amount: 1,
            resourceName: availableVehicle.name
          })
          console.log(`🚗 Alokované vozidlo (build): 1x ${availableVehicle.name} na [${row},${col}], zostatok: ${availableVehicle.amount}`)
        }
        
        // Označ budovu ako animujúcu (stav sa upresní cez building-state-changed event)
        const animKey = `${row}-${col}`
        animatingBuildings.value.set(animKey, 'building')
        buildingWorkerCount.value[animKey] = 1 // Štart s 1 pracovníkom
        console.log(`🏗️ Budova ${animKey} začína stavebnú animáciu`)
        
        // Uložíme alokované work items - budú vrátené keď animácia skutočne dokončí (cez event)
        if (allocatedWorkItems && allocatedWorkItems.length > 0) {
          pendingBuildAllocations.value[animKey] = allocatedWorkItems
        }
      }
      
      const isRoadTile = selectedImageId.value.startsWith('road_tile_')
      
      if (isRoadTile && canvasRef.value.placeImageAtCell) {
        const tileMetadata = {
          name: selectedImage.name,
          tileIndex: selectedImage.tileIndex,
          x: selectedImage.x,
          y: selectedImage.y,
          width: selectedImage.width,
          height: selectedImage.height,
          rotation: selectedImage.rotation
        }
        canvasRef.value.placeImageAtCell(
          row,
          col,
          selectedImage.url,
          lastImageCellsX.value,
          lastImageCellsY.value,
          false,
          true,
          selectedImage.bitmap || null,
          selectedImage.name || '',
          tileMetadata
        )
      } else {
        canvasRef.value.placeImageAtSelectedCell(
          selectedImage.url, 
          lastImageCellsX.value, 
          lastImageCellsY.value, 
          selectedImage, // Pošli cel\u00fd objekt aby sa ulo\u017eili buildingData
          selectedImage.templateName || '',
          isRoadTile
        )
      }
      return
    }
  }
}

const handleImagePlaced = (data) => {
  if (data && data.row !== undefined && data.col !== undefined) {
    selectedCell.value = { row: -1, col: -1 }
  }
  // Show astronaut message for building placement
  if (selectedBuildingId.value) {
    const building = images.value.find(img => img.id === selectedBuildingId.value)
    const name = building?.buildingData?.buildingName || 'a building'
    if (astronautRef.value) {
      astronautRef.value.showMessage(`Time to build ${name}!`, null, null, astronautRef.value.PRIORITY.BUILDING_PLACED)
    }
  }
  handleCanvasUpdated()
}

const handleToggleNumbering = (value) => {
  showNumbering.value = value
}

const handleToggleGallery = (value) => {
  showGallery.value = value
}

const handleToggleGrid = (value) => {
  showGrid.value = value
}

const handleLoadProject = async (projectData) => {
  console.log('📂 GameView: Začínam načítavať projekt')
  
  // Nastav loading state
  isLoading.value = true
  loadingProgress.value = 0
  loadingStatus.value = 'Načítavam projekt...'
  
  try {
    // Použiť projectLoader service
    const loadedData = await loadProject(
      projectData,
      canvasRef.value,
      (progress, status) => {
        loadingProgress.value = progress
        loadingStatus.value = status
      }
    )
    
    // Aplikuj načítané dáta
    roadTiles.value = loadedData.roadTiles
    environmentColors.value = loadedData.environmentColors
    textureSettings.value = loadedData.textureSettings
    resources.value = loadedData.resources
    workforce.value = loadedData.workforce
    gameEvents.value = loadedData.events || []
    roadSpriteUrl.value = loadedData.roadSpriteUrl
    roadOpacity.value = loadedData.roadOpacity
    gameTime.value = loadedData.gameTime || 0
    
    // Apply construct/temp building sprites from JSON (base64)
    if (loadedData.constructSpriteUrl && canvasRef.value?.updateStructureSprite) {
      canvasRef.value.updateStructureSprite('construct', loadedData.constructSpriteUrl)
    }
    if (loadedData.tempBuildingSpriteUrl && canvasRef.value?.updateStructureSprite) {
      canvasRef.value.updateStructureSprite('tempBuilding', loadedData.tempBuildingSpriteUrl)
    }
    
    // Apply car sprites from JSON (base64)
    if (loadedData.carSprite1Url && canvasRef.value?.updateCarSprite) {
      canvasRef.value.updateCarSprite('car1', loadedData.carSprite1Url)
    }
    if (loadedData.carSprite2Url && canvasRef.value?.updateCarSprite) {
      canvasRef.value.updateCarSprite('car2', loadedData.carSprite2Url)
    }
    
    // Apply person sprite from JSON
    if (loadedData.personSpriteUrl && canvasRef.value?.updatePersonSprite) {
      canvasRef.value.updatePersonSprite(loadedData.personSpriteUrl)
    }
    
    // Apply advisor sprite from JSON
    if (loadedData.advisorSpriteUrl) {
      advisorSpriteUrl.value = loadedData.advisorSpriteUrl
    }
    
    // Načítaj images
    const loadedImages = loadedData.images || []
    
    if (loadedImages.length === 0) {
      images.value = []
      selectedImageId.value = null
    } else {
      images.value = loadedImages.map(img => ({
        id: img.id || Date.now().toString() + Math.random(),
        url: img.url,
        prompt: img.prompt || '',
        negativePrompt: img.negativePrompt || '',
        cellsX: img.cellsX || 1,
        cellsY: img.cellsY || 1,
        view: img.view || '',
        timestamp: img.timestamp ? new Date(img.timestamp) : new Date(),
        buildingData: img.buildingData || null
      }))
      
      if (images.value.length > 0) {
        selectedImageId.value = null
      }
    }
    
    // Aktualizuj canvas mapu
    setTimeout(() => {
      handleCanvasUpdated()
      
      console.log('🔍 DEBUG: Kontrolujem buildingProductionStates...', loadedData.buildingProductionStates)
      console.log('🔍 DEBUG: loadedData typ:', typeof loadedData.buildingProductionStates)
      console.log('🔍 DEBUG: loadedData keys:', loadedData.buildingProductionStates ? Object.keys(loadedData.buildingProductionStates) : 'undefined')
      
      // Obnov production states pre budovy
      if (loadedData.buildingProductionStates && Object.keys(loadedData.buildingProductionStates).length > 0) {
        console.log('🔄 GameView: Restoring auto-production states...', Object.keys(loadedData.buildingProductionStates).length, 'buildings')
        
        Object.entries(loadedData.buildingProductionStates).forEach(([key, state]) => {
          if (state.enabled && state.buildingData) {
            const [row, col] = key.split('-').map(Number)
            const cellImages = canvasRef.value?.cellImages()
            
            if (cellImages && cellImages[key]) {
              tryStartProduction(row, col, state.buildingData)
            } else {
              console.warn(`⚠️ Building at [${row}, ${col}] not on canvas, skipping auto-production`)
            }
          }
        })
      } else {
        console.log('⚠️ GameView: No buildingProductionStates to restore')
        console.log('   - buildingProductionStates existuje:', !!loadedData.buildingProductionStates)
        console.log('   - počet kľúčov:', loadedData.buildingProductionStates ? Object.keys(loadedData.buildingProductionStates).length : 0)
      }
      
      // Spawn cars a persons podľa resources s vehicleAnimation/personAnimation
      setTimeout(() => {
        if (canvasRef.value && resources.value.length > 0) {
          // Spawn cars pre resources s vehicleAnimation: true
          resources.value.forEach(resource => {
            if (resource.vehicleAnimation && resource.amount > 0) {
              console.log(`🚗 Spawning ${resource.amount} cars pre resource '${resource.name}'`)
              canvasRef.value.spawnCarsOnAllRoads(resource.amount)
            }
          })
          // Spawn persons pre resources s personAnimation: true
          resources.value.forEach(resource => {
            if (resource.personAnimation && resource.amount > 0) {
              console.log(`🚶 Spawning ${resource.amount} persons pre resource '${resource.name}'`)
              canvasRef.value.spawnPersonsOnAllRoads(resource.amount)
            }
          })
          // Inicializuj prevAnimationAmounts aby watch nedetekoval zmenu
          resources.value.forEach(resource => {
            if (resource.vehicleAnimation || resource.personAnimation) {
              prevAnimationAmounts.value[resource.id] = resource.amount || 0
            }
          })
        }
      }, 800)

      // Ukončenie loading state
      setTimeout(() => {
        isLoading.value = false
        loadingProgress.value = 100
        loadingStatus.value = 'Projekt načítaný!'
        console.log('✅ GameView: Projekt úspešne načítaný')
        
        // Trigger astronaut sprite animation
        astronautActive.value = true
      }, 500)
    }, 500)
    
  } catch (error) {
    console.error('❌ GameView: Chyba pri načítaní projektu:', error)
    isLoading.value = false
    loadingStatus.value = 'Chyba pri načítaní projektu'
  }
}

const handleUpdateResources = (data) => {
  resources.value = data.resources || []
  workforce.value = data.workforce || []
}

const handleEffectChanged = (effectName) => {
  if (canvasRef.value && canvasRef.value.applyEffect) {
    canvasRef.value.applyEffect(effectName)
  }
}

const handleUpdateBuildingData = ({ imageId, buildingData }) => {
  const image = images.value.find(img => img.id === imageId)
  if (image) {
    image.buildingData = {
      isBuilding: buildingData.isBuilding,
      isCommandCenter: buildingData.isCommandCenter,
      isPort: buildingData.isPort,
      canBuildOnlyInDestination: buildingData.canBuildOnlyInDestination,
      destinationTiles: buildingData.destinationTiles,
      buildingName: buildingData.buildingName,
      buildingSize: buildingData.buildingSize,
      dontDropShadow: buildingData.dontDropShadow,
      buildCost: buildingData.buildCost,
      operationalCost: buildingData.operationalCost,
      production: buildingData.production,
      stored: buildingData.stored,
      allowedResources: buildingData.allowedResources,
      portCapacity: buildingData.portCapacity,
      hasSmokeEffect: buildingData.hasSmokeEffect,
      smokeSpeed: buildingData.smokeSpeed,
      smokeScale: buildingData.smokeScale,
      smokeAlpha: buildingData.smokeAlpha,
      smokeTint: buildingData.smokeTint,
      hasLightEffect: buildingData.hasLightEffect,
      hasFlyAwayEffect: buildingData.hasFlyAwayEffect,
      lightBlinkSpeed: buildingData.lightBlinkSpeed,
      lightColor: buildingData.lightColor,
      lightSize: buildingData.lightSize
    }
  }
}

// Handler pre command center selection - command center môže byť len jeden
const handleCommandCenterSelected = (selectedImageId) => {
  // Prejdi všetky obrázky a zruš command center na všetkých okrem aktuálneho
  images.value.forEach(img => {
    if (img.id !== selectedImageId && img.buildingData?.isCommandCenter) {
      img.buildingData.isCommandCenter = false
      console.log('❌ GameView: Command center zrušený na obrázku:', img.id)
    }
  })
  console.log('🏛️ GameView: Command center nastavený na:', selectedImageId)
}

// Spusti auto produkciu pre konkrétnu budovu (volaná po dokončení stavebnej animácie)
const startAutoProductionForBuilding = (row, col) => {
  const key = `${row}-${col}`
  delete stoppedByResources.value[key]
  canvasRef.value?.hideDisabledOverlay(row, col)

  const mapData = canvasImagesMap.value[key]
  if (!mapData) return
  if (buildingProductionStates.value[key]?.enabled) return

  const matchingImage = images.value.find(img => img.id === mapData.imageId)
  const bd = mapData.buildingData || matchingImage?.buildingData
  if (!bd?.isBuilding) return

  const buildingDataForProduction = {
    row, col,
    buildingName: bd.buildingName,
    isCommandCenter: bd.isCommandCenter || false,
    isPort: bd.isPort || false,
    operationalCost: bd.operationalCost || [],
    production: bd.production || [],
    stored: bd.stored || []
  }

  tryStartProduction(row, col, buildingDataForProduction)
  rebuildConsumptionMap()
}

// Aktualizuj mapu budov na canvase
const handleCanvasUpdated = () => {
  if (canvasRef.value && canvasRef.value.cellImages) {
    const cellImages = canvasRef.value.cellImages()
    const newMap = {}
    
    // Získaj staré kľúče pred aktualizáciou
    const oldKeys = new Set(Object.keys(canvasImagesMap.value))
    
    Object.entries(cellImages).forEach(([key, data]) => {
      // Preskočíme sekundárne bunky multi-cell budov
      if (data.isSecondary) {
        return
      }
      
      // Najprv skús matchovať podľa libraryImageId (stabilné - nemení sa pri výmene obrázka)
      let matchingImage = null
      if (data.libraryImageId) {
        matchingImage = images.value.find(img => img.id === data.libraryImageId)
      }
      // Fallback na URL alebo templateName
      if (!matchingImage) {
        matchingImage = images.value.find(img => 
          img.url === data.url || 
          (data.templateName && img.templateName === data.templateName)
        )
      }
      
      // Použij buildingData z canvas položky (má prednosť) alebo z image library
      const buildingData = data.buildingData || matchingImage?.buildingData || null
      
      if (matchingImage || buildingData) {
        newMap[key] = {
          imageId: matchingImage?.id || null,
          url: data.url,
          templateName: data.templateName,
          isSecondary: false,
          buildingData: buildingData
        }
        // Propaguj imageId späť do cellImages ak chýba (napr. po load z JSON)
        if (matchingImage && !data.libraryImageId && canvasRef.value?.setCellImageLibraryId) {
          canvasRef.value.setCellImageLibraryId(key, matchingImage.id)
        }
      }
    })
    
    // Skontroluj či sa niektoré budovy vymazali a zastav ich auto-produkciu + skry warning indikátory
    const newKeys = new Set(Object.keys(newMap))
    oldKeys.forEach(oldKey => {
      if (!newKeys.has(oldKey)) {
        // Budova bola vymazaná
        const [row, col] = oldKey.split('-').map(Number)
        
        // Zastavenie auto-produkcie (ak bežala)
        const state = buildingProductionStates.value[oldKey]
        if (state && state.interval) {
          clearInterval(state.interval)
          delete buildingProductionStates.value[oldKey]
          console.log(`⏹️ Auto-produkcia zastavená pre vymazanú budovu na [${row}, ${col}]`)
        }
        
        // Vrátenie pending build alokácií (vrátane vehicleAnimation resources)
        const pendingAlloc = pendingBuildAllocations.value[oldKey]
        if (pendingAlloc && pendingAlloc.length > 0) {
          returnBuildWorkforce(pendingAlloc, resources.value, allocatedResources.value, workforceAllocations.value, row, col)
          delete pendingBuildAllocations.value[oldKey]
          console.log(`🚗 Vrátené pending build alokácie pre vymazanú budovu na [${row}, ${col}]`)
        }
        
        // Odstráň z animujúcich budov
        animatingBuildings.value.delete(oldKey)
        delete buildingWorkerCount.value[oldKey] // Vyčisti worker count
        
        // Skrytie warning indikátora
        canvasRef.value?.hideWarningIndicator(row, col)
        
        // Skrytie disabled overlay
        canvasRef.value?.hideDisabledOverlay(row, col)
        
        // Skrytie auto-production indikátora
        canvasRef.value?.hideAutoProductionIndicator(row, col)
      }
    })
    
    canvasImagesMap.value = newMap
    console.log('🔄 GameView: Canvas aktualizovaný, budov na canvase:', Object.keys(newMap).length)
    
    // Automaticky spusti auto produkciu pre všetky nové budovy ktoré majú produkciu
    nextTick(() => {
      Object.entries(newMap).forEach(([key, mapData]) => {
        const [row, col] = key.split('-').map(Number)
        const matchingImage = images.value.find(img => img.id === mapData.imageId)
        
        // Použi buildingData z mapy (má prednosť) alebo z image library
        const bd = mapData.buildingData || matchingImage?.buildingData
        
        // Ak budova je building a ešte nemá zapnutú auto produkciu (produkcia môže byť aj prázdna)
        // Preskočíme budovy ktoré sú ešte v stavebnej animácii
        // Preskočíme port budovy - tie sa spúšťajú manuálne
        if (bd?.isBuilding && 
            !bd.isPort &&
            !buildingProductionStates.value[key]?.enabled &&
            !animatingBuildings.value.has(key)) {
          
          const buildingDataForProduction = {
            row, col,
            buildingName: bd.buildingName,
            isCommandCenter: bd.isCommandCenter || false,
            isPort: bd.isPort || false,
            operationalCost: bd.operationalCost || [],
            production: bd.production || [],
            stored: bd.stored || []
          }
          
          tryStartProduction(row, col, buildingDataForProduction)
        }
      })
    })
  }

  // Prebuduj mapu spotreby surovín po zmene budov na canvase
  rebuildConsumptionMap()
}

// Handler pre výber budovy z BuildingSelector
const handleBuildingSelected = (data) => {
  // Ak je data null, odznač budovu
  if (data === null) {
    selectedBuildingId.value = null
    selectedImageId.value = null
    selectedImageData.value = null
    selectedBuildingDestinationTiles.value = []
    selectedBuildingCanBuildOnlyInDestination.value = false
    console.log('🏗️ GameView: Budova odznačená')
    return
  }
  
  const { building, cellsX, cellsY } = data
  selectedBuildingId.value = building.id
  selectedImageId.value = building.id
  selectedImageData.value = building
  lastImageCellsX.value = cellsX
  lastImageCellsY.value = cellsY
  
  // Extrahuj destination tiles ak má budova toto obmedzenie
  if (building.buildingData?.canBuildOnlyInDestination && building.buildingData?.destinationTiles) {
    selectedBuildingCanBuildOnlyInDestination.value = true
    selectedBuildingDestinationTiles.value = building.buildingData.destinationTiles
    console.log('🎯 GameView: Budova má destination restriction:', selectedBuildingDestinationTiles.value.length, 'tiles')
  } else {
    selectedBuildingCanBuildOnlyInDestination.value = false
    selectedBuildingDestinationTiles.value = []
  }
  
  // Zruš road building mode, bulldozer mode a recycle mode pri výbere budovy
  roadBuildingMode.value = false
  roadDeleteMode.value = false
  deleteMode.value = false
  recycleMode.value = false
  
  console.log(`🏗️ GameView: Vybraná budova: ${building.buildingData?.buildingName} (${cellsX}x${cellsY})`)
}

// Handler pre prepnutie road building mode z RoadSelector
const handleRoadModeToggled = (isEnabled) => {
  roadBuildingMode.value = isEnabled
  if (isEnabled) {
    // Zrušiť výber budovy a ostatné modes pri zapnutí road mode
    selectedBuildingId.value = null
    selectedImageId.value = null
    roadDeleteMode.value = false
    recycleMode.value = false
  }
  console.log(`🛣️ GameView: Road building mode: ${isEnabled ? 'ON' : 'OFF'}`)
}

// Handler pre prepnutie road delete mode z RoadSelector
const handleRoadDeleteModeToggled = (isEnabled) => {
  roadDeleteMode.value = isEnabled
  if (isEnabled) {
    // Zrušiť výber budovy a ostatné modes pri zapnutí delete mode
    selectedBuildingId.value = null
    selectedImageId.value = null
    roadBuildingMode.value = false
    recycleMode.value = false
  }
  console.log(`🚜 GameView: Road delete mode: ${isEnabled ? 'ON' : 'OFF'}`)
}

// Handler pre kliknutie na budovu na canvase
const handleBuildingClicked = ({ row, col, buildingData }) => {
  console.log('🏗️ GameView: Kliknuté na budovu na pozícii:', row, col, buildingData)
  
  // buildingData z canvasu už obsahuje všetky potrebné údaje vrátane buildingData
  if (buildingData && buildingData.buildingData) {
    // Normálne na origin súradnice pre multi-cell budovy
    let originRow = row
    let originCol = col
    
    if (buildingData.isSecondary) {
      originRow = buildingData.originRow
      originCol = buildingData.originCol
      console.log(`🔄 Sekundárna bunka - používam origin: [${originRow}, ${originCol}]`)
    }
    
    clickedBuilding.value = {
      row: originRow,
      col: originCol,
      ...buildingData.buildingData,
      imageUrl: buildingData.url
    }
    showBuildingModal.value = true
    
    // Zvýrazni tile pod budovou
    const size = buildingData.buildingData?.buildingSize || '1x1'
    const [bsX, bsY] = size.split('x').map(Number)
    canvasRef.value?.highlightBuildingTile(originRow, originCol, bsX || 1, bsY || 1)
    
    console.log('📋 Zobrazujem metadata budovy:', clickedBuilding.value)
  } else {
    console.warn('⚠️ Budova nemá metadata:', buildingData)
  }
}

// Handler pre zmazanie budovy (bulldozer/road delete mode)
const handleBuildingDeleted = ({ row, col, buildingData }) => {
  // Suroviny sa NEVRACAJU pri zmazaní budovy
  
  // Vrátenie pending build alokácií (vrátane vehicleAnimation resources) ak bola budova v stavbe
  if (row !== undefined && col !== undefined) {
    const key = `${row}-${col}`
    const pendingAlloc = pendingBuildAllocations.value[key]
    if (pendingAlloc && pendingAlloc.length > 0) {
      returnBuildWorkforce(pendingAlloc, resources.value, allocatedResources.value, workforceAllocations.value, row, col)
      delete pendingBuildAllocations.value[key]
      console.log(`🚗 Vrátené pending build alokácie pre zmazanú budovu na [${row}, ${col}]`)
    }
    // Odstráň z animujúcich budov
    animatingBuildings.value.delete(key)
    delete buildingWorkerCount.value[key] // Vyčisti worker count
    // Odstráň z auto-restart sledovania pri zmazaní budovy
    delete stoppedByResources.value[key]
    // Odstráň z manuálne zastavených budov
    delete manuallyStoppedBuildings.value[key]
    // Vyčisti recykláciu ak bola budova v recyklačnom procese
    delete recyclingBuildings.value[key]
    // Prebuduj mapu spotreby surovín
    rebuildConsumptionMap()
    
    // Trigger building destroyed event
    const deletedBuildingId = buildingData?.buildingData?.id || buildingData?.id || null
    checkBuildingEvents('destroyed', deletedBuildingId)
  }
}

// Handler pre zmenu stavu stavby budovy (waiting/building)
const handleBuildingStateChanged = ({ row, col, state }) => {
  const key = `${row}-${col}`
  animatingBuildings.value.set(key, state)
  console.log(`🏗️ Budova [${row}, ${col}] stav: ${state}`)
}

// Handler pre dokončenie stavebnej animácie budovy (skutočné dokončenie, rešpektuje pauzy)
const handleBuildingConstructionComplete = ({ row, col }) => {
  const key = `${row}-${col}`
  
  // Vráť work-force ak boli alokované
  const allocatedWorkItems = pendingBuildAllocations.value[key]
  if (allocatedWorkItems && allocatedWorkItems.length > 0) {
    returnBuildWorkforce(allocatedWorkItems, resources.value, allocatedResources.value, workforceAllocations.value, row, col)
    delete pendingBuildAllocations.value[key]
  }
  
  // Odstráň z animujúcich
  animatingBuildings.value.delete(key)
  delete buildingWorkerCount.value[key] // Vyčisti worker count
  console.log(`✅ Budova ${key} skutočne dokončená, spúšťam auto produkciu`)
  
  // Trigger building built event
  const builtBuildingData = canvasRef.value?.cellImages?.()[key]
  const builtBuildingId = builtBuildingData?.buildingData?.id || null
  checkBuildingEvents('built', builtBuildingId)
  
  // Show astronaut message for completed building
  const buildingName = builtBuildingData?.buildingData?.buildingName || 'Building'
  if (astronautRef.value) {
    astronautRef.value.showMessage(`${buildingName} is ready!`, null, null, astronautRef.value.PRIORITY.BUILDING_COMPLETE)
  }
  
  // Spusti auto produkciu pre túto budovu
  startAutoProductionForBuilding(row, col)
}

// Handler pre prepnutie recycle mode
const handleRecycleModeToggled = (isEnabled) => {
  recycleMode.value = isEnabled
  if (isEnabled) {
    // Zrušiť výber budovy a ostatné modes pri zapnutí recycle mode
    selectedBuildingId.value = null
    selectedImageId.value = null
    roadBuildingMode.value = false
    roadDeleteMode.value = false
    deleteMode.value = false
  }
  console.log(`♻️ GameView: Recycle mode: ${isEnabled ? 'ON' : 'OFF'}`)
}

// Handler pre kliknutie na budovu v recycle mode
const handleBuildingRecycled = ({ row, col, buildingData, cellsX, cellsY }) => {
  const key = `${row}-${col}`
  console.log(`♻️ GameView: Recyklácia budovy [${row}, ${col}]`, buildingData?.buildingName)

  // Kontrola vehicleAnimation resource
  const vehicleRes = resources.value.find(r => r.vehicleAnimation)
  if (!vehicleRes || vehicleRes.amount < 1) {
    console.log(`⛔ Nedostatok vozidiel pre recykláciu`)
    // Zobraz modal s chybou
    const missingBuild = []
    if (vehicleRes) {
      missingBuild.push({
        resourceName: vehicleRes.name,
        required: 1,
        available: vehicleRes.amount,
        isVehicle: true
      })
    }
    insufficientResourcesData.value = {
      buildingName: buildingData?.buildingName || 'Building',
      missingBuildResources: missingBuild,
      missingOperationalResources: []
    }
    showInsufficientResourcesModal.value = true
    return
  }

  // Zastavenie auto produkcie budovy ak beží
  stopAutoProduction(row, col, 'recycle')

  // Alokuj 1 vehicleAnimation resource
  vehicleRes.amount -= 1
  if (!allocatedResources.value[vehicleRes.id]) {
    allocatedResources.value[vehicleRes.id] = 0
  }
  allocatedResources.value[vehicleRes.id] += 1
  if (!workforceAllocations.value[vehicleRes.id]) {
    workforceAllocations.value[vehicleRes.id] = []
  }
  workforceAllocations.value[vehicleRes.id].push({
    row, col, amount: 1, type: 'recycle',
    buildingName: buildingData?.buildingName || 'Building'
  })

  // Track pending allocations for cleanup
  pendingBuildAllocations.value[key] = [{
    resourceId: vehicleRes.id,
    amount: 1,
    resourceName: vehicleRes.name
  }]

  // Track as recycling building
  recyclingBuildings.value[key] = {
    buildingData,
    workerCount: 1
  }
  buildingWorkerCount.value[key] = 1

  console.log(`♻️🚗 Alokované vozidlo (recycle): 1x ${vehicleRes.name} na [${row},${col}], zostatok: ${vehicleRes.amount}`)

  // Spusti recyklačnú animáciu na canvase
  const buildCost = buildingData?.buildCost || []
  canvasRef.value?.startRecycleForBuilding(row, col, buildCost, () => {
    // onComplete callback - vráť suroviny a vyčisti
    console.log(`♻️✅ GameView: Recyklácia dokončená [${row}, ${col}], vraciam suroviny`)

    // Vráť build cost suroviny (okrem work-force)
    refundBuildCostOnDelete(buildingData, resources.value)

    // Vráť alokované vehicleAnimation resources
    const pendingAlloc = pendingBuildAllocations.value[key]
    if (pendingAlloc && pendingAlloc.length > 0) {
      returnBuildWorkforce(pendingAlloc, resources.value, allocatedResources.value, workforceAllocations.value, row, col)
      delete pendingBuildAllocations.value[key]
    }

    // Vyčisti tracking
    delete recyclingBuildings.value[key]
    delete buildingWorkerCount.value[key]
    animatingBuildings.value.delete(key)
    delete stoppedByResources.value[key]

    // Prebuduj mapu spotreby surovín po recyklácii
    rebuildConsumptionMap()

    // Zatvor modal ak je otvorený pre túto budovu
    if (showBuildingModal.value && clickedBuilding.value && 
        clickedBuilding.value.row === row && clickedBuilding.value.col === col) {
      showBuildingModal.value = false
      clickedBuilding.value = null
    }
  })

  // Označ budovu ako animujúcu
  animatingBuildings.value.set(key, 'recycling')
}

// Handler pre zmenu počtu pracovníkov na stavbe
const changeConstructionWorkers = (newCount) => {
  if (!clickedBuilding.value) return
  const { row, col } = clickedBuilding.value
  const key = `${row}-${col}`
  const currentCount = buildingWorkerCount.value[key] || 1
  newCount = Math.max(1, Math.round(newCount))
  
  if (newCount === currentCount) return
  
  const vehicleRes = resources.value.find(r => r.vehicleAnimation)
  if (!vehicleRes) return
  
  const diff = newCount - currentCount
  
  if (diff > 0) {
    // Pridávame pracovníkov - kontrola dostupnosti
    if (vehicleRes.amount < diff) {
      console.log(`⛔ Nedostatok vozidiel: potreba ${diff}, dostupné ${vehicleRes.amount}`)
      return
    }
    
    // Alokuj ďalšie vozidlá
    vehicleRes.amount -= diff
    if (!allocatedResources.value[vehicleRes.id]) {
      allocatedResources.value[vehicleRes.id] = 0
    }
    allocatedResources.value[vehicleRes.id] += diff
    
    // Pridaj do workforce alokácií
    if (!workforceAllocations.value[vehicleRes.id]) {
      workforceAllocations.value[vehicleRes.id] = []
    }
    // Aktualizuj existujúcu alokáciu alebo pridaj novú
    const existingAlloc = workforceAllocations.value[vehicleRes.id].find(
      a => a.row === row && a.col === col && a.type === 'build'
    )
    if (existingAlloc) {
      existingAlloc.amount += diff
    } else {
      workforceAllocations.value[vehicleRes.id].push({
        row, col, amount: diff, type: 'build',
        buildingName: clickedBuilding.value.buildingName || 'Building'
      })
    }
    
    // Pridaj do pending build alokácií (pre návrat pri dokončení/zmazaní)
    if (!pendingBuildAllocations.value[key]) {
      pendingBuildAllocations.value[key] = []
    }
    const existingPending = pendingBuildAllocations.value[key].find(a => a.resourceId === vehicleRes.id)
    if (existingPending) {
      existingPending.amount += diff
    } else {
      pendingBuildAllocations.value[key].push({
        resourceId: vehicleRes.id,
        amount: diff,
        resourceName: vehicleRes.name
      })
    }
    
    // Dispatch extra cars k budove
    for (let i = 0; i < diff; i++) {
      if (canvasRef.value?.dispatchExtraCarToBuilding) {
        canvasRef.value.dispatchExtraCarToBuilding(row, col)
      }
    }
    
    console.log(`👷 Pridaní ${diff} pracovníci na [${row},${col}], celkom: ${newCount}, zostatok vozidiel: ${vehicleRes.amount}`)
  } else {
    // Odoberáme pracovníkov - vrátime vozidlá
    const returnCount = Math.abs(diff)
    vehicleRes.amount += returnCount
    if (allocatedResources.value[vehicleRes.id]) {
      allocatedResources.value[vehicleRes.id] -= returnCount
      if (allocatedResources.value[vehicleRes.id] <= 0) {
        delete allocatedResources.value[vehicleRes.id]
      }
    }
    
    // Aktualizuj workforce alokácie
    if (workforceAllocations.value[vehicleRes.id]) {
      const alloc = workforceAllocations.value[vehicleRes.id].find(
        a => a.row === row && a.col === col && a.type === 'build'
      )
      if (alloc) {
        alloc.amount -= returnCount
        if (alloc.amount <= 0) {
          const idx = workforceAllocations.value[vehicleRes.id].indexOf(alloc)
          workforceAllocations.value[vehicleRes.id].splice(idx, 1)
        }
      }
    }
    
    // Aktualizuj pending build alokácie
    if (pendingBuildAllocations.value[key]) {
      const pendingAlloc = pendingBuildAllocations.value[key].find(a => a.resourceId === vehicleRes.id)
      if (pendingAlloc) {
        pendingAlloc.amount -= returnCount
        if (pendingAlloc.amount <= 0) {
          const idx = pendingBuildAllocations.value[key].indexOf(pendingAlloc)
          pendingBuildAllocations.value[key].splice(idx, 1)
        }
      }
    }
    
    console.log(`👷 Odobratí ${returnCount} pracovníci z [${row},${col}], celkom: ${newCount}, zostatok vozidiel: ${vehicleRes.amount}`)
  }
  
  // Aktualizuj worker count
  buildingWorkerCount.value[key] = newCount
  
  // Nastav animation speed
  if (canvasRef.value?.setConstructionWorkers) {
    canvasRef.value.setConstructionWorkers(row, col, newCount)
  }
}

// Handler pre zmenu počtu vozidiel na recyklácii (analogické k changeConstructionWorkers)
const changeRecycleWorkers = (newCount) => {
  if (!clickedBuilding.value) return
  const { row, col } = clickedBuilding.value
  const key = `${row}-${col}`
  const currentCount = buildingWorkerCount.value[key] || 1
  newCount = Math.max(1, Math.round(newCount))
  
  if (newCount === currentCount) return
  
  const vehicleRes = resources.value.find(r => r.vehicleAnimation)
  if (!vehicleRes) return
  
  const diff = newCount - currentCount
  
  if (diff > 0) {
    // Pridávame vozidlá - kontrola dostupnosti
    if (vehicleRes.amount < diff) {
      console.log(`⛔ Nedostatok vozidiel pre recykláciu: potreba ${diff}, dostupné ${vehicleRes.amount}`)
      return
    }
    
    // Alokuj ďalšie vozidlá
    vehicleRes.amount -= diff
    if (!allocatedResources.value[vehicleRes.id]) {
      allocatedResources.value[vehicleRes.id] = 0
    }
    allocatedResources.value[vehicleRes.id] += diff
    
    // Pridaj do workforce alokácií
    if (!workforceAllocations.value[vehicleRes.id]) {
      workforceAllocations.value[vehicleRes.id] = []
    }
    const existingAlloc = workforceAllocations.value[vehicleRes.id].find(
      a => a.row === row && a.col === col && a.type === 'recycle'
    )
    if (existingAlloc) {
      existingAlloc.amount += diff
    } else {
      workforceAllocations.value[vehicleRes.id].push({
        row, col, amount: diff, type: 'recycle',
        buildingName: clickedBuilding.value.buildingName || 'Building'
      })
    }
    
    // Pridaj do pending build alokácií
    if (!pendingBuildAllocations.value[key]) {
      pendingBuildAllocations.value[key] = []
    }
    const existingPending = pendingBuildAllocations.value[key].find(a => a.resourceId === vehicleRes.id)
    if (existingPending) {
      existingPending.amount += diff
    } else {
      pendingBuildAllocations.value[key].push({
        resourceId: vehicleRes.id,
        amount: diff,
        resourceName: vehicleRes.name
      })
    }
    
    // Dispatch extra cars k budove na recykláciu
    for (let i = 0; i < diff; i++) {
      if (canvasRef.value?.dispatchExtraCarToRecycle) {
        canvasRef.value.dispatchExtraCarToRecycle(row, col)
      }
    }
    
    console.log(`♻️🚗 Pridané ${diff} vozidlá na recykláciu [${row},${col}], celkom: ${newCount}, zostatok: ${vehicleRes.amount}`)
  } else {
    // Odoberáme vozidlá
    const returnCount = Math.abs(diff)
    vehicleRes.amount += returnCount
    if (allocatedResources.value[vehicleRes.id]) {
      allocatedResources.value[vehicleRes.id] -= returnCount
      if (allocatedResources.value[vehicleRes.id] <= 0) {
        delete allocatedResources.value[vehicleRes.id]
      }
    }
    
    // Aktualizuj workforce alokácie
    if (workforceAllocations.value[vehicleRes.id]) {
      const alloc = workforceAllocations.value[vehicleRes.id].find(
        a => a.row === row && a.col === col && a.type === 'recycle'
      )
      if (alloc) {
        alloc.amount -= returnCount
        if (alloc.amount <= 0) {
          const idx = workforceAllocations.value[vehicleRes.id].indexOf(alloc)
          workforceAllocations.value[vehicleRes.id].splice(idx, 1)
        }
      }
    }
    
    // Aktualizuj pending build alokácie
    if (pendingBuildAllocations.value[key]) {
      const pendingAlloc = pendingBuildAllocations.value[key].find(a => a.resourceId === vehicleRes.id)
      if (pendingAlloc) {
        pendingAlloc.amount -= returnCount
        if (pendingAlloc.amount <= 0) {
          const idx = pendingBuildAllocations.value[key].indexOf(pendingAlloc)
          pendingBuildAllocations.value[key].splice(idx, 1)
        }
      }
    }
    
    console.log(`♻️🚗 Odobraté ${returnCount} vozidlá z recyklácie [${row},${col}], celkom: ${newCount}, zostatok: ${vehicleRes.amount}`)
  }
  
  // Aktualizuj worker count
  buildingWorkerCount.value[key] = newCount
  
  // Aktualizuj recykláciu tracking
  if (recyclingBuildings.value[key]) {
    recyclingBuildings.value[key].workerCount = newCount
  }
  
  // Nastav animation speed
  if (canvasRef.value?.setConstructionWorkers) {
    canvasRef.value.setConstructionWorkers(row, col, newCount)
  }
}

// Helper - kontrola či je resource typu work-force
const isWorkResource = (resourceId) => {
  const resource = resources.value.find(r => r.id === resourceId)
  return resource?.workResource === true
}

// Helper - získaj ikonu resource podľa ID
const getResourceIcon = (resourceId) => {
  const resource = resources.value.find(r => r.id === resourceId)
  return resource?.icon || ''
}

// Zatvorenie modalu
const closeBuildingModal = () => {
  showBuildingModal.value = false
  clickedBuilding.value = null
  portPayload.value = []
  selectedPayloadResource.value = ''
  payloadAmount.value = 1
  canvasRef.value?.clearBuildingHighlight()
}

// Kliknutie mimo building detail panel - zavrie ho
const handleDocumentClick = (e) => {
  // Zatvor payload dropdown ak kliknem mimo neho
  if (payloadDropdownOpen.value) {
    const dropdown = document.querySelector('.payload-custom-select')
    if (!dropdown || !dropdown.contains(e.target)) {
      payloadDropdownOpen.value = false
    }
  }
  if (!showBuildingModal.value) return
  const panel = document.querySelector('.building-detail-panel')
  if (panel && !panel.contains(e.target)) {
    closeBuildingModal()
  }
}

// Pridanie resource do payloadu portu
const addPortPayload = () => {
  if (!selectedPayloadResource.value || payloadAmount.value <= 0) return
  
  const res = resources.value.find(r => r.id === selectedPayloadResource.value)
  if (!res) return
  
  const weight = Number(res.weight) || 0
  const addedWeight = weight * payloadAmount.value
  
  // Kontrola či sa zmestí do kapacity
  if (currentPortWeight.value + addedWeight > portMaxCapacity.value) {
    console.log(`⚠️ Port payload: nedostatok kapacity. Aktuálne: ${currentPortWeight.value}, pridávam: ${addedWeight}, max: ${portMaxCapacity.value}`)
    return
  }
  
  // Kontrola či existuje v allowedResources
  const allowed = clickedBuilding.value.allowedResources || []
  if (!allowed.some(a => a.resourceId === selectedPayloadResource.value)) return
  
  // Ak už existuje v payload, pridaj k existujúcemu
  const existing = portPayload.value.find(p => p.resourceId === selectedPayloadResource.value)
  if (existing) {
    existing.amount += payloadAmount.value
  } else {
    portPayload.value.push({
      resourceId: selectedPayloadResource.value,
      resourceName: res.name,
      amount: payloadAmount.value
    })
  }
  
  // Reset
  payloadAmount.value = 1
}

// Odobranie resource z payloadu portu
const removePortPayload = (index) => {
  portPayload.value.splice(index, 1)
}

// Zastaviť auto produkciu pre konkrétnu budovu (delegates to fullStopProduction)
const stopAutoProduction = (row, col, reason = 'manual', deficitResources = null) => {
  fullStopProduction(row, col, reason)
}

// Toggle auto produkcie pre konkrétnu budovu
const toggleAutoProduction = () => {
  if (!clickedBuilding.value) return
  
  const row = clickedBuilding.value.row
  const col = clickedBuilding.value.col
  const key = `${row}-${col}`
  const buildingData = clickedBuilding.value
  
  // Command center nemôže byť vypnutý
  if (buildingData.isCommandCenter) {
    console.log('🏛️ Command Center - cannot disable auto production')
    return
  }
  
  const currentState = buildingProductionStates.value[key]
  
  if (currentState?.enabled) {
    // Turn off - manual stop (only manual restart allowed)
    fullStopProduction(row, col, 'manual')
  } else {
    // Turn on
    delete manuallyStoppedBuildings.value[key]
    delete stoppedByResources.value[key]
    canvasRef.value?.hideDisabledOverlay(row, col)
    canvasRef.value?.hideWarningIndicator(row, col)
    
    if (!tryStartProduction(row, col, buildingData)) {
      // Failed to start - tryStartProduction already shows warnings
      console.log(`⚠️ Cannot start production for [${row}, ${col}] - insufficient resources`)
    }
  }
}

// Kontrola či je dosť resources na spustenie produkcie (vrátane work-force)
const canStartProduction = () => {
  if (!clickedBuilding.value) return false
  // Kontrola materiálových resources
  if (!checkProductionResources(clickedBuilding.value, resources.value)) return false
  // Kontrola work-force resources (ak budova ešte neprodukuje, WF nie je alokovaná)
  const key = `${clickedBuilding.value.row}-${clickedBuilding.value.col}`
  const isProducing = buildingProductionStates.value[key]?.enabled || false
  if (!isProducing && !hasEnoughWorkforceFor(clickedBuilding.value)) return false
  return true
}

// Computed property pre zistenie chýbajúcich operational resources
// Ak budova NEprodukuje, zahŕňa aj work-force resources (aby boli zvýraznené červenou)
const missingOperationalResources = computed(() => {
  if (!clickedBuilding.value) return new Set()
  const key = `${clickedBuilding.value.row}-${clickedBuilding.value.col}`
  const isProducing = buildingProductionStates.value[key]?.enabled || false
  return getMissingOperationalResources(clickedBuilding.value, resources.value, !isProducing)
})

// Spustenie produkcie - používa resourceCalculator service
const startProduction = () => {
  if (!clickedBuilding.value) return
  executeProduction(clickedBuilding.value, resources.value, storedResources.value)
}

// Spustenie port produkcie - odpočíta operational cost a pridá payload resources do hráčových zdrojov
const startPortProduction = () => {
  if (!clickedBuilding.value) return
  if (!checkProductionResources(clickedBuilding.value, resources.value)) return
  if (portPayload.value.length === 0) {
    console.log('⚠️ Port payload je prázdny, nie je čo produkovať')
    return
  }

  // Odpočítaj operational cost (work-force sa preskakuje)
  const operationalCost = clickedBuilding.value.operationalCost || []
  operationalCost.forEach(cost => {
    const resource = resources.value.find(r => r.id === cost.resourceId)
    if (resource) {
      if (resource.workResource) {
        console.log(`👷 Work force ${resource.name} preskočená - je alokovaná na úrovni produkcie`)
        return
      }
      resource.amount -= cost.amount
      console.log(`⚙️ Port: Odpočítané prevádzkové náklady: ${cost.amount}x ${resource.name}, zostatok: ${resource.amount}`)
    }
  })

  // Pridaj payload resources do hráčových zdrojov
  portPayload.value.forEach(item => {
    const resource = resources.value.find(r => r.id === item.resourceId)
    if (resource) {
      resource.amount += item.amount
      console.log(`🚢 Port produkcia: +${item.amount}x ${resource.name}, nový zostatok: ${resource.amount}`)
    } else {
      console.warn(`⚠️ Resource ${item.resourceName} (${item.resourceId}) neexistuje v zozname resources`)
    }
  })

  console.log('✅ Port produkcia dokončená! Payload vyčistený.')

  // Ulož spawn dáta z payloadu pred vyčistením
  const spawnData = { cars: 0, persons: 0 }
  portPayload.value.forEach(item => {
    const res = resources.value.find(r => r.id === item.resourceId)
    if (res) {
      if (res.vehicleAnimation) spawnData.cars += item.amount
      if (res.personAnimation) spawnData.persons += item.amount
    }
  })

  // Vyčisti payload po produkcii
  portPayload.value = []

  // Spusti efekty budovy
  const row = clickedBuilding.value.row
  const col = clickedBuilding.value.col
  const hasFlyAway = !!clickedBuilding.value.hasFlyAwayEffect
  const cellsX = clickedBuilding.value.buildingSize?.x || 1
  const cellsY = clickedBuilding.value.buildingSize?.y || 1

  // Najprv vyčisti existujúce efekty
  canvasRef.value?.hideProductionEffects(row, col)

  // Po krátkom oneskorení spusti všetky efekty nanovo
  setTimeout(() => {
    // Fly-away efekt (ak ho budova má)
    if (hasFlyAway) {
      canvasRef.value?.triggerFlyAwayEffect(row, col)
      // Smoke efekty - fly-away onComplete ich sám vyčistí po návrate
      canvasRef.value?.showProductionEffects(row, col)

      // Po dokončení fly-away animácie (5s + 600ms buffer) spawn cars/persons
      setTimeout(() => {
        if (spawnData.cars > 0) {
          console.log(`🚗 Port: Spawning ${spawnData.cars} cars po fly-away`)
          canvasRef.value?.spawnCarsOnAdjacentRoads(row, col, spawnData.cars, cellsX, cellsY)
        }
        if (spawnData.persons > 0) {
          console.log(`🚶 Port: Spawning ${spawnData.persons} persons po fly-away`)
          canvasRef.value?.spawnPersonsAtBuilding(row, col, spawnData.persons, cellsX, cellsY)
        }
      }, 5600)
    } else {
      // Bez fly-away - dočasný smoke/light flash na 3 sekundy
      canvasRef.value?.showProductionEffects(row, col)
      setTimeout(() => {
        canvasRef.value?.hideProductionEffects(row, col)

        // Spawn cars/persons po skončení efektu
        if (spawnData.cars > 0) {
          console.log(`🚗 Port: Spawning ${spawnData.cars} cars po produkcii`)
          canvasRef.value?.spawnCarsOnAdjacentRoads(row, col, spawnData.cars, cellsX, cellsY)
        }
        if (spawnData.persons > 0) {
          console.log(`🚶 Port: Spawning ${spawnData.persons} persons po produkcii`)
          canvasRef.value?.spawnPersonsAtBuilding(row, col, spawnData.persons, cellsX, cellsY)
        }
      }, 3000)
    }
  }, 100)

  // Zatvor modálne okno pri port budovách
  closeBuildingModal()
}

// Handler pre zníženie resource na kapacitu po odpočítavaní
const handleReduceToCapacity = (resourceId) => {
  const resource = resources.value.find(r => r.id === resourceId)
  if (!resource) return
  
  const capacity = storedResources.value[resourceId]
  const capacityNum = capacity !== undefined ? Number(capacity) : 0
  
  console.log(`📉 handleReduceToCapacity: ${resource.name}, amount: ${resource.amount}, allocated: ${allocatedResources.value[resourceId] || 0}, capacity: ${capacityNum}`)
  
  // Najprv uvoľni alokované resources - zastav produkciu budov ktoré používajú tento resource
  const allocations = workforceAllocations.value[resourceId]
  if (allocations && allocations.length > 0) {
    // Skopíruj pole lebo stopAutoProduction ho modifikuje
    const allocationsCopy = [...allocations]
    allocationsCopy.forEach(alloc => {
      if (alloc.type === 'production') {
        console.log(`📉 Zastavujem produkciu budovy ${alloc.buildingName} na [${alloc.row}, ${alloc.col}] kvôli nedostatku skladu pre ${resource.name}`)
        const key = `${alloc.row}-${alloc.col}`
        const hasState = !!buildingProductionStates.value[key]
        
        if (hasState) {
          stopAutoProduction(alloc.row, alloc.col, 'resources')
        } else {
          // stopAutoProduction by preskočil (state neexistuje) - manuálne dealokuj
          console.log(`📉 Produkčný stav neexistuje pre [${alloc.row}, ${alloc.col}], manuálna dealokácia ${alloc.amount}x ${resource.name}`)
          resource.amount += alloc.amount
          
          if (allocatedResources.value[resourceId]) {
            allocatedResources.value[resourceId] -= alloc.amount
            if (allocatedResources.value[resourceId] <= 0) {
              delete allocatedResources.value[resourceId]
            }
          }
          
          // Odstráň detailný záznam alokácie
          const allocList = workforceAllocations.value[resourceId]
          if (allocList) {
            const idx = allocList.indexOf(alloc)
            if (idx !== -1) {
              allocList.splice(idx, 1)
              if (allocList.length === 0) {
                delete workforceAllocations.value[resourceId]
              }
            }
          }
        }
      } else if (alloc.type === 'build' || alloc.type === 'recycle') {
        // Uvoľni build/recycle alokácie - vráť workforce
        const key = `${alloc.row}-${alloc.col}`
        resource.amount += alloc.amount
        
        // Aktualizuj allocatedResources
        if (allocatedResources.value[resourceId]) {
          allocatedResources.value[resourceId] -= alloc.amount
          if (allocatedResources.value[resourceId] <= 0) {
            delete allocatedResources.value[resourceId]
          }
        }
        
        // Odstráň detailný záznam alokácie
        const allocList = workforceAllocations.value[resourceId]
        if (allocList) {
          const idx = allocList.indexOf(alloc)
          if (idx !== -1) {
            allocList.splice(idx, 1)
            if (allocList.length === 0) {
              delete workforceAllocations.value[resourceId]
            }
          }
        }
        
        // Vyčisti aj pendingBuildAllocations
        const pending = pendingBuildAllocations.value[key]
        if (pending) {
          const pIdx = pending.findIndex(p => p.resourceId === resourceId)
          if (pIdx !== -1) {
            pending.splice(pIdx, 1)
            if (pending.length === 0) {
              delete pendingBuildAllocations.value[key]
            }
          }
        }
        
        console.log(`📉 Uvoľnená build/recycle alokácia: ${alloc.amount}x ${resource.name} z [${alloc.row}, ${alloc.col}]`)
      }
    })
  }
  
  // Teraz zníži amount na kapacitu (po dealokácii sa amount mohol zvýšiť)
  if (capacityNum <= 0 && resource.amount > 0) {
    console.log(`📉 Znižujem ${resource.name} z ${resource.amount} na 0 (bez skladu)`)
    resource.amount = 0
  } else if (capacityNum > 0 && resource.amount > capacityNum) {
    console.log(`📉 Znižujem ${resource.name} z ${resource.amount} na kapacitu ${capacityNum}`)
    resource.amount = capacityNum
  }
  
  // Fallback: Ak po všetkých dealokáciách stále existujú alokácie a kapacita je 0,
  // vynuluj všetko - ochrana proti desync medzi allocatedResources a workforceAllocations
  const remainingAllocated = allocatedResources.value[resourceId] || 0
  const totalAfter = resource.amount + remainingAllocated
  if (totalAfter > capacityNum) {
    console.log(`📉 Fallback cleanup: ${resource.name} - stále total=${totalAfter} > capacity=${capacityNum}, allocated=${remainingAllocated}`)
    
    // Vymaž všetky zvyšné alokácie pre tento resource
    if (allocatedResources.value[resourceId]) {
      delete allocatedResources.value[resourceId]
      console.log(`📉 Fallback: Vymazané allocatedResources pre ${resource.name}`)
    }
    if (workforceAllocations.value[resourceId]) {
      delete workforceAllocations.value[resourceId]
      console.log(`📉 Fallback: Vymazané workforceAllocations pre ${resource.name}`)
    }
    
    // Nastav amount na kapacitu
    resource.amount = Math.min(resource.amount, capacityNum)
  }
  
  console.log(`📉 handleReduceToCapacity DONE: ${resource.name}, amount: ${resource.amount}, allocated: ${allocatedResources.value[resourceId] || 0}`)
}

// Handler pre kliknutie na alokovanú work force - zobrazí ikony na canvase
let allocationHighlightTimeout = null
const handleShowAllocations = (resourceId) => {
  const allocations = workforceAllocations.value[resourceId]
  if (!allocations || allocations.length === 0) {
    console.log(`👷 Žiadne alokácie pre resource ${resourceId}`)
    return
  }
  
  console.log(`👷 Zobrazujem alokácie pre ${resourceId}:`, allocations)
  
  // Zobraz ikony na canvase
  const positions = allocations.map(a => ({
    row: a.row,
    col: a.col,
    amount: a.amount,
    type: a.type,
    buildingName: a.buildingName
  }))
  
  canvasRef.value?.showWorkforceAllocations(positions)
  
  // Automaticky skry po 4 sekundách
  if (allocationHighlightTimeout) clearTimeout(allocationHighlightTimeout)
  allocationHighlightTimeout = setTimeout(() => {
    canvasRef.value?.hideWorkforceAllocations()
  }, 4000)
}

// Handler pre kliknutie na resource - prepne na buildings tab s filtrom
const handleResourceClicked = (resourceId) => {
  filterResourceId.value = resourceId
  sidebarTab.value = 'buildings'
}

// Handler pre zmenu poradia budov (drag & drop v BuildingSelector)
const handleReorderBuildings = (newOrder) => {
  // newOrder = [{ id, order }, ...]
  newOrder.forEach(({ id, order }) => {
    const img = images.value.find(i => i.id === id)
    if (img && img.buildingData) {
      img.buildingData.buildingOrder = order
    }
  })
  console.log('🔀 Poradie budov aktualizované')
}

// Lifecycle - document click outside listener
onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentClick)
  document.addEventListener('fullscreenchange', onFullscreenChange)

  // Auto-load project if navigated from Play button
  if (route.query.autoload === '1') {
    setTimeout(async () => {
      try {
        isLoading.value = true
        loadingStatus.value = 'Loading game data...'
        const response = await fetch(BASE_URL + 'templates/all/isometric-gameplay-1771767207345.json')
        if (!response.ok) throw new Error('Failed to load game data')
        const projectData = await response.json()
        handleLoadProject(projectData)
      } catch (error) {
        console.error('Failed to load game data:', error)
        isLoading.value = false
      }
    }, 500)
  }
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', handleDocumentClick)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
})
</script>

<template>
  <div id="game-view">
    <!-- Loading overlay -->
    <div v-if="isLoading" class="loading-overlay">
      <div class="loading-content">
        <div class="loading-spinner"></div>
        <h2>{{ loadingStatus }}</h2>
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: loadingProgress + '%' }"></div>
        </div>
        <p class="progress-text">{{ loadingProgress }}%</p>
      </div>
    </div>
    
    <!-- Canvas na pozadí -->
    <PhaserCanvas
      ref="canvasRef"
      :images="images" 
      :selectedImageId="selectedImageId"
      :lastImageCellsX="lastImageCellsX"
      :lastImageCellsY="lastImageCellsY"
      :templateSelected="templateSelected"
      :showNumbering="showNumbering"
      :showGallery="showGallery"
      :showGrid="showGrid"
      :deleteMode="deleteMode"
      :roadBuildingMode="roadBuildingMode"
      :roadDeleteMode="roadDeleteMode"
      :recycleMode="recycleMode"
      :roadTiles="roadTiles"
      :personSpawnEnabled="personSpawnEnabled"
      :personSpawnCount="personSpawnCount"
      :selectedBuildingDestinationTiles="selectedBuildingDestinationTiles"
      :selectedBuildingCanBuildOnlyInDestination="selectedBuildingCanBuildOnlyInDestination"
      :showPerson="showPerson"
      :isFullscreen="isFullscreen"
      @cell-selected="handleCellSelected"
      @image-placed="handleImagePlaced"
      @road-placed="handleRoadPlaced"
      @building-clicked="handleBuildingClicked"
      @building-deleted="handleBuildingDeleted"
      @building-state-changed="handleBuildingStateChanged"
      @building-construction-complete="handleBuildingConstructionComplete"
      @building-recycled="handleBuildingRecycled"
    />
    
    <!-- Top Resource Bar -->
    <div class="top-resource-bar">
      <!-- Hamburger button -->
      <div class="top-warpper">
      <button class="hamburger-btn" @click="hamburgerOpen = !hamburgerOpen" :class="{ open: hamburgerOpen }">
        <span class="hamburger-line"></span>
        <span class="hamburger-line"></span>
        <span class="hamburger-line"></span>
      </button>

      <!-- Fullscreen button -->
      <button class="fullscreen-btn" @click="toggleFullscreen" :title="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'">
        <span v-if="!isFullscreen">⛶</span>
        <span v-else>⛶</span>
      </button>
      </div>

      <!-- ResourceDisplay in top bar -->
      <ResourceDisplay 
        :resources="resources"
        :storedResources="storedResources"
        :allocatedResources="allocatedResources"
        @reduce-to-capacity="handleReduceToCapacity"
        @show-allocations="handleShowAllocations"
        @resource-clicked="handleResourceClicked"
      />
    </div>

    <!-- Game Clock - fixná pozícia -->
    <GameClock 
      :initialTime="gameTime"
      @update:gameTime="gameTime = $event"
    />

    <!-- Hamburger dropdown menu -->
    <div class="hamburger-menu" v-if="hamburgerOpen" @click.self="hamburgerOpen = false">
      <div class="hamburger-menu-content">
        <div class="hamburger-menu-header">
          <span>⚙️ Menu</span>
          <button class="hamburger-close" @click="hamburgerOpen = false">✕</button>
        </div>
        <div class="hamburger-menu-body">
          <label class="resource-check-toggle">
            <input type="checkbox" v-model="showNumbering" />
            <span>🔢 Numbering</span>
          </label>
          <label class="resource-check-toggle">
            <input type="checkbox" v-model="showGallery" />
            <span>🖼️ Gallery</span>
          </label>
          <label class="resource-check-toggle">
            <input type="checkbox" v-model="showGrid" />
            <span>☰ Grid</span>
          </label>
          <label class="resource-check-toggle">
            <input type="checkbox" v-model="showPerson" />
            <span>🚶 Person</span>
          </label>
          <label class="resource-check-toggle">
            <input type="checkbox" v-model="ignoreResourceCheck" />
            <span>🚫 Disable resource check</span>
          </label>
          
          <ProjectManager 
            :images="images"
            :showNumbering="showNumbering"
            :showGallery="showGallery"
            :showGrid="showGrid"
            :canvasRef="canvasRef"
            :environmentColors="environmentColors"
            :textureSettings="textureSettings"
            :personSpawnSettings="{ enabled: personSpawnEnabled, count: personSpawnCount }"
            :resources="resources"
            :workforce="workforce"
            :allocatedResources="allocatedResources"
            :roadSpriteUrl="roadSpriteUrl"
            :roadOpacity="roadOpacity"
            :buildingProductionStates="buildingProductionStates"
            :gameTime="gameTime"
            :events="gameEvents"
            @load-project="handleLoadProject"
            @update:showNumbering="showNumbering = $event"
            @update:showGallery="showGallery = $event"
            @update:showGrid="showGrid = $event"
            @update-resources="handleUpdateResources"
            @update-events="gameEvents = $event"
            @effect-changed="handleEffectChanged"
          />
        </div>
      </div>
    </div>

    <!-- Pravý sidebar s Buildings -->
    <aside class="sidebar">
      <BuildingSelector 
        :buildings="buildings"
        :selectedBuildingId="selectedBuildingId"
        :filterResourceId="filterResourceId"
        :resources="resources"
        @building-selected="handleBuildingSelected"
        @clear-filter="filterResourceId = null"
        @reorder-buildings="handleReorderBuildings"
      />

      <!-- Road selector - fixed at bottom -->
      <div class="sidebar-bottom-fixed">
        <RoadSelector 
          :roadBuildingMode="roadBuildingMode"
          :roadDeleteMode="roadDeleteMode"
          :recycleMode="recycleMode"
          @road-mode-toggled="handleRoadModeToggled"
          @road-delete-mode-toggled="handleRoadDeleteModeToggled"
          @recycle-mode-toggled="handleRecycleModeToggled"
        />
      </div>
    </aside>
    
    <!-- Panel s detailom budovy - fixný vľavo, priesvitný, bez overlay -->
    <Teleport to="body">
      <div 
        v-if="showBuildingModal && clickedBuilding"
        class="building-detail-panel"
      >
        <!-- Header -->
        <div class="bdp-header">
          <span class="bdp-title">{{ clickedBuilding.buildingName || 'Building' }}</span>
          <button class="bdp-close" @click="closeBuildingModal">✕</button>
        </div>
        
        <!-- Body -->
        <div class="bdp-body">
          <!-- Horizontálny riadok: Build Cost | Storage Capacity | Production -->
          <div class="bdp-columns">
            <!-- Build Cost -->
            <div v-if="clickedBuilding.buildCost && clickedBuilding.buildCost.length > 0" class="bdp-col">
              <h4>💰 Build Cost</h4>
              <div class="bdp-resource-list">
                <div v-for="(cost, index) in clickedBuilding.buildCost" :key="'bc'+index" class="bdp-resource-row">
                  <img v-if="getResourceIcon(cost.resourceId)" :src="getResourceIcon(cost.resourceId)" class="bdp-res-icon" />
                  <span class="bdp-res-name">{{ cost.resourceName }}</span>
                  <span class="bdp-res-amount">{{ cost.amount }}</span>
                </div>
              </div>
            </div>
            
            <!-- Storage Capacity (normálna budova) -->
            <div v-if="!clickedBuilding.isPort && clickedBuilding.stored && clickedBuilding.stored.length > 0" class="bdp-col">
              <h4>🏪 Storage Capacity</h4>
              <div class="bdp-resource-list">
                <div v-for="(store, index) in clickedBuilding.stored" :key="'st'+index" class="bdp-resource-row stored">
                  <img v-if="getResourceIcon(store.resourceId)" :src="getResourceIcon(store.resourceId)" class="bdp-res-icon" />
                  <span class="bdp-res-name">{{ store.resourceName }}</span>
                  <span class="bdp-res-amount">{{ store.amount }}</span>
                </div>
              </div>
            </div>
            
            <!-- Production (normálna budova) -->
            <div v-if="!clickedBuilding.isPort && clickedBuilding.production && clickedBuilding.production.length > 0" class="bdp-col">
              <h4>📦 Production</h4>
              <div class="bdp-resource-list">
                <div v-for="(prod, index) in clickedBuilding.production" :key="'pr'+index" class="bdp-resource-row production">
                  <img v-if="getResourceIcon(prod.resourceId)" :src="getResourceIcon(prod.resourceId)" class="bdp-res-icon" />
                  <span class="bdp-res-name">{{ prod.resourceName }}</span>
                  <span class="bdp-res-amount">+{{ prod.amount }}</span>
                </div>
              </div>
            </div>
            
            <!-- Operational Cost -->
            <div v-if="clickedBuilding.operationalCost && clickedBuilding.operationalCost.length > 0" class="bdp-col">
              <h4>⚙️ Operating Cost</h4>
              <div class="bdp-resource-list">
                <div 
                  v-for="(cost, index) in clickedBuilding.operationalCost" 
                  :key="'oc'+index" 
                  class="bdp-resource-row"
                  :class="{ 'insufficient': missingOperationalResources.has(cost.resourceId) }"
                >
                  <img v-if="getResourceIcon(cost.resourceId)" :src="getResourceIcon(cost.resourceId)" class="bdp-res-icon" />
                  <span class="bdp-res-name">{{ cost.resourceName }}</span>
                  <span class="bdp-res-amount">{{ cost.amount }}</span>
                </div>
              </div>
            </div>
          </div>
          
          <!-- PORT sekcie -->
          <template v-if="clickedBuilding.isPort">
            <!-- Capacity Progress Bar -->
            <div class="bdp-section">
              <h4>📊 Payload Capacity</h4>
              <div class="port-capacity-section">
                <div class="port-capacity-bar-container">
                  <div 
                    class="port-capacity-bar-fill" 
                    :style="{ width: portFillPercent + '%' }"
                    :class="{ 'near-full': portFillPercent > 80, 'full': portFillPercent >= 100 }"
                  ></div>
                </div>
                <div class="port-capacity-text">
                  {{ currentPortWeight }} / {{ portMaxCapacity }} ({{ Math.round(portFillPercent) }}%)
                </div>
              </div>
            </div>
            
            <!-- Payload + Port Controls vedľa seba -->
            <div class="port-payload-row">
              <!-- Payload -->
              <div class="bdp-section port-payload-left">
                <h4>📦 Reqested Payload</h4>
                <div class="payload-add-section">
                  <div class="payload-custom-select" @click.stop="payloadDropdownOpen = !payloadDropdownOpen">
                    <div class="payload-custom-selected">
                      <template v-if="selectedPayloadResource">
                        <img v-if="getResourceIcon(selectedPayloadResource)" :src="getResourceIcon(selectedPayloadResource)" class="payload-option-icon" />
                        <span>{{ (clickedBuilding.allowedResources || []).find(a => a.resourceId === selectedPayloadResource)?.resourceName }}</span>
                      </template>
                      <span v-else class="payload-placeholder">Select resource...</span>
                      <span class="payload-select-arrow">▾</span>
                    </div>
                    <div v-if="payloadDropdownOpen" class="payload-dropdown">
                      <div 
                        v-for="ar in (clickedBuilding.allowedResources || [])" 
                        :key="ar.resourceId" 
                        class="payload-dropdown-item"
                        :class="{ selected: selectedPayloadResource === ar.resourceId }"
                        @click.stop="selectedPayloadResource = ar.resourceId; payloadDropdownOpen = false"
                      >
                        <img v-if="getResourceIcon(ar.resourceId)" :src="getResourceIcon(ar.resourceId)" class="payload-option-icon" />
                        <span>{{ ar.resourceName }}</span>
                      </div>
                    </div>
                  </div>
                  <input 
                    type="number" 
                    v-model.number="payloadAmount" 
                    min="1" 
                    class="payload-amount-input"
                    placeholder="Amt"
                  />
                  <button 
                    class="payload-add-button" 
                    @click="addPortPayload"
                    :disabled="!selectedPayloadResource || payloadAmount <= 0 || portFillPercent >= 100"
                  >
                    + Add
                  </button>
                </div>
                <div v-if="portPayload.length > 0" class="payload-list">
                  <div v-for="(item, index) in portPayload" :key="index" class="payload-item">
                    <img v-if="getResourceIcon(item.resourceId)" :src="getResourceIcon(item.resourceId)" class="payload-option-icon" />
                    <span class="payload-resource-name">{{ item.resourceName }}</span>
                    <span class="payload-resource-amount">× {{ item.amount }}</span>
                    <span class="payload-resource-weight">
                      (⚖️ {{ (resources.find(r => r.id === item.resourceId)?.weight || 0) * item.amount }})
                    </span>
                    <button class="payload-remove-button" @click="removePortPayload(index)">✕</button>
                  </div>
                </div>
                <p v-else class="payload-empty">No cost</p>
              </div>

              <!-- Port Controls (vpravo) -->
              <div v-if="(clickedBuilding.production && clickedBuilding.production.length > 0) || (clickedBuilding.operationalCost && clickedBuilding.operationalCost.length > 0)" class="bdp-section port-payload-right">
                <h4>⚙️ Port Controls</h4>
                <div class="production-controls">
                  <button 
                    class="production-button"
                    :class="{ disabled: !canStartProduction() || portPayload.length === 0 }"
                    :disabled="!canStartProduction() || portPayload.length === 0"
                    @click="startPortProduction"
                  >
                    <span v-if="!canStartProduction()">⛔ Insufficient resources</span>
                    <span v-else-if="portPayload.length === 0">📦 Empty payload</span>
                    <span v-else>▶️ Start</span>
                  </button>
                </div>
                <p v-if="!canStartProduction()" class="production-warning">
                  ⚠️ You don't have enough resources for operation!
                </p>
              </div>
            </div>

            <!-- Port: Recyklácia / Stavba stavy -->
            <div v-if="currentBuildingAnimState === 'recycling-waiting' || currentBuildingAnimState === 'recycling'" class="bdp-section">
              <template v-if="currentBuildingAnimState === 'recycling-waiting'">
                <h4>♻️🚚 Waiting for workforce...</h4>
                <div class="build-in-progress recycle-in-progress">
                  <div class="build-progress-animation waiting recycle"><div class="build-progress-bar waiting-bar recycle-bar"></div></div>
                  <p class="build-progress-text">Waiting for vehicle arrival.</p>
                  <div class="worker-count-section">
                    <label>🚗 Vehicles:</label>
                    <div class="worker-count-controls">
                      <button class="worker-btn" :disabled="currentBuildingWorkers <= 1" @click="changeRecycleWorkers(currentBuildingWorkers - 1)">−</button>
                      <span class="worker-count-value">{{ currentBuildingWorkers }}</span>
                      <button class="worker-btn" :disabled="currentBuildingWorkers >= maxBuildingWorkers" @click="changeRecycleWorkers(currentBuildingWorkers + 1)">+</button>
                    </div>
                    <span class="worker-speed-info">{{ currentBuildingWorkers }}× speed</span>
                  </div>
                </div>
              </template>
              <template v-else>
                <h4>♻️ Recycling in progress...</h4>
                <div class="build-in-progress recycle-in-progress">
                  <div class="build-progress-animation recycle"><div class="build-progress-bar recycle-bar"></div></div>
                  <p class="build-progress-text">Building is being dismantled.</p>
                  <div class="worker-count-section">
                    <label>🚗 Vehicles:</label>
                    <div class="worker-count-controls">
                      <button class="worker-btn" :disabled="currentBuildingWorkers <= 1" @click="changeRecycleWorkers(currentBuildingWorkers - 1)">−</button>
                      <span class="worker-count-value">{{ currentBuildingWorkers }}</span>
                      <button class="worker-btn" :disabled="currentBuildingWorkers >= maxBuildingWorkers" @click="changeRecycleWorkers(currentBuildingWorkers + 1)">+</button>
                    </div>
                    <span class="worker-speed-info">{{ currentBuildingWorkers }}× speed</span>
                  </div>
                </div>
              </template>
            </div>
            <div v-else-if="currentBuildingAnimState === 'waiting' || currentBuildingAnimState === 'building'" class="bdp-section">
              <template v-if="currentBuildingAnimState === 'waiting'">
                <h4>🚚 Waiting for workforce...</h4>
                <div class="build-in-progress">
                  <div class="build-progress-animation waiting"><div class="build-progress-bar waiting-bar"></div></div>
                  <p class="build-progress-text">Waiting for workforce arrival.</p>
                  <div class="worker-count-section">
                    <label>👷 Workers:</label>
                    <div class="worker-count-controls">
                      <button class="worker-btn" :disabled="currentBuildingWorkers <= 1" @click="changeConstructionWorkers(currentBuildingWorkers - 1)">−</button>
                      <span class="worker-count-value">{{ currentBuildingWorkers }}</span>
                      <button class="worker-btn" :disabled="currentBuildingWorkers >= maxBuildingWorkers" @click="changeConstructionWorkers(currentBuildingWorkers + 1)">+</button>
                    </div>
                    <span class="worker-speed-info">{{ currentBuildingWorkers }}× speed</span>
                  </div>
                </div>
              </template>
              <template v-else>
                <h4>🏗️ Construction in progress...</h4>
                <div class="build-in-progress">
                  <div class="build-progress-animation"><div class="build-progress-bar"></div></div>
                  <p class="build-progress-text">Building is under construction.</p>
                  <div class="worker-count-section">
                    <label>👷 Workers:</label>
                    <div class="worker-count-controls">
                      <button class="worker-btn" :disabled="currentBuildingWorkers <= 1" @click="changeConstructionWorkers(currentBuildingWorkers - 1)">−</button>
                      <span class="worker-count-value">{{ currentBuildingWorkers }}</span>
                      <button class="worker-btn" :disabled="currentBuildingWorkers >= maxBuildingWorkers" @click="changeConstructionWorkers(currentBuildingWorkers + 1)">+</button>
                    </div>
                    <span class="worker-speed-info">{{ currentBuildingWorkers }}× speed</span>
                  </div>
                </div>
              </template>
            </div>
          </template>
          
          <!-- NORMÁLNA BUDOVA: Production Controls -->
          <template v-else>
            <!-- Recyklácia -->
            <div v-if="currentBuildingAnimState === 'recycling-waiting' || currentBuildingAnimState === 'recycling'" class="bdp-section">
              <template v-if="currentBuildingAnimState === 'recycling-waiting'">
                <h4>♻️🚚 Waiting for workforce...</h4>
                <div class="build-in-progress recycle-in-progress">
                  <div class="build-progress-animation waiting recycle"><div class="build-progress-bar waiting-bar recycle-bar"></div></div>
                  <p class="build-progress-text">Waiting for vehicle arrival.</p>
                  <div class="worker-count-section">
                    <label>🚗 Vehicles:</label>
                    <div class="worker-count-controls">
                      <button class="worker-btn" :disabled="currentBuildingWorkers <= 1" @click="changeRecycleWorkers(currentBuildingWorkers - 1)">−</button>
                      <span class="worker-count-value">{{ currentBuildingWorkers }}</span>
                      <button class="worker-btn" :disabled="currentBuildingWorkers >= maxBuildingWorkers" @click="changeRecycleWorkers(currentBuildingWorkers + 1)">+</button>
                    </div>
                    <span class="worker-speed-info">{{ currentBuildingWorkers }}× speed</span>
                  </div>
                </div>
              </template>
              <template v-else>
                <h4>♻️ Recycling in progress...</h4>
                <div class="build-in-progress recycle-in-progress">
                  <div class="build-progress-animation recycle"><div class="build-progress-bar recycle-bar"></div></div>
                  <p class="build-progress-text">Building is being dismantled.</p>
                  <div class="worker-count-section">
                    <label>🚗 Vehicles:</label>
                    <div class="worker-count-controls">
                      <button class="worker-btn" :disabled="currentBuildingWorkers <= 1" @click="changeRecycleWorkers(currentBuildingWorkers - 1)">−</button>
                      <span class="worker-count-value">{{ currentBuildingWorkers }}</span>
                      <button class="worker-btn" :disabled="currentBuildingWorkers >= maxBuildingWorkers" @click="changeRecycleWorkers(currentBuildingWorkers + 1)">+</button>
                    </div>
                    <span class="worker-speed-info">{{ currentBuildingWorkers }}× speed</span>
                  </div>
                </div>
              </template>
              <div v-if="clickedBuilding.buildCost && clickedBuilding.buildCost.length > 0" class="recycle-refund-info">
                <h4>📦 Returned resources after recycling:</h4>
                <div class="resource-list">
                  <div v-for="(cost, index) in clickedBuilding.buildCost" :key="index" class="resource-item"
                    :class="{ 'work-resource-strike': isWorkResource(cost.resourceId) }">
                    <span class="resource-name">{{ cost.resourceName }}</span>
                    <span class="resource-amount" v-if="!isWorkResource(cost.resourceId)">+{{ cost.amount }}</span>
                    <span class="resource-amount strikethrough" v-else>{{ cost.amount }} (work)</span>
                  </div>
                </div>
              </div>
            </div>
            
            <!-- Stavba (pre všetky budovy vrátane tých bez production/operationalCost) -->
            <div v-else-if="currentBuildingAnimState === 'waiting' || currentBuildingAnimState === 'building'" class="bdp-section">
              <template v-if="currentBuildingAnimState === 'waiting'">
                <h4>🚚 Waiting for workforce...</h4>
                <div class="build-in-progress">
                  <div class="build-progress-animation waiting"><div class="build-progress-bar waiting-bar"></div></div>
                  <p class="build-progress-text">Waiting for workforce arrival.</p>
                  <div class="worker-count-section">
                    <label>👷 Workers:</label>
                    <div class="worker-count-controls">
                      <button class="worker-btn" :disabled="currentBuildingWorkers <= 1" @click="changeConstructionWorkers(currentBuildingWorkers - 1)">−</button>
                      <span class="worker-count-value">{{ currentBuildingWorkers }}</span>
                      <button class="worker-btn" :disabled="currentBuildingWorkers >= maxBuildingWorkers" @click="changeConstructionWorkers(currentBuildingWorkers + 1)">+</button>
                    </div>
                    <span class="worker-speed-info">{{ currentBuildingWorkers }}× speed</span>
                  </div>
                </div>
              </template>
              <template v-else>
                <h4>🏗️ Construction in progress...</h4>
                <div class="build-in-progress">
                  <div class="build-progress-animation"><div class="build-progress-bar"></div></div>
                  <p class="build-progress-text">Building is under construction.</p>
                  <div class="worker-count-section">
                    <label>👷 Workers:</label>
                    <div class="worker-count-controls">
                      <button class="worker-btn" :disabled="currentBuildingWorkers <= 1" @click="changeConstructionWorkers(currentBuildingWorkers - 1)">−</button>
                      <span class="worker-count-value">{{ currentBuildingWorkers }}</span>
                      <button class="worker-btn" :disabled="currentBuildingWorkers >= maxBuildingWorkers" @click="changeConstructionWorkers(currentBuildingWorkers + 1)">+</button>
                    </div>
                    <span class="worker-speed-info">{{ currentBuildingWorkers }}× speed</span>
                  </div>
                </div>
              </template>
            </div>
            
            <!-- Produkcia (len pre budovy s production alebo operationalCost) -->
            <div v-else-if="(clickedBuilding.production && clickedBuilding.production.length > 0) || (clickedBuilding.operationalCost && clickedBuilding.operationalCost.length > 0)" class="bdp-section">
              <h4 v-if="clickedBuilding.production && clickedBuilding.production.length > 0">⚙️ Production Controls</h4>
              <h4 v-else>⚙️ Operation Controls</h4>
              <div class="production-controls">
                
                <label class="auto-production-toggle" :class="{ 'with-progress': currentBuildingAutoEnabled }">
                  <input 
                    type="checkbox" 
                    :checked="currentBuildingAutoEnabled"
                    @change="toggleAutoProduction"
                    :disabled="!canStartProduction()"
                  />
                  <span class="toggle-content">
                    <span class="toggle-text"> {{ currentBuildingAutoEnabled ? 'Stop' : 'Start' }}</span>
                    <div v-if="currentBuildingAutoEnabled" class="progress-bar-container">
                      <div class="progress-bar-fill" :style="{ width: currentBuildingProgress + '%' }"></div>
                    </div>
                  </span>
                </label>
              </div>
              <p v-if="!canStartProduction()" class="production-warning">
                ⚠️ You don't have enough resources for operation!
              </p>
            </div>
          </template>
        </div>
      </div>
    </Teleport>
    
    <!-- Insufficient Resources Modal -->
    <Modal 
      v-if="showInsufficientResourcesModal" 
      title="⚠️ Insufficient resources"
      @close="showInsufficientResourcesModal = false"
    >
      <div class="insufficient-resources-content">
        <h3>🏗️ {{ insufficientResourcesData.buildingName }}</h3>
        
        <!-- Chýbajúce resources na stavbu -->
        <div v-if="insufficientResourcesData.missingBuildResources.length > 0" class="missing-section">
          <p class="warning-text">
            🔨 You cannot build this building because you don't have enough resources required for construction:
          </p>
          <div class="missing-resources-list">
            <div 
              v-for="(resource, index) in insufficientResourcesData.missingBuildResources" 
              :key="'build-' + index"
              class="missing-resource-item build-cost"
            >
              <span class="resource-name">📦 {{ resource.name }}</span>
              <span class="resource-amounts">
                <span class="needed">✏️ Required: {{ resource.needed }}</span>
                <span class="available">✅ Available: {{ resource.available }}</span>
                <span class="deficit">❌ Missing: {{ resource.needed - resource.available }}</span>
              </span>
            </div>
          </div>
        </div>
        
        <!-- Chýbajúce resources na prevádzku -->
        <div v-if="insufficientResourcesData.missingOperationalResources.length > 0" class="missing-section">
          <p class="warning-text">
            ⚙️ You cannot build this building because you don't have enough resources required for operation:
          </p>
          <div class="missing-resources-list">
            <div 
              v-for="(resource, index) in insufficientResourcesData.missingOperationalResources" 
              :key="'operational-' + index"
              class="missing-resource-item operational-cost"
            >
              <span class="resource-name">📦 {{ resource.name }}</span>
              <span class="resource-amounts">
                <span class="needed">✏️ Required: {{ resource.needed }}</span>
                <span class="available">✅ Available: {{ resource.available }}</span>
                <span class="deficit">❌ Missing: {{ resource.needed - resource.available }}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </Modal>

    <!-- Astronaut Sprite -->
    <AstronautSprite
      ref="astronautRef"
      :active="astronautActive"
      bubbleText="Hello!"
      :spriteUrl="advisorSpriteUrl"
      :cols="3"
      :rows="2"
      :frameWidth="116"
      :frameHeight="112"
      :frameSpeed="180"
      @bubble-clicked="handleResourceClicked"
    />

    <!-- Game Event Modal -->
    <Modal 
      v-if="showEventModal && triggeredEvent" 
      :title="'🎯 ' + triggeredEvent.name"
      width="500px"
      @close="closeEventModal"
    >
      <div class="event-modal-content">
        <div v-if="triggeredEvent.image" class="event-modal-image">
          <img :src="triggeredEvent.image" :alt="triggeredEvent.name" />
        </div>
        <div v-if="triggeredEvent.description" class="event-modal-description">
          {{ triggeredEvent.description }}
        </div>
        <div v-if="triggeredEvent.actions && triggeredEvent.actions.length > 0" class="event-modal-actions">
          <h4>Effects:</h4>
          <div v-for="(action, idx) in triggeredEvent.actions" :key="idx" class="event-action-item">
            <template v-if="action.type === 'add_resource'">
              <span>➕ +{{ action.amount }} {{ action.resourceName || action.resourceId }}</span>
            </template>
            <template v-else-if="action.type === 'remove_resource'">
              <span>➖ -{{ action.amount }} {{ action.resourceName || action.resourceId }}</span>
            </template>
            <template v-else-if="action.type === 'show_message'">
              <span>💬 {{ action.message }}</span>
            </template>
            <template v-else-if="action.type === 'unlock_building'">
              <span>🔓 Building unlocked</span>
            </template>
          </div>
        </div>
        <button class="event-modal-ok-btn" @click="closeEventModal">OK</button>
      </div>
    </Modal>
  </div>
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

top-warpper {
  display: flex;
  gap: 5px;
  flex-direction: column;
}

#game-view {
  width: 100vw;
  height: 100vh;
  position: relative;
  overflow: hidden;
  padding: 0;
}

/* Top Resource Bar */
.top-resource-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 250px;
  height: auto;
  z-index: 10;
  display: flex;
  align-items: flex-start;
  overflow: hidden;
}

.top-resource-bar .resource-display {
  flex: 1;
  min-width: 0;
}

.top-resource-bar .resource-display .resource-item {
  padding: 0.2rem 0.4rem;
  margin-bottom: 0;
  border-radius: 4px;
  min-width: auto;
  flex-shrink: 0;
}

.top-resource-bar .game-clock {
  flex-shrink: 0;
}

/* Hamburger Button */
.hamburger-btn {
  position: relative;
  width: 40px;
  height: 40px;
  margin: 5px 8px;
  background: rgba(102, 126, 234, 0.9);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 8px;
  flex-shrink: 0;
  transition: all 0.3s;
  z-index: 15;
}

.hamburger-btn:hover {
  background: rgba(102, 126, 234, 1);
  transform: scale(1.05);
}

/* Fullscreen Button */
.fullscreen-btn {
  position: relative;
    max-width: 40px;
    height: 40px;
    padding: 22px;
    margin: 5px;
    background: rgba(102, 126, 234, 0.9);
    border: none;
    border-radius: 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 0.3s;
    z-index: 15;
    color: white;
    font-size: 1.2rem;
}

.fullscreen-btn:hover {
  background: rgba(102, 126, 234, 1);
  transform: scale(1.05);
}

.hamburger-line {
  display: block;
  width: 22px;
  height: 2px;
  background: white;
  border-radius: 2px;
  transition: all 0.3s;
}

.hamburger-btn.open .hamburger-line:nth-child(1) {
  transform: rotate(45deg) translate(5px, 5px);
}

.hamburger-btn.open .hamburger-line:nth-child(2) {
  opacity: 0;
}

.hamburger-btn.open .hamburger-line:nth-child(3) {
  transform: rotate(-45deg) translate(5px, -5px);
}

/* Hamburger Dropdown Menu */
.hamburger-menu {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 100;
  display: flex;
  justify-content: flex-start;
  align-items: flex-start;
}

.hamburger-menu-content {
  position: absolute;
  top: 55px;
  left: 8px;
  background: rgba(102, 126, 234, 0.97);
  backdrop-filter: blur(12px);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  min-width: 320px;
  max-width: 95vw;
  max-height: calc(100vh - 70px);
  overflow-y: auto;
  animation: hamburger-slide-in 0.2s ease-out;
}

@keyframes hamburger-slide-in {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.hamburger-menu-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  color: white;
  font-weight: 700;
  font-size: 1rem;
}

.hamburger-close {
  background: rgba(255, 255, 255, 0.2);
  border: none;
  color: white;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.hamburger-close:hover {
  background: rgba(255, 255, 255, 0.35);
}

.hamburger-menu-body {
  padding: 0.75rem 1rem;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}

.header-left {
  display: contents;
}

.resource-check-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: white;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  color: #667eea;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  transition: all 0.2s;
  user-select: none;
}

.resource-check-toggle:hover {
  background: #f0f0f0;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.resource-check-toggle input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #667eea;
  margin: 0;
}

.resource-check-toggle span {
  font-size: 0.9rem;
  white-space: nowrap;
}

.sidebar {
  position: absolute;
  top: 0;
  right: 0;
  width: 250px;
  height: 100vh;
  background: linear-gradient(180deg, #00000036 0%, #b1aeae78 100%);
  overflow-y: auto;
  box-shadow: -4px 0 20px rgba(0, 0, 0, 0.3);
  z-index: 20;
  padding-top: 8px;
}

/* Road selector fixed at bottom */
.sidebar-bottom-fixed {
  position: sticky;
  bottom: 0;
  background: white;
  z-index: 5;
  border-top: 2px solid #f0f0f0;
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.08);
}

/* Loading overlay styles */
.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  backdrop-filter: blur(5px);
}

.loading-content {
  text-align: center;
  color: white;
  max-width: 400px;
  padding: 2rem;
}

.loading-spinner {
  width: 60px;
  height: 60px;
  border: 4px solid rgba(255, 255, 255, 0.3);
  border-top-color: #667eea;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 1.5rem;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-content h2 {
  margin: 0 0 1rem 0;
  font-size: 1.5rem;
  font-weight: 600;
}

.progress-bar {
  width: 100%;
  height: 8px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 0.5rem;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #667eea, #764ba2);
  transition: width 0.3s ease;
  border-radius: 4px;
}

.progress-text {
  margin: 0.5rem 0 0 0;
  font-size: 1.1rem;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.9);
}

/* Header navigation */
.header-nav {
  position: absolute;
  right: 1rem;
  top: 50%;
  transform: translateY(-50%);
  z-index: 10;
}

.nav-button {
  padding: 0.5rem 1rem;
  background: white;
  color: #667eea;
  text-decoration: none;
  border-radius: 8px;
  font-weight: 600;
  transition: all 0.2s;
  display: inline-block;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.nav-button:hover {
  background: #f0f0f0;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

/* ===== Building Detail Panel (fixed left, transparent, no overlay) ===== */
.building-detail-panel {
  position: fixed;
  left: 16px;
  bottom: 16px;
  z-index: 9000;
  width: 638px;
  max-height: 84vh;
  background: rgba(255, 255, 255, 0.3);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(12px);
  border-radius: 14px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: bdp-slide-in 0.25s ease-out;
  pointer-events: auto;
}

@keyframes bdp-slide-in {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}

.bdp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.7rem 1rem;
  flex-shrink: 0;
}

.bdp-title {
  color: #2b2b2b;
  font-size: 1.05rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bdp-close {
  width: 30px;
  height: 30px;
  border: none;
  background: rgba(255, 255, 255, 0.2);
  color: rgb(51, 51, 51);
  font-size: 1.2rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
  line-height: 1;
  flex-shrink: 0;
}

.bdp-close:hover {
  background: rgba(255, 255, 255, 0.35);
}

.bdp-body {
  padding: 0.75rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

/* Horizontal columns for Build Cost / Storage / Production */
.bdp-columns {
  display: flex;
  gap: 0.5rem;
}

.bdp-col {
  flex: 1;
  min-width: 0;
  background: rgba(248, 249, 250, 0.7);
  border-radius: 10px;
  padding: 0.6rem 0.7rem;
  border: 1px solid #e0e0e0;
}

.bdp-col h4 {
  margin: 0 0 0.45rem 0;
  font-size: 0.82rem;
  font-weight: 600;
  color: #667eea;
  white-space: nowrap;
}

.bdp-resource-list {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.bdp-resource-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.5rem;
  background: rgba(255, 255, 255, 0.6);
  border-radius: 6px;
  border: 1px solid #e0e0e0;
  font-size: 0.82rem;
}

.bdp-resource-row.insufficient {
  border-color: #ef4444;
  background: rgba(239, 68, 68, 0.08);
}

.bdp-resource-row.insufficient .bdp-res-name {
  color: #dc2626;
}

.bdp-resource-row.insufficient .bdp-res-amount {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.15);
}

.bdp-res-icon {
  width: 20px;
  height: 20px;
  object-fit: contain;
  border-radius: 4px;
  flex-shrink: 0;
  border-radius: 100%
}

.bdp-res-name {
  font-weight: 500;
  color: #333;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bdp-res-amount {
  font-weight: 600;
  color: #667eea;
  padding: 0.15rem 0.5rem;
  background: rgba(102, 126, 234, 0.1);
  border-radius: 10px;
  font-size: 0.82rem;
  margin-left: auto;
  flex-shrink: 0;
}

.bdp-resource-row.production .bdp-res-amount {
  color: #10b981;
  background: rgba(16, 185, 129, 0.1);
}

.bdp-resource-row.stored .bdp-res-amount {
  color: #2196f3;
  background: rgba(33, 150, 243, 0.1);
}

/* Generic section inside panel */
.bdp-section {
  background: rgba(248, 249, 250, 0.7);
  border-radius: 10px;
  padding: 0.6rem 0.7rem;
  border: 1px solid #e0e0e0;
}

.bdp-section h4 {
  margin: 0 0 0.45rem 0;
  font-size: 0.82rem;
  font-weight: 600;
  color: #667eea;
}

/* Compact overrides for controls inside the panel */
.building-detail-panel .production-controls {
  margin-top: 0.4rem;
  gap: 0.4rem;
}

.building-detail-panel .production-button {
  padding: 0.55rem 1rem;
  font-size: 0.9rem;
  margin-top: 0.4rem;
}

.building-detail-panel .auto-production-toggle {
  padding: 0.5rem 0.7rem;
  font-size: 0.85rem;
}

.building-detail-panel .build-in-progress {
  padding: 0.5rem;
}

.building-detail-panel .worker-count-section {
  margin-top: 0.4rem;
  padding: 0.35rem 0.5rem;
}

.building-detail-panel .production-warning {
  font-size: 0.8rem;
  padding: 0.5rem;
  margin-top: 0.4rem;
}
/* ===== End Building Detail Panel ===== */

/* Building modal styles (legacy, kept for other modals) */
.building-modal-content {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.building-image-preview {
  width: 100%;
  max-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f8f9fa;
  border-radius: 12px;
  padding: 1rem;
  overflow: hidden;
}

.building-image-preview img {
  max-width: 100%;
  max-height: 180px;
  object-fit: contain;
  border-radius: 8px;
}

.building-info-section {
  background: #f8f9fa;
  border-radius: 12px;
  padding: 1.25rem;
  border: 1px solid #e0e0e0;
}

.building-info-section h3 {
  margin: 0 0 1rem 0;
  color: #667eea;
  font-size: 1.1rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 0;
  border-bottom: 1px solid #e0e0e0;
}

.info-row:last-child {
  border-bottom: none;
}

.info-label {
  font-weight: 600;
  color: #555;
  font-size: 0.95rem;
}

.info-value {
  font-weight: 500;
  color: #333;
  font-size: 0.95rem;
}

.command-center-badge {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 0.35rem 0.75rem;
  border-radius: 20px;
  font-size: 0.85rem;
  font-weight: 600;
}

.port-badge {
  background: linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%);
  color: white;
  padding: 0.35rem 0.75rem;
  border-radius: 20px;
  font-size: 0.85rem;
  font-weight: 600;
}

/* Port Capacity Bar */
.port-capacity-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.port-capacity-bar-container {
  width: 100%;
  height: 20px;
  background: #e5e7eb;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid #d1d5db;
}

.port-capacity-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #22c55e, #16a34a);
  border-radius: 10px;
  transition: width 0.3s ease;
}

.port-capacity-bar-fill.near-full {
  background: linear-gradient(90deg, #f59e0b, #d97706);
}

.port-capacity-bar-fill.full {
  background: linear-gradient(90deg, #ef4444, #dc2626);
}

.port-capacity-text {
  text-align: center;
  font-size: 0.85rem;
  color: #6b7280;
  font-weight: 600;
}

/* Port Payload Row - side by side layout */
.port-payload-row {
  display: flex;
  gap: 0.75rem;
  padding: 0 0.75rem;
}

.port-payload-left {
  flex: 1;
  min-width: 0;
}

.port-payload-right {
  flex: 0 0 200px;
}

/* Payload Section */
.payload-add-section {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  align-items: center;
}

/* Custom select dropdown */
.payload-custom-select {
  flex: 1;
  position: relative;
  min-width: 0;
}

.payload-custom-selected {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 0.85rem;
  background: white;
  cursor: pointer;
  min-height: 34px;
  user-select: none;
}

.payload-custom-selected span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.payload-select-arrow {
  margin-left: auto;
  flex-shrink: 0;
  color: #6b7280;
  font-size: 0.9rem;
}

.payload-placeholder {
  color: #9ca3af;
}

.payload-dropdown {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  z-index: 9999;
  background: white;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  margin-bottom: 2px;
  max-height: 200px;
  overflow-y: auto;
  box-shadow: 0 -4px 12px rgba(0,0,0,0.15);
}

.payload-dropdown-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.5rem;
  cursor: pointer;
  font-size: 0.85rem;
  transition: background 0.15s;
}

.payload-dropdown-item:hover {
  background: #eff6ff;
}

.payload-dropdown-item.selected {
  background: #dbeafe;
  font-weight: 600;
}

.payload-option-icon {
  width: 20px;
  height: 20px;
  border-radius: 3px;
  flex-shrink: 0;
  object-fit: contain;
}

.payload-amount-input {
  width: 55px;
  padding: 0.4rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 0.85rem;
  text-align: center;
  flex-shrink: 0;
}

.payload-add-button {
  padding: 0.4rem 0.6rem;
  background: #2563eb;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 600;
  white-space: nowrap;
  transition: background 0.2s;
  flex-shrink: 0;
}

.payload-add-button:hover:not(:disabled) {
  background: #1d4ed8;
}

.payload-add-button:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}

.payload-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.payload-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: #f0f9ff;
  border: 1px solid #bae6fd;
  border-radius: 6px;
  font-size: 0.85rem;
}

.payload-resource-name {
  flex: 1;
  font-weight: 600;
  color: #1e40af;
}

.payload-resource-amount {
  color: #475569;
  font-weight: 500;
}

.payload-resource-weight {
  color: #64748b;
  font-size: 0.8rem;
}

.payload-remove-button {
  background: #fee2e2;
  color: #dc2626;
  border: 1px solid #fca5a5;
  border-radius: 4px;
  cursor: pointer;
  padding: 0.15rem 0.4rem;
  font-size: 0.8rem;
  transition: background 0.2s;
}

.payload-remove-button:hover {
  background: #fecaca;
}

.payload-empty {
  text-align: center;
  color: #9ca3af;
  font-style: italic;
  font-size: 0.85rem;
  padding: 0.5rem 0;
}

.resource-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.resource-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem;
  background: linear-gradient(135deg, #f8fafb1f 0%, #f0f2f5 100%);
  border-radius: 8px;
  border: 1px solid #e0e0e0;
  transition: all 0.2s;
}

.resource-item:hover {
  border-color: #667eea;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.1);
}

.resource-name {
  font-weight: 500;
  color: #333;
  font-size: 0.95rem;
}

.resource-amount {
  color: #667eea;
  font-weight: 600;
  font-size: 1rem;
  padding: 0.25rem 0.75rem;
  background: rgba(102, 126, 234, 0.1);
  border-radius: 12px;
}

.resource-item.production .resource-amount {
  color: #10b981;
  background: rgba(16, 185, 129, 0.1);
}

.resource-item.stored .resource-amount {
  color: #2196f3;
  background: rgba(33, 150, 243, 0.1);
  font-weight: 600;
}

.resource-item.insufficient {
  border-color: #ef4444;
  background: rgba(239, 68, 68, 0.05);
}

.resource-item.insufficient .resource-name {
  color: #dc2626;
  font-weight: 600;
}

.resource-item.insufficient .resource-amount {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.15);
  font-weight: 700;
}

/* Production button */
.production-button {
  width: 100%;
  padding: 1rem 1.5rem;
  margin-top: 1rem;
  border: none;
  border-radius: 12px;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
  font-size: 1.1rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 4px 15px rgba(16, 185, 129, 0.3);
}

.production-button:hover:not(.disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(16, 185, 129, 0.4);
}

.production-button:active:not(.disabled) {
  transform: translateY(0);
}

.production-button.disabled {
  background: linear-gradient(135deg, #9ca3af 0%, #6b7280 100%);
  cursor: not-allowed;
  box-shadow: none;
}

.production-controls {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-top: 1rem;
}

.auto-production-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: #f0f9ff;
  border: 2px solid #3b82f6;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  color: #3b82f6;
  transition: all 0.2s;
  user-select: none;
  position: relative;
  overflow: hidden;
}

.auto-production-toggle:hover {
  background: #dbeafe;
}

.auto-production-toggle:has(input:checked) {
  background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
  color: white;
  animation: pulse-auto 2s infinite;
}

.auto-production-toggle.with-progress {
  padding-bottom: 1.5rem;
}

.toggle-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  z-index: 1;
}

.toggle-text {
  white-space: nowrap;
}

.progress-bar-container {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 6px;
  background: rgba(255, 255, 255, 0.3);
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #10b981 0%, #059669 100%);
  transition: width 0.1s linear;
  box-shadow: 0 0 10px rgba(16, 185, 129, 0.5);
}

@keyframes pulse-auto {
  0%, 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.4); }
  50% { box-shadow: 0 0 0 8px rgba(59, 130, 246, 0); }
}

.auto-production-toggle input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #3b82f6;
}

.auto-production-toggle:has(input:disabled) {
  opacity: 0.5;
  cursor: not-allowed;
}

.auto-production-toggle input:disabled {
  cursor: not-allowed;
}

.production-warning {
  margin: 0.75rem 0 0 0;
  padding: 0.75rem;
  background: rgba(245, 158, 11, 0.1);
  border-left: 4px solid #f59e0b;
  border-radius: 4px;
  color: #b45309;
  font-size: 0.9rem;
  font-weight: 500;
}

/* Build in progress */
.build-in-progress {
  text-align: center;
  padding: 1rem;
}

.build-progress-animation {
  width: 100%;
  height: 8px;
  background: #e5e7eb;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 0.75rem;
}

.build-progress-bar {
  width: 30%;
  height: 100%;
  background: linear-gradient(90deg, #667eea, #764ba2, #667eea);
  background-size: 200% 100%;
  border-radius: 4px;
  animation: build-progress-slide 1.5s ease-in-out infinite;
}

@keyframes build-progress-slide {
  0% { margin-left: -30%; }
  100% { margin-left: 100%; }
}

.build-progress-animation.waiting {
  background: #fef3c7;
}

.build-progress-bar.waiting-bar {
  background: linear-gradient(90deg, #f59e0b, #d97706, #f59e0b);
  background-size: 200% 100%;
  animation: build-progress-pulse 2s ease-in-out infinite;
}

@keyframes build-progress-pulse {
  0% { opacity: 0.4; margin-left: 0; width: 100%; }
  50% { opacity: 1; margin-left: 0; width: 100%; }
  100% { opacity: 0.4; margin-left: 0; width: 100%; }
}

/* Recycle progress bar styles */
.build-progress-animation.recycle {
  background: #fef3c7;
}

.build-progress-bar.recycle-bar {
  background: linear-gradient(90deg, #f97316, #ea580c, #f97316);
  background-size: 200% 100%;
  border-radius: 4px;
  animation: build-progress-slide 1.5s ease-in-out infinite;
}

.build-progress-animation.waiting.recycle .build-progress-bar.recycle-bar {
  animation: build-progress-pulse 2s ease-in-out infinite;
}

.recycle-in-progress {
  border-left: 3px solid #f97316;
  padding-left: 0.5rem;
}

.recycle-refund-info {
  margin-top: 0.75rem;
  padding: 0.5rem 0.75rem;
  background: rgba(249, 115, 22, 0.08);
  border-radius: 8px;
  border: 1px solid rgba(249, 115, 22, 0.15);
}

.recycle-refund-info h4 {
  margin: 0 0 0.5rem 0;
  font-size: 0.85rem;
  color: #ea580c;
}

.work-resource-strike .resource-amount.strikethrough {
  text-decoration: line-through;
  color: #9ca3af;
  font-style: italic;
}

.work-resource-strike .resource-name {
  color: #9ca3af;
}

.build-progress-text {
  margin: 0;
  color: #6b7280;
  font-size: 0.85rem;
  font-style: italic;
}

.worker-count-section {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.75rem;
  padding: 0.5rem 0.75rem;
  background: rgba(102, 126, 234, 0.08);
  border-radius: 8px;
  border: 1px solid rgba(102, 126, 234, 0.15);
}

.recycle-in-progress .worker-count-section {
  background: rgba(249, 115, 22, 0.08);
  border: 1px solid rgba(249, 115, 22, 0.15);
}

.worker-count-section label {
  font-size: 0.85rem;
  font-weight: 600;
  color: #4b5563;
  white-space: nowrap;
}

.worker-count-controls {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.worker-btn {
  width: 28px;
  height: 28px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: white;
  cursor: pointer;
  font-size: 1rem;
  font-weight: bold;
  color: #374151;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.worker-btn:hover:not(:disabled) {
  background: #667eea;
  color: white;
  border-color: #667eea;
}

.worker-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.worker-count-value {
  font-size: 1.1rem;
  font-weight: 700;
  color: #1f2937;
  min-width: 24px;
  text-align: center;
}

.worker-speed-info {
  font-size: 0.8rem;
  color: #667eea;
  font-weight: 600;
  margin-left: auto;
  white-space: nowrap;
}

/* Insufficient Resources Modal */
.insufficient-resources-content {
  padding: 1rem;
  max-width: 600px;
}

.insufficient-resources-content h3 {
  margin: 0 0 1.5rem 0;
  font-size: 1.5rem;
  color: #667eea;
  text-align: center;
}

.missing-section {
  margin-bottom: 2rem;
}

.missing-section:last-child {
  margin-bottom: 0;
}

.warning-text {
  font-size: 1rem;
  color: #f59e0b;
  margin-bottom: 1rem;
  padding: 0.75rem;
  background: rgba(245, 158, 11, 0.1);
  border-left: 4px solid #f59e0b;
  border-radius: 4px;
}

.missing-resources-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.missing-resource-item {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem;
  background: #f8f9fa;
  border-radius: 8px;
  border-left: 4px solid #ef4444;
}

.missing-resource-item.build-cost {
  border-left-color: #f59e0b;
}

.missing-resource-item.operational-cost {
  border-left-color: #ef4444;
}

.missing-resource-item .resource-name {
  font-weight: 600;
  font-size: 1rem;
  color: #1f2937;
}

.missing-resource-item .resource-amounts {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.9rem;
}

.missing-resource-item .resource-amounts span {
  display: flex;
  justify-content: space-between;
}

.missing-resource-item .needed {
  color: #6b7280;
}

.missing-resource-item .available {
  color: #10b981;
}

.missing-resource-item .deficit {
  color: #ef4444;
  font-weight: 600;
}

/* Game Event Modal */
.event-modal-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  align-items: center;
  text-align: center;
}

.event-modal-image {
  width: 100%;
  max-width: 400px;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
}

.event-modal-image img {
  width: 100%;
  height: auto;
  display: block;
}

.event-modal-description {
  font-size: 1rem;
  color: #374151;
  line-height: 1.6;
  padding: 0.5rem 1rem;
  background: #f9fafb;
  border-radius: 8px;
  width: 100%;
}

.event-modal-actions {
  width: 100%;
  text-align: left;
}

.event-modal-actions h4 {
  margin: 0 0 0.5rem 0;
  font-size: 0.85rem;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.event-action-item {
  padding: 0.4rem 0.75rem;
  background: #f3f4f6;
  border-radius: 6px;
  margin-bottom: 0.3rem;
  font-size: 0.9rem;
  color: #374151;
}

.event-modal-ok-btn {
  padding: 0.6rem 2.5rem;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
  margin-top: 0.5rem;
}

.event-modal-ok-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}
</style>
