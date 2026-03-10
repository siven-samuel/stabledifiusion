<script setup>
import { ref, watch, computed } from 'vue'
import TemplateSelector from './TemplateSelector.vue'

const emit = defineEmits(['image-generated', 'template-selected', 'tab-changed', 'numbering-changed', 'road-sprite-selected'])

const prompt = ref('')
const negativePrompt = ref('')
const isGenerating = ref(false)
const error = ref('')
const inputImage = ref(null)
const inputImagePreview = ref('')
const strength = ref(0.75) // Ako moc zmeniť obrázok (0.0 - 1.0)
const model = ref('dreamshaper') // 'lite' or 'full'
const lastGeneratedImage = ref('') // Posledný vygenerovaný obrázok
const isRemovingBackground = ref(false)
const hueShift = ref(0) // Posun odtieňa (-180 až +180)
const isAdjustingHue = ref(false)
const autoRemoveBackground = ref(true) // Či automaticky odstrániť pozadie po generovaní
const useAiRemoval = ref(true) // Či použiť AI (rembg) na odstránenie pozadia
const showNumbering = ref(true) // Či zobrazovať číslovanie šachovnice
const templateCellsX = ref(1) // Počet políčok do šírky pre šablónu
const templateCellsY = ref(1) // Počet políčok do výšky pre šablónu
const currentTemplateName = ref('') // Názov aktuálnej šablóny
const isRoadSprite = ref(false) // Či je aktuálna šablóna road sprite
const seed = ref('') // Seed pre reprodukovateľnosť generovania (prázdne = náhodný)

// Sleduj zmeny showNumbering a oznám App.vue
watch(showNumbering, (newValue) => {
  emit('numbering-changed', newValue)
  console.log('🔢 Číslovanie šachovnice:', newValue ? 'ZAPNUTÉ' : 'VYPNUTÉ')
})

// Funkcia na spracovanie zmeny tabu v šablónach
const handleTabChanged = ({ cellsX, cellsY }) => {
  templateCellsX.value = cellsX
  templateCellsY.value = cellsY
  // Oznám App.vue o zmene tabu
  emit('tab-changed', { cellsX, cellsY })
  console.log(`Tab zmenený, políčka: ${cellsX}x${cellsY}`)
}

// Funkcia na preposlanie road sprite URL do App.vue
const handleRoadSpriteSelected = (spriteUrl) => {
  console.log('🛣️ Road sprite vybraný:', spriteUrl)
  emit('road-sprite-selected', spriteUrl)
}

// Funkcia na spracovanie vybranej šablóny
const handleTemplateSelected = ({ dataUrl, templateName, width, height, cellsX, cellsY, isRoadSprite: isRoad }) => {
  inputImage.value = dataUrl
  inputImagePreview.value = dataUrl
  error.value = ''
  currentTemplateName.value = templateName // Ulož názov šablóny
  isRoadSprite.value = isRoad || false // Ulož či je to road sprite
  
  // Ulož informáciu o počte políčok pre canvas
  if (cellsX && cellsY) {
    templateCellsX.value = cellsX
    templateCellsY.value = cellsY
  }
  
  // Oznám App.vue že bola vybraná šablóna
  emit('template-selected', true)
  
  // Automaticky nastav rozmery podľa šablóny
  if (width && height) {
    templateWidth.value = width
    templateHeight.value = height
    sizeMultiplier.value = 1 // Reset na "zo šablóny"
    console.log(`Šablóna vybraná: ${templateName}, rozmery: ${width}x${height}, políčka: ${cellsX}x${cellsY}`)
  } else {
    console.log('Šablóna vybraná:', templateName)
  }
}

// LoRA podpora
const availableLoras = ref([])
const selectedLora = ref('')
const loraScale = ref(0.9) // Sila LoRA (0.0 - 1.0)
const showAllLoras = ref(false) // Či zobraziť všetky LoRA alebo len isometric

// Rozmery obrázka - dynamické podľa šablóny
const templateWidth = ref(400) // Šírka šablóny
const templateHeight = ref(400) // Výška šablóny
const sizeMultiplier = ref(1) // 1 = zo šablóny, 2 = zo šablóny x2

// Funkcia na získanie šírky a výšky podľa šablóny a multiplikátora
const getImageDimensions = () => {
  return {
    width: templateWidth.value * sizeMultiplier.value,
    height: templateHeight.value * sizeMultiplier.value
  }
}

// RGB farebné kanály (1.0 = normálne, 0.0 = bez farby, 2.0 = zdvojnásobenie)

