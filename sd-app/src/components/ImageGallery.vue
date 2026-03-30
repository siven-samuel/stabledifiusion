<script setup>
import { ref, watch, onMounted } from 'vue'
import roadTileManager from '../utils/roadTileManager.js'

const props = defineProps({
  images: Array,
  selectedImageId: String,
  canvas: Object, // Referencia na canvas pre regeneráciu road tiles
  personSpawnEnabled: {
    type: Boolean,
    default: false
  },
  personSpawnCount: {
    type: Number,
    default: 3
  },
  carSpawnEnabled: {
    type: Boolean,
    default: false
  },
  carSpawnCount: {
    type: Number,
    default: 3
  },
  resources: {
    type: Array,
    default: () => []
  },
  workforce: {
    type: Array,
    default: () => []
  },
  roadSpriteUrl: {
    type: String,
    default: import.meta.env.BASE_URL + 'templates/roads/sprites/pastroad.png'
  },
  constructSpriteUrl: {
    type: String,
    default: import.meta.env.BASE_URL + 'templates/cubes1/contruct.png'
  },
  tempBuildingSpriteUrl: {
    type: String,
    default: import.meta.env.BASE_URL + 'templates/cubes1/0.png'
  },
  carSprite1Url: {
    type: String,
    default: import.meta.env.BASE_URL + 'templates/roads/sprites/car-dawn-top-right.png'
  },
  carSprite2Url: {
    type: String,
    default: import.meta.env.BASE_URL + 'templates/roads/sprites/car-down-top-left.png'
  },
  personSpriteUrl: {
    type: String,
    default: import.meta.env.BASE_URL + 'templates/roads/sprites/persons-mini-astro.gif'
  },
  advisorSpriteUrl: {
    type: String,
    default: import.meta.env.BASE_URL + 'templates/all/advisor3.png'
  },
  roadCostResourceId: {
    type: String,
    default: ''
  },
  roadCostAmount: {
    type: Number,
    default: 1
  }
})

const emit = defineEmits([
  'delete',
  'select',
  'place-on-board',
  'grid-size-changed',
  'delete-mode-changed',
  'road-building-mode-changed',
  'road-tiles-ready',
  'road-opacity-changed',
  'person-spawn-settings-changed',
  'car-spawn-settings-changed',
  'update-building-data',
  'command-center-selected',
  'destination-mode-started',
  'destination-mode-finished',
  'replace-image-url',
  'reorder-images',
  'structure-sprite-changed',
  'car-sprite-changed',
  'person-sprite-changed',
  'advisor-sprite-changed',
  'road-cost-changed'
])

const selectedImage = ref(null)
const selectedGridSize = ref(1) // 1, 4, 9, 16, 25, alebo -1 pre režim mazania
const activeGalleryTab = ref('roads') // 'gallery', 'roads' alebo 'structures'
const roadTiles = ref([]) // Road tiles - synchronizované s roadTileManager
const roadTilesOriginal = ref([]) // Kópia pre referenčné účely
const roadBuildingMode = ref(true) // Režim stavby ciest - automatický výber tiles
const roadOpacity = ref(100) // Opacity pre road tiles (0-100)
// Structure sprites
const localConstructSpriteUrl = ref(props.constructSpriteUrl)
const localTempBuildingSpriteUrl = ref(props.tempBuildingSpriteUrl)

// Car sprites
const localCarSprite1Url = ref(props.carSprite1Url)
const localCarSprite2Url = ref(props.carSprite2Url)

// Person sprite
const localPersonSpriteUrl = ref(props.personSpriteUrl)

// Advisor sprite
const localAdvisorSpriteUrl = ref(props.advisorSpriteUrl)

const spawnPersonsEnabled = ref(props.personSpawnEnabled) // Či pridať osoby pri kliknutí na road tile
const personsPerPlacement = ref(props.personSpawnCount) // Počet osôb na jedno umiestnenie road tile

// Drag and drop pre radenie obrázkov v galérii
const galleryDraggedId = ref(null)
const galleryDragOverId = ref(null)

const onGalleryDragStart = (event, imageId) => {
  galleryDraggedId.value = imageId
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', imageId)
  setTimeout(() => {
    const el = event.target.closest('.gallery-item')
    if (el) el.classList.add('dragging')
  }, 0)
}

const onGalleryDragOver = (event, imageId) => {
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  galleryDragOverId.value = imageId
}

const onGalleryDragLeave = () => {
  galleryDragOverId.value = null
}

const onGalleryDrop = (event, targetId) => {
  event.preventDefault()
  if (!galleryDraggedId.value || galleryDraggedId.value === targetId) {
    resetGalleryDrag()
    return
  }
  
  const list = [...props.images]
  const draggedIdx = list.findIndex(img => img.id === galleryDraggedId.value)
  const targetIdx = list.findIndex(img => img.id === targetId)
  
  if (draggedIdx === -1 || targetIdx === -1) {
    resetGalleryDrag()
    return
  }
  
  const [movedItem] = list.splice(draggedIdx, 1)
  list.splice(targetIdx, 0, movedItem)
  
  // Emit nové poradie (pole ID v správnom poradí)
  emit('reorder-images', list.map(img => img.id))
  
  resetGalleryDrag()
}

const onGalleryDragEnd = (event) => {
  const el = event.target.closest('.gallery-item')
  if (el) el.classList.remove('dragging')
  resetGalleryDrag()
}

const resetGalleryDrag = () => {
  galleryDraggedId.value = null
  galleryDragOverId.value = null
}
const spawnCarsEnabled = ref(props.carSpawnEnabled) // Či pridať autá pri kliknutí na road tile
const carsPerPlacement = ref(props.carSpawnCount) // Počet áut na jedno umiestnenie road tile

// Road cost settings
const roadCostResourceId = ref(props.roadCostResourceId)
const roadCostAmount = ref(props.roadCostAmount)

// Building data
const isBuilding = ref(false)
const isCommandCenter = ref(false) // Či je budova command center
const isPort = ref(false) // Či je budova prístav
const canBuildOnlyInDestination = ref(false) // Či sa môže stavať len v destination tiles
const destinationTiles = ref([]) // Pole destination tiles [{row, col}]
const isSettingDestination = ref(false) // Či práve nastavujeme destination
const buildingName = ref('') // Názov budovy
const buildingSize = ref('default') // Veľkosť budovy
const dontDropShadow = ref(false) // Či nezobrazovať tieň
const buildCost = ref([]) // [{resourceId, resourceName, amount}]
const operationalCost = ref([]) // [{resourceId, resourceName, amount}]
const production = ref([]) // [{resourceId, resourceName, amount}]
const stored = ref([]) // [{resourceId, resourceName, amount}] - skladované resources v budove
const hasSmokeEffect = ref(false) // Či budova emituje dym
const smokeSpeed = ref(1) // Rýchlosť animácie dymu (0.1 - 3)
const smokeScale = ref(1) // Veľkosť častíc dymu (0.1 - 3)
const smokeAlpha = ref(0.5) // Priehľadnosť dymu (0.1 - 1.0)
const smokeTint = ref(1) // Tmavosť dymu - brightness multiplikátor (0.1 - 2.0, 1=normálne)
const hasLightEffect = ref(false) // Či budova má blikajúce svetlo
const hasFlyAwayEffect = ref(false) // Či budova má fly-away efekt
const lightBlinkSpeed = ref(1) // Rýchlosť blikania svetla (0.1 - 10)
const lightColor = ref('#ffff00') // Farba svetla (hex)
const lightSize = ref(1) // Veľkosť svetla (0.1 - 5)
const allowedResources = ref([]) // [{resourceId, resourceName}] - povolené resources pre port
const portCapacity = ref(0) // Kapacita portu
const selectedAllowedResource = ref('')
const selectedBuildResource = ref('')
const selectedOperationalResource = ref('')
const selectedProductionResource = ref('')
const selectedStoredResource = ref('')
const buildAmount = ref(1)
const operationalAmount = ref(1)
const productionAmount = ref(1)
const storedAmount = ref(1)

// Watch pre props - aktualizuj lokálne refs keď sa zmenia props (napr. po načítaní projektu)
watch(() => props.personSpawnEnabled, (newVal) => {
  spawnPersonsEnabled.value = newVal
  console.log('🔄 ImageGallery: personSpawnEnabled updated from props:', newVal)
})

watch(() => props.personSpawnCount, (newVal) => {
  personsPerPlacement.value = Math.max(0, Math.min(500, Math.round(newVal || 0)))
  console.log('🔄 ImageGallery: personsPerPlacement updated from props:', personsPerPlacement.value)
})

watch(() => props.carSpawnEnabled, (newVal) => {
  spawnCarsEnabled.value = newVal
  console.log('🔄 ImageGallery: carSpawnEnabled updated from props:', newVal)
})

watch(() => props.carSpawnCount, (newVal) => {
  carsPerPlacement.value = Math.max(0, Math.min(500, Math.round(newVal || 0)))
  console.log('🔄 ImageGallery: carsPerPlacement updated from props:', carsPerPlacement.value)
})

