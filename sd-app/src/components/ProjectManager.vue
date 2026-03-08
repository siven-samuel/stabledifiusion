<script setup>
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Modal from './Modal.vue'
import ResourceManager from './ResourceManager.vue'
import EventEmitter from './EventEmitter.vue'

const router = useRouter()
const route = useRoute()

const props = defineProps({
  mode: {
    type: String,
    default: 'editor'
  },
  images: {
    type: Array,
    required: true
  },
  showNumbering: {
    type: Boolean,
    default: false
  },
  showGallery: {
    type: Boolean,
    default: false
  },
  showGrid: {
    type: Boolean,
    default: true
  },
  canvasRef: {
    type: Object,
    default: null
  },
  environmentColors: {
    type: Object,
    default: () => ({ hue: 0, saturation: 100, brightness: 100 })
  },
  textureSettings: {
    type: Object,
    default: () => ({ tilesPerImage: 1, tileResolution: 512, customTexture: null })
  },
  personSpawnSettings: {
    type: Object,
    default: () => ({ enabled: false, count: 3 })
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
    default: '/templates/roads/sprites/pastroad.png'
  },
  roadOpacity: {
    type: Number,
    default: 100
  },
  allocatedResources: {
    type: Object,
    default: () => ({})
  },
  buildingProductionStates: {
    type: Object,
    default: () => ({})
  },
  gameTime: {
    type: Number,
    default: 0
  },
  events: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['load-project', 'update:showNumbering', 'update:showGallery', 'update:showGrid', 'update-resources', 'mode-changed', 'update-events', 'effect-changed'])

const fileInput = ref(null)
const showResourceModal = ref(false)
const showEventModal = ref(false)

// Effect preview
const selectedEffect = ref('none')
const effectOptions = [
  { value: 'none', label: '❌ None' },
  { value: 'night', label: '🌙 Night' },
  { value: 'shake', label: '🌋 Shake' },
  { value: 'flash', label: '⚡ Flash' },
  { value: 'pulse', label: '💫 Pulse' },
  { value: 'fade', label: '🌫️ Fade' },
  { value: 'bounce', label: '⬆️ Bounce' },
  { value: 'fire', label: '🔥 Fire' },
  { value: 'smoke', label: '💨 Smoke' }
]

const onEffectChange = () => {
  emit('effect-changed', selectedEffect.value)
}

const openResourceManager = () => {
  showResourceModal.value = true
}

const closeResourceManager = () => {
  showResourceModal.value = false
}

const openEventEmitter = () => {
  showEventModal.value = true
}

const closeEventEmitter = () => {
  showEventModal.value = false
}

const handleEventsUpdate = (updatedEvents) => {
  emit('update-events', updatedEvents)
}

const handleResourceUpdate = (data) => {
  emit('update-resources', data)
}

// Pomocná funkcia na škálovanie obrázka
const resizeImage = async (imageUrl, buildingSize) => {
  // Ak je 'default', vráť originálny obrázok bez zmeny
  if (buildingSize === 'default') {
    console.log('   ⏩ Building size: default - zachováva originálnu veľkosť')
    return imageUrl
  }
  
  // Mapy buildingSize na šírku
  const widthMap = {
    '1x1': 200,
    '2x2': 400,
    '3x3': 600,
    '4x4': 800,
    '5x5': 1000
  }
  
  const targetWidth = widthMap[buildingSize] || 200 // Default 200px šírka
  
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    
    img.onload = () => {
      // Vypočítaj výšku aby sa zachoval aspect ratio
      const aspectRatio = img.height / img.width
      const targetHeight = Math.round(targetWidth * aspectRatio)
      
      // Vytvor canvas s vypočítanou veľkosťou
      const canvas = document.createElement('canvas')
      canvas.width = targetWidth
      canvas.height = targetHeight
      const ctx = canvas.getContext('2d')
      
      // Nakresli zmenšený obrázok (zachová aspect ratio)
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight)
      
      // Konvertuj na base64
      resolve(canvas.toDataURL('image/png'))
      
      console.log(`   ✅ Zmenšené: ${img.width}×${img.height} → ${targetWidth}×${targetHeight}`)
    }
    
    img.onerror = () => {
      console.warn('Nepodarilo sa načítať obrázok pre resize, použijem originál')
      resolve(imageUrl) // Fallback na originál
    }
    
    img.src = imageUrl
  })
}