// Computed property pre filtrované LoRA modely
const filteredLoras = computed(() => {
  if (showAllLoras.value) {
    return availableLoras.value
  }
  // Filtruj len modely začínajúce na "iso" (case-insensitive)
  return availableLoras.value.filter(lora => 
    lora.toLowerCase().startsWith('iso')
  )
})

// Konfigurácia pre Python backend z environment premenných
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000'
const API_URL = `${API_BASE_URL}/generate`
const HEALTH_URL = `${API_BASE_URL}/health`

// Načítaj dostupné LoRA z backendu
const fetchAvailableLoras = async (retryCount = 0) => {
  try {
    console.log(`🔍 Načítavam LoRA modely z ${HEALTH_URL}... (pokus ${retryCount + 1})`)
    const response = await fetch(HEALTH_URL)
    if (response.ok) {
      const data = await response.json()
      availableLoras.value = data.loras_available || []
      console.log(`✅ Načítaných ${availableLoras.value.length} LoRA modelov:`, availableLoras.value)
    } else {
      console.warn(`⚠️ Health endpoint vrátil status ${response.status}`)
      // Retry po 3 sekundách ak backend ešte nie je ready
      if (retryCount < 3) {
        setTimeout(() => fetchAvailableLoras(retryCount + 1), 3000)
      }
    }
  } catch (err) {
    console.error('❌ Nepodarilo sa načítať LoRA:', err.message)
    // Retry po 5 sekundách ak backend ešte nebeží
    if (retryCount < 3) {
      console.log(`🔄 Skúsim znova o 5s... (pokus ${retryCount + 1}/3)`)
      setTimeout(() => fetchAvailableLoras(retryCount + 1), 5000)
    }
  }
}

// Načítaj LoRA pri štarte
fetchAvailableLoras()

const handleImageUpload = (event) => {
  const file = event.target.files[0]
  if (file) {
    if (file.size > 10 * 1024 * 1024) { // 10MB limit
      error.value = 'Image is too large (max 10MB)'
      return
    }
    
    const reader = new FileReader()
    reader.onload = (e) => {
      inputImage.value = e.target.result
      inputImagePreview.value = e.target.result
      error.value = ''
    }
    reader.readAsDataURL(file)
  }
}

const removeInputImage = () => {
  inputImage.value = null
  inputImagePreview.value = ''
  currentTemplateName.value = '' // Vymaž názov šablóny
  isRoadSprite.value = false // Vymaž road sprite flag
  const fileInput = document.getElementById('image-upload')
  if (fileInput) fileInput.value = ''
  
  // Keď odstránime obrázok/šablónu, zrušíme výber šablóny
  emit('template-selected', false)
}

