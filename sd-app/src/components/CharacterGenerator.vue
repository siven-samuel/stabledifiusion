<script setup>
import { ref } from 'vue'

const emit = defineEmits(['character-generated'])

const characterPrompt = ref('')
const referenceImage = ref(null)
const referenceImageUrl = ref(null)
const isGenerating = ref(false)
const seed = ref('') // Seed pre reprodukovateľnosť

const handleImageUpload = (event) => {
  const file = event.target.files[0]
  if (file) {
    referenceImage.value = file
    // Vytvor preview URL
    const reader = new FileReader()
    reader.onload = (e) => {
      referenceImageUrl.value = e.target.result
    }
    reader.readAsDataURL(file)
  }
}

const removeImage = () => {
  referenceImage.value = null
  referenceImageUrl.value = null
}

const generateCharacter = async () => {
  if (!characterPrompt.value.trim()) {
    alert('Please enter a character description!')
    return
  }

  isGenerating.value = true
  
  try {
    const formData = new FormData()
    
    // Priprav dáta pre API
    const requestData = {
      prompt: characterPrompt.value,
      negative_prompt: 'blurry, low quality, distorted, ugly, deformed, disfigured, bad anatomy, extra limbs, realistic photo, photorealistic, 3d render, perspective view, complex background',
      model: 'dreamshaper', // Alebo 'realistic', 'majicmix'
      width: 512,
      height: 512
    }
    
    // Pridaj seed ak je zadaný
    if (seed.value && seed.value.trim()) {
      const seedNum = parseInt(seed.value.trim())
      if (!isNaN(seedNum)) {
        requestData.seed = seedNum
      }
    }
    
    // Pridaj seed ak je zadaný
    if (seed.value && seed.value.trim()) {
      const seedNum = parseInt(seed.value.trim())
      if (!isNaN(seedNum)) {
        requestData.seed = seedNum
      }
    }
    
    // Ak je nahraný referenčný obrázok, pridaj ho
    if (referenceImageUrl.value) {
      requestData.reference_image = referenceImageUrl.value
    }

    console.log('🎭 Generovanie characteru s promptom:', characterPrompt.value)
    console.log('   Referenčný obrázok:', referenceImage.value ? 'Áno' : 'Nie')
    
    // Zavolaj backend API
    const response = await fetch('http://localhost:5000/generate-character', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData)
    })
    
    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error || 'Error during generation')
    }
    
    const data = await response.json()
    
    // Transformuj výsledky do formátu pre emisiu
    const characterImages = data.images.map((img, index) => ({
      id: `${Date.now()}-${img.view}`,
      url: img.image,
      view: img.view,
      seed: img.seed,
      prompt: img.prompt
    }))
    
    // Emit event s vygenerovanými obrázkami
    emit('character-generated', {
      images: characterImages,
      prompt: characterPrompt.value,
      baseSeed: data.base_seed,
      model: data.model
    })
    
    console.log('✅ Character vygenerovaný!')
    console.log(`   Model: ${data.model}`)
    console.log(`   Base seed: ${data.base_seed}`)
    console.log(`   Počet views: ${characterImages.length}`)
    
  } catch (error) {
    console.error('❌ Chyba pri generovaní characteru:', error)
    alert(`Error generating character: ${error.message}`)
  } finally {
    isGenerating.value = false
  }
}
</script>