// Načítaj a rozrež road sprite na 12 tiles (4 stĺpce x 3 riadky) s izometrickou maskou
const loadRoadSprite = async (spriteUrl = null) => {
  // Použi explicitný parameter ak je poskytnutý, inak použij prop
  const spritePath = spriteUrl || props.roadSpriteUrl
  console.log('🛣️ loadRoadSprite začína s cestou:', spritePath.substring(0, 50) + '...')
  console.log('   Zdroj URL:', spriteUrl ? 'parameter' : 'props.roadSpriteUrl')
  const img = new Image()
  img.crossOrigin = 'anonymous'
  
  img.onload = async () => {
    console.log('✅ Road sprite obrázok načítaný, veľkosť:', img.width, 'x', img.height)
    // ═══════════════════════════════════════════════════════════════════
    // MANUÁLNA DEFINÍCIA POZÍCIÍ ROAD TILES V SPRITE (presentroad.png)
    // 
    // Každý tile má vlastné súradnice:
    //   x, y     = pozícia ľavého horného rohu v sprite (v pixeloch)
    //   width    = šírka výrezu v sprite (v pixeloch)
    //   height   = výška výrezu v sprite (v pixeloch)
    //   name     = názov tile pre zobrazenie v galérii
    //
    // Cieľová veľkosť po vyrezaní: 64×32 px (izometrické políčko)
    // ═══════════════════════════════════════════════════════════════════
    const tileDefinitions = [
      // { name: 'Názov', x: 0, y: 0, width: 100, height: 50 },
      
      { name: 'Rovná ↘', x: 570, y: 266, width: 205, height: 105, rotation: 10 },
      { name: 'Rovná ↙', x: 20, y: 152, width: 205, height: 105, rotation: 0 },
      
      // Rohy
      { name: 'Roh ↙', x: 580, y: 413, width: 205, height: 105, rotation: 0},
      { name: 'Roh ↘', x: 727, y: 342, width: 205, height: 105, rotation: 0 },
      { name: 'Roh ↖', x: 309, y: 275, width: 205, height: 105, rotation: 0  },
      { name: 'Roh ↗', x: 437, y: 78, width: 205, height: 105, rotation: 0  }, //nastavené ručne
      
      // T-križovatky
      { name: 'T ↖', x: 576, y: 146, width: 205, height: 105, rotation: 0 },
      { name: 'T ↘', x: 176, y: 73, width: 205, height: 105, rotation: 0 },
      { name: 'T ↗', x: 313, y: 141, width: 205, height: 105, rotation: 1 },
      { name: 'T ↙', x: 726, y: 74, width: 205, height: 105, rotation: 0 },
      
      // Križovatka a koniec
      { name: 'Križovatka +', x: 449, y: 206, width: 205, height: 105, rotation: 0 }, //vyladane super
      { name: 'Koniec', x: 768, y: 384, width: 256, height: 128, rotation: 0 },
    ]
    
    // Cieľová veľkosť políčka (rovnaká ako v PhaserCanvas)
    // Zväčši tieto hodnoty pre väčšie priblíženie v galérii
    const TILE_WIDTH = 200
    const TILE_HEIGHT = 100
    
    const tiles = []
    
    for (let i = 0; i < tileDefinitions.length; i++) {
      const def = tileDefinitions[i]
      
      // Vytvor canvas s veľkosťou políčka
      const canvas = document.createElement('canvas')
      canvas.width = TILE_WIDTH
      canvas.height = TILE_HEIGHT
      const ctx = canvas.getContext('2d')
      
      // Škáluj obrázok aby šírka zodpovedala TILE_WIDTH
      const scale = TILE_WIDTH / def.width
      const scaledHeight = def.height * scale
      
      // Najprv vytvor izometrickú masku (diamant)
      ctx.beginPath()
      ctx.moveTo(TILE_WIDTH / 2, 0) // Hore
      ctx.lineTo(TILE_WIDTH, TILE_HEIGHT / 2) // Vpravo
      ctx.lineTo(TILE_WIDTH / 2, TILE_HEIGHT) // Dole
      ctx.lineTo(0, TILE_HEIGHT / 2) // Vľavo
      ctx.closePath()
      ctx.clip() // Aplikuj masku
      
      // Potom nakresli tile (vycentrovaný a škálovaný)
      const offsetY = (TILE_HEIGHT - scaledHeight) / 2
      ctx.drawImage(
        img,
        def.x, def.y, def.width, def.height,  // Zdrojová oblasť v sprite
        0, offsetY, TILE_WIDTH, scaledHeight   // Cieľová oblasť na canvas
      )
      
      let bitmap = null
      try {
        bitmap = await createImageBitmap(canvas)
      } catch (e) {
        console.warn('createImageBitmap zlyhalo, fallback na dataURL', e)
      }
      
      tiles.push({
        id: `road_tile_${i}`,
        url: canvas.toDataURL('image/png'),
        bitmap, // pripravené na rýchle kreslenie
        name: def.name,
        tileIndex: i, // Index pre rekreáciu z metadata
        x: def.x,
        y: def.y,
        width: def.width,
        height: def.height,
        rotation: def.rotation,
        opacity: roadOpacity.value // Aktuálna opacity
      })
    }
    
    roadTiles.value = tiles
    roadTilesOriginal.value = JSON.parse(JSON.stringify(tiles)) // Ulož originály
    console.log(`🛣️ Načítaných ${tiles.length} road tiles zo sprite s opacity ${roadOpacity.value}%`)
  }
  
  img.onerror = () => {
    console.error('Nepodarilo sa načítať road sprite')
  }
  
  img.src = spritePath
}

// Funkcia na aktualizáciu sprite URL a reloadnutie tiles
// POZNÁMKA: roadSpriteUrl je teraz prop, takže sa aktualizuje v parent komponente
const updateRoadSprite = async (newSpriteUrl) => {
  console.log('🔄 updateRoadSprite volaný s URL:', newSpriteUrl.substring(0, 50) + '...')
  console.log('   Aktuálny props.roadSpriteUrl:', props.roadSpriteUrl.substring(0, 50) + '...')
  // Použi explicitný parameter pre načítanie sprite (nie prop)
  await loadRoadSprite(newSpriteUrl)
  console.log('   loadRoadSprite dokončený s novým sprite')
}

// Načítaj sprite pri štarte
onMounted(() => {
  // Sprite sa načíta cez watch na props.roadSpriteUrl
  // alebo cez updateRoadSprite() volanie z App.vue
  console.log('🎬 ImageGallery mounted s roadSpriteUrl:', props.roadSpriteUrl.substring(0, 50) + '...')
  if (props.roadSpriteUrl) {
    loadRoadSprite(props.roadSpriteUrl)
  }
})

// Watch na zmenu roadSpriteUrl prop - načítaj sprite pri zmene
watch(() => props.roadSpriteUrl, (newUrl) => {
  if (newUrl) {
    console.log('🔄 props.roadSpriteUrl zmenené, načítavam sprite:', newUrl.substring(0, 50) + '...')
    loadRoadSprite(newUrl)
  }
})

// Watch na zmenu structure sprite props
watch(() => props.constructSpriteUrl, (newUrl) => {
  if (newUrl) localConstructSpriteUrl.value = newUrl
})
watch(() => props.tempBuildingSpriteUrl, (newUrl) => {
  if (newUrl) localTempBuildingSpriteUrl.value = newUrl
})
watch(() => props.carSprite1Url, (newUrl) => {
  if (newUrl) localCarSprite1Url.value = newUrl
})
watch(() => props.carSprite2Url, (newUrl) => {
  if (newUrl) localCarSprite2Url.value = newUrl
})
watch(() => props.personSpriteUrl, (newUrl) => {
  if (newUrl) localPersonSpriteUrl.value = newUrl
})
watch(() => props.advisorSpriteUrl, (newUrl) => {
  if (newUrl) localAdvisorSpriteUrl.value = newUrl
})
watch(() => props.roadCostResourceId, (newVal) => {
  roadCostResourceId.value = newVal || ''
})
watch(() => props.roadCostAmount, (newVal) => {
  if (newVal !== undefined) roadCostAmount.value = newVal
})

// Upload handler pre structure sprites
const handleStructureSpriteUpload = (event, type) => {
  const file = event.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (e) => {
    const dataUrl = e.target.result
    if (type === 'construct') {
      localConstructSpriteUrl.value = dataUrl
    } else {
      localTempBuildingSpriteUrl.value = dataUrl
    }
    emit('structure-sprite-changed', { type, url: dataUrl })
    console.log(`🏗️ Structure sprite '${type}' updated`)
  }
  reader.readAsDataURL(file)
  event.target.value = ''
}

// Upload handler pre person sprite
const handlePersonSpriteUpload = (event) => {
  const file = event.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (e) => {
    const dataUrl = e.target.result
    localPersonSpriteUrl.value = dataUrl
    emit('person-sprite-changed', { url: dataUrl })
    console.log(`🚶 Person sprite updated`)
  }
  reader.readAsDataURL(file)
  event.target.value = ''
}

// Upload handler pre advisor sprite
const handleAdvisorSpriteUpload = (event) => {
  const file = event.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (e) => {
    const dataUrl = e.target.result
    localAdvisorSpriteUrl.value = dataUrl
    emit('advisor-sprite-changed', { url: dataUrl })
    console.log(`🧑‍🚀 Advisor sprite updated`)
  }
  reader.readAsDataURL(file)
  event.target.value = ''
}