const generateImage = async () => {
  console.log('🎨 ImageGenerator: Začínam generovať obrázok...')
  console.log('   Prompt:', prompt.value)
  console.log('   Model:', model.value)
  console.log('   TemplateSelected:', inputImage.value ? 'Áno' : 'Nie')
  console.log('   CellsX x CellsY:', templateCellsX.value, 'x', templateCellsY.value)
  
  // Kontroluj prompt
  if (!prompt.value.trim()) {
    error.value = 'Please enter a description (prompt)'
    return
  }

  isGenerating.value = true
  error.value = ''
  console.log('🔄 ImageGenerator: Odosielam request na backend...')

  try {
    const dimensions = getImageDimensions()
    
    const requestBody = {
      prompt: prompt.value,
      negative_prompt: negativePrompt.value,
      model: model.value,
      num_inference_steps: 50,
      guidance_scale: 7.5,
      width: dimensions.width,
      height: dimensions.height,
    }

    // Pridaj seed ak je zadaný (inak backend použije náhodný)
    if (seed.value && seed.value.trim()) {
      const seedNum = parseInt(seed.value.trim())
      if (!isNaN(seedNum)) {
        requestBody.seed = seedNum
      }
    }
    
    // Pridaj LoRA ak je vybraná
    if (selectedLora.value) {
      requestBody.lora = selectedLora.value
      requestBody.lora_scale = loraScale.value
    }
    
    // Pridaj obrázok ak je nahraný
    if (inputImage.value) {
      requestBody.input_image = inputImage.value
      requestBody.strength = strength.value
    }
    
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error || 'Error generating image')
    }

    const data = await response.json()
    console.log('✅ ImageGenerator: Obrázok úspešne vygenerovaný!')
    console.log('🎲 Použitý seed:', data.seed || 'N/A')

    // Zistíme či je to pozadie (šablóna 0.png) - ignoruje kolíziu
    const isBackgroundTemplate = currentTemplateName.value === '0.png'
    
    // Vytvor bitmap pre rýchlejšie renderovanie na canvas
    let bitmap = null
    try {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      await new Promise((resolve, reject) => {
        img.onload = async () => {
          try {
            bitmap = await createImageBitmap(img)
            console.log('✅ Bitmap vytvorená pre budovu')
            resolve()
          } catch (e) {
            console.warn('createImageBitmap zlyhalo:', e)
            resolve()
          }
        }
        img.onerror = reject
        img.src = data.image
      })
    } catch (e) {
      console.warn('Chyba pri vytváraní bitmap:', e)
    }
    
    const generatedImage = {
      id: Date.now().toString(),
      url: data.image,
      bitmap, // Optimalizovaná bitmap pre rýchle kreslenie
      prompt: prompt.value,
      negativePrompt: negativePrompt.value,
      timestamp: new Date(),
      isBackground: isBackgroundTemplate, // Flag pre ignorovanie kolízie
      templateName: currentTemplateName.value, // Názov šablóny pre tieň
      isRoadSprite: isRoadSprite.value, // Či je to road sprite
      seed: data.seed || null, // Seed z backendu (vždy je nastavený)
    }

    // Ulož posledný vygenerovaný obrázok
    lastGeneratedImage.value = data.image
    console.log('📦 ImageGenerator: Vytvorený objekt obrázka, ID:', generatedImage.id)

    // Ak je zapnuté automatické odstránenie pozadia
    if (autoRemoveBackground.value) {
      try {
        const bgRemovedImage = await removeBackgroundFromImage(data.image)
        generatedImage.url = bgRemovedImage
        lastGeneratedImage.value = bgRemovedImage
        
        // Aktualizuj bitmap s novým obrázkom (bez pozadia)
        try {
          const img = new Image()
          img.crossOrigin = 'anonymous'
          await new Promise((resolve, reject) => {
            img.onload = async () => {
              try {
                generatedImage.bitmap = await createImageBitmap(img)
                console.log('✅ Bitmap aktualizovaná po odstránení pozadia')
                resolve()
              } catch (e) {
                console.warn('createImageBitmap zlyhalo:', e)
                resolve()
              }
            }
            img.onerror = reject
            img.src = bgRemovedImage
          })
        } catch (e) {
          console.warn('Chyba pri aktualizácii bitmap:', e)
        }
      } catch (bgError) {
        console.error('Chyba pri odstraňovaní pozadia:', bgError)
        // Ponechaj originálny obrázok
      }
    }

    console.log('📤 ImageGenerator: Emitujem image-generated event')
    console.log('   Image ID:', generatedImage.id)
    console.log('   CellsX x CellsY:', templateCellsX.value, 'x', templateCellsY.value)
    emit('image-generated', generatedImage, templateCellsX.value, templateCellsY.value)
    console.log('✨ ImageGenerator: Event image-generated emitovaný!')
    // Ponecháme všetky nastavenia tak ako sú (používateľ môže upraviť a znova generovať)
    console.log('📸 ImageGenerator: Šablóna zostáva vybraná, inputImage:', inputImage.value ? 'ÁNO' : 'NIE')
    console.log('   inputImagePreview:', inputImagePreview.value ? 'ÁNO' : 'NIE')
  // Keep the uploaded input image by default so the user can re-run
  // image-to-image generations. The user can remove it manually
  // using the ❌ Odstrániť button in the UI.
  } catch (err) {
    if (err.message.includes('Failed to fetch')) {
      error.value = `Cannot connect to server. Make sure the backend is running at ${API_BASE_URL}`
    } else {
      error.value = err.message || 'Unknown error'
    }
  } finally {
    isGenerating.value = false
  }
}

// Pomocná funkcia na odstránenie pozadia z obrázka
const removeBackgroundFromImage = async (imageData) => {
  const response = await fetch(`${API_BASE_URL}/remove-background`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      image: imageData,
      threshold: 30,
      use_ai: useAiRemoval.value  // Použiť rembg AI odstránenie pozadia
    }),
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(errorData.error || 'Error removing background')
  }

  const data = await response.json()
  return data.image
}