<template>
  <div class="character-generator">
    <h3>🎭 Character Generator</h3>
    
    <!-- Text input pre popis postavy -->
    <div class="form-group">
      <label>Character description (isometric style)</label>
      <textarea
        v-model="characterPrompt"
        placeholder="E.g.: medieval knight, warrior woman, elf archer, orc warrior, mage with staff..."
        rows="4"
        :disabled="isGenerating"
      ></textarea>
      <small class="hint">💡 Tip: Describe the character simply - it will be automatically generated in isometric pixel art style suitable for the game.</small>
    </div>
    
    <!-- Image upload pre referenčný obrázok -->
    <div class="form-group">
      <label>Reference image (optional)</label>
      
      <div v-if="!referenceImageUrl" class="upload-area">
        <input
          type="file"
          accept="image/*"
          @change="handleImageUpload"
          :disabled="isGenerating"
          id="character-image-upload"
        />
        <label for="character-image-upload" class="upload-label">
          📁 Upload image
        </label>
      </div>
      
      <div v-else class="image-preview">
        <img :src="referenceImageUrl" alt="Reference" />
        <button @click="removeImage" class="remove-btn" :disabled="isGenerating">✕</button>
      </div>
    </div>
    
    <!-- Seed -->
    <div class="form-group">
      <label>🎲 Seed (reproducibility)</label>
      <input
        type="text"
        v-model="seed"
        placeholder="Empty = random seed"
        :disabled="isGenerating"
        class="seed-input"
      />
      <small class="hint">Same seed + prompt = same characters in all directions</small>
    </div>
    
    <!-- Tlačidlo generovať -->
    <button 
      @click="generateCharacter" 
      :disabled="isGenerating || !characterPrompt.trim()"
      class="generate-btn"
    >
      <span v-if="!isGenerating">🎨 Generate Character</span>
      <span v-else>⏳ Generating...</span>
    </button>
    
    <!-- Info text -->
    <div class="info-box">
      <p><strong>💡 Info:</strong> A set of 4 isometric character sprites will be generated from different directions (north, south, east, west) in pixel art style for isometric games.</p>
    </div>
  </div>
</template>

<style scoped>
.character-generator {
  padding: 1rem;
}

h3 {
  margin: 0 0 1rem 0;
  color: #667eea;
  font-size: 1.1rem;
}

.form-group {
  margin-bottom: 1rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 600;
  color: #333;
  font-size: 0.85rem;
}

.form-group small.hint {
  display: block;
  margin-top: 0.5rem;
  font-size: 0.75rem;
  color: #666;
  line-height: 1.4;
}

textarea {
  width: 100%;
  padding: 0.75rem;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  font-family: inherit;
  font-size: 0.85rem;
  resize: vertical;
  transition: border-color 0.2s;
}

textarea:focus {
  outline: none;
  border-color: #667eea;
}

textarea:disabled {
  background: #f5f5f5;
  cursor: not-allowed;
}

.seed-input {
  width: 100%;
  padding: 0.75rem;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  font-family: inherit;
  font-size: 0.85rem;
  transition: border-color 0.2s;
}

.seed-input:focus {
  outline: none;
  border-color: #667eea;
}

.seed-input:disabled {
  background: #f5f5f5;
  cursor: not-allowed;
}

.upload-area {
  position: relative;
}

.upload-area input[type="file"] {
  display: none;
}

.upload-label {
  display: block;
  padding: 1rem;
  border: 2px dashed #e0e0e0;
  border-radius: 8px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  background: #fafafa;
  font-size: 0.9rem;
}

.upload-label:hover {
  border-color: #667eea;
  background: rgba(102, 126, 234, 0.05);
}

.image-preview {
  position: relative;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  overflow: hidden;
}

.image-preview img {
  width: 100%;
  height: auto;
  display: block;
}

.remove-btn {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  font-size: 1.2rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.remove-btn:hover {
  background: rgba(255, 0, 0, 0.8);
}

.remove-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.generate-btn {
  width: 100%;
  padding: 1rem;
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

.generate-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
}

.generate-btn:active:not(:disabled) {
  transform: translateY(0);
}

.generate-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}

.info-box {
  margin-top: 1rem;
  padding: 0.75rem;
  background: rgba(102, 126, 234, 0.05);
  border-left: 3px solid #667eea;
  border-radius: 4px;
}

.info-box p {
  margin: 0;
  font-size: 0.8rem;
  color: #555;
  line-height: 1.5;
}

.info-box strong {
  color: #667eea;
}
</style>
