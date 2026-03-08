<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { assetUrl } from '../utils/assetUrl.js'

const emit = defineEmits(['apply-texture', 'color-change', 'tiles-change', 'resolution-change', 'perspective-change'])

const props = defineProps({
  texturePath: {
    type: String,
    default: assetUrl('/enviroment/grass.jpg')
  },
  disabled: {
    type: Boolean,
    default: false
  },
  initialColors: {
    type: Object,
    default: () => ({ hue: 0, saturation: 100, brightness: 100 })
  },
  initialTilesPerImage: {
    type: Number,
    default: 1
  },
  initialTileResolution: {
    type: Number,
    default: 512
  },
  initialPerspective: {
    type: Number,
    default: 0
  }
})

const hueRotation = ref(0)
const saturation = ref(100)
const brightness = ref(100)
const tilesPerImage = ref(1)
const tileResolution = ref(512)
const perspective = ref(0)

// Inicializuj farby z props
onMounted(() => {
  if (props.initialColors) {
    hueRotation.value = props.initialColors.hue || 0
    saturation.value = props.initialColors.saturation || 100
    brightness.value = props.initialColors.brightness || 100
  }
  tilesPerImage.value = props.initialTilesPerImage || 1
  tileResolution.value = props.initialTileResolution || 512
  perspective.value = props.initialPerspective || 0
})

// Watch na zmenu initialColors (pri načítaní projektu)
watch(() => props.initialColors, (newColors) => {
  if (newColors) {
    hueRotation.value = newColors.hue || 0
    saturation.value = newColors.saturation || 100
    brightness.value = newColors.brightness || 100
  }
}, { deep: true })

// Watch na zmenu initialTilesPerImage (pri načítaní projektu)
watch(() => props.initialTilesPerImage, (newValue) => {
  if (newValue !== undefined) {
    tilesPerImage.value = newValue
    console.log('📐 TextureColorPicker: tilesPerImage načítané:', newValue)
  }
})

// Watch na zmenu initialTileResolution (pri načítaní projektu)
watch(() => props.initialTileResolution, (newValue) => {
  if (newValue !== undefined) {
    tileResolution.value = newValue
    console.log('📐 TextureColorPicker: tileResolution načítané:', newValue)
  }
})

// Watch na zmenu initialPerspective (pri načítaní projektu)
watch(() => props.initialPerspective, (newValue) => {
  if (newValue !== undefined) {
    perspective.value = newValue
    console.log('🔭 TextureColorPicker: perspective načítané:', newValue)
  }
})

// Watch na zmenu texturePath (pri načítaní projektu s vlastnou textúrou)
watch(() => props.texturePath, async (newPath) => {
  if (newPath && newPath.startsWith('data:')) {
    console.log('🎨 TextureColorPicker: Vlastná textúra načítaná, automaticky aplikujem...')
    // Počkaj chvíľu aby sa všetky hodnoty nastavili
    await new Promise(resolve => setTimeout(resolve, 100))
    const adjustedImage = await applyColorAdjustments(newPath)
    emit('apply-texture', adjustedImage, tilesPerImage.value)
    console.log('✅ TextureColorPicker: Textúra automaticky aplikovaná')
  }
})

const filterStyle = computed(() => ({
  filter: `hue-rotate(${hueRotation.value}deg) saturate(${saturation.value}%) brightness(${brightness.value}%)`
}))

// Aplikovať farebné úpravy na obrázok
const applyColorAdjustments = (imageSrc) => {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      // Perspective mení šírku, ale zachováva výšku
      const widthMultiplier = 1 + (perspective.value / 100)
      canvas.width = tileResolution.value * widthMultiplier
      canvas.height = tileResolution.value
      const ctx = canvas.getContext('2d')
      
      ctx.filter = `hue-rotate(${hueRotation.value}deg) saturate(${saturation.value}%) brightness(${brightness.value}%)`
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      
      resolve(canvas.toDataURL('image/jpeg', 0.9))
    }
    img.src = imageSrc
  })
}

const applyTexture = async () => {
  const adjustedImage = await applyColorAdjustments(props.texturePath)
  emit('apply-texture', adjustedImage, tilesPerImage.value)
}

const resetColors = () => {
  hueRotation.value = 0
  saturation.value = 100
  brightness.value = 100
}

// Emituj zmeny farieb
watch([hueRotation, saturation, brightness], () => {
  emit('color-change', {
    hue: hueRotation.value,
    saturation: saturation.value,
    brightness: brightness.value
  })
}, { immediate: true })

// Emituj zmenu počtu políčok a automaticky aplikuj textúru
watch(tilesPerImage, async (newValue) => {
  emit('tiles-change', newValue)
  // Automaticky aplikuj textúru na canvas pri zmene
  const adjustedImage = await applyColorAdjustments(props.texturePath)
  emit('apply-texture', adjustedImage, newValue)
})

// Emituj zmenu rozlíšenia a automaticky aplikuj textúru
watch(tileResolution, async (newValue) => {
  console.log('🎨 Tile rozlíšenie zmenené na:', newValue)
  emit('resolution-change', newValue)
  const adjustedImage = await applyColorAdjustments(props.texturePath)
  emit('apply-texture', adjustedImage, tilesPerImage.value)
})

// Emituj zmenu perspektívy a automaticky aplikuj textúru
watch(perspective, async (newValue) => {
  console.log('🔭 Perspektíva zmenená na:', newValue)
  emit('perspective-change', newValue)
  const adjustedImage = await applyColorAdjustments(props.texturePath)
  emit('apply-texture', adjustedImage, tilesPerImage.value)
})
</script>