// Odstráň čierne pozadie (manuálne tlačidlo)
const removeBackground = async () => {
  if (!lastGeneratedImage.value) {
    error.value = 'Generate an image first'
    return
  }

  isRemovingBackground.value = true
  error.value = ''

  try {
    const response = await fetch(`${API_BASE_URL}/remove-background`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image: lastGeneratedImage.value,
        threshold: 30,
        use_ai: useAiRemoval.value  // Použiť rembg AI odstránenie pozadia
      }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error || 'Error removing background')
    }

    const data = await response.json()

    const cleanedImage = {
      id: Date.now().toString(),
      url: data.image,
      bitmap: null, // Bude vytvorená nižšie
      prompt: 'Black background removed',
      negativePrompt: '',
      timestamp: new Date(),
    }

    // Vytvor bitmap pre optimalizované renderovanie
    try {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      await new Promise((resolve, reject) => {
        img.onload = async () => {
          try {
            cleanedImage.bitmap = await createImageBitmap(img)
            console.log('✅ Bitmap vytvorená po odstránení pozadia')
            resolve()
          } catch (e) {
            console.warn('createImageBitmap zlyhalo:', e)
            resolve()
          }
        }
        img.onerror = reject
        img.src = data.image
      })
    } catch (e) {
      console.warn('Chyba pri vytváraní bitmap:', e)
    }

    // Aktualizuj posledný obrázok
    lastGeneratedImage.value = data.image

    emit('image-generated', cleanedImage, templateCellsX.value, templateCellsY.value)
  } catch (err) {
    error.value = err.message || 'Error removing background'
  } finally {
    isRemovingBackground.value = false
  }
}