// Uloží projekt do JSON súboru
const saveProject = () => {
  if (props.images.length === 0) {
    alert('No images to save!')
    return
  }

  try {
    // Získaj umiestnené obrázky zo šachovnice
    const placedImages = {}
    
    // Mapa pre deduplikáciu obrázkov - url -> id
    const uniqueImages = new Map()
    let imageIdCounter = 1
    
    if (props.canvasRef && typeof props.canvasRef.cellImages === 'function') {
      const cellImagesData = props.canvasRef.cellImages()
      
      Object.entries(cellImagesData).forEach(([key, imageData]) => {
        // Preskočíme background tiles - tie sa ukladajú samostatne cez backgroundTiles
        if (imageData.isBackground) {
          return
        }
        
        // Preskočíme sekundárne bunky multi-cell budov - ukladáme len origin
        if (imageData.isSecondary) {
          return
        }
        
        const [row, col] = key.split('-').map(Number)
        
        // Pre road tiles ukladáme len metadata, nie celý obrázok (optimalizácia)
        if (imageData.isRoadTile && imageData.tileMetadata) {
          placedImages[key] = {
            row,
            col,
            cellsX: imageData.cellsX || 1,
            cellsY: imageData.cellsY || 1,
            isBackground: false,
            isRoadTile: true,
            templateName: imageData.templateName || '',
            tileMetadata: imageData.tileMetadata, // Len metadata - sprite sa rekreuje z roadSpriteUrl
            buildingData: imageData.buildingData || null
          }
          return
        }
        
        // Pre non-road obrázky pokračuj s deduplikáciou
        const url = imageData.url
        
        // Skontroluj či tento obrázok už máme
        let imageId
        if (uniqueImages.has(url)) {
          imageId = uniqueImages.get(url)
        } else {
          // Nový unikátny obrázok
          imageId = `img_${imageIdCounter++}`
          uniqueImages.set(url, imageId)
        }
        
        // Ulož len referenciu na obrázok (nie celé base64!) + všetky metadáta
        placedImages[key] = {
          row,
          col,
          imageId,  // referencia namiesto url
          libraryImageId: imageData.libraryImageId || null, // ID z image library pre stabilné matchovanie
          cellsX: imageData.cellsX || 1,
          cellsY: imageData.cellsY || 1,
          isBackground: false,
          isRoadTile: false,
          templateName: imageData.templateName || '',
          tileMetadata: imageData.tileMetadata || null,
          buildingData: imageData.buildingData || null
        }
      })
    }
    
    // Konvertuj uniqueImages mapu na pole objektov
    const imageLibrary = []
    uniqueImages.forEach((id, url) => {
      imageLibrary.push({ id, url })
    })

    // Priprav dáta pre export
    const projectData = {
      version: '1.8',  // Nová verzia s optimalizovaným roads (len sprite + metadata)
      timestamp: new Date().toISOString(),
      imageCount: props.images.length,
      placedImageCount: Object.keys(placedImages).length,
      uniqueImageCount: imageLibrary.length,  // Počet unikátnych obrázkov
      images: props.images.map(img => {
        // Debug logging pre buildingData
        if (img.buildingData) {
          console.log(`💾 Ukladám buildingData pre obrázok ${img.id}:`, {
            isBuilding: img.buildingData.isBuilding,
            buildingName: img.buildingData.buildingName,
            buildingSize: img.buildingData.buildingSize,
            buildCost: img.buildingData.buildCost?.length || 0,
            operationalCost: img.buildingData.operationalCost?.length || 0,
            production: img.buildingData.production?.length || 0
          })
        }
        
        return {
          id: img.id,
          url: img.url,
          prompt: img.prompt || '',
          negativePrompt: img.negativePrompt || '',
          cellsX: img.cellsX || 1,
          cellsY: img.cellsY || 1,
          view: img.view || '',
          timestamp: img.timestamp || new Date().toISOString(),
          buildingData: img.buildingData || null,
          seed: img.seed || null
        }
      }),
      imageLibrary,  // Unikátne obrázky pre placedImages
      placedImages,
      environmentColors: props.environmentColors,
      textureSettings: {
        tilesPerImage: props.textureSettings?.tilesPerImage || 1,
        tileResolution: props.textureSettings?.tileResolution || 512,
        customTexture: props.textureSettings?.customTexture || null
      },
      // Pre work-force resources pripočítaj alokované množstvo, aby sa uložil celkový počet
      resources: (props.resources || []).map(r => {
        const allocated = (r.workResource && props.allocatedResources[r.id]) ? props.allocatedResources[r.id] : 0
        return allocated > 0 ? { ...r, amount: r.amount + allocated } : r
      }),
      workforce: props.workforce || [],
      events: props.events || [],
      gameTime: props.gameTime || 0,
      roadSpriteUrl: props.roadSpriteUrl || '/templates/roads/sprites/pastroad.png',
      roadOpacity: props.roadOpacity || 100,
      buildingProductionStates: Object.entries(props.buildingProductionStates || {}).reduce((acc, [key, state]) => {
        // Uloží len enabled flag a buildingData, nie interval (funkciu)
        acc[key] = {
          enabled: state.enabled || false,
          buildingData: state.buildingData || null
        }
        return acc
      }, {})
    }

    // DEBUG logging pre road sprite a opacity
    console.log('🔍 DEBUG saveProject:')
    console.log('   props.roadSpriteUrl:', props.roadSpriteUrl?.substring(0, 50) + '...')
    console.log('   props.roadOpacity:', props.roadOpacity)
    console.log('   projectData.roadSpriteUrl:', projectData.roadSpriteUrl?.substring(0, 50) + '...')
    console.log('   projectData.roadOpacity:', projectData.roadOpacity)
    console.log('   buildingProductionStates:', Object.keys(projectData.buildingProductionStates || {}).length, 'budov')
    if (Object.keys(projectData.buildingProductionStates || {}).length > 0) {
      console.log('   📋 Production states:', projectData.buildingProductionStates)
    }

    // Konvertuj na JSON string
    const jsonString = JSON.stringify(projectData, null, 2)
    
    // Vytvor blob a stiahni súbor
    const blob = new Blob([jsonString], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `isometric-project-${Date.now()}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    console.log('✅ Projekt uložený:', projectData.imageCount, 'obrázkov v galérii,', projectData.placedImageCount, 'umiestnených na šachovnici')
    
    // Počítaj road tiles a non-road obrázky
    const roadTileCount = Object.values(placedImages).filter(img => img.isRoadTile).length
    const nonRoadCount = Object.values(placedImages).filter(img => !img.isRoadTile && !img.isBackground).length
    
    console.log('   📦 Unikátnych obrázkov:', imageLibrary.length, '(deduplikované z', nonRoadCount, 'non-road obrázkov)')
    
    const roadSpriteInfo = props.roadSpriteUrl.startsWith('data:') 
      ? `data URL (${Math.round(props.roadSpriteUrl.length / 1024)}KB)` 
      : props.roadSpriteUrl
    console.log(`   🛣️ Road sprite: ${roadSpriteInfo}, opacity: ${props.roadOpacity}%`)
    console.log(`   🛣️ Road tiles: ${roadTileCount} (uložené ako metadata, nie celé obrázky - OPTIMALIZOVANÉ!)`)
  } catch (error) {
    console.error('❌ Chyba pri ukladaní projektu:', error)
    alert('Error saving project: ' + error.message)
  }
}

// Uloží projekt do JSON súboru s optimalizovanými obrázkami pre gameplay
const saveGameplayProject = async () => {
  if (props.images.length === 0) {
    alert('No images to save!')
    return
  }

  try {
    console.log('🎮 Začínam Save Gameplay - škálujem obrázky...')
    
    // Získaj umiestnené obrázky zo šachovnice (rovnaké ako v saveProject)
    const placedImages = {}
    const uniqueImages = new Map()
    let imageIdCounter = 1
    
    if (props.canvasRef && typeof props.canvasRef.cellImages === 'function') {
      const cellImagesData = props.canvasRef.cellImages()
      
      Object.entries(cellImagesData).forEach(([key, imageData]) => {
        if (imageData.isBackground) return
        
        // Preskočíme sekundárne bunky multi-cell budov - ukladáme len origin
        if (imageData.isSecondary) return
        
        const [row, col] = key.split('-').map(Number)
        
        if (imageData.isRoadTile && imageData.tileMetadata) {
          placedImages[key] = {
            row, col,
            cellsX: imageData.cellsX || 1,
            cellsY: imageData.cellsY || 1,
            isBackground: false,
            isRoadTile: true,
            templateName: imageData.templateName || '',
            tileMetadata: imageData.tileMetadata,
            buildingData: imageData.buildingData || null
          }
          return
        }
        
        const url = imageData.url
        let imageId
        if (uniqueImages.has(url)) {
          imageId = uniqueImages.get(url)
        } else {
          imageId = `img_${imageIdCounter++}`
          uniqueImages.set(url, imageId)
        }
        
        placedImages[key] = {
          row, col, imageId,
          libraryImageId: imageData.libraryImageId || null, // ID z image library pre stabilné matchovanie
          cellsX: imageData.cellsX || 1,
          cellsY: imageData.cellsY || 1,
          isBackground: false,
          isRoadTile: false,
          templateName: imageData.templateName || '',
          tileMetadata: imageData.tileMetadata || null,
          buildingData: imageData.buildingData || null
        }
      })
    }
    
    const imageLibrary = []
    uniqueImages.forEach((id, url) => {
      imageLibrary.push({ id, url })
    })

    // Škáluj obrázky podľa buildingSize
    const scaledImages = []
    for (const img of props.images) {
      let scaledUrl = img.url
      
      // Ak má obrázok buildingSize, zmenš ho
      if (img.buildingData?.buildingSize) {
        console.log(`📐 Škálujem obrázok ${img.id} z ${img.buildingData.buildingSize}...`)
        scaledUrl = await resizeImage(img.url, img.buildingData.buildingSize)
      }
      
      scaledImages.push({
        id: img.id,
        url: scaledUrl, // Škálovaný URL
        prompt: img.prompt || '',
        negativePrompt: img.negativePrompt || '',
        cellsX: img.cellsX || 1,
        cellsY: img.cellsY || 1,
        view: img.view || '',
        timestamp: img.timestamp || new Date().toISOString(),
        buildingData: img.buildingData || null,
        seed: img.seed || null
      })
    }

    // Priprav dáta pre export
    const projectData = {
      version: '1.9', // Nová verzia s gameplay optimalizáciou
      gameplayOptimized: true, // Flag že obrázky sú škálované
      timestamp: new Date().toISOString(),
      imageCount: scaledImages.length,
      placedImageCount: Object.keys(placedImages).length,
      uniqueImageCount: imageLibrary.length,
      images: scaledImages,
      imageLibrary,
      placedImages,
      environmentColors: props.environmentColors,
      textureSettings: {
        tilesPerImage: props.textureSettings?.tilesPerImage || 1,
        tileResolution: props.textureSettings?.tileResolution || 512,
        customTexture: props.textureSettings?.customTexture || null
      },
      // Pre work-force resources pripočítaj alokované množstvo, aby sa uložil celkový počet
      resources: (props.resources || []).map(r => {
        const allocated = (r.workResource && props.allocatedResources[r.id]) ? props.allocatedResources[r.id] : 0
        return allocated > 0 ? { ...r, amount: r.amount + allocated } : r
      }),
      workforce: props.workforce || [],
      events: props.events || [],
      gameTime: props.gameTime || 0,
      roadSpriteUrl: props.roadSpriteUrl || '/templates/roads/sprites/pastroad.png',
      roadOpacity: props.roadOpacity || 100,
      buildingProductionStates: Object.entries(props.buildingProductionStates || {}).reduce((acc, [key, state]) => {
        // Uloží len enabled flag a buildingData, nie interval (funkciu)
        acc[key] = {
          enabled: state.enabled || false,
          buildingData: state.buildingData || null
        }
        return acc
      }, {})
    }

    console.log('✅ Gameplay projekt uložený s optimalizovanými obrázkami!')
    console.log('   📦 Obrázkov:', projectData.imageCount)
    console.log('   🎨 Škálované podľa buildingSize')
    console.log('   🔄 Production states:', Object.keys(projectData.buildingProductionStates || {}).length, 'budov')
    if (Object.keys(projectData.buildingProductionStates || {}).length > 0) {
      console.log('   📋 Auto-production data:', projectData.buildingProductionStates)
    }
    
    // Konvertuj na JSON string
    const jsonString = JSON.stringify(projectData, null, 2)
    
    // Vytvor blob a stiahni súbor
    const blob = new Blob([jsonString], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `isometric-gameplay-${Date.now()}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    console.log('✅ Gameplay projekt uložený s optimalizovanými obrázkami!')
    console.log('   📦 Obrázkov:', projectData.imageCount)
    console.log('   🎨 Škálované podľa buildingSize')
  } catch (error) {
    console.error('❌ Chyba pri ukladaní gameplay projektu:', error)
    alert('Error saving gameplay project: ' + error.message)
  }
}

// Načíta projekt z JSON súboru
const loadProject = () => {
  fileInput.value?.click()
}

const handleFileUpload = async (event) => {
  const file = event.target.files[0]
  if (!file) return

  try {
    const text = await file.text()
    const projectData = JSON.parse(text)

    // Validácia
    if (!projectData.images || !Array.isArray(projectData.images)) {
      throw new Error('Invalid project format')
    }

    console.log('📂 Načítavam projekt:', projectData.imageCount, 'obrázkov v galérii')
    console.log('   Verzia:', projectData.version)
    if (projectData.version >= '1.8') {
      console.log('   🛣️ Optimalizované roads (sprite + metadata)')
    }
    console.log('   Dátum vytvorenia:', projectData.timestamp)
    if (projectData.placedImages) {
      const totalPlaced = Object.keys(projectData.placedImages).length
      const roadTileCount = Object.values(projectData.placedImages).filter(img => img.isRoadTile).length
      console.log('   Umiestnené obrázky na šachovnici:', totalPlaced)
      if (roadTileCount > 0) {
        console.log(`   🛣️ Road tiles: ${roadTileCount} (metadata - rekreujú sa z sprite)`)
      }
    }
    
    // Spracuj placedImages - zrekonštruuj URL z imageLibrary (verzia 1.4+)
    let processedPlacedImages = projectData.placedImages || {}
    
    if (projectData.version >= '1.4' && projectData.imageLibrary) {
      // Nový formát s deduplikáciou - vytvor mapu id -> url
      const imageMap = new Map()
      projectData.imageLibrary.forEach(img => {
        imageMap.set(img.id, img.url)
      })
      
      console.log('   📦 Unikátnych obrázkov v knižnici:', projectData.imageLibrary.length)
      
      // Zrekonštruuj plné URL pre každý placedImage + všetky metadáta
      processedPlacedImages = {}
      Object.entries(projectData.placedImages).forEach(([key, data]) => {
        // Pre road tiles (verzia 1.8+) - URL sa rekreuje z sprite, nepoužívame imageId
        if (data.isRoadTile && data.tileMetadata) {
          processedPlacedImages[key] = {
            row: data.row,
            col: data.col,
            url: null, // Bude rekreované z roadSpriteUrl + tileMetadata
            cellsX: data.cellsX || 1,
            cellsY: data.cellsY || 1,
            isBackground: false,
            isRoadTile: true,
            templateName: data.templateName || '',
            tileMetadata: data.tileMetadata,
            buildingData: data.buildingData || null
          }
        } else {
          // Non-road obrázky - rekonštruuj URL z imageLibrary
          processedPlacedImages[key] = {
            row: data.row,
            col: data.col,
            url: imageMap.get(data.imageId) || data.url,  // fallback na url ak existuje
            cellsX: data.cellsX || 1,
            cellsY: data.cellsY || 1,
            isBackground: data.isBackground || false,
            isRoadTile: data.isRoadTile || false,
            templateName: data.templateName || '',
            tileMetadata: data.tileMetadata || null,
            buildingData: data.buildingData || null
          }
        }
      })
    }
    // Pre staršie verzie (1.3 a menej) - url je priamo v placedImages

    // Emituj event do App.vue s načítanými obrázkami a placement dátami
    emit('load-project', {
      images: projectData.images,
      placedImages: processedPlacedImages,
      environmentColors: projectData.environmentColors || { hue: 0, saturation: 100, brightness: 100 },
      textureSettings: projectData.textureSettings || { tilesPerImage: 1, tileResolution: 512, customTexture: null },
      resources: projectData.resources || [],
      workforce: projectData.workforce || [],
      events: projectData.events || [],
      gameTime: projectData.gameTime || 0,
      roadSpriteUrl: projectData.roadSpriteUrl || '/templates/roads/sprites/pastroad.png',
      roadOpacity: projectData.roadOpacity || 100,
      buildingProductionStates: projectData.buildingProductionStates || {}
    })

    // Debug logging pre buildingData
    const imagesWithBuildings = projectData.images.filter(img => img.buildingData?.isBuilding)
    if (imagesWithBuildings.length > 0) {
      console.log(`📦 Načítaných ${imagesWithBuildings.length} budov:`)
      imagesWithBuildings.forEach(img => {
        console.log(`   - ${img.buildingData.buildingName || 'Unnamed'} (${img.buildingData.buildingSize || '1x1'})`)
      })
    }

    // Resetuj file input
    event.target.value = ''

    console.log('✅ Projekt načítaný!')
  } catch (error) {
    console.error('❌ Chyba pri načítavaní projektu:', error)
    alert('Error loading project: ' + error.message)
  }
}

// Vyčisti všetky obrázky
const clearProject = () => {
  if (props.images.length === 0) {
    alert('Gallery is already empty!')
    return
  }

  if (confirm(`Are you sure you want to delete all ${props.images.length} images from the gallery?`)) {
    emit('load-project', {
      images: [],
      placedImages: {}
    })
    console.log('🗑️ Projekt vyčistený')
  }
}
</script>

<template>
  <div class="project-manager">
    <div class="button-group">
      <!-- Mode switcher -->
      <div class="mode-switcher">
        <button 
          @click="router.push('/editor')" 
          :class="['mode-btn', { active: route.path === '/editor' }]"
          title="Editor mode - generate and edit"
        >
          🎨 Editor
        </button>
        <button 
          @click="router.push('/gameplay')" 
          :class="['mode-btn', { active: route.path === '/gameplay' }]"
          title="Game Play mode - display resources"
        >
          🎮 Game Play
        </button>
      </div>
      
      <div class="separator"></div>
      
      <button @click="saveProject" class="btn btn-save" title="Save project to JSON file">
        💾 Save
      </button>
      
      <button @click="saveGameplayProject" class="btn btn-save-gameplay" title="Save project with optimized images for gameplay">
        🎮 Save Gameplay
      </button>
      
      <button @click="loadProject" class="btn btn-load" title="Load project from JSON file">
        📂 Load
      </button>
      
      <button @click="openResourceManager" class="btn btn-resources" title="Manage resources and workforce">
        📊 Resources
      </button>
      
      <button @click="openEventEmitter" class="btn btn-events" title="Manage events and triggers">
        ⚡ Events
      </button>
      
      <button @click="clearProject" class="btn btn-clear" title="Delete all images">
        🗑️ Clear
      </button>
    </div>

    <!-- Checkboxy pre zobrazenie -->
    <div class="toggle-group">
      <label class="toggle-label" title="Show/hide cell numbering">
        <input 
          type="checkbox" 
          :checked="showNumbering"
          @change="$emit('update:showNumbering', $event.target.checked)"
        />
        <span>🔢 Numbering</span>
      </label>
      
      <label class="toggle-label" title="Show/hide image gallery">
        <input 
          type="checkbox" 
          :checked="showGallery"
          @change="$emit('update:showGallery', $event.target.checked)"
        />
        <span>🖼️ Gallery</span>
      </label>
      
      <label class="toggle-label" title="Show/hide checkerboard grid">
        <input 
          type="checkbox" 
          :checked="showGrid"
          @change="$emit('update:showGrid', $event.target.checked)"
        />
        <span>⊞ Grid</span>
      </label>

      <div class="effect-select-wrapper">
        <span class="effect-icon">✨</span>
        <select v-model="selectedEffect" @change="onEffectChange" class="effect-select">
          <option v-for="opt in effectOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </div>
    </div>

    <!-- Skrytý file input -->
    <input
      ref="fileInput"
      type="file"
      accept=".json"
      @change="handleFileUpload"
      style="display: none"
    />
    
    <!-- Resource Manager Modal -->
    <Modal 
      v-if="showResourceModal" 
      title="Resource Manager"
      width="800px"
      @close="closeResourceManager"
    >
      <ResourceManager
        :initialResources="resources"
        :initialWorkforce="workforce"
        @update="handleResourceUpdate"
      />
    </Modal>
    
    <!-- Event Emitter Modal -->
    <Modal 
      v-if="showEventModal" 
      title="Event Emitter"
      width="700px"
      @close="closeEventEmitter"
    >
      <EventEmitter
        :events="events"
        :resources="resources"
        :workforce="workforce"
        :images="images"
        @update-events="handleEventsUpdate"
      />
    </Modal>
  </div>
</template>

<style scoped>
.project-manager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.5rem 1rem;
  width: 100%;
}