// Upload handler pre car sprites
const handleCarSpriteUpload = (event, type) => {
  const file = event.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (e) => {
    const dataUrl = e.target.result
    if (type === 'car1') {
      localCarSprite1Url.value = dataUrl
    } else {
      localCarSprite2Url.value = dataUrl
    }
    emit('car-sprite-changed', { type, url: dataUrl })
    console.log(`🚗 Car sprite '${type}' updated`)
  }
  reader.readAsDataURL(file)
  event.target.value = ''
}

// Watch pre zmenu tabu - aktivuj road building mode keď je roads tab
watch(activeGalleryTab, (newTab) => {
  const isRoadTab = newTab === 'roads'
  emit('road-building-mode-changed', isRoadTab && roadBuildingMode.value)
  console.log(`🛣️ Road building mode: ${isRoadTab && roadBuildingMode.value ? 'AKTÍVNY' : 'NEAKTÍVNY'}`)
})

// Watch pre roadTiles - keď sú načítané, pošli ich do parent komponentu
watch(roadTiles, (tiles) => {
  if (tiles.length > 0) {
    emit('road-tiles-ready', tiles)
    // Aktivuj road building mode ak sme na roads tabe
    if (activeGalleryTab.value === 'roads') {
      emit('road-building-mode-changed', roadBuildingMode.value)
    }
    // Synchronizuj s roadTileManager
    if (roadTileManager.getTiles().length === 0) {
      console.log('🔄 ImageGallery: Synchronizujem tiles s roadTileManager')
    }
  }
}, { immediate: true })

const emitPersonSettings = () => {
  const safeCount = Math.max(0, Math.min(500, Math.round(personsPerPlacement.value || 0)))
  personsPerPlacement.value = safeCount
  emit('person-spawn-settings-changed', {
    enabled: spawnPersonsEnabled.value,
    count: safeCount
  })
}

const emitCarSettings = () => {
  const safeCount = Math.max(0, Math.min(500, Math.round(carsPerPlacement.value || 0)))
  carsPerPlacement.value = safeCount
  emit('car-spawn-settings-changed', {
    enabled: spawnCarsEnabled.value,
    count: safeCount
  })
}

watch(spawnPersonsEnabled, () => emitPersonSettings(), { immediate: true })
watch(personsPerPlacement, () => emitPersonSettings())

watch(spawnCarsEnabled, () => emitCarSettings(), { immediate: true })
watch(carsPerPlacement, () => emitCarSettings())

const emitRoadCostSettings = () => {
  emit('road-cost-changed', {
    resourceId: roadCostResourceId.value,
    amount: roadCostAmount.value
  })
}

watch(roadCostResourceId, () => emitRoadCostSettings())
watch(roadCostAmount, () => emitRoadCostSettings())

// Funkcia na uloženie building data
const saveBuildingData = () => {
  if (selectedImage.value) {
    const buildingData = {
      isBuilding: isBuilding.value,
      isCommandCenter: isCommandCenter.value,
      isPort: isPort.value,
      canBuildOnlyInDestination: canBuildOnlyInDestination.value,
      destinationTiles: destinationTiles.value,
      buildingName: buildingName.value,
      buildingSize: buildingSize.value,
      dontDropShadow: dontDropShadow.value,
      buildCost: buildCost.value,
      operationalCost: operationalCost.value,
      production: production.value,
      stored: stored.value,
      allowedResources: allowedResources.value,
      portCapacity: portCapacity.value,
      hasSmokeEffect: hasSmokeEffect.value,
      smokeSpeed: smokeSpeed.value,
      smokeScale: smokeScale.value,
      smokeAlpha: smokeAlpha.value,
      smokeTint: smokeTint.value,
      hasLightEffect: hasLightEffect.value,
      hasFlyAwayEffect: hasFlyAwayEffect.value,
      lightBlinkSpeed: lightBlinkSpeed.value,
      lightColor: lightColor.value,
      lightSize: lightSize.value
    }
    
    emit('update-building-data', {
      imageId: selectedImage.value.id,
      buildingData
    })
    
    console.log('💾 Building data automaticky uložené:', buildingData)
  }
}

// Watch na building data - automaticky ukladaj pri každej zmene
watch([isBuilding, isCommandCenter, isPort, canBuildOnlyInDestination, destinationTiles, buildingName, buildingSize, dontDropShadow, buildCost, operationalCost, production, stored, allowedResources, portCapacity, hasSmokeEffect, smokeSpeed, smokeScale, smokeAlpha, smokeTint, hasLightEffect, hasFlyAwayEffect, lightBlinkSpeed, lightColor, lightSize], () => {
  saveBuildingData()
}, { deep: true })

// Explicitný watch na buildingSize pre okamžité uloženie
watch(buildingSize, (newSize) => {
  console.log('📐 Building size zmenené na:', newSize)
  saveBuildingData()
})

// Explicitný watch na stored pre debugging
watch(stored, (newStored) => {
  console.log('🏚️ Stored zmenené:', JSON.stringify(newStored))
  saveBuildingData()
}, { deep: true })

// Explicitný watch na destinationTiles pre debugging
watch(destinationTiles, (newTiles) => {
  console.log('🎯 Destination tiles zmenené:', JSON.stringify(newTiles))
  saveBuildingData()
}, { deep: true })

// Watch na isCommandCenter - command center môže byť len jeden
watch(isCommandCenter, (newValue) => {
  if (newValue === true && selectedImage.value) {
    // Notifikuj parent komponent že táto budova je teraz command center
    emit('command-center-selected', selectedImage.value.id)
    console.log('🏛️ Command center označený:', selectedImage.value.id)
  }
})

// Funkcia na regenerovanie road tiles s novou opacity
const regenerateRoadTilesWithOpacity = async () => {
  console.log(`🎨 ImageGallery: Regenerujem tiles s novou opacity ${roadOpacity.value}%`)
  
  try {
    const tiles = await roadTileManager.changeOpacity(roadOpacity.value)
    roadTiles.value = tiles
    roadTilesOriginal.value = JSON.parse(JSON.stringify(tiles))
    console.log(`✅ ImageGallery: Road tiles regenerované s opacity ${roadOpacity.value}%`)
    
    // Emitni event s novou opacity pre parent komponent
    emit('road-opacity-changed', roadOpacity.value)
  } catch (error) {
    console.error('❌ ImageGallery: Chyba pri regenerácii tiles:', error)
  }
}

// Watch pre zmenu opacity
watch(roadOpacity, async (newOpacity) => {
  await regenerateRoadTilesWithOpacity()
})

// Funkcia na získanie road tile podľa smeru
const getRoadTileByDirection = (direction) => {
  return roadTileManager.getTileByDirection(direction)
}

// Funkcia na získanie road tile podľa indexu (pre load z metadata)
const getRoadTileByIndex = (tileIndex) => {
  return roadTileManager.getTileByIndex(tileIndex)
}

const copyToClipboard = async (text, label = 'text') => {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
  } catch (err) {
    console.error(`Kopírovanie ${label} zlyhalo:`, err)
  }
}

// Watch grid size changes and emit to parent
watch(selectedGridSize, (newSize) => {
  if (newSize === -1) {
    // Delete mode: 1x1 hover, but in delete mode
    emit('grid-size-changed', { cellsX: 1, cellsY: 1 })
    emit('delete-mode-changed', true)
  } else {
    const cellsPerSide = Math.sqrt(newSize)
    emit('grid-size-changed', { cellsX: cellsPerSide, cellsY: cellsPerSide })
    emit('delete-mode-changed', false)
  }
})

const openModal = (image) => {
  selectedImage.value = image
  
  // Načítaj building data ak existujú
  if (image.buildingData) {
    isBuilding.value = image.buildingData.isBuilding || false
    isCommandCenter.value = image.buildingData.isCommandCenter || false
    isPort.value = image.buildingData.isPort || false
    canBuildOnlyInDestination.value = image.buildingData.canBuildOnlyInDestination || false
    destinationTiles.value = image.buildingData.destinationTiles || []
    buildingName.value = image.buildingData.buildingName || ''
    buildingSize.value = image.buildingData.buildingSize || 'default'
    dontDropShadow.value = image.buildingData.dontDropShadow === true // Explicitná kontrola pre boolean
    buildCost.value = image.buildingData.buildCost || []
    operationalCost.value = image.buildingData.operationalCost || []
    production.value = image.buildingData.production || []
    stored.value = image.buildingData.stored || []
    allowedResources.value = image.buildingData.allowedResources || []
    portCapacity.value = image.buildingData.portCapacity || 0
    hasSmokeEffect.value = image.buildingData.hasSmokeEffect === true
    smokeSpeed.value = image.buildingData.smokeSpeed || 1
    smokeScale.value = image.buildingData.smokeScale || 1
    smokeAlpha.value = image.buildingData.smokeAlpha !== undefined ? image.buildingData.smokeAlpha : 0.5
    smokeTint.value = image.buildingData.smokeTint || 1
    hasLightEffect.value = image.buildingData.hasLightEffect === true
    hasFlyAwayEffect.value = image.buildingData.hasFlyAwayEffect === true
    lightBlinkSpeed.value = image.buildingData.lightBlinkSpeed || 1
    lightColor.value = image.buildingData.lightColor || '#ffff00'
    lightSize.value = image.buildingData.lightSize || 1
    console.log('🔍 Loading building data (smoke & light):', image.buildingData)
  } else {
    isBuilding.value = false
    isCommandCenter.value = false
    isPort.value = false
    canBuildOnlyInDestination.value = false
    destinationTiles.value = []
    buildingName.value = ''
    buildingSize.value = 'default'
    dontDropShadow.value = false
    buildCost.value = []
    operationalCost.value = []
    production.value = []
    stored.value = []
    allowedResources.value = []
    portCapacity.value = 0
    hasSmokeEffect.value = false
    smokeSpeed.value = 1
    smokeScale.value = 1
    smokeAlpha.value = 0.5
    smokeTint.value = 1
    hasLightEffect.value = false
    hasFlyAwayEffect.value = false
    lightBlinkSpeed.value = 1
    lightColor.value = '#ffff00'
    lightSize.value = 1
  }
}