// Zmena farebného odtieňa
const adjustHue = async () => {
  if (!lastGeneratedImage.value) {
    error.value = 'Generate an image first'
    return
  }

  isAdjustingHue.value = true
  error.value = ''

  try {
    const response = await fetch(`${API_BASE_URL}/adjust-hue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image: lastGeneratedImage.value,
        hue_shift: hueShift.value
      }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error || 'Error adjusting hue')
    }

    const data = await response.json()

    const adjustedImage = {
      id: Date.now().toString(),
      url: data.image,
      bitmap: null, // Bude vytvorená nižšie
      prompt: `Hue adjusted (${hueShift.value}°)`,
      negativePrompt: '',
      timestamp: new Date(),
    }

    // Vytvor bitmap pre optimalizované renderovanie
    try {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      await new Promise((resolve, reject) => {
        img.onload = async () => {
          try {
            adjustedImage.bitmap = await createImageBitmap(img)
            console.log('✅ Bitmap vytvorená po zmene odtieňa')
            resolve()
          } catch (e) {
            console.warn('createImageBitmap zlyhalo:', e)
            resolve()
          }
        }
        img.onerror = reject
        img.src = data.image
      })
    } catch (e) {
      console.warn('Chyba pri vytváraní bitmap:', e)
    }

    // Aktualizuj posledný obrázok
    lastGeneratedImage.value = data.image

    emit('image-generated', adjustedImage, templateCellsX.value, templateCellsY.value)
  } catch (err) {
    error.value = err.message || 'Error adjusting hue'
  } finally {
    isAdjustingHue.value = false
  }
}

// Demo funkcia
const generateDemo = () => {
  const demoImage = {
    id: Date.now().toString(),
    url: `https://picsum.photos/512/512?random=${Date.now()}`,
    prompt: prompt.value || 'Demo image',
    negativePrompt: negativePrompt.value,
    timestamp: new Date(),
  }
  emit('image-generated', demoImage, templateCellsX.value, templateCellsY.value)
  // Ponecháme všetky nastavenia tak ako sú
}

// Funkcia pre automatické spustenie generovania (volaná z App.vue)
const startGeneration = () => {
  console.log('🚀 ImageGenerator.startGeneration() volaná z App.vue')
  generateImage()
}

// Expose funkciu aby ju mohol App.vue volať
defineExpose({
  startGeneration
})
</script>

<template>
  <div class="generator-card">
    
    <div class="form">
      <!-- 1. Komponent pre výber šablón (tabs 1size/2size + grid šablón) -->
      <TemplateSelector 
        @template-selected="handleTemplateSelected" 
        @tab-changed="handleTabChanged"
        @road-sprite-selected="handleRoadSpriteSelected"
      />
      
      <!-- 2. Upload vlastného obrázka -->
      <div class="upload-section">
        <div class="upload-divider">
          <span>or upload your own</span>
        </div>
        
        <div class="image-upload-area">
          <input
            id="image-upload"
            type="file"
            accept="image/*"
            @change="handleImageUpload"
            :disabled="isGenerating"
            style="display: none"
          />
          
          <div v-if="!inputImagePreview" class="upload-placeholder">
            <label for="image-upload" class="upload-label">
              📁 Click here
            </label>
          </div>
          
          <div v-else class="image-preview">
            <img :src="inputImagePreview" alt="Uploaded image" />
            <button @click="removeInputImage" class="remove-btn" :disabled="isGenerating">
              ✕
            </button>
          </div>
        </div>
      </div>

      <!-- 3. Sila zmeny (len ak je vybraný obrázok) -->
      <div v-if="inputImagePreview" class="slider-group strength-section">
        <label for="strength">Change strength ({{ (strength * 100).toFixed(0) }}%)</label>
        <input
          id="strength"
          type="range"
          v-model.number="strength"
          min="0.3"
          max="1.0"
          step="0.05"
          :disabled="isGenerating"
        />
      </div>

      <!-- 4. Text prompt -->
      <div class="input-group prompt-section">
        <label for="prompt">✏️ Prompt</label>
        <textarea
          id="prompt"
          v-model="prompt"
          placeholder="house, building, castle..."
          rows="1"
          :disabled="isGenerating"
        />

        
      </div>

      <!-- 5. Hlavné tlačidlo GENEROVAŤ -->
      <button 
        @click="() => { console.log('🖱️ BUTTON CLICKED! prompt:', prompt, 'isGenerating:', isGenerating); generateImage(); }" 
        :disabled="isGenerating || !prompt.trim()"
        class="btn-primary btn-generate-main"
      >
        <span v-if="isGenerating">⏳ Generating...</span>
        <span v-else-if="inputImagePreview">🎨 Edit image</span>
        <span v-else>🎨 Generate image</span>
      </button>

      <div v-if="error" class="error-message">
        ⚠️ {{ error }}
      </div>

      <!-- Rozšírené nastavenia - skryté v collapse -->
      <details class="advanced-settings">
        <summary>⚙️ Advanced settings</summary>
        
        <div class="settings-content">
          <!-- Model -->
          <div class="input-group">
            <label for="model-select">Model</label>
            <select id="model-select" v-model="model" :disabled="isGenerating">
              <option value="lite">Lite (faster)</option>
              <option value="dreamshaper">🏆 DreamShaper 8</option>
              <option value="absolutereality">⭐ Absolute Reality</option>
              <option value="epicrealism">🎨 Epic Realism</option>
              <option value="majicmix">✨ MajicMix Realistic</option>
              <option value="realistic">📷 Realistic Vision V5.1</option>
              <option value="full">Full SD v1.5</option>
            </select>
          </div>

          <!-- Rozmery obrázka -->
          <div class="input-group">
            <label for="image-dimensions">📏 Image dimensions</label>
            <select id="image-dimensions" v-model.number="sizeMultiplier" :disabled="isGenerating">
              <option :value="1">from template ({{ templateWidth }}×{{ templateHeight }} px)</option>
              <option :value="2">from template x2 ({{ templateWidth * 2 }}×{{ templateHeight * 2 }} px)</option>
            </select>
          </div>

          <!-- LoRA výber -->
          <div class="input-group lora-section">
            <label for="lora-select">🎨 LoRA Model</label>
            
            <div v-if="availableLoras.length > 0">
              <!-- Checkbox pre zobrazenie všetkých LoRA -->
              <div class="lora-filter-checkbox">
                <label class="checkbox-label-inline">
                  <input 
                    type="checkbox" 
                    v-model="showAllLoras"
                    :disabled="isGenerating"
                  />
                  <span>Show all LoRA</span>
                </label>
                <span class="lora-count">({{ filteredLoras.length }} of {{ availableLoras.length }})</span>
              </div>
              
              <select id="lora-select" v-model="selectedLora" :disabled="isGenerating">
                <option value="">🚫 No LoRA</option>
                <option v-for="lora in filteredLoras" :key="lora" :value="lora">
                  {{ lora }}
                </option>
              </select>
            </div>
            
            <div v-else>
              <input
                id="lora-manual"
                type="text"
                v-model="selectedLora"
                placeholder="LoRA name (e.g. Iso-Pixel-05)"
                :disabled="isGenerating"
              />
              <small style="color: #999; font-size: 0.8rem; margin-top: 0.25rem; display: block;">
                Backend not connected — enter LoRA name manually
              </small>
            </div>
            
            <div v-if="selectedLora" class="slider-group">
              <label for="lora-scale">
                LoRA strength ({{ (loraScale * 100).toFixed(0) }}%)
              </label>
              <input
                id="lora-scale"
                type="range"
                v-model.number="loraScale"
                min="0.0"
                max="1.0"
                step="0.1"
                :disabled="isGenerating"
              />
            </div>
          </div>

          <!-- Negatívny prompt -->
          <div class="input-group">
            <label for="negative-prompt">Negative prompt</label>
            <textarea
              id="negative-prompt"
              v-model="negativePrompt"
              placeholder="blurry, low quality..."
              rows="2"
              :disabled="isGenerating"
            />
          </div>

          <!-- Seed -->
          <div class="input-group">
            <label for="seed">🎲 Seed (reproducibility)</label>
            <input
              id="seed"
              type="text"
              v-model="seed"
              placeholder="Empty = random seed"
              :disabled="isGenerating"
            />
            <small style="color: #666; font-size: 0.85rem; margin-top: 0.25rem; display: block;">
              Same seed + prompt = same result
            </small>
          </div>

          <!-- Checkbox automatické odstránenie pozadia -->
          <div class="input-group checkbox-group">
            <label class="checkbox-label">
              <input 
                type="checkbox" 
                v-model="autoRemoveBackground"
                :disabled="isGenerating"
              />
              <span>🎭 Automatically remove background</span>
            </label>
            
            <div v-if="autoRemoveBackground" class="sub-checkbox">
              <label class="checkbox-label">
                <input 
                  type="checkbox" 
                  v-model="useAiRemoval"
                  :disabled="isGenerating"
                />
                <span>🤖 Use AI (rembg)</span>
              </label>
            </div>
          </div>

          <!-- Tlačidlá -->
          <div class="button-group">
            <button 
              @click="removeBackground" 
              :disabled="isRemovingBackground || !lastGeneratedImage"
              class="btn-remove-bg"
            >
              <span v-if="isRemovingBackground">⏳ ...</span>
              <span v-else>🧹 Remove background</span>
            </button>

            <button 
              @click="generateDemo" 
              :disabled="isGenerating"
              class="btn-secondary"
            >
              🎲 Demo
            </button>
          </div>

          <!-- Farebné úpravy -->
          <div v-if="lastGeneratedImage" class="color-adjust-section">
            <h4>🎨 Hue adjustment</h4>
            <div class="slider-group">
              <label>
                Shift: <strong>{{ hueShift }}°</strong>
              </label>
              <input
                type="range"
                v-model.number="hueShift"
                min="-180"
                max="180"
                step="5"
                :disabled="isAdjustingHue"
              />
              <button 
                @click="adjustHue" 
                :disabled="isAdjustingHue || hueShift === 0"
                class="btn-hue"
              >
                <span v-if="isAdjustingHue">⏳</span>
                <span v-else>🎨 Apply</span>
              </button>
            </div>
          </div>
        </div>
      </details>
    </div>
  </div>
</template>

<style scoped>
.generator-card {
  background: white;
  color: #333;
  border-radius: 0;
  padding: 8px;
  height: 100%;
  display: flex;
  flex-direction: column;
}

h2 {
  margin-top: 0;
  margin-bottom: 0.5rem;
  color: #667eea;
  font-size: 1.2rem;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  flex: 1;
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

label {
  font-weight: 600;
  font-size: 0.8rem;
  color: #555;
}

label small {
  font-weight: normal;
  color: #888;
  font-size: 0.85em;
}

textarea {
  padding: 0.4rem;
  border: 2px solid #e0e0e0;
  border-radius: 6px;
  font-size: 0.85rem;
  font-family: inherit;
  resize: none;
  transition: border-color 0.3s;
}

textarea:focus {
  outline: none;
  border-color: #667eea;
}

textarea:disabled {
  background: #f5f5f5;
  cursor: not-allowed;
}

/* Image upload area */
.image-upload-area {
  border: 2px dashed #ccc;
  border-radius: 8px;
  overflow: hidden;
  transition: border-color 0.3s;
}

.image-upload-area:hover {
  border-color: #667eea;
}

.upload-placeholder {
  padding: 0.75rem;
  text-align: center;
  background: #f9f9f9;
}

.upload-label {
  cursor: pointer;
  color: #667eea;
  font-weight: 600;
  display: block;
}

.upload-label:hover {
  color: #764ba2;
}

.image-preview {
  position: relative;
  padding: 1rem;
  background: #f0f0f0;
}

.image-preview img {
  width: 100%;
  max-height: 300px;
  object-fit: contain;
  border-radius: 8px;
}

.remove-btn {
  position: absolute;
  top: 1.5rem;
  right: 1.5rem;
  background: rgba(255, 0, 0, 0.8);
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  transition: background 0.3s;
}

.remove-btn:hover:not(:disabled) {
  background: rgba(255, 0, 0, 1);
}

.remove-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Slider */
.slider-group {
  margin-top: 1rem;
}

.slider-group label {
  display: block;
  margin-bottom: 0.5rem;
}

input[type="range"] {
  width: 100%;
  height: 8px;
  border-radius: 4px;
  background: #e0e0e0;
  outline: none;
  -webkit-appearance: none;
}

input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #667eea;
  cursor: pointer;
}

input[type="range"]::-moz-range-thumb {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #667eea;
  cursor: pointer;
  border: none;
}

input[type="range"]:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.button-group {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

button {
  padding: 1rem 2rem;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
  flex: 1;
  min-width: 200px;
}

.btn-primary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 5px 20px rgba(102, 126, 234, 0.4);
}

.btn-secondary {
  background: #f0f0f0;
  color: #333;
}

.btn-secondary:hover:not(:disabled) {
  background: #e0e0e0;
}

.btn-remove-bg {
  padding: 1rem;
  font-size: 1rem;
  font-weight: 600;
  border: none;
  border-radius: 12px;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
}

.btn-remove-bg:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(16, 185, 129, 0.4);
}