.button-group {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.mode-switcher {
  display: flex;
  gap: 2px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  padding: 2px;
}

.mode-btn {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s;
  background: transparent;
  color: rgba(255, 255, 255, 0.8);
}

.mode-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  color: white;
}

.mode-btn.active {
  background: white;
  color: #667eea;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.separator {
  width: 1px;
  height: 30px;
  background: rgba(255, 255, 255, 0.3);
}

.toggle-group {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  color: white;
  font-weight: 600;
  font-size: 0.9rem;
  user-select: none;
  transition: opacity 0.2s;
}

.toggle-label:hover {
  opacity: 0.8;
}

.toggle-label input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #10b981;
}

.effect-select-wrapper {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-left: 0.5rem;
}

.effect-icon {
  font-size: 1rem;
}

.effect-select {
  padding: 0.3rem 0.5rem;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.15);
  color: white;
  cursor: pointer;
  outline: none;
  transition: all 0.2s;
}

.effect-select:hover {
  background: rgba(255, 255, 255, 0.25);
}

.effect-select:focus {
  border-color: rgba(255, 255, 255, 0.6);
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.15);
}

.effect-select option {
  background: #374151;
  color: white;
}

.btn {
  padding: 0.6rem 1.2rem;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.3s;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
}

.btn:active {
  transform: translateY(0);
}

.btn-save {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
}

.btn-save:hover {
  background: linear-gradient(135deg, #059669 0%, #047857 100%);
}

.btn-save-gameplay {
  background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
  color: white;
}

.btn-save-gameplay:hover {
  background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%);
}

.btn-load {
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  color: white;
}

.btn-load:hover {
  background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
}

.btn-resources {
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
  color: white;
}

.btn-resources:hover {
  background: linear-gradient(135deg, #d97706 0%, #b45309 100%);
}

.btn-events {
  background: linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%);
  color: white;
}

.btn-events:hover {
  background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%);
}

.btn-clear {
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  color: white;
}

.btn-clear:hover {
  background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
}

.image-count {
  padding: 0.6rem 1rem;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 8px;
  font-weight: 600;
  color: #667eea;
  font-size: 0.9rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}
</style>