const closeModal = () => {
  selectedImage.value = null
  isBuilding.value = false
  isCommandCenter.value = false
  isPort.value = false
  canBuildOnlyInDestination.value = false
  destinationTiles.value = []
  isSettingDestination.value = false
  dontDropShadow.value = false
  buildingName.value = ''
  buildingSize.value = 'default'
  buildCost.value = []
  operationalCost.value = []
  production.value = []
  stored.value = []
  allowedResources.value = []
  portCapacity.value = 0
  hasSmokeEffect.value = false
  smokeSpeed.value = 1
  smokeScale.value = 1
  smokeAlpha.value = 0.5
  smokeTint.value = 1
  hasFlyAwayEffect.value = false
  selectedBuildResource.value = ''
  selectedOperationalResource.value = ''
  selectedProductionResource.value = ''
  selectedStoredResource.value = ''
}

const downloadImage = (image) => {
  const link = document.createElement('a')
  link.href = image.url
  link.download = `stable-diffusion-${image.id}.png`
  link.click()
}

const deleteImage = (id) => {
  if (confirm('Are you sure you want to delete this image?')) {
    emit('delete', id)
    if (selectedImage.value?.id === id) {
      closeModal()
    }
  }
}

const placeOnBoard = () => {
  // Najprv skús nájsť v images, potom v roadTiles
  let selected = props.images.find(img => img.id === props.selectedImageId)
  
  if (!selected) {
    selected = roadTiles.value.find(tile => tile.id === props.selectedImageId)
  }
  
  if (selected) {
    // Vypočítaj cellsX a cellsY podľa selectedGridSize
    const cellsPerSide = Math.sqrt(selectedGridSize.value)
    emit('place-on-board', {
      ...selected,
      cellsX: cellsPerSide,
      cellsY: cellsPerSide
    })
  }
}

const formatDate = (date) => {
  return new Date(date).toLocaleString('en-US')
}

// Building management functions
const addBuildResource = () => {
  if (!selectedBuildResource.value) return
  const resource = props.resources.find(r => r.id === selectedBuildResource.value)
  if (!resource) return
  
  buildCost.value.push({
    resourceId: resource.id,
    resourceName: resource.name,
    amount: buildAmount.value
  })
  selectedBuildResource.value = ''
  buildAmount.value = 1
}

const removeBuildResource = (index) => {
  buildCost.value.splice(index, 1)
}

const addOperationalResource = () => {
  if (!selectedOperationalResource.value) return
  const resource = props.resources.find(r => r.id === selectedOperationalResource.value)
  if (!resource) return
  
  operationalCost.value.push({
    resourceId: resource.id,
    resourceName: resource.name,
    amount: operationalAmount.value
  })
  selectedOperationalResource.value = ''
  operationalAmount.value = 1
}

const removeOperationalResource = (index) => {
  operationalCost.value.splice(index, 1)
}

const addProductionResource = () => {
  if (!selectedProductionResource.value) return
  const resource = props.resources.find(r => r.id === selectedProductionResource.value)
  if (!resource) return
  
  production.value.push({
    resourceId: resource.id,
    resourceName: resource.name,
    amount: productionAmount.value
  })
  selectedProductionResource.value = ''
  productionAmount.value = 1
}

const removeProductionResource = (index) => {
  production.value.splice(index, 1)
}

const addStoredResource = () => {
  if (!selectedStoredResource.value) return
  const resource = props.resources.find(r => r.id === selectedStoredResource.value)
  if (!resource) return
  
  stored.value.push({
    resourceId: resource.id,
    resourceName: resource.name,
    amount: storedAmount.value
  })
  selectedStoredResource.value = ''
  storedAmount.value = 1
}

const addAllowedResource = () => {
  if (!selectedAllowedResource.value) return
  const resource = props.resources.find(r => r.id === selectedAllowedResource.value)
  if (!resource) return
  
  // Skontroluj duplicitu
  if (allowedResources.value.some(r => r.resourceId === resource.id)) return
  
  allowedResources.value.push({
    resourceId: resource.id,
    resourceName: resource.name
  })
  selectedAllowedResource.value = ''
}

const removeAllowedResource = (index) => {
  allowedResources.value.splice(index, 1)
}

const removeStoredResource = (index) => {
  stored.value.splice(index, 1)
}

// Destination mode funkcie
const startSettingDestination = () => {
  isSettingDestination.value = true
  console.log('🎯 Začínam nastavovať destination tiles')
  // Emit event pre parent aby vedel že sme v destination mode
  emit('destination-mode-started')
}

const finishSettingDestination = () => {
  isSettingDestination.value = false
  console.log('✅ Destination tiles nastavené:', destinationTiles.value)
  // Emit event pre parent že destination mode skončil
  emit('destination-mode-finished')
}

const addDestinationTile = (row, col) => {
  // Skontroluj či tile už nie je v zozname
  const exists = destinationTiles.value.some(t => t.row === row && t.col === col)
  if (!exists) {
    destinationTiles.value.push({ row, col })
    console.log(`➕ Pridaný destination tile: [${row}, ${col}]`)
  } else {
    // Ak už existuje, odstráň ho (toggle)
    destinationTiles.value = destinationTiles.value.filter(t => !(t.row === row && t.col === col))
    console.log(`➖ Odstránený destination tile: [${row}, ${col}]`)
  }
}

const isDestinationTile = (row, col) => {
  return destinationTiles.value.some(t => t.row === row && t.col === col)
}

// Nahradenie obrázka v modále
const handleReplaceImage = async (event) => {
  const file = event.target.files[0]
  if (!file) return
  
  // Kontrola veľkosti súboru (max 10MB)
  if (file.size > 10 * 1024 * 1024) {
    alert('Image is too large (max 10MB)')
    event.target.value = ''
    return
  }
  
  // Kontrola typu súboru
  if (!file.type.startsWith('image/')) {
    alert('File is not an image')
    event.target.value = ''
    return
  }
  
  const reader = new FileReader()
  reader.onload = async (e) => {
    const newImageUrl = e.target.result
    
    // Nahraď len URL obrázka, všetky metadáta zostanú
    if (selectedImage.value) {
      emit('replace-image-url', selectedImage.value.id, newImageUrl)
      console.log('🔄 Obrázok nahradený pre ID:', selectedImage.value.id)
      
      // Zatvor modal po úspešnom nahratí
      closeModal()
    }
    
    // Vyčisti file input
    event.target.value = ''
  }
  
  reader.readAsDataURL(file)
}

// Expose pre parent komponent
defineExpose({
  getRoadTileByDirection,
  getRoadTileByIndex,
  roadTiles,
  updateRoadSprite,
  activeGalleryTab,
  roadOpacity,
  isSettingDestination,
  addDestinationTile,
  isDestinationTile,
  finishSettingDestination,
  localConstructSpriteUrl,
  localTempBuildingSpriteUrl,
  localCarSprite1Url,
  localCarSprite2Url,
  localPersonSpriteUrl,
  localAdvisorSpriteUrl
})
</script>

