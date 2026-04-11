<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

// State
const webgpuStatus = ref(null) // null=checking, object with supported + info
const backendProvider = ref('')
const status = ref('Checking WebGPU support...')
const statusType = ref('info') // info, success, error, warning
const prompt = ref('a cute cat astronaut in space, pixel art, isometric')
const negativePrompt = ref('')
const isLoading = ref(false)
const isGenerating = ref(false)
const loadProgress = ref(0)
const loadStage = ref('')
const generatedImage = ref(null)
const modelLoaded = ref(false)
const numSteps = ref(1)
const generationTime = ref(null)

// img2img state
const mode = ref('txt2img') // 'txt2img' or 'img2img'
const inputImage = ref(null) // data URL for preview
const inputImageEl = ref(null) // HTMLImageElement for pipeline
const strength = ref(0.7)

// Pipeline instance
let pipeline = null

onMounted(async () => {
  const { checkWebGPU } = await import('./utils/webgpuDiffusion.js')
  const result = await checkWebGPU()
  webgpuStatus.value = result

  if (result.supported) {
    if (result.webgpu) {
      status.value = 'WebGPU available! Load a model to start generating.'
      statusType.value = 'success'
    } else {
      status.value = (result.reason || 'WebGPU not available') + ' — WASM backend will be used instead.'
      statusType.value = 'warning'
    }
  } else {
    status.value = result.reason
    statusType.value = 'error'
  }
})

onUnmounted(async () => {
  if (pipeline) {
    await pipeline.dispose()
    pipeline = null
  }
})

const loadModel = async () => {
  isLoading.value = true
  loadProgress.value = 0
  status.value = 'Downloading model files... This may take a few minutes on first load.'
  statusType.value = 'info'
  loadStage.value = 'Starting...'

  try {
    const { StableDiffusionPipeline } = await import('./utils/webgpuDiffusion.js')
    pipeline = new StableDiffusionPipeline()

    await pipeline.load((progress, stage) => {
      loadProgress.value = progress
      const stageNames = ['Tokenizer', 'Text Encoder', 'UNet', 'VAE Decoder', 'VAE Encoder']
      loadStage.value = stageNames[stage] || `Step ${stage + 1}`
      status.value = `Loading ${loadStage.value}... ${Math.round(progress * 100)}%`
    })

    const { getSelectedProvider } = await import('./utils/webgpuDiffusion.js')
    backendProvider.value = getSelectedProvider()
    modelLoaded.value = true
    status.value = `Model loaded (${backendProvider.value.toUpperCase()} backend)! Enter a prompt and click Generate.`
    statusType.value = 'success'
  } catch (e) {
    const msg = e?.message || e?.toString?.() || JSON.stringify(e) || 'Unknown error'
    status.value = `Failed to load model: ${msg}`
    statusType.value = 'error'
    console.error('Model load error:', e)
    console.error('Error stack:', e?.stack)
  } finally {
    isLoading.value = false
  }
}

const generate = async () => {
  if (!pipeline || !prompt.value.trim()) return
  if (mode.value === 'img2img' && !inputImageEl.value) return

  isGenerating.value = true
  generatedImage.value = null
  generationTime.value = null
  status.value = 'Generating image...'
  statusType.value = 'info'

  const startTime = performance.now()

  try {
    let imageDataUrl

    if (mode.value === 'img2img') {
      imageDataUrl = await pipeline.generateImg2Img(prompt.value, inputImageEl.value, {
        numSteps: numSteps.value,
        strength: strength.value,
        width: 512,
        height: 512,
        onStep: (step, total) => {
          status.value = `Denoising step ${step + 1}/${total}...`
        }
      })
    } else {
      imageDataUrl = await pipeline.generate(prompt.value, {
        numSteps: numSteps.value,
        width: 512,
        height: 512,
        onStep: (step, total) => {
          status.value = `Denoising step ${step + 1}/${total}...`
        }
      })
    }

    generatedImage.value = imageDataUrl
    generationTime.value = ((performance.now() - startTime) / 1000).toFixed(1)
    status.value = `Done! Generated in ${generationTime.value}s`
    statusType.value = 'success'
  } catch (e) {
    status.value = `Generation failed: ${e.message}`
    statusType.value = 'error'
    console.error('Generation error:', e)
  } finally {
    isGenerating.value = false
  }
}

const handleImageUpload = (event) => {
  const file = event.target.files?.[0]
  if (!file) return
  loadInputImage(file)
}

const handleDrop = (event) => {
  event.preventDefault()
  const file = event.dataTransfer?.files?.[0]
  if (!file || !file.type.startsWith('image/')) return
  loadInputImage(file)
}

const handleDragOver = (event) => {
  event.preventDefault()
}

