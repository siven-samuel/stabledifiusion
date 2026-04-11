/**
 * WebGPU Stable Diffusion Pipeline
 * Uses @huggingface/transformers for tokenization and model loading
 * Uses onnxruntime-web with WebGPU for inference
 * 
 * Supports SD Turbo (1-4 step generation) for fast in-browser inference.
 */

import { AutoTokenizer } from '@huggingface/transformers'
import * as ort from 'onnxruntime-web/webgpu'

// HuggingFace Hub CDN base
const HF_CDN = 'https://huggingface.co'

// Default model repo - SD Turbo ONNX (FP16, optimized for web)
const DEFAULT_MODEL_REPO = 'schmuell/sd-turbo-ort-web'
const DEFAULT_TOKENIZER_REPO = 'openai/clip-vit-base-patch32'

/**
 * Download a file from HuggingFace Hub with progress tracking
 */
async function downloadModel(repo, filepath, onProgress) {
  const url = `${HF_CDN}/${repo}/resolve/main/${filepath}`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Failed to download ${filepath}: ${response.status} ${response.statusText}`)
  }

  const contentLength = response.headers.get('content-length')
  const total = contentLength ? parseInt(contentLength, 10) : 0
  const reader = response.body.getReader()
  const chunks = []
  let loaded = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    if (onProgress && total > 0) {
      onProgress(loaded / total)
    }
  }

  const buffer = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.length
  }

  return buffer.buffer
}

/**
 * Cache model in IndexedDB for faster subsequent loads
 */
const MODEL_CACHE_DB = 'webgpu-sd-model-cache'
const MODEL_CACHE_STORE = 'models'

async function openCacheDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MODEL_CACHE_DB, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(MODEL_CACHE_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function getCachedModel(key) {
  try {
    const db = await openCacheDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(MODEL_CACHE_STORE, 'readonly')
      const req = tx.objectStore(MODEL_CACHE_STORE).get(key)
      req.onsuccess = () => { db.close(); resolve(req.result || null) }
      req.onerror = () => { db.close(); reject(req.error) }
    })
  } catch {
    return null
  }
}

async function setCachedModel(key, data) {
  try {
    const db = await openCacheDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(MODEL_CACHE_STORE, 'readwrite')
      tx.objectStore(MODEL_CACHE_STORE).put(data, key)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); reject(tx.error) }
    })
  } catch {
    // Cache write failure is non-fatal
  }
}

/**
 * Load an ONNX model with caching and WebGPU/WASM execution
 */
let _selectedProvider = null

async function loadOnnxModel(repo, filepath, onProgress) {
  const cacheKey = `${repo}/${filepath}`

  // Try cache first
  let buffer = await getCachedModel(cacheKey)
  if (buffer) {
    console.log(`[SD] Cache hit: ${filepath}`)
    if (onProgress) onProgress(1)
  } else {
    console.log(`[SD] Downloading: ${filepath}`)
    buffer = await downloadModel(repo, filepath, onProgress)
    await setCachedModel(cacheKey, buffer)
    console.log(`[SD] Downloaded & cached: ${filepath}`)
  }

  // Pick provider on first model load
  if (!_selectedProvider) {
    _selectedProvider = await pickProvider(buffer)
    console.log(`[SD] Selected provider: ${_selectedProvider}`)
  }

  console.log(`[SD] Creating session for ${filepath} with ${_selectedProvider}...`)
  try {
    const session = await ort.InferenceSession.create(buffer, {
      executionProviders: [_selectedProvider],
      graphOptimizationLevel: 'disabled',
    })
    console.log(`[SD] Session created for ${filepath}`)
    return session
  } catch (e) {
    // If webgpu failed for this specific model, try wasm
    if (_selectedProvider === 'webgpu') {
      console.warn(`[SD] WebGPU session failed for ${filepath}, trying wasm:`, e.message)
      _selectedProvider = 'wasm'
      const session = await ort.InferenceSession.create(buffer, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'disabled',
      })
      console.log(`[SD] Session created for ${filepath} with wasm fallback`)
      return session
    }
    throw e
  }
}

async function pickProvider(testBuffer) {
  // Try WebGPU with actual session creation
  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter()
      if (adapter) {
        console.log('[SD] WebGPU adapter found, testing session creation...')
        try {
          const testSession = await ort.InferenceSession.create(testBuffer, {
            executionProviders: ['webgpu'],
            graphOptimizationLevel: 'disabled',
          })
          await testSession.release()
          console.log('[SD] WebGPU session test passed')
          return 'webgpu'
        } catch (e) {
          console.warn('[SD] WebGPU session test failed:', e.message)
        }
      }
    } catch (e) {
      console.warn('[SD] WebGPU adapter request failed:', e)
    }
  }
  console.log('[SD] Using wasm provider')
  return 'wasm'
}

// ─── Float16 conversion ───

const _f32 = new Float32Array(1)
const _u32 = new Uint32Array(_f32.buffer)

function float32ToFloat16(val) {
  _f32[0] = val
  const f = _u32[0]
  const sign = (f >> 16) & 0x8000
  const exp = ((f >> 23) & 0xff) - 127 + 15
  const frac = (f >> 13) & 0x3ff
  if (exp <= 0) return sign // flush to zero for subnormals
  if (exp >= 31) return sign | 0x7c00 // infinity
  return sign | (exp << 10) | frac
}

function float32ArrayToFloat16(f32arr) {
  const u16 = new Uint16Array(f32arr.length)
  for (let i = 0; i < f32arr.length; i++) {
    u16[i] = float32ToFloat16(f32arr[i])
  }
  return u16
}

// ─── SD Turbo Scheduler (EulerDiscrete, trailing spacing) ───

const NUM_TRAIN_TIMESTEPS = 1000
const BETA_START = 0.00085
const BETA_END = 0.012

function computeAlphasCumprod() {
  // scaled_linear beta schedule
  const betas = new Float64Array(NUM_TRAIN_TIMESTEPS)
  const sqrtStart = Math.sqrt(BETA_START)
  const sqrtEnd = Math.sqrt(BETA_END)
  for (let i = 0; i < NUM_TRAIN_TIMESTEPS; i++) {
    const b = sqrtStart + (sqrtEnd - sqrtStart) * i / (NUM_TRAIN_TIMESTEPS - 1)
    betas[i] = b * b
  }

  const alphasCumprod = new Float64Array(NUM_TRAIN_TIMESTEPS)
  alphasCumprod[0] = 1.0 - betas[0]
  for (let i = 1; i < NUM_TRAIN_TIMESTEPS; i++) {
    alphasCumprod[i] = alphasCumprod[i - 1] * (1.0 - betas[i])
  }
  return alphasCumprod
}

const ALPHAS_CUMPROD = computeAlphasCumprod()

function getTimesteps(numSteps) {
  // trailing timestep spacing (as used by SD Turbo)
  const stepRatio = Math.floor(NUM_TRAIN_TIMESTEPS / numSteps)
  const timesteps = []
  for (let i = numSteps; i > 0; i--) {
    timesteps.push(i * stepRatio - 1)
  }
  return timesteps
}

function getSigma(timestep) {
  const alphaProd = ALPHAS_CUMPROD[timestep]
  return Math.sqrt((1 - alphaProd) / alphaProd)
}

function gaussianRandom() {
  const u1 = Math.random()
  const u2 = Math.random()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

function generateLatentNoise(batchSize, channels, height, width) {
  const size = batchSize * channels * height * width
  const noise = new Float32Array(size)
  for (let i = 0; i < size; i++) {
    noise[i] = gaussianRandom()
  }
  return noise
}

function eulerStep(modelOutput, sample, sigma, sigmaNext) {
  // Euler discrete step with epsilon prediction
  // pred_original_sample = sample - sigma * model_output
  // derivative (d) = (sample - pred_original) / sigma = model_output
  // dt = sigma_next - sigma
  // output = sample + d * dt

  const dt = sigmaNext - sigma
  const result = new Float32Array(sample.length)
  for (let i = 0; i < sample.length; i++) {
    result[i] = sample[i] + modelOutput[i] * dt
  }
  return result
}

/**
 * Convert latent tensor to RGB image (post-VAE decode)
 */
function latentsToImage(decodedData, width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  const imageData = ctx.createImageData(width, height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = y * width + x
      const dstIdx = (y * width + x) * 4

      // Decoded latents come as NCHW: [1, 3, H, W]
      // Values typically in [-1, 1], map to [0, 255]
      const r = Math.min(255, Math.max(0, Math.round((decodedData[0 * height * width + srcIdx] / 2 + 0.5) * 255)))
      const g = Math.min(255, Math.max(0, Math.round((decodedData[1 * height * width + srcIdx] / 2 + 0.5) * 255)))
      const b = Math.min(255, Math.max(0, Math.round((decodedData[2 * height * width + srcIdx] / 2 + 0.5) * 255)))

      imageData.data[dstIdx] = r
      imageData.data[dstIdx + 1] = g
      imageData.data[dstIdx + 2] = b
      imageData.data[dstIdx + 3] = 255
    }
  }

  ctx.putImageData(imageData, 0, 0)
  return canvas.toDataURL('image/png')
}

/**
 * Main Stable Diffusion Pipeline
 */
export class StableDiffusionPipeline {
  constructor(options = {}) {
    this.modelRepo = options.modelRepo || DEFAULT_MODEL_REPO
    this.tokenizerRepo = options.tokenizerRepo || DEFAULT_TOKENIZER_REPO
    this.tokenizer = null
    this.textEncoder = null
    this.unet = null
    this.vaeDecoder = null
    this.vaeEncoder = null
    this.loaded = false
  }

  async load(onProgress) {
    const totalModels = 4
    let completedModels = 0

    const reportProgress = (modelProgress) => {
      const overall = (completedModels + modelProgress) / totalModels
      if (onProgress) onProgress(overall, completedModels)
    }

    // Load tokenizer
    try {
      this.tokenizer = await AutoTokenizer.from_pretrained(this.tokenizerRepo, {
        progress_callback: (p) => {
          if (p.progress !== undefined) reportProgress(p.progress / 100)
        }
      })
    } catch (e) {
      console.warn('AutoTokenizer failed, will use basic tokenization:', e)
      this.tokenizer = null
    }
    completedModels = 1
    reportProgress(0)

    // Load text encoder ONNX
    this.textEncoder = await loadOnnxModel(
      this.modelRepo,
      'text_encoder/model.onnx',
      (p) => reportProgress(p)
    )
    completedModels = 2
    reportProgress(0)

    // Log text encoder inputs/outputs for debugging
    console.log('[SD] Text encoder inputs:', this.textEncoder.inputNames)
    console.log('[SD] Text encoder outputs:', this.textEncoder.outputNames)

    // Load UNet ONNX
    this.unet = await loadOnnxModel(
      this.modelRepo,
      'unet/model.onnx',
      (p) => reportProgress(p)
    )
    completedModels = 2.5
    reportProgress(0)

    console.log('[SD] UNet inputs:', this.unet.inputNames)
    console.log('[SD] UNet outputs:', this.unet.outputNames)

    // Load VAE decoder ONNX
    this.vaeDecoder = await loadOnnxModel(
      this.modelRepo,
      'vae_decoder/model.onnx',
      (p) => reportProgress(p)
    )
    completedModels = 3
    reportProgress(0)

    console.log('[SD] VAE decoder inputs:', this.vaeDecoder.inputNames)
    console.log('[SD] VAE decoder outputs:', this.vaeDecoder.outputNames)

    // Load VAE encoder ONNX (for img2img)
    this.vaeEncoder = await loadOnnxModel(
      this.modelRepo,
      'vae_encoder/model.onnx',
      (p) => reportProgress(p)
    )
    completedModels = 4
    if (onProgress) onProgress(1, 4)

    console.log('[SD] VAE encoder inputs:', this.vaeEncoder.inputNames)
    console.log('[SD] VAE encoder outputs:', this.vaeEncoder.outputNames)

    this.loaded = true
  }

  async generate(prompt, options = {}) {
    if (!this.loaded) throw new Error('Pipeline not loaded. Call load() first.')

    const {
      numSteps = 1,
      width = 512,
      height = 512,
      onStep = null,
    } = options

    const latentHeight = height / 8
    const latentWidth = width / 8
    const latentChannels = 4

    // 1. Tokenize
    let inputIds
    if (this.tokenizer) {
      const encoded = await this.tokenizer(prompt, {
        padding: 'max_length',
        max_length: 77,
        truncation: true,
      })
      let raw = encoded.input_ids
      if (raw && raw.data) raw = raw.data
      if (raw && raw.flat) raw = raw.flat()
      const arr = new Int32Array(77)
      for (let i = 0; i < 77 && i < raw.length; i++) {
        arr[i] = Number(raw[i])
      }
      inputIds = arr
      console.log('[SD] Token IDs (first 10):', Array.from(inputIds.slice(0, 10)))
    } else {
      inputIds = new Int32Array(77).fill(49407)
      inputIds[0] = 49406
      console.warn('[SD] Using fallback tokenizer')
    }

    // 2. Text encoder
    const textInputTensor = new ort.Tensor('int32', inputIds, [1, 77])
    const textOutput = await this.textEncoder.run({ input_ids: textInputTensor })
    const textEmbeddings = Object.values(textOutput)[0]
    console.log('[SD] Text embeddings shape:', textEmbeddings.dims, 'dtype:', textEmbeddings.type)

    // 3. Generate initial noise
    let latents = generateLatentNoise(1, latentChannels, latentHeight, latentWidth)

    // 4. Compute timesteps and sigmas
    const timesteps = getTimesteps(numSteps)
    const sigmas = timesteps.map(t => getSigma(t))
    sigmas.push(0) // final sigma = 0

    console.log('[SD] Timesteps:', timesteps, 'Sigmas:', sigmas)

    // 5. Scale initial latents by first sigma
    // model input = sample / sqrt(sigma^2 + 1)  (scaled model input)
    const initSigma = sigmas[0]
    for (let i = 0; i < latents.length; i++) {
      latents[i] *= initSigma
    }

    // 6. Denoising loop
    for (let step = 0; step < numSteps; step++) {
      if (onStep) onStep(step, numSteps)

      const sigma = sigmas[step]
      const sigmaNext = sigmas[step + 1]
      const timestep = timesteps[step]

      // Scale model input: sample / sqrt(sigma^2 + 1)
      const scaleFactor = 1.0 / Math.sqrt(sigma * sigma + 1)
      const scaledLatents = new Float32Array(latents.length)
      for (let i = 0; i < latents.length; i++) {
        scaledLatents[i] = latents[i] * scaleFactor
      }

      const latentTensor = new ort.Tensor('float32', scaledLatents, [1, latentChannels, latentHeight, latentWidth])
      const timestepTensor = new ort.Tensor('int64', new BigInt64Array([BigInt(timestep)]), [1])

      console.log(`[SD] Step ${step + 1}/${numSteps}: timestep=${timestep}, sigma=${sigma.toFixed(4)}, sigmaNext=${sigmaNext.toFixed(4)}`)

      const unetOutput = await this.unet.run({
        sample: latentTensor,
        timestep: timestepTensor,
        encoder_hidden_states: textEmbeddings,
      })
      const noisePred = Object.values(unetOutput)[0].data

      // Euler step
      latents = eulerStep(noisePred, latents, sigma, sigmaNext)
    }

    // 7. VAE decode — scale latents by 1/0.18215
    const scaledLatents = new Float32Array(latents.length)
    for (let i = 0; i < latents.length; i++) {
      scaledLatents[i] = latents[i] / 0.18215
    }

    const latentTensor = new ort.Tensor('float32', scaledLatents, [1, latentChannels, latentHeight, latentWidth])
    const decoded = await this.vaeDecoder.run({ latent_sample: latentTensor })
    const decodedData = Object.values(decoded)[0].data

    console.log('[SD] Decoded output shape:', Object.values(decoded)[0].dims)
    console.log('[SD] Decoded values range:', Math.min(...decodedData.slice(0, 100)), 'to', Math.max(...decodedData.slice(0, 100)))

    // 8. Convert to image
    return latentsToImage(decodedData, width, height)
  }

  /**
   * Encode an image (HTMLImageElement, HTMLCanvasElement, or ImageBitmap) to latent space
   */
  async encodeImage(imageSource, width = 512, height = 512) {
    // Draw to canvas at target size
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(imageSource, 0, 0, width, height)
    const imageData = ctx.getImageData(0, 0, width, height)
    const pixels = imageData.data

    // Convert RGBA HWC [0,255] to RGB NCHW [-1,1]
    const size = width * height
    const input = new Float32Array(1 * 3 * height * width)
    for (let i = 0; i < size; i++) {
      const r = pixels[i * 4] / 255.0 * 2 - 1
      const g = pixels[i * 4 + 1] / 255.0 * 2 - 1
      const b = pixels[i * 4 + 2] / 255.0 * 2 - 1
      input[0 * size + i] = r
      input[1 * size + i] = g
      input[2 * size + i] = b
    }

    // VAE encoder expects float16
    const inputF16 = float32ArrayToFloat16(input)
    const inputTensor = new ort.Tensor('float16', inputF16, [1, 3, height, width])
    const result = await this.vaeEncoder.run({ sample: inputTensor })
    const latentDist = Object.values(result)[0]

    console.log('[SD] VAE encoder output shape:', latentDist.dims, 'dtype:', latentDist.type)

    // VAE encoder outputs mean (and logvar concatenated in channel dim)
    // latent_dist shape is [1, 8, H/8, W/8] — first 4 channels = mean, last 4 = logvar
    const latentH = height / 8
    const latentW = width / 8
    let latentData = latentDist.data
    // Convert float16 output to float32 if needed
    if (latentDist.type === 'float16') {
      const f32 = new Float32Array(latentData.length)
      const dv = new DataView(latentData.buffer, latentData.byteOffset, latentData.byteLength)
      for (let i = 0; i < latentData.length; i++) {
        const h = dv.getUint16(i * 2, true)
        const sign = (h >> 15) & 1
        const exp = (h >> 10) & 0x1f
        const frac = h & 0x3ff
        if (exp === 0) {
          f32[i] = (sign ? -1 : 1) * (frac / 1024) * Math.pow(2, -14)
        } else if (exp === 31) {
          f32[i] = frac === 0 ? (sign ? -Infinity : Infinity) : NaN
        } else {
          f32[i] = (sign ? -1 : 1) * Math.pow(2, exp - 15) * (1 + frac / 1024)
        }
      }
      latentData = f32
    }
    const mean = new Float32Array(1 * 4 * latentH * latentW)
    const planeSize = latentH * latentW

    for (let c = 0; c < 4; c++) {
      for (let i = 0; i < planeSize; i++) {
        mean[c * planeSize + i] = latentData[c * planeSize + i]
      }
    }

    // Scale by VAE scaling factor
    for (let i = 0; i < mean.length; i++) {
      mean[i] *= 0.18215
    }

    return mean
  }

  /**
   * Image-to-image generation
   * @param {string} prompt - Text prompt
   * @param {HTMLImageElement|HTMLCanvasElement} inputImage - Source image
   * @param {object} options - Generation options including strength (0-1)
   */
  async generateImg2Img(prompt, inputImage, options = {}) {
    if (!this.loaded) throw new Error('Pipeline not loaded. Call load() first.')

    const {
      numSteps = 2,
      strength = 0.7,
      width = 512,
      height = 512,
      onStep = null,
    } = options

    const latentHeight = height / 8
    const latentWidth = width / 8
    const latentChannels = 4

    // 1. Encode input image to latent space
    console.log('[SD img2img] Encoding input image...')
    const imageLatents = await this.encodeImage(inputImage, width, height)

    // 2. Tokenize
    let inputIds
    if (this.tokenizer) {
      const encoded = await this.tokenizer(prompt, {
        padding: 'max_length',
        max_length: 77,
        truncation: true,
      })
      let raw = encoded.input_ids
      if (raw && raw.data) raw = raw.data
      if (raw && raw.flat) raw = raw.flat()
      const arr = new Int32Array(77)
      for (let i = 0; i < 77 && i < raw.length; i++) {
        arr[i] = Number(raw[i])
      }
      inputIds = arr
    } else {
      inputIds = new Int32Array(77).fill(49407)
      inputIds[0] = 49406
    }

    // 3. Text encoder
    const textInputTensor = new ort.Tensor('int32', inputIds, [1, 77])
    const textOutput = await this.textEncoder.run({ input_ids: textInputTensor })
    const textEmbeddings = Object.values(textOutput)[0]

    // 4. Compute timesteps based on strength
    // For img2img, strength controls the noise level / starting timestep
    // strength=1.0 → max noise (like txt2img), strength=0.1 → minimal change
    // We pick a starting timestep proportional to strength, then denoise from there
    const maxTimestep = NUM_TRAIN_TIMESTEPS - 1
    const startTimestep = Math.max(1, Math.round(maxTimestep * strength))

    // Build timestep schedule from startTimestep down to near 0
    const stepSize = Math.max(1, Math.floor(startTimestep / numSteps))
    const timesteps = []
    for (let i = 0; i < numSteps; i++) {
      const t = startTimestep - i * stepSize
      if (t > 0) timesteps.push(t)
    }
    const actualSteps = timesteps.length

    if (actualSteps === 0) {
      // strength too low, just decode the image latents back
      const scaledLatents = new Float32Array(imageLatents.length)
      for (let i = 0; i < imageLatents.length; i++) {
        scaledLatents[i] = imageLatents[i] / 0.18215
      }
      const latentTensor = new ort.Tensor('float32', scaledLatents, [1, latentChannels, latentHeight, latentWidth])
      const decoded = await this.vaeDecoder.run({ latent_sample: latentTensor })
      return latentsToImage(Object.values(decoded)[0].data, width, height)
    }

    // 5. Compute sigmas for the schedule
    const sigmas = timesteps.map(t => getSigma(t))
    sigmas.push(0) // denoise to zero

    console.log('[SD img2img] startTimestep:', startTimestep, 'Timesteps:', timesteps, 'Sigmas:', sigmas, 'Strength:', strength)

    // 6. Add noise to image latents based on first sigma (noise schedule)
    const initSigma = sigmas[0]
    const noise = generateLatentNoise(1, latentChannels, latentHeight, latentWidth)
    const latents = new Float32Array(imageLatents.length)
    for (let i = 0; i < latents.length; i++) {
      // latent = image_latent + sigma * noise
      latents[i] = imageLatents[i] + initSigma * noise[i]
    }

    // 7. Denoising loop (same as txt2img)
    let currentLatents = latents
    for (let step = 0; step < actualSteps; step++) {
      if (onStep) onStep(step, actualSteps)

      const sigma = sigmas[step]
      const sigmaNext = sigmas[step + 1]
      const timestep = timesteps[step]

      const scaleFactor = 1.0 / Math.sqrt(sigma * sigma + 1)
      const scaledLatents = new Float32Array(currentLatents.length)
      for (let i = 0; i < currentLatents.length; i++) {
        scaledLatents[i] = currentLatents[i] * scaleFactor
      }

      const latentTensor = new ort.Tensor('float32', scaledLatents, [1, latentChannels, latentHeight, latentWidth])
      const timestepTensor = new ort.Tensor('int64', new BigInt64Array([BigInt(timestep)]), [1])

      console.log(`[SD img2img] Step ${step + 1}/${actualSteps}: timestep=${timestep}, sigma=${sigma.toFixed(4)}, sigmaNext=${sigmaNext.toFixed(4)}`)

      const unetOutput = await this.unet.run({
        sample: latentTensor,
        timestep: timestepTensor,
        encoder_hidden_states: textEmbeddings,
      })
      const noisePred = Object.values(unetOutput)[0].data

      currentLatents = eulerStep(noisePred, currentLatents, sigma, sigmaNext)
    }

    // 8. VAE decode
    const finalScaled = new Float32Array(currentLatents.length)
    for (let i = 0; i < currentLatents.length; i++) {
      finalScaled[i] = currentLatents[i] / 0.18215
    }

    const latentTensor = new ort.Tensor('float32', finalScaled, [1, latentChannels, latentHeight, latentWidth])
    const decoded = await this.vaeDecoder.run({ latent_sample: latentTensor })
    const decodedData = Object.values(decoded)[0].data

    console.log('[SD img2img] Done!')
    return latentsToImage(decodedData, width, height)
  }

  async dispose() {
    if (this.textEncoder) await this.textEncoder.release()
    if (this.unet) await this.unet.release()
    if (this.vaeDecoder) await this.vaeDecoder.release()
    if (this.vaeEncoder) await this.vaeEncoder.release()
    this.loaded = false
  }
}

/**
 * Check WebGPU availability and return adapter info
 */
export async function checkWebGPU() {
  if (!navigator.gpu) {
    return { supported: true, webgpu: false, reason: 'WebGPU not available — will use WASM backend (slower)' }
  }

  try {
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) {
      return { supported: true, webgpu: false, reason: 'No WebGPU adapter — will use WASM backend (slower)' }
    }

    const info = await adapter.requestAdapterInfo?.() || {}
    return {
      supported: true,
      webgpu: true,
      adapter: {
        vendor: info.vendor || 'Unknown',
        architecture: info.architecture || 'Unknown',
        device: info.device || 'Unknown',
        description: info.description || 'Unknown',
      }
    }
  } catch (e) {
    return { supported: true, webgpu: false, reason: `WebGPU check failed: ${e.message} — will use WASM backend` }
  }
}

/**
 * Get which execution provider was selected after model load
 */
export function getSelectedProvider() {
  return _selectedProvider || 'not loaded'
}
