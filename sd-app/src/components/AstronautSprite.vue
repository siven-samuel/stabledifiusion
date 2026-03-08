<template>
  <div v-if="visible" class="astronaut-container" :class="{ 'slide-in': animating }">
    <!-- Sprite animation -->
    <div class="astronaut-sprite" :style="spriteStyle"></div>
    <!-- Speech bubble -->
    <div v-if="showBubble" class="speech-bubble" :class="{ 'bubble-appear': showBubble, 'bubble-clickable': !!currentResourceId }" @click="handleBubbleClick">
      <span v-if="currentWarningType" class="warning-badge" :class="'warning-' + currentWarningType">!</span>
      <img v-if="currentIcon" :src="currentIcon" class="bubble-icon" />
      <span>{{ currentText }}</span>
      <div class="bubble-tail"></div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { assetUrl } from '../utils/assetUrl.js'

const emit = defineEmits(['bubble-clicked'])

// Message priority levels (higher = more important, shown first)
const PRIORITY = {
  RESOURCE_DEFICIT: 100,   // Not enough resources for production
  STORAGE_FULL: 80,        // Overproduction / storage overflow
  BUILDING_COMPLETE: 40,   // Construction finished
  BUILDING_RESUME: 30,     // Building back in operation
  BUILDING_PLACED: 20,     // Building placement
  INFO: 10                 // General info (hello, etc.)
}

const props = defineProps({
  spriteUrl: {
    type: String,
    default: assetUrl('/astronaut-sprite.png')
  },
  // Number of columns in the sprite sheet
  cols: {
    type: Number,
    default: 4
  },
  // Number of rows in the sprite sheet
  rows: {
    type: Number,
    default: 3
  },
  // Frame width in px (display size)
  frameWidth: {
    type: Number,
    default: 120
  },
  // Frame height in px (display size)
  frameHeight: {
    type: Number,
    default: 120
  },
  // Whether the animation is active
  active: {
    type: Boolean,
    default: false
  },
  // Text to show in the speech bubble
  bubbleText: {
    type: String,
    default: 'Hello!'
  },
  // Animation speed in ms per frame
  frameSpeed: {
    type: Number,
    default: 180
  },
  // Crop inset as fraction (0-0.5) — how much to cut from each side of the frame
  cropInset: {
    type: Number,
    default: 0.15
  }
})

const visible = ref(false)
const animating = ref(false)
const showBubble = ref(false)
const currentFrame = ref(0)
const idleShake = ref(false)
const shakeOffsetX = ref(0)
const shakeOffsetY = ref(0)
const currentText = ref(props.bubbleText) // The currently displayed text (can be overridden by showMessage)
const currentIcon = ref(null) // Optional icon (base64 or URL) shown in the bubble
const currentWarningType = ref(null) // 'storage' | 'resources' | null — styled warning badge type
const currentResourceId = ref(null) // Resource ID for click-through to ResourceDisplay
const currentPriority = ref(0) // Priority of currently displayed message
let animationInterval = null
let bubbleTimeout = null
let stopTimeout = null
let shakeInterval = null
let hideTimeout = null

// Message queue — sorted by priority, highest first
const messageQueue = ref([])
let queueProcessTimeout = null

const totalFrames = computed(() => props.cols * props.rows)

// Reading time: 0.12s per character + 0.2s extra per space + 0.4s per sentence-end (. or !)
const calcReadingTime = (text) => {
  const spaces = (text.match(/ /g) || []).length
  const sentenceEnds = (text.match(/[.!]/g) || []).length
  return text.length * 120 + spaces * 200 + sentenceEnds * 400
}

// Duration to show based on bubble text length
const displayDuration = computed(() => {
  return calcReadingTime(currentText.value)
})

// Speed multiplier for sprite animation (faster than prop value)
const animSpeed = computed(() => Math.round(props.frameSpeed * 0.75))

// The visible viewport is smaller than the full frame — we zoom into the center
const viewportWidth = computed(() => props.frameWidth * (1 - props.cropInset * 2))
const viewportHeight = computed(() => props.frameHeight * (1 - props.cropInset * 2))

const spriteStyle = computed(() => {
  const col = currentFrame.value % props.cols
  const row = Math.floor(currentFrame.value / props.cols)
  // Offset into the frame by cropInset to show only the center
  const insetX = props.frameWidth * props.cropInset
  const insetY = props.frameHeight * props.cropInset
  const baseX = col * props.frameWidth + insetX
  const baseY = row * props.frameHeight + insetY
  return {
    width: viewportWidth.value + 'px',
    height: viewportHeight.value + 'px',
    backgroundImage: `url(${props.spriteUrl})`,
    backgroundSize: `${props.frameWidth * props.cols}px ${props.frameHeight * props.rows}px`,
    backgroundPosition: `-${baseX - shakeOffsetX.value}px -${baseY - shakeOffsetY.value}px`,
    backgroundRepeat: 'no-repeat',
    overflow: 'hidden'
  }
})