.btn-remove-bg:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.btn-hue {
  padding: 0.8rem 1.5rem;
  font-size: 1rem;
  font-weight: 600;
  border: none;
  border-radius: 12px;
  background: linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%);
  color: white;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 4px 12px rgba(236, 72, 153, 0.3);
  margin-top: 1rem;
  width: 100%;
}

.btn-hue:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(236, 72, 153, 0.4);
}

.btn-hue:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.color-adjust-section {
  margin-top: 1.5rem;
  padding: 1.5rem;
  background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.color-adjust-section h3 {
  margin-top: 0;
  margin-bottom: 1rem;
  color: #92400e;
}

.hue-preview {
  text-align: center;
  font-size: 1.2rem;
  font-weight: 600;
  margin-top: 0.5rem;
  padding: 0.5rem;
  background: rgba(255, 255, 255, 0.5);
  border-radius: 8px;
}

.hint {
  font-size: 0.85rem;
  color: #92400e;
  font-weight: normal;
  margin-left: 0.5rem;
}

.btn-reset {
  background: #ff9800;
  color: white;
  padding: 0.5rem 1rem;
  margin-top: 0.5rem;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  transition: background 0.3s;
}

.btn-reset:hover:not(:disabled) {
  background: #f57c00;
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none !important;
}

.btn-generate-main {
  width: 100%;
  padding: 1.25rem 2rem;
  font-size: 1.1rem;
  margin-top: 1rem;
  margin-bottom: 1rem;
  box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
}

.btn-generate-main:hover:not(:disabled) {
  transform: translateY(-3px);
  box-shadow: 0 8px 25px rgba(102, 126, 234, 0.6);
}

.secondary-buttons {
  margin-top: 1.5rem;
}

.error-message {
  padding: 1rem;
  background: #fee;
  color: #c33;
  border-radius: 8px;
  border-left: 4px solid #c33;
}

.info-box {
  background: #f8f9fa;
  padding: 1.5rem;
  border-radius: 8px;
  border-left: 4px solid #667eea;
  font-size: 0.9rem;
}

.info-box p, .info-box ul {
  margin: 0.5rem 0;
}

.info-box ul {
  padding-left: 1.5rem;
}

.info-box code {
  background: white;
  padding: 0.2rem 0.4rem;
  border-radius: 4px;
  font-family: 'Courier New', monospace;
  color: #764ba2;
}

/* Color controls section */
.color-controls {
  padding: 1rem;
  background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
  border-radius: 8px;
  margin-top: 1rem;
}

.color-controls h4 {
  margin-top: 0;
  margin-bottom: 1rem;
  color: #667eea;
}

.color-picker-group {
  margin-bottom: 1rem;
}

.color-picker-container {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-top: 0.5rem;
}

.color-picker-input {
  width: 80px;
  height: 50px;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.3s;
}

.color-picker-input:hover {
  border-color: #667eea;
}

.color-picker-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.color-hex {
  font-family: 'Courier New', monospace;
  font-weight: 600;
  color: #667eea;
  font-size: 1.1rem;
}

.reset-color-btn {
  padding: 0.5rem 1rem;
  background: #f0f0f0;
  border: 2px solid #e0e0e0;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.3s;
}

.reset-color-btn:hover:not(:disabled) {
  background: #e0e0e0;
  border-color: #667eea;
}

.reset-color-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.color-hint {
  margin: 1rem 0 0;
  padding: 0.75rem;
  background: rgba(255, 255, 255, 0.5);
  border-left: 4px solid #667eea;
  border-radius: 4px;
  font-size: 0.9rem;
  color: #555;
}

/* LoRA section */
.lora-section {
  background: linear-gradient(135deg, #fff5f8 0%, #e9d5ff 100%);
  padding: 1.5rem;
  border-radius: 12px;
  border: 2px solid #764ba2;
}

.lora-section label {
  color: #764ba2;
}

.lora-filter-checkbox {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0.75rem 0;
  padding: 0.5rem;
  background: rgba(255, 255, 255, 0.5);
  border-radius: 6px;
}

.checkbox-label-inline {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-weight: 500;
  font-size: 0.85rem;
  color: #764ba2;
  user-select: none;
}

.checkbox-label-inline input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #764ba2;
}

.lora-count {
  font-size: 0.8rem;
  color: #764ba2;
  font-weight: 600;
  background: rgba(118, 75, 162, 0.1);
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

/* Size section */
.size-section {
  background: linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%);
  padding: 1.5rem;
  border-radius: 12px;
  border: 2px solid #0ea5e9;
}

.size-section label {
  color: #0369a1;
  font-weight: 600;
}

/* Prompt section */
.prompt-section {
  background: linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%);
  padding: 0.5rem;
  border-radius: 8px;
  border: 2px solid #0ea5e9;
}