const loadInputImage = (file) => {
  const reader = new FileReader()
  reader.onload = (e) => {
    inputImage.value = e.target.result
    const img = new Image()
    img.onload = () => { inputImageEl.value = img }
    img.src = e.target.result
  }
  reader.readAsDataURL(file)
}

const clearInputImage = () => {
  inputImage.value = null
  inputImageEl.value = null
}

const downloadImage = () => {
  if (!generatedImage.value) return
  const link = document.createElement('a')
  link.download = `sd-webgpu-${Date.now()}.png`
  link.href = generatedImage.value
  link.click()
}

const goHome = () => router.push('/')

const clearCache = async () => {
  try {
    const dbs = await indexedDB.databases()
    for (const db of dbs) {
      if (db.name && db.name.includes('webgpu-sd')) {
        indexedDB.deleteDatabase(db.name)
      }
    }
    status.value = 'Model cache cleared. You can reload the model now.'
    statusType.value = 'info'
  } catch (e) {
    status.value = 'Failed to clear cache: ' + (e.message || e)
    statusType.value = 'error'
  }
}
</script>

<template>
  <div class="local-model-page">
    <!-- Header -->
    <div class="header">
      <button class="back-btn" @click="goHome" title="Back to Home">&larr;</button>
      <h1>Local Model <span class="badge">WebGPU</span></h1>
    </div>

    <!-- WebGPU Status -->
    <div class="status-bar" :class="statusType">
      <span class="status-icon">
        <template v-if="statusType === 'success'">&#10003;</template>
        <template v-else-if="statusType === 'error'">&#10007;</template>
        <template v-else-if="statusType === 'warning'">&#9888;</template>
        <template v-else>&#8987;</template>
      </span>
      {{ status }}
    </div>

    <!-- GPU Info -->
    <div v-if="webgpuStatus?.supported && webgpuStatus.adapter" class="gpu-info">
      <span><strong>GPU:</strong> {{ webgpuStatus.adapter.vendor }} {{ webgpuStatus.adapter.description }}</span>
    </div>

    <!-- Main Content -->
    <div class="content">
      <!-- Load Model -->
      <div v-if="!modelLoaded" class="load-section">
        <div class="model-info">
          <h3>SD Turbo (ONNX WebGPU)</h3>
          <p>Single-step Stable Diffusion model optimized for browser inference.</p>
          <p class="note">First load downloads ~2 GB of model files. Subsequent loads use cached data.</p>
          <button class="action-btn secondary clear-cache-btn" @click="clearCache">Clear Model Cache</button>
        </div>

        <button
          class="action-btn load-btn"
          @click="loadModel"
          :disabled="isLoading"
        >
          {{ isLoading ? 'Loading...' : 'Load Model' }}
        </button>

        <div v-if="isLoading" class="progress-container">
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: (loadProgress * 100) + '%' }"></div>
          </div>
          <span class="progress-text">{{ loadStage }} &mdash; {{ Math.round(loadProgress * 100) }}%</span>
        </div>
      </div>

      <!-- Generate Section -->
      <div v-else class="generate-section">
        <!-- Mode Toggle -->
        <div class="mode-toggle">
          <button
            :class="['mode-btn', { active: mode === 'txt2img' }]"
            @click="mode = 'txt2img'"
            :disabled="isGenerating"
          >Text to Image</button>
          <button
            :class="['mode-btn', { active: mode === 'img2img' }]"
            @click="mode = 'img2img'"
            :disabled="isGenerating"
          >Image to Image</button>
        </div>

        <!-- Image Upload (img2img only) -->
        <div v-if="mode === 'img2img'" class="input-group">
          <label>Input Image</label>
          <div
            v-if="!inputImage"
            class="drop-zone"
            @drop="handleDrop"
            @dragover="handleDragOver"
            @click="$refs.fileInput.click()"
          >
            <span class="drop-icon">&#128247;</span>
            <p>Drop an image here or click to upload</p>
            <p class="note">Will be resized to 512 &times; 512</p>
          </div>
          <div v-else class="image-preview-container">
            <img :src="inputImage" alt="Input image" class="image-preview" />
            <button class="remove-image-btn" @click="clearInputImage" title="Remove image">&times;</button>
          </div>
          <input
            ref="fileInput"
            type="file"
            accept="image/*"
            style="display: none;"
            @change="handleImageUpload"
          />
        </div>

        <div class="input-group">
          <label>Prompt</label>
          <textarea
            v-model="prompt"
            rows="3"
            placeholder="Describe the image you want to generate..."
            :disabled="isGenerating"
          ></textarea>
        </div>

        <div class="settings-row">
          <div class="setting">
            <label>Steps</label>
            <select v-model.number="numSteps" :disabled="isGenerating">
              <option :value="1">1 (Fastest)</option>
              <option :value="2">2</option>
              <option :value="4">4 (Best Quality)</option>
            </select>
          </div>
          <div v-if="mode === 'img2img'" class="setting">
            <label>Strength: {{ strength.toFixed(2) }}</label>
            <input
              type="range"
              v-model.number="strength"
              min="0.1"
              max="1.0"
              step="0.05"
              :disabled="isGenerating"
              class="strength-slider"
            />
          </div>
          <div class="setting">
            <label>Size</label>
            <span class="fixed-value">512 &times; 512</span>
          </div>
        </div>

        <button
          class="action-btn generate-btn"
          @click="generate"
          :disabled="isGenerating || !prompt.trim() || (mode === 'img2img' && !inputImage)"
        >
          {{ isGenerating ? 'Generating...' : 'Generate' }}
        </button>
      </div>

      <!-- Result -->
      <div v-if="generatedImage" class="result-section">
        <div class="image-container">
          <img :src="generatedImage" alt="Generated image" />
        </div>
        <div class="result-actions">
          <button class="action-btn secondary" @click="downloadImage">Download</button>
          <span v-if="generationTime" class="gen-time">{{ generationTime }}s</span>
        </div>
      </div>

      <!-- Placeholder when generating -->
      <div v-else-if="isGenerating" class="result-placeholder">
        <div class="spinner"></div>
        <p>Running inference on GPU...</p>
      </div>
    </div>

    <!-- Info Box -->
    <div class="info-box">
      <strong>Requirements:</strong>
      <ul>
        <li>Chrome 113+ or Edge 113+ with WebGPU enabled</li>
        <li>GPU with at least 4 GB VRAM recommended</li>
        <li>First load downloads models (~2 GB), cached afterwards</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.local-model-page {
  min-height: 100vh;
  background: linear-gradient(135deg, #0f0c29 0%, #1a1a3e 50%, #16213e 100%);
  color: #e0e0e0;
  padding: 1.5rem 2rem;
  overflow-y: auto;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}

.header h1 {
  margin: 0;
  font-size: 1.8rem;
  color: #fff;
}

.badge {
  font-size: 0.7rem;
  background: linear-gradient(135deg, #76b852, #3aafa9);
  color: #fff;
  padding: 3px 10px;
  border-radius: 12px;
  vertical-align: middle;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.back-btn {
  background: rgba(255,255,255,0.1);
  border: 1px solid rgba(255,255,255,0.2);
  color: #fff;
  font-size: 1.4rem;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}
.back-btn:hover {
  background: rgba(255,255,255,0.2);
}

/* Status bar */
.status-bar {
  padding: 0.6rem 1rem;
  border-radius: 8px;
  margin-bottom: 1rem;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.status-bar.info { background: rgba(33,150,243,0.15); border: 1px solid rgba(33,150,243,0.3); }
.status-bar.success { background: rgba(76,175,80,0.15); border: 1px solid rgba(76,175,80,0.3); }
.status-bar.error { background: rgba(244,67,54,0.15); border: 1px solid rgba(244,67,54,0.3); color: #ef9a9a; }
.status-bar.warning { background: rgba(255,152,0,0.15); border: 1px solid rgba(255,152,0,0.3); }

.status-icon {
  font-size: 1.1rem;
}

.gpu-info {
  font-size: 0.8rem;
  color: rgba(255,255,255,0.5);
  margin-bottom: 1rem;
  padding: 0.4rem 0.8rem;
  background: rgba(255,255,255,0.05);
  border-radius: 6px;
}

/* Content */
.content {
  display: flex;
}

/* Load section */
.load-section {
  margin-bottom: 2rem;
}

.model-info h3 {
  margin: 0 0 0.4rem;
  color: #fff;
  font-size: 1.2rem;
}
.model-info p {
  margin: 0 0 0.3rem;
  color: rgba(255,255,255,0.6);
  font-size: 0.9rem;
}
.model-info .note {
  color: rgba(255,193,7,0.8);
  font-size: 0.8rem;
}

/* Action buttons */
.action-btn {
  padding: 0.7rem 2rem;
  border: none;
  border-radius: 10px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  margin-top: 1rem;
}

.load-btn {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
}
.load-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(102,126,234,0.4);
}

.generate-btn {
  background: linear-gradient(135deg, #4caf50, #2e7d32);
  color: #fff;
  width: 100%;
  padding: 0.9rem;
  font-size: 1.1rem;
}
.generate-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(76,175,80,0.4);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.action-btn.secondary {
  background: rgba(255,255,255,0.1);
  border: 1px solid rgba(255,255,255,0.2);
  color: #fff;
}
.action-btn.secondary:hover {
  background: rgba(255,255,255,0.2);
}

/* Progress */
.progress-container {
  margin-top: 1rem;
}

.progress-bar {
  width: 100%;
  height: 8px;
  background: rgba(255,255,255,0.1);
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #667eea, #764ba2);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 0.8rem;
  color: rgba(255,255,255,0.5);
  margin-top: 0.3rem;
  display: block;
}

/* Generate section */
.generate-section {
  margin-bottom: 1.5rem;
}

.input-group {
  margin-bottom: 1rem;
}

.input-group label {
  display: block;
  font-size: 0.85rem;
  color: rgba(255,255,255,0.7);
  margin-bottom: 0.3rem;
  font-weight: 600;
}

.input-group textarea {
  width: 100%;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 8px;
  color: #fff;
  padding: 0.7rem;
  font-size: 0.95rem;
  font-family: inherit;
  resize: vertical;
  outline: none;
  transition: border-color 0.2s;
  box-sizing: border-box;
}
.input-group textarea:focus {
  border-color: rgba(102,126,234,0.6);
}

.settings-row {
  display: flex;
  gap: 1.5rem;
  margin-bottom: 1rem;
}

.setting {
  flex: 1;
}

.setting label {
  display: block;
  font-size: 0.8rem;
  color: rgba(255,255,255,0.6);
  margin-bottom: 0.3rem;
}

.setting select {
  width: 100%;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 6px;
  color: #fff;
  padding: 0.5rem;
  font-size: 0.9rem;
  outline: none;
}

.fixed-value {
  display: block;
  padding: 0.5rem;
  color: rgba(255,255,255,0.5);
  font-size: 0.9rem;
}

/* Result */
.result-section {
  margin-top: 1.5rem;
}

.image-container {
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.1);
  background: rgba(0,0,0,0.3);
}

.image-container img {
  width: 100%;
  display: block;
}

.result-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-top: 0.8rem;
}

.gen-time {
  font-size: 0.85rem;
  color: rgba(255,255,255,0.4);
}

/* Placeholder spinner */
.result-placeholder {
  text-align: center;
  padding: 3rem 0;
  color: rgba(255,255,255,0.5);
}

.spinner {
  width: 48px;
  height: 48px;
  border: 4px solid rgba(255,255,255,0.1);
  border-top: 4px solid #667eea;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 1rem;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Info box */
.info-box {
  margin-top: 2rem;
  padding: 1rem;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  font-size: 0.8rem;
  color: rgba(255,255,255,0.4);
  max-width: 640px;
}

.info-box strong {
  color: rgba(255,255,255,0.6);
}

.info-box ul {
  margin: 0.4rem 0 0;
  padding-left: 1.3rem;
}

.info-box li {
  margin-bottom: 0.2rem;
}

/* Mode toggle */
.mode-toggle {
  display: flex;
  gap: 0;
  margin-bottom: 1rem;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.15);
}

.mode-btn {
  flex: 1;
  padding: 0.6rem 1rem;
  background: rgba(255,255,255,0.05);
  border: none;
  color: rgba(255,255,255,0.5);
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.mode-btn.active {
  background: rgba(102,126,234,0.3);
  color: #fff;
}

.mode-btn:hover:not(.active):not(:disabled) {
  background: rgba(255,255,255,0.1);
}

.mode-btn:disabled {
  cursor: not-allowed;
}

/* Drop zone */
.drop-zone {
  border: 2px dashed rgba(255,255,255,0.2);
  border-radius: 10px;
  padding: 2rem;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  color: rgba(255,255,255,0.5);
}

.drop-zone:hover {
  border-color: rgba(102,126,234,0.5);
  background: rgba(102,126,234,0.05);
}

.drop-icon {
  font-size: 2rem;
  display: block;
  margin-bottom: 0.5rem;
}

.drop-zone p {
  margin: 0.2rem 0;
  font-size: 0.9rem;
}

.drop-zone .note {
  font-size: 0.75rem;
  color: rgba(255,255,255,0.3);
}

/* Image preview */
.image-preview-container {
  position: relative;
  display: inline-block;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.15);
}

.image-preview {
  max-width: 100%;
  max-height: 200px;
  display: block;
}

.remove-image-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: rgba(0,0,0,0.7);
  color: #fff;
  font-size: 1.2rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  transition: background 0.2s;
}

.remove-image-btn:hover {
  background: rgba(244,67,54,0.8);
}

/* Strength slider */
.strength-slider {
  width: 100%;
  -webkit-appearance: none;
  appearance: none;
  height: 6px;
  border-radius: 3px;
  background: rgba(255,255,255,0.15);
  outline: none;
  margin-top: 0.4rem;
}

.strength-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #667eea;
  cursor: pointer;
}

.strength-slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #667eea;
  cursor: pointer;
  border: none;
}
</style>