<template>
  <!-- Grid size tabs -->
  <div class="grid-size-tabs">
    <button 
      @click="selectedGridSize = 1" 
      :class="{ active: selectedGridSize === 1 }"
      class="size-btn"
      title="1 tile (1x1)"
    >
      1
    </button>
    <button 
      @click="selectedGridSize = 4" 
      :class="{ active: selectedGridSize === 4 }"
      class="size-btn"
      title="4 tiles (2x2)"
    >
      4
    </button>
    <button 
      @click="selectedGridSize = 9" 
      :class="{ active: selectedGridSize === 9 }"
      class="size-btn"
      title="9 tiles (3x3)"
    >
      9
    </button>
    <button 
      @click="selectedGridSize = 16" 
      :class="{ active: selectedGridSize === 16 }"
      class="size-btn"
      title="16 tiles (4x4)"
    >
      16
    </button>
    <button 
      @click="selectedGridSize = 25" 
      :class="{ active: selectedGridSize === 25 }"
      class="size-btn"
      title="25 tiles (5x5)"
    >
      25
    </button>
    <button 
      @click="selectedGridSize = -1" 
      :class="{ active: selectedGridSize === -1, 'delete-btn': true }"
      class="size-btn"
      title="Delete mode - click on a tile on the board to delete it"
    >
      🗑️
    </button>
  </div>
  
  <!-- Gallery/Roads tabs -->
  <div class="gallery-tabs">
    <button 
      @click="activeGalleryTab = 'gallery'" 
      :class="{ active: activeGalleryTab === 'gallery' }"
      class="gallery-tab-btn"
    >
      🖼️ Gallery
    </button>
    <button 
      @click="activeGalleryTab = 'roads'" 
      :class="{ active: activeGalleryTab === 'roads' }"
      class="gallery-tab-btn"
    >
      🛣️ Roads
    </button>
    <button 
      @click="activeGalleryTab = 'structures'" 
      :class="{ active: activeGalleryTab === 'structures' }"
      class="gallery-tab-btn"
    >
      🏗️ Structures
    </button>
    <button 
      @click="activeGalleryTab = 'characters'" 
      :class="{ active: activeGalleryTab === 'characters' }"
      class="gallery-tab-btn"
    >
      🚶 Characters
    </button>
  </div>
  
  <!-- Opacity control for roads -->
  <div v-if="activeGalleryTab === 'roads'" class="opacity-control">
    <label for="road-opacity">Opacity:</label>
    <div class="opacity-input-group">
      <input 
        id="road-opacity"
        v-model.number="roadOpacity" 
        type="range" 
        min="0" 
        max="100" 
        step="5"
        class="opacity-slider"
      />
      <span class="opacity-value">{{ roadOpacity }}%</span>
    </div>
  </div>

  <!-- Person spawn controls -->
  <div v-if="activeGalleryTab === 'roads'" class="person-spawn-controls">
    <label class="person-spawn-checkbox">
      <input type="checkbox" v-model="spawnPersonsEnabled" />
      <span>Add people when placing road</span>
    </label>
    <div class="person-count-input">
      <label for="persons-per-placement">Number of people:</label>
      <input
        id="persons-per-placement"
        type="number"
        min="0"
        max="500"
        step="1"
        v-model.number="personsPerPlacement"
      />
    </div>
  </div>

  <!-- Car spawn controls -->
  <div v-if="activeGalleryTab === 'roads'" class="car-spawn-controls">
    <label class="car-spawn-checkbox">
      <input type="checkbox" v-model="spawnCarsEnabled" />
      <span>Add cars when placing road</span>
    </label>
    <div class="car-count-input">
      <label for="cars-per-placement">Number of cars:</label>
      <input
        id="cars-per-placement"
        type="number"
        min="0"
        max="500"
        step="1"
        v-model.number="carsPerPlacement"
      />
    </div>
  </div>

  <!-- Road cost controls -->
  <div v-if="activeGalleryTab === 'roads'" class="road-cost-controls">
    <label class="road-cost-label">🪨 Cost per road tile:</label>
    <div class="resource-input-group">
      <select v-model="roadCostResourceId" class="resource-select">
        <option value="">-- None --</option>
        <option 
          v-for="resource in resources" 
          :key="resource.id" 
          :value="resource.id"
        >
          {{ resource.name }}
        </option>
      </select>
      <input 
        type="number" 
        v-model.number="roadCostAmount" 
        min="1" 
        max="9999" 
        step="1" 
        class="amount-input"
        :disabled="!roadCostResourceId"
      />
    </div>
  </div>
  
  <div class="gallery">
    
    <!-- Gallery tab content -->
    <template v-if="activeGalleryTab === 'gallery'">
      <div v-if="images.length === 0" class="empty-state">
        <p>📷 No generated images yet</p>
        <p>Start by generating your first image!</p>
      </div>

      <div v-else class="gallery-grid">
        <div 
          v-for="image in images" 
          :key="image.id" 
          :class="['gallery-item', { 'selected': image.id === selectedImageId, 'drag-over': galleryDragOverId === image.id }]"
          @click="emit('select', { id: image.id, imageData: image })"
          @dblclick="openModal(image)"
          draggable="true"
          @dragstart="onGalleryDragStart($event, image.id)"
          @dragover="onGalleryDragOver($event, image.id)"
          @dragleave="onGalleryDragLeave"
          @drop="onGalleryDrop($event, image.id)"
          @dragend="onGalleryDragEnd"
        >
          <img :src="image.url" :alt="image.prompt" />
          <div class="image-overlay">
            <p class="prompt-preview">{{ image.prompt }}</p>
          </div>
          <div v-if="image.id === selectedImageId" class="selected-badge">✓</div>
        </div>
      </div>
    </template>
    
    <!-- Roads tab content -->
    <template v-else-if="activeGalleryTab === 'roads'">
      <div v-if="roadTiles.length === 0" class="empty-state">
        <p>⏳ Loading road tiles...</p>
      </div>
      
      <div v-else class="roads-grid">
        <div 
          v-for="tile in roadTiles" 
          :key="tile.id" 
          :class="['road-tile-item', { 'selected': tile.id === selectedImageId }]"
          @click="emit('select', { id: tile.id, imageData: tile })"
        >
          <img :src="tile.url" :alt="tile.name" />
          <div class="tile-label">{{ tile.name }}</div>
          <div v-if="tile.id === selectedImageId" class="selected-badge">✓</div>
        </div>
      </div>
    </template>

    <!-- Structures tab content -->
    <template v-else-if="activeGalleryTab === 'structures'">
      <div class="structures-grid">
        <div class="structure-sprite-card">
          <div class="structure-label">🔨 Construction Sprite</div>
          <div class="structure-preview">
            <img :src="localConstructSpriteUrl" alt="Construct sprite" />
          </div>
          <label class="btn-upload-sprite">
            Upload
            <input type="file" accept="image/*" @change="handleStructureSpriteUpload($event, 'construct')" hidden />
          </label>
        </div>
        <div class="structure-sprite-card">
          <div class="structure-label">🏠 Temp Building Sprite</div>
          <div class="structure-preview">
            <img :src="localTempBuildingSpriteUrl" alt="Temp building sprite" />
          </div>
          <label class="btn-upload-sprite">
            Upload
            <input type="file" accept="image/*" @change="handleStructureSpriteUpload($event, 'tempBuilding')" hidden />
          </label>
        </div>
      </div>
    </template>

    <!-- Characters tab content -->
    <template v-else-if="activeGalleryTab === 'characters'">
      <div class="structures-grid">
        <div class="structure-sprite-card">
          <div class="structure-label">🧑‍🚀 Advisor Sprite</div>
          <div class="structure-preview">
            <img :src="localAdvisorSpriteUrl" alt="Advisor sprite" />
          </div>
          <label class="btn-upload-sprite">
            Upload
            <input type="file" accept="image/*" @change="handleAdvisorSpriteUpload($event)" hidden />
          </label>
        </div>
        <div class="structure-sprite-card">
          <div class="structure-label">🚶 Person Sprite (GIF)</div>
          <div class="structure-preview">
            <img :src="localPersonSpriteUrl" alt="Person sprite" />
          </div>
          <label class="btn-upload-sprite">
            Upload
            <input type="file" accept="image/gif,image/*" @change="handlePersonSpriteUpload($event)" hidden />
          </label>
        </div>
        <div class="structure-sprite-card">
          <div class="structure-label">🚗 Car Sprite 1 (↗)</div>
          <div class="structure-preview">
            <img :src="localCarSprite1Url" alt="Car sprite 1" />
          </div>
          <label class="btn-upload-sprite">
            Upload
            <input type="file" accept="image/*" @change="handleCarSpriteUpload($event, 'car1')" hidden />
          </label>
        </div>
        <div class="structure-sprite-card">
          <div class="structure-label">🚗 Car Sprite 2 (↖)</div>
          <div class="structure-preview">
            <img :src="localCarSprite2Url" alt="Car sprite 2" />
          </div>
          <label class="btn-upload-sprite">
            Upload
            <input type="file" accept="image/*" @change="handleCarSpriteUpload($event, 'car2')" hidden />
          </label>
        </div>
      </div>
    </template>

    <!-- Modal -->
    <Teleport to="body">
      <div v-if="selectedImage && !isSettingDestination" class="modal-overlay" @click="closeModal">
        <div class="modal-content" @click.stop>
          <button class="close-btn" @click="closeModal">✕</button>
          
          <img :src="selectedImage.url" :alt="selectedImage.prompt" class="modal-image" />
          
          <div class="modal-info">
            <div class="info-section">
              <div class="info-header">
                <h3>Prompt:</h3>
                <button 
                  class="copy-btn"
                  @click="copyToClipboard(selectedImage.prompt || '', 'prompt')"
                  type="button"
                  :disabled="!selectedImage.prompt"
                >
                  Copy
                </button>
              </div>
              <p class="prompt-text">{{ selectedImage.prompt || '—' }}</p>
            </div>
            
            <div v-if="selectedImage.negativePrompt" class="info-section">
              <h3>Negative prompt:</h3>
              <p>{{ selectedImage.negativePrompt }}</p>
            </div>
            
            <div v-if="selectedImage.seed !== null && selectedImage.seed !== undefined" class="info-section">
              <div class="info-header">
                <h3>🎲 Seed:</h3>
                <button 
                  class="copy-btn"
                  @click="copyToClipboard(String(selectedImage.seed), 'seed')"
                  type="button"
                >
                  Copy
                </button>
              </div>
              <p>{{ selectedImage.seed }}</p>
            </div>
            
            <div class="info-section">
              <h3>Created:</h3>
              <p>{{ formatDate(selectedImage.timestamp) }}</p>
            </div>

            <div class="info-section">
              <h3>📐 Building size:</h3>
              <select v-model="buildingSize" class="building-size-select">
                <option value="default">Default (originál)</option>
                <option value="1x1">1x1</option>
                <option value="2x2">2x2</option>
                <option value="3x3">3x3</option>
                <option value="4x4">4x4</option>
                <option value="5x5">5x5</option>
              </select>
            </div>

            <div class="info-section">
              <label class="shadow-checkbox">
                <input type="checkbox" v-model="dontDropShadow" />
                <span>🚫 Don't drop shadow</span>
              </label>
            </div>

            <!-- Building section -->
            <div class="info-section building-section">
              <div class="building-header">
                <label class="building-checkbox">
                  <input type="checkbox" v-model="isBuilding" />
                  <span>Is it a building?</span>
                </label>
                
                <label v-if="isBuilding" class="building-checkbox" style="margin-top: 0.5rem;">
                  <input type="checkbox" v-model="isCommandCenter" />
                  <span>Is Command Center</span>
                </label>
                
                <label v-if="isBuilding" class="building-checkbox" style="margin-top: 0.5rem;">
                  <input type="checkbox" v-model="isPort" />
                  <span>Is Port</span>
                </label>
                
                <div v-if="isBuilding" class="destination-controls" style="margin-top: 0.75rem;">
                  <label class="building-checkbox">
                    <input type="checkbox" v-model="canBuildOnlyInDestination" />
                    <span>🎯 Can build only in destination</span>
                  </label>
                  
                  <button 
                    v-if="canBuildOnlyInDestination" 
                    @click="startSettingDestination"
                    class="btn-set-destination"
                    :disabled="isSettingDestination"
                  >
                    🗺️ Set destination
                  </button>
                  
                  <button 
                    v-if="canBuildOnlyInDestination && destinationTiles.length > 0" 
                    @click="finishSettingDestination"
                    class="btn-destination-finish"
                  >
                    ✅ Destination is set ({{ destinationTiles.length }} tiles)
                  </button>
                  
                  <div v-if="destinationTiles.length > 0" class="destination-info">
                    <span>✅ {{ destinationTiles.length }} tiles set</span>
                  </div>
                </div>
              </div>

              <div v-if="isBuilding" class="building-details">
                <!-- Názov budovy -->
                <div class="building-name-input">
                  <label for="building-name">🏗️ Building name:</label>
                  <input 
                    id="building-name"
                    v-model="buildingName" 
                    type="text" 
                    placeholder="E.g. Lumber cabin, Town house..."
                    class="name-input"
                  />
                </div>

                <!-- Effects -->
                <div class="building-subsection">
                  <h4>✨ Effects</h4>
                  <label class="shadow-checkbox">
                    <input 
                      type="checkbox" 
                      v-model="hasSmokeEffect"
                    />
                    <span>💨 Smoke Effect</span>
                  </label>
                  <label class="shadow-checkbox" style="margin-top: 0.75rem;">
                    <input 
                      type="checkbox" 
                      v-model="hasFlyAwayEffect"
                    />
                    <span>🛫 Fly away effect (5s)</span>
                  </label>
                  <div v-if="hasSmokeEffect" class="smoke-speed-control">
                    <label for="smoke-speed">⚡ Smoke speed:</label>
                    <div class="smoke-speed-input-group">
                      <input 
                        id="smoke-speed"
                        type="range" 
                        v-model.number="smokeSpeed" 
                        min="0.1" 
                        max="3" 
                        step="0.1"
                        class="smoke-speed-slider"
                      />
                      <span class="smoke-speed-value">{{ smokeSpeed.toFixed(1) }}x</span>
                    </div>
                  </div>
                  <div v-if="hasSmokeEffect" class="smoke-speed-control">
                    <label for="smoke-scale">📏 Smoke size:</label>
                    <div class="smoke-speed-input-group">
                      <input 
                        id="smoke-scale"
                        type="range" 
                        v-model.number="smokeScale" 
                        min="0.1" 
                        max="3" 
                        step="0.1"
                        class="smoke-speed-slider"
                      />
                      <span class="smoke-speed-value">{{ smokeScale.toFixed(1) }}x</span>
                    </div>
                  </div>
                  <div v-if="hasSmokeEffect" class="smoke-speed-control">
                    <label for="smoke-alpha">👁️ Smoke opacity:</label>
                    <div class="smoke-speed-input-group">
                      <input 
                        id="smoke-alpha"
                        type="range" 
                        v-model.number="smokeAlpha" 
                        min="0.1" 
                        max="1" 
                        step="0.05"
                        class="smoke-speed-slider"
                      />
                      <span class="smoke-speed-value">{{ (smokeAlpha * 100).toFixed(0) }}%</span>
                    </div>
                  </div>
                  <div v-if="hasSmokeEffect" class="smoke-speed-control">
                    <label for="smoke-tint">🎨 Smoke darkness:</label>
                    <div class="smoke-speed-input-group">
                      <input 
                        id="smoke-tint"
                        type="range" 
                        v-model.number="smokeTint" 
                        min="0.1" 
                        max="2" 
                        step="0.1"
                        class="smoke-speed-slider"
                      />
                      <span class="smoke-speed-value">{{ smokeTint.toFixed(1) }}x</span>
                    </div>
                  </div>
                </div>

                <!-- Light Effect -->
                <div class="building-subsection">
                  <label class="smoke-checkbox-label">
                    <input type="checkbox" v-model="hasLightEffect" />
                    <span>💡 Blinking light</span>
                  </label>
                  <div v-if="hasLightEffect" class="smoke-speed-control">
                    <label for="light-blink-speed">⚡ Blink speed:</label>
                    <div class="smoke-speed-input-group">
                      <input 
                        id="light-blink-speed"
                        type="range" 
                        v-model.number="lightBlinkSpeed" 
                        min="0.1" 
                        max="10" 
                        step="0.5"
                        class="smoke-speed-slider"
                      />
                      <span class="smoke-speed-value">{{ lightBlinkSpeed.toFixed(1) }}x</span>
                    </div>
                  </div>
                  <div v-if="hasLightEffect" class="smoke-speed-control">
                    <label for="light-color">🌈 Light color:</label>
                    <div class="smoke-speed-input-group">
                      <input 
                        id="light-color"
                        type="color" 
                        v-model="lightColor" 
                        class="light-color-picker"
                      />
                      <span class="smoke-speed-value">{{ lightColor }}</span>
                    </div>
                  </div>
                  <div v-if="hasLightEffect" class="smoke-speed-control">
                    <label for="light-size">📏 Light size:</label>
                    <div class="smoke-speed-input-group">
                      <input 
                        id="light-size"
                        type="range" 
                        v-model.number="lightSize" 
                        min="0.1" 
                        max="5" 
                        step="0.1"
                        class="smoke-speed-slider"
                      />
                      <span class="smoke-speed-value">{{ lightSize.toFixed(1) }}x</span>
                    </div>
                  </div>
                </div>

                <!-- Need for build -->
                <div class="building-subsection">
                  <h4>🔨 Build cost</h4>
                  <div class="resource-input-group">
                    <select v-model="selectedBuildResource" class="resource-select">
                      <option value="">Select resource...</option>
                      <option v-for="resource in resources" :key="resource.id" :value="resource.id">
                        {{ resource.name }}
                      </option>
                    </select>
                    <input 
                      v-model.number="buildAmount" 
                      type="number" 
                      min="1" 
                      placeholder="Amount"
                      class="amount-input"
                    />
                    <button @click="addBuildResource" class="btn-add-resource" type="button">
                      ➕
                    </button>
                  </div>
                  <div v-if="buildCost.length > 0" class="resource-list">
                    <div v-for="(item, index) in buildCost" :key="index" class="resource-item">
                      <span class="resource-name">{{ item.resourceName }}</span>
                      <span class="resource-amount">× {{ item.amount }}</span>
                      <button @click="removeBuildResource(index)" class="btn-remove" type="button">✕</button>
                    </div>
                  </div>
                </div>

                <!-- Need for operational -->
                <div class="building-subsection">
                  <h4>⚙️ Operational cost</h4>
                  <div class="resource-input-group">
                    <select v-model="selectedOperationalResource" class="resource-select">
                      <option value="">Select resource...</option>
                      <option v-for="resource in resources" :key="resource.id" :value="resource.id">
                        {{ resource.name }}
                      </option>
                    </select>
                    <input 
                      v-model.number="operationalAmount" 
                      type="number" 
                      min="1" 
                      placeholder="Amount"
                      class="amount-input"
                    />
                    <button @click="addOperationalResource" class="btn-add-resource" type="button">
                      ➕
                    </button>
                  </div>
                  <div v-if="operationalCost.length > 0" class="resource-list">
                    <div v-for="(item, index) in operationalCost" :key="index" class="resource-item">
                      <span class="resource-name">{{ item.resourceName }}</span>
                      <span class="resource-amount">× {{ item.amount }}</span>
                      <button @click="removeOperationalResource(index)" class="btn-remove" type="button">✕</button>
                    </div>
                  </div>
                </div>

                <!-- Port sekcie (Allowed Resources + Capacity) -->
                <template v-if="isPort">
                  <!-- Allowed Resources -->
                  <div class="building-subsection">
                    <h4>🚢 Allowed Resources</h4>
                    <div class="resource-input-group">
                      <select v-model="selectedAllowedResource" class="resource-select">
                        <option value="">Select resource...</option>
                        <option v-for="resource in resources" :key="resource.id" :value="resource.id">
                          {{ resource.name }}
                        </option>
                      </select>
                      <button @click="addAllowedResource" class="btn-add-resource" type="button">
                        ➕
                      </button>
                    </div>
                    <div v-if="allowedResources.length > 0" class="resource-list">
                      <div v-for="(item, index) in allowedResources" :key="index" class="resource-item">
                        <span class="resource-name">{{ item.resourceName }}</span>
                        <button @click="removeAllowedResource(index)" class="btn-remove" type="button">✕</button>
                      </div>
                    </div>
                  </div>

                  <!-- Port Capacity -->
                  <div class="building-subsection">
                    <h4>📊 Capacity</h4>
                    <div class="building-name-input">
                      <input 
                        v-model.number="portCapacity" 
                        type="number" 
                        min="0" 
                        placeholder="Port capacity"
                        class="name-input"
                      />
                    </div>
                  </div>
                </template>

                <!-- Non-port sekcie (Produce + Stored) -->
                <template v-else>
                  <!-- Produce -->
                  <div class="building-subsection">
                    <h4>📦 Production</h4>
                    <div class="resource-input-group">
                      <select v-model="selectedProductionResource" class="resource-select">
                        <option value="">Select resource...</option>
                        <option v-for="resource in resources" :key="resource.id" :value="resource.id">
                          {{ resource.name }}
                        </option>
                      </select>
                      <input 
                        v-model.number="productionAmount" 
                        type="number" 
                        min="1" 
                        placeholder="Amount"
                        class="amount-input"
                      />
                      <button @click="addProductionResource" class="btn-add-resource" type="button">
                        ➕
                      </button>
                    </div>
                    <div v-if="production.length > 0" class="resource-list">
                      <div v-for="(item, index) in production" :key="index" class="resource-item">
                        <span class="resource-name">{{ item.resourceName }}</span>
                        <span class="resource-amount">× {{ item.amount }}</span>
                        <button @click="removeProductionResource(index)" class="btn-remove" type="button">✕</button>
                      </div>
                    </div>
                  </div>

                  <!-- Stored -->
                  <div class="building-subsection">
                    <h4>🏚️ Stored</h4>
                    <div class="resource-input-group">
                      <select v-model="selectedStoredResource" class="resource-select">
                        <option value="">Select resource...</option>
                        <option v-for="resource in resources" :key="resource.id" :value="resource.id">
                          {{ resource.name }}
                        </option>
                      </select>
                      <input 
                        v-model.number="storedAmount" 
                        type="number" 
                        min="1" 
                        placeholder="Amount"
                        class="amount-input"
                      />
                      <button @click="addStoredResource" class="btn-add-resource" type="button">
                        ➕
                      </button>
                    </div>
                    <div v-if="stored.length > 0" class="resource-list">
                      <div v-for="(item, index) in stored" :key="index" class="resource-item">
                        <span class="resource-name">{{ item.resourceName }}</span>
                        <span class="resource-amount">× {{ item.amount }}</span>
                        <button @click="removeStoredResource(index)" class="btn-remove" type="button">✕</button>
                      </div>
                    </div>
                  </div>
                </template>
              </div>
            </div>

            <div class="modal-actions">
              <input 
                type="file" 
                id="replace-image-input" 
                accept="image/*" 
                @change="handleReplaceImage"
                style="display: none;"
              />
              <label for="replace-image-input" class="btn-replace">
                🔄 Replace image
              </label>
              <button @click="downloadImage(selectedImage)" class="btn-download">
                💾 Download
              </button>
              <button @click="deleteImage(selectedImage.id)" class="btn-delete">
                🗑️ Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.gallery {
  background: white;
  color: #333;
  border-radius: 0 0 16px 16px;
  padding: 0.5rem;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
  border: 1px solid #a2a9b1;
  border-top: none;
}