.prompt-section label {
  color: #0369a1;
  font-weight: 600;
  font-size: 0.8rem;
}

.prompt-section textarea {
  margin-top: 0.25rem;
}



/* Checkbox group */
.checkbox-group {
  padding: 1rem;
  background: rgba(102, 126, 234, 0.05);
  border-radius: 8px;
  border: 2px solid rgba(102, 126, 234, 0.2);
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  cursor: pointer;
  font-weight: 600;
  color: #333;
  user-select: none;
}

.checkbox-label input[type="checkbox"] {
  width: 20px;
  height: 20px;
  cursor: pointer;
  accent-color: #667eea;
}

.checkbox-label input[type="checkbox"]:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.checkbox-group .hint {
  display: block;
  margin-top: 0.5rem;
  margin-left: 2.25rem;
  color: #666;
  font-size: 0.85rem;
  font-style: italic;
}

.sub-checkbox {
  margin-top: 0.75rem;
  margin-left: 2rem;
  padding: 0.75rem;
  background: rgba(102, 126, 234, 0.1);
  border-radius: 6px;
  border-left: 3px solid #667eea;
}

.sub-checkbox .checkbox-label {
  font-size: 0.9rem;
}

.sub-checkbox .hint {
  margin-left: 1.75rem;
  font-size: 0.8rem;
}