const startAnimation = () => {
  visible.value = true
  animating.value = true
  currentFrame.value = 0

  // Start sprite frame cycling (randomly skip frame 3 sometimes, 50% chance to skip 2 frames)
  animationInterval = setInterval(() => {
    let next = (currentFrame.value + 1) % totalFrames.value
    if (next === 2 && Math.random() < 0.8) {
      next = (next + 1) % totalFrames.value
      if (Math.random() < 0.2) next = (next + 1) % totalFrames.value
    }
    currentFrame.value = next
  }, animSpeed.value)

  // Show bubble after a short delay
  bubbleTimeout = setTimeout(() => {
    showBubble.value = true
  }, 400)

  // Stop animation after displayDuration, freeze on last frame
  // Wait for slide-in (500ms) + bubble delay (400ms) + reading time
  const totalWait = 500 + 400 + displayDuration.value
  stopTimeout = setTimeout(() => {
    // Stop cycling — freeze on last frame
    if (animationInterval) {
      clearInterval(animationInterval)
      animationInterval = null
    }
    currentFrame.value = totalFrames.value - 1
    // Start idle shake — subtle vibration like sitting in a car
    startIdleShake()
    // Hide everything 5s after animation loop ends
    hideTimeout = setTimeout(() => {
      hide()
    }, 5000)
  }, totalWait)
}

// Subtle idle vibration — shifts the background crop by small random offsets
const startIdleShake = () => {
  idleShake.value = true
  shakeInterval = setInterval(() => {
    shakeOffsetX.value = (Math.random() - 0.5) * 1.5  // ±0.75px
    shakeOffsetY.value = (Math.random() - 0.5) * 0.8  // ±0.4px
  }, 150)
}

const stopIdleShake = () => {
  idleShake.value = false
  if (shakeInterval) {
    clearInterval(shakeInterval)
    shakeInterval = null
  }
  shakeOffsetX.value = 0
  shakeOffsetY.value = 0
}

const stopAnimation = () => {
  if (animationInterval) {
    clearInterval(animationInterval)
    animationInterval = null
  }
  if (bubbleTimeout) {
    clearTimeout(bubbleTimeout)
    bubbleTimeout = null
  }
  if (stopTimeout) {
    clearTimeout(stopTimeout)
    stopTimeout = null
  }
  if (queueProcessTimeout) {
    clearTimeout(queueProcessTimeout)
    queueProcessTimeout = null
  }
  if (hideTimeout) {
    clearTimeout(hideTimeout)
    hideTimeout = null
  }
  stopIdleShake()
  showBubble.value = false
  animating.value = false
  currentFrame.value = 0
  currentPriority.value = 0
  messageQueue.value = []
}

const hide = () => {
  stopAnimation()
  visible.value = false
}

// Show a new message — uses priority queue so important messages are shown first
// icon: optional base64 or URL string for a resource icon
// warningType: 'storage' | 'resources' | null — shows PhaserCanvas-style warning badge
// priority: number — higher = more important (use PRIORITY constants)
// resourceId: optional resource ID for click-through
const showMessage = (text, icon = null, warningType = null, priority = PRIORITY.INFO, resourceId = null) => {
  // If a higher-priority message is currently showing, queue this one
  if (showBubble.value && priority < currentPriority.value) {
    // Add to queue (avoid duplicates by text)
    if (!messageQueue.value.some(m => m.text === text)) {
      messageQueue.value.push({ text, icon, warningType, priority, resourceId })
      messageQueue.value.sort((a, b) => b.priority - a.priority)
    }
    return
  }

  // If same or lower priority is showing, interrupt it
  displayMessage(text, icon, warningType, priority, resourceId)
}