/* Grid size tabs */
.grid-size-tabs {
  display: flex;
  gap: 2px;
  margin-bottom: 0;
  padding: 0;
  border-bottom: 1px solid #a2a9b1;
  max-width: 300px;
}

.size-btn {
  flex: 1;
  padding: 0.5rem 1rem;
  border: 1px solid transparent;
  border-radius: 4px 4px 0 0;
  background: #f8f9fa;
  font-weight: 500;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s;
  color: #202122;
  position: relative;
  margin-bottom: -1px;
}

.size-btn:hover {
  background: #fff;
  color: #202122;
}

.size-btn.active {
  background: #fff;
  color: #202122;
  border-color: #a2a9b1;
  border-bottom-color: #fff;
  font-weight: 600;
}

.size-btn.delete-btn {
  color: #d32f2f;
}

.size-btn.delete-btn:hover {
  background: #ffebee;
}

.size-btn.delete-btn.active {
  background: #fff;
  color: #d32f2f;
  border-color: #a2a9b1;
  border-bottom-color: #fff;
}

/* Gallery/Roads tabs */
.gallery-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 0.5rem;
  margin-top: 0.5rem;
}

.gallery-tab-btn {
  flex: 1;
  padding: 0.5rem 1rem;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  background: #f8f9fa;
  font-weight: 600;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s;
  color: #666;
}