<template>
  <div class="texture-picker">
    <label class="title">🌿 Default Texture</label>
    
    <div class="texture-preview-container">
      <img 
        :src="texturePath" 
        alt="Default texture"
        class="texture-preview-img"
        :style="filterStyle"
      />
    </div>
    
    <!-- Náhľad opakovanej textúry -->
    <div class="tiled-preview-section">
      <label class="preview-label">👁️ Seamless Preview</label>
      <div 
        class="tiled-preview"
        :style="{
          backgroundImage: `url(${texturePath})`,
          backgroundRepeat: 'repeat',
          backgroundSize: 'auto',
          ...filterStyle
        }"
      >
      </div>
      <p class="preview-hint">Texture repeated - check for seamless transitions</p>
    </div>
    
    <div class="color-controls">
      <div class="color-slider">
        <label>🎨 Hue: {{ hueRotation }}°</label>
        <input
          type="range"
          v-model.number="hueRotation"
          min="0"
          max="360"
          step="1"
          class="hue-slider"
          :disabled="disabled"
        />
      </div>
      
      <div class="color-slider">
        <label>💧 Saturation: {{ saturation }}%</label>
        <input
          type="range"
          v-model.number="saturation"
          min="0"
          max="200"
          step="1"
          :disabled="disabled"
        />
      </div>
      
      <div class="color-slider">
        <label>☀️ Brightness: {{ brightness }}%</label>
        <input
          type="range"
          v-model.number="brightness"
          min="0"
          max="200"
          step="1"
          :disabled="disabled"
        />
      </div>
      
      <div class="color-slider">
        <label>🔲 Texture Size: {{ tilesPerImage }}x{{ tilesPerImage }} tiles</label>
        <input
          type="range"
          v-model.number="tilesPerImage"
          min="1"
          max="30"
          step="1"
          :disabled="disabled"
        />
      </div>
      
      <div class="color-slider">
        <label>📐 Tile Resolution: {{ tileResolution }}x{{ tileResolution }}px</label>
        <input
          type="range"
          v-model.number="tileResolution"
          min="256"
          max="4096"
          step="256"
          :disabled="disabled"
        />
      </div>
      
      <div class="color-slider">
        <label>🔭 Perspective: {{ perspective }}% (stretch)</label>
        <input
          type="range"
          v-model.number="perspective"
          min="0"
          max="200"
          step="5"
          :disabled="disabled"
        />
      </div>
    </div>
    
    <div class="button-row">
      <button 
        @click="applyTexture" 
        :disabled="disabled"
        class="btn-apply"
      >
        ✅ Apply
      </button>
      <button 
        @click="resetColors" 
        :disabled="disabled"
        class="btn-reset"
      >
        🔄
      </button>
    </div>
  </div>
</template>

<style scoped>
.texture-picker {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  background: linear-gradient(135deg, #f0fff0 0%, #e8f5e9 100%);
  border-radius: 12px;
  border: 2px solid #c8e6c9;
}

.title {
  font-weight: 600;
  color: #2e7d32;
  font-size: 1rem;
  margin: 0;
}

.texture-preview-container {
  width: 100%;
  height: 120px;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.texture-preview-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: filter 0.3s;
}

.tiled-preview-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.preview-label {
  font-size: 0.85rem;
  color: #2e7d32;
  font-weight: 600;
  margin: 0;
}

.tiled-preview {
  width: 100%;
  height: 150px;
  border: 2px solid #4caf50;
  border-radius: 8px;
  background-color: #f0f0f0;
  image-rendering: pixelated;
  image-rendering: -moz-crisp-edges;
  image-rendering: crisp-edges;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.preview-hint {
  font-size: 0.7rem;
  color: #666;
  margin: 0;
  text-align: center;
  font-style: italic;
}

.color-controls {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.color-slider {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.color-slider label {
  font-size: 0.8rem;
  color: #555;
  font-weight: 500;
}

.color-slider input[type="range"] {
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: #e0e0e0;
  outline: none;
  cursor: pointer;
}

.color-slider input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #4caf50;
  cursor: pointer;
  transition: all 0.3s;
}

.color-slider input[type="range"]::-webkit-slider-thumb:hover {
  transform: scale(1.2);
  background: #388e3c;
}

.hue-slider {
  background: linear-gradient(to right, 
    hsl(0, 100%, 50%), 
    hsl(60, 100%, 50%), 
    hsl(120, 100%, 50%), 
    hsl(180, 100%, 50%), 
    hsl(240, 100%, 50%), 
    hsl(300, 100%, 50%), 
    hsl(360, 100%, 50%)
  ) !important;
}

.button-row {
  display: flex;
  gap: 0.5rem;
}

.btn-apply {
  flex: 1;
  background: linear-gradient(135deg, #4caf50 0%, #8bc34a 100%);
  color: white;
  padding: 0.75rem;
  font-size: 0.95rem;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.3s;
}

.btn-apply:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 5px 20px rgba(76, 175, 80, 0.4);
}

.btn-apply:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-reset {
  background: #f5f5f5;
  color: #555;
  padding: 0.75rem;
  font-size: 0.95rem;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s;
}

.btn-reset:hover:not(:disabled) {
  background: #e0e0e0;
  border-color: #bdbdbd;
}

.btn-reset:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