/* Upload divider */
.upload-divider {
  text-align: center;
  position: relative;
}

.upload-divider::before,
.upload-divider::after {
  content: '';
  position: absolute;
  top: 50%;
  width: calc(50% - 80px);
  height: 1px;
  background: #e0e0e0;
}

.upload-divider::before {
  left: 0;
}

.upload-divider::after {
  right: 0;
}

.upload-divider span {
  background: white;
  padding: 0 0.5rem;
  color: #999;
  font-size: 0.75rem;
  font-style: italic;
}

select {
  width: 100%;
  padding: 0.4rem;
  border: 2px solid #e0e0e0;
  border-radius: 6px;
  font-size: 0.85rem;
  font-family: inherit;
  background: white;
  cursor: pointer;
  transition: border-color 0.3s;
}

select:focus {
  outline: none;
  border-color: #667eea;
}

select:disabled {
  background: #f5f5f5;
  cursor: not-allowed;
}

/* Upload section */
.upload-section {
  margin-top: 0.25rem;
}

.upload-placeholder {
  padding: 0.5rem;
  text-align: center;
  background: #f9f9f9;
}

/* Image preview compact */
.image-preview {
  position: relative;
  padding: 0.25rem;
  background: #f0f0f0;
}

.image-preview img {
  width: 100%;
  max-height: 80px;
  object-fit: contain;
  border-radius: 4px;
}

.remove-btn {
  position: absolute;
  top: 0.75rem;
  right: 0.75rem;
  background: rgba(255, 0, 0, 0.8);
  color: white;
  border: none;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Strength section */
.strength-section {
  background: #f8f9fa;
  padding: 0.4rem;
  border-radius: 6px;
  margin-top: 0;
}

.strength-section label {
  font-size: 0.75rem;
}

.strength-section label strong {
  color: #667eea;
}

/* Advanced settings collapse */
.advanced-settings {
  margin-top: 0.25rem;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  overflow: hidden;
}

.advanced-settings summary {
  padding: 0.4rem 0.5rem;
  background: #f8f9fa;
  cursor: pointer;
  font-weight: 600;
  font-size: 0.8rem;
  color: #555;
  user-select: none;
}

.advanced-settings summary:hover {
  background: #f0f0f0;
}

.settings-content {
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* Compact button group */
.button-group {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.button-group button {
  flex: 1;
  min-width: auto;
  padding: 0.5rem 1rem;
  font-size: 0.85rem;
}

/* Compact color adjust */
.color-adjust-section {
  padding: 0.75rem;
  background: #fef3c7;
  border-radius: 8px;
}

.color-adjust-section h4 {
  margin: 0 0 0.5rem;
  font-size: 0.9rem;
}

/* Generate button */
.btn-generate-main {
  width: 100%;
  padding: 0.6rem;
  font-size: 0.9rem;
  margin-top: 0.25rem;
}
</style>