.gallery-tab-btn:hover {
  border-color: #667eea;
  background: rgba(102, 126, 234, 0.05);
}

.gallery-tab-btn.active {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border-color: #667eea;
}

.gallery-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

h2 {
  margin: 0;
  color: #667eea;
}

.btn-place-on-board {
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 8px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  font-weight: 600;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.3s;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

.btn-place-on-board:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
}

.btn-place-on-board:active {
  transform: translateY(0);
}

.empty-state {
  text-align: center;
  padding: 3rem;
  color: #999;
}

.empty-state p {
  margin: 0.5rem 0;
  font-size: 1.1rem;
}

.gallery-grid {
  display: flex;
  gap: 5px;
  overflow-x: auto;
  overflow-y: hidden;
  flex-wrap: nowrap;
  padding-bottom: 6px;
}

.gallery-grid::-webkit-scrollbar {
  height: 6px;
}

.gallery-grid::-webkit-scrollbar-track {
  background: #f0f0f0;
  border-radius: 3px;
}

.gallery-grid::-webkit-scrollbar-thumb {
  background: #b0b0b0;
  border-radius: 3px;
}

.gallery-grid::-webkit-scrollbar-thumb:hover {
  background: #888;
}

.gallery-item {
  position: relative;
  aspect-ratio: 1;
  border-radius: 12px;
  overflow: hidden;
  cursor: grab;
  transition: all 0.3s;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  border: 3px solid transparent;
  min-width: 7%;
  width: 7%;
  flex-shrink: 0;
}

.gallery-item:hover {
  transform: translateY(-5px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
}

.gallery-item:active {
  cursor: grabbing;
}

.gallery-item.dragging {
  opacity: 0.4;
  transform: scale(0.9);
}

.gallery-item.drag-over {
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.4);
  transform: scale(1.08);
}

.gallery-item.selected {
  border-color: #10b981;
  box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.2);
}

.selected-badge {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
  font-weight: bold;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.gallery-item img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.image-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.8), transparent);
  padding: 1rem;
  opacity: 0;
  transition: opacity 0.3s;
}

.gallery-item:hover .image-overlay {
  opacity: 1;
}