// Actually display a message (bypasses priority check)
const displayMessage = (text, icon, warningType, priority, resourceId) => {
  // Clean up any running animation
  if (animationInterval) { clearInterval(animationInterval); animationInterval = null }
  if (bubbleTimeout) { clearTimeout(bubbleTimeout); bubbleTimeout = null }
  if (stopTimeout) { clearTimeout(stopTimeout); stopTimeout = null }
  if (queueProcessTimeout) { clearTimeout(queueProcessTimeout); queueProcessTimeout = null }
  if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null }
  stopIdleShake()
  showBubble.value = false
  
  // Set new text/icon/warning and restart
  currentText.value = text
  currentIcon.value = icon
  currentWarningType.value = warningType
  currentPriority.value = priority
  currentResourceId.value = resourceId
  currentFrame.value = 0
  visible.value = true
  animating.value = true

  // Start sprite frame cycling (randomly skip frame 3 sometimes, 50% chance to skip 2 frames)
  animationInterval = setInterval(() => {
    let next = (currentFrame.value + 1) % totalFrames.value
    if (next === 3 && Math.random() < 0.75) {
      next = (next + 1) % totalFrames.value
      if (Math.random() < 0.5) next = (next + 1) % totalFrames.value
    }
    currentFrame.value = next
  }, animSpeed.value)

  // Show bubble after a short delay
  bubbleTimeout = setTimeout(() => {
    showBubble.value = true
  }, 300)

  // Stop looping after reading time, freeze on last frame + idle shake
  const totalWait = 300 + calcReadingTime(text)
  stopTimeout = setTimeout(() => {
    if (animationInterval) { clearInterval(animationInterval); animationInterval = null }
    currentFrame.value = totalFrames.value - 1
    startIdleShake()

    // After the message is done, process the queue or hide
    if (messageQueue.value.length > 0) {
      queueProcessTimeout = setTimeout(() => {
        processQueue()
      }, 2000) // 2s pause before showing next queued message
    } else {
      // Hide everything 5s after animation loop ends
      hideTimeout = setTimeout(() => {
        hide()
      }, 5000)
    }
  }, totalWait)
}

// Process the next message from the queue
const processQueue = () => {
  if (messageQueue.value.length === 0) return
  const next = messageQueue.value.shift()
  displayMessage(next.text, next.icon, next.warningType, next.priority, next.resourceId)
}

// Handle click on the speech bubble
const handleBubbleClick = () => {
  if (currentResourceId.value) {
    emit('bubble-clicked', currentResourceId.value)
  }
}

watch(() => props.active, (newVal) => {
  if (newVal) {
    startAnimation()
  } else {
    stopAnimation()
  }
})

onBeforeUnmount(() => {
  stopAnimation()
})

defineExpose({ startAnimation, stopAnimation, hide, showMessage, PRIORITY })
</script>

<style scoped>
.astronaut-container {
  position: fixed;
  left: 16px;
  bottom: 24px;
  z-index: 1000;
  display: flex;
  align-items: flex-end;
  gap: 8px;
  pointer-events: auto;
  opacity: 0;
  transform: translateX(-120px);
  transition: opacity 0.4s ease, transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.astronaut-container.slide-in {
  opacity: 1;
  transform: translateX(0);
}

.astronaut-sprite {
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 180, 255, 0.3), 0 0 40px rgba(0, 120, 255, 0.15);
  border: 2px solid rgba(0, 180, 255, 0.5);
  flex-shrink: 0;
}

/* Speech bubble */
.speech-bubble {
  position: relative;
  background: linear-gradient(135deg, #1a2a3a 0%, #0d1b2a 100%);
  border: 1.5px solid rgba(0, 180, 255, 0.6);
  border-radius: 14px;
  padding: 10px 16px;
  color: #e0f0ff;
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.3px;
  box-shadow: 0 4px 16px rgba(0, 120, 255, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.05);
  max-width: 200px;
  margin-bottom: 30px;
  opacity: 0;
  transform: scale(0.7) translateY(10px);
  transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  white-space: pre-line;
  pointer-events: none;
}

.speech-bubble.bubble-clickable {
  pointer-events: auto;
  cursor: pointer;
  transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), border-color 0.2s;
}

.speech-bubble.bubble-clickable:hover {
  border-color: rgba(0, 220, 255, 1);
  box-shadow: 0 4px 20px rgba(0, 180, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.speech-bubble.bubble-appear {
  opacity: 1;
  transform: scale(1) translateY(0);
}

.warning-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  font-family: 'Arial Black', sans-serif;
  font-weight: bold;
  font-size: 14px;
  color: #ffffff;
  vertical-align: middle;
  margin-right: 5px;
  flex-shrink: 0;
  animation: warning-pulse 0.8s ease-in-out infinite alternate;
}

.warning-storage {
  background: #990000;
  border: 2px solid #ffffff;
}

.warning-resources {
  background: #996600;
  border: 2px solid #ffcc00;
}

@keyframes warning-pulse {
  from { transform: scale(1); }
  to { transform: scale(1.15); }
}

.bubble-icon {
  display: inline;
  width: 18px;
  height: 18px;
  vertical-align: middle;
  margin-right: 4px;
  border-radius: 3px;
}

.bubble-tail {
  position: absolute;
  left: -10px;
  bottom: 14px;
  width: 0;
  height: 0;
  border-top: 8px solid transparent;
  border-bottom: 8px solid transparent;
  border-right: 12px solid rgba(0, 180, 255, 0.6);
}

.bubble-tail::after {
  content: '';
  position: absolute;
  left: 2px;
  top: -7px;
  width: 0;
  height: 0;
  border-top: 7px solid transparent;
  border-bottom: 7px solid transparent;
  border-right: 10px solid #132030;
}
</style>