.prompt-preview {
  color: white;
  font-size: 0.85rem;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 2rem;
  animation: fadeIn 0.3s;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.modal-content {
  background: white;
  border-radius: 16px;
  max-width: 900px;
  max-height: 90vh;
  overflow: auto;
  position: relative;
  animation: slideUp 0.3s;
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.close-btn {
  position: absolute;
  top: 1rem;
  right: 1rem;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.5);
  color: white;
  font-size: 1.5rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  transition: background 0.3s;
}

.close-btn:hover {
  background: rgba(0, 0, 0, 0.8);
}

.modal-image {
  width: 100%;
  display: block;
  border-radius: 16px 16px 0 0;
}

.modal-info {
  padding: 2rem;
}

.info-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.copy-btn {
  padding: 0.35rem 0.65rem;
  border: 1px solid #d0d7de;
  background: #f8f9fa;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
}

.copy-btn:hover:not(:disabled) {
  background: #eef2ff;
  border-color: #667eea;
}

.copy-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.prompt-text {
  white-space: pre-wrap;
}



.info-section h3 {
  margin: 0 0 0.5rem 0;
  color: #667eea;
  font-size: 1rem;
}

.info-section p {
  margin: 0;
  color: #555;
  line-height: 1.6;
}

.modal-actions {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.modal-actions button,
.modal-actions label {
  flex: 1;
  min-width: 120px;
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
  text-align: center;
  display: inline-block;
}

.btn-replace {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

.btn-replace:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
}

.btn-download {
  background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
  color: white;
  box-shadow: 0 4px 12px rgba(76, 175, 80, 0.3);
}

.btn-download:hover {
  transform: translateY(-2px);
  box-shadow: 0 5px 20px rgba(76, 175, 80, 0.5);
}

.btn-delete {
  background: linear-gradient(135deg, #f44336 0%, #d32f2f 100%);
  color: white;
  box-shadow: 0 4px 12px rgba(244, 67, 54, 0.3);
}

.btn-delete:hover {
  transform: translateY(-2px);
  box-shadow: 0 5px 20px rgba(244, 67, 54, 0.5);
}

/* Opacity control */
.opacity-control {
  padding: 0.75rem;
  background: #f8f9fa;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  align-items: center;
  gap: 1rem;
}

.opacity-control label {
  font-weight: 600;
  color: #333;
  margin: 0;
  white-space: nowrap;
  font-size: 0.9rem;
}

.opacity-input-group {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex: 1;
  max-width: 300px;
}

.opacity-slider {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(to right, rgba(102, 126, 234, 0.2), rgba(102, 126, 234, 1));
  outline: none;
  -webkit-appearance: none;
  appearance: none;
}

.opacity-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(102, 126, 234, 0.4);
  border: 2px solid white;
}

.opacity-slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(102, 126, 234, 0.4);
  border: 2px solid white;
}

.opacity-value {
  font-weight: 600;
  color: #667eea;
  min-width: 50px;
  text-align: right;
  font-size: 0.9rem;
}

/* Person spawn controls */
.person-spawn-controls {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.5rem 0.75rem;
  background: #f8f9fa;
  border-bottom: 1px solid #e0e0e0;
}

.person-spawn-checkbox {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  color: #333;
  margin: 0;
}

.person-count-input {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  color: #333;
}

.person-count-input input {
  width: 80px;
  padding: 0.35rem 0.5rem;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  font-weight: 600;
}

/* Car spawn controls */
.car-spawn-controls {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.5rem 0.75rem;
  background: #f0f8ff;
  border-bottom: 1px solid #e0e0e0;
}

.car-spawn-checkbox {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  color: #333;
  margin: 0;
}

.car-count-input {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  color: #333;
}

.car-count-input input {
  width: 80px;
  padding: 0.35rem 0.5rem;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  font-weight: 600;
}

/* Road cost controls */
.road-cost-controls {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid #e1e4e8;
  background: #f8f9fa;
}

.road-cost-label {
  display: block;
  font-weight: 600;
  font-size: 0.85rem;
  color: #333;
  margin-bottom: 0.3rem;
}

/* Car sprites section */
.car-sprites-section {
  padding: 0.5rem 0.75rem;
  background: #f0f8ff;
  border-bottom: 1px solid #e0e0e0;
}

.car-sprites-label {
  font-weight: 600;
  color: #333;
  margin-bottom: 0.4rem;
  font-size: 0.9rem;
}

.car-sprites-grid {
  display: flex;
  gap: 0.75rem;
}

/* Roads grid */
.roads-grid {
  display: flex;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  padding: 0.5rem;
}

.road-tile-item {
  position: relative;
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  border: 2px solid transparent;
  background: #f5f5f5;
}

.road-tile-item:hover {
  transform: scale(1.05);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  border-color: #667eea;
}

.road-tile-item.selected {
  border-color: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.3);
}

.road-tile-item img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.tile-label {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  font-size: 0.65rem;
  padding: 2px 4px;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.road-tile-item .selected-badge {
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  font-size: 0.8rem;
}

/* Building section */
.building-section {
  background: #f8f9fa;
  border-radius: 8px;
  padding: 1rem;
  margin-top: 1rem;
}

.building-header {
  margin-bottom: 1rem;
}

.building-checkbox {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  cursor: pointer;
  font-size: 1.1rem;
}

.building-checkbox input[type="checkbox"] {
  width: 20px;
  height: 20px;
  cursor: pointer;
}

.building-details {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.building-name-input {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.building-name-input label {
  font-weight: 600;
  color: #667eea;
  font-size: 0.95rem;
}

.name-input {
  padding: 0.75rem;
  border: 2px solid #d0d7de;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 500;
  transition: all 0.2s;
}

.name-input:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.building-subsection {
  background: white;
  border-radius: 8px;
  padding: 1rem;
  border: 1px solid #e0e0e0;
}

.building-subsection h4 {
  margin: 0 0 1rem 0;
  color: #667eea;
  font-size: 0.95rem;
}

.resource-input-group {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.resource-select {
  flex: 2;
  padding: 0.5rem;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  font-size: 0.9rem;
  background: white;
}

.amount-input {
  flex: 1;
  padding: 0.5rem;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  font-size: 0.9rem;
  max-width: 100px;
}

.btn-add-resource {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 6px;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
  font-size: 1rem;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-add-resource:hover {
  transform: scale(1.05);
  box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);
}

.resource-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.resource-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  background: #f8f9fa;
  border-radius: 6px;
  border: 1px solid #e0e0e0;
}

.resource-name {
  flex: 1;
  font-weight: 500;
  color: #333;
}

.resource-amount {
  color: #667eea;
  font-weight: 600;
}

.btn-remove {
  padding: 0.25rem 0.5rem;
  border: none;
  border-radius: 4px;
  background: #fee;
  color: #c33;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.9rem;
}

.btn-remove:hover {
  background: #fdd;
}

/* Building size select */
.building-size-select {
  width: 100%;
  padding: 0.75rem;
  border: 2px solid #d0d7de;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 500;
  background: white;
  cursor: pointer;
  transition: all 0.2s;
}

.building-size-select:focus {
  outline: none;

/* Shadow checkbox */
.shadow-checkbox {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  cursor: pointer;
  font-size: 1rem;
  margin: 0;
}

.shadow-checkbox input[type="checkbox"] {
  width: 20px;
  height: 20px;
  cursor: pointer;
}

.shadow-checkbox span {
  color: #333;
}

/* Smoke speed control */
.smoke-speed-control {
  margin-top: 0.75rem;
  padding: 0.75rem;
  background: #f8f9fa;
  border-radius: 6px;
  border: 1px solid #e0e0e0;
}

.smoke-speed-control label {
  display: block;
  font-weight: 600;
  color: #333;
  margin-bottom: 0.5rem;
  font-size: 0.9rem;
}

.smoke-speed-input-group {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.smoke-speed-slider {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(to right, rgba(102, 126, 234, 0.2), rgba(102, 126, 234, 1));
  outline: none;
  -webkit-appearance: none;
  appearance: none;
}

.smoke-speed-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(102, 126, 234, 0.4);
  border: 2px solid white;
}

.smoke-speed-slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(102, 126, 234, 0.4);
  border: 2px solid white;
}

.smoke-speed-value {
  font-weight: 600;
  color: #667eea;
  min-width: 45px;
  text-align: right;
  font-size: 0.9rem;
}

.light-color-picker {
  width: 60px;
  height: 35px;
  border: 2px solid #667eea;
  border-radius: 6px;
  cursor: pointer;
  padding: 0;
  background: none;
}

.light-color-picker::-webkit-color-swatch-wrapper {
  padding: 0;
}

.light-color-picker::-webkit-color-swatch {
  border: none;
  border-radius: 4px;
}

.light-color-picker::-moz-color-swatch {
  border: none;
  border-radius: 4px;
}
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.building-size-select:hover {
  border-color: #667eea;
}

/* Destination controls */
.destination-controls {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  background: #f0f8ff;
  border-radius: 8px;
  border: 2px solid #667eea;
}

.btn-set-destination {
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 8px;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
  font-weight: 600;
  font-size: 0.95rem;
  cursor: pointer;
  transition: all 0.3s;
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
}

.btn-set-destination:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(16, 185, 129, 0.5);
}

.btn-set-destination:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.btn-destination-finish {
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 8px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  font-weight: 600;
  font-size: 0.95rem;
  cursor: pointer;
  transition: all 0.3s;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

.btn-destination-finish:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
}

.destination-info {
  padding: 0.5rem;
  background: rgba(16, 185, 129, 0.1);
  border-radius: 6px;
  font-weight: 600;
  color: #059669;
  text-align: center;
}

/* Minimized modal floating button */
.destination-finish-button {
  position: fixed;
  bottom: 2rem;
  left: 50%;
  transform: translateX(-50%);
  padding: 1rem 2rem;
  border: none;
  border-radius: 12px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  font-weight: 700;
  font-size: 1.1rem;
  cursor: pointer;
  box-shadow: 0 6px 24px rgba(102, 126, 234, 0.5);
  z-index: 10000;
  transition: all 0.3s;
  animation: pulse 2s infinite;
}

.destination-finish-button:hover {
  transform: translateX(-50%) scale(1.05);
  box-shadow: 0 8px 32px rgba(102, 126, 234, 0.7);
}

@keyframes pulse {
  0%, 100% {
    box-shadow: 0 6px 24px rgba(102, 126, 234, 0.5);
  }
  50% {
    box-shadow: 0 6px 32px rgba(102, 126, 234, 0.8);
  }
}

/* Structures tab */
.structures-grid {
  display: flex;
  gap: 1rem;
  padding: 0.5rem;
  flex-wrap: wrap;
}

.structure-sprite-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  border: 2px solid #e0e0e0;
  border-radius: 10px;
  background: #f8f9fa;
  min-width: 120px;
  transition: border-color 0.2s;
}

.structure-sprite-card:hover {
  border-color: #667eea;
}

.structure-label {
  font-weight: 600;
  font-size: 0.8rem;
  color: #555;
  text-align: center;
}

.structure-preview {
  width: 80px;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: white;
  border-radius: 8px;
  border: 1px solid #ddd;
  overflow: hidden;
}

.structure-preview img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.btn-upload-sprite {
  padding: 0.35rem 0.75rem;
  border: none;
  border-radius: 6px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  font-weight: 600;
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
}

.btn-upload-sprite:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}
</style>
