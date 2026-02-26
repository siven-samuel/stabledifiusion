<template>
  <div v-if="visible" class="astronaut-container" :class="{ 'slide-in': animating }">
    <!-- Sprite animation -->
    <div class="astronaut-sprite" :style="spriteStyle"></div>
    <!-- Speech bubble -->
    <div v-if="showBubble" class="speech-bubble" :class="{ 'bubble-appear': showBubble }">
      <span>{{ bubbleText }}</span>
      <div class="bubble-tail"></div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'

const props = defineProps({
  spriteUrl: {
    type: String,
    default: '/astronaut-sprite.png'
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
  }
})

const visible = ref(false)
const animating = ref(false)
const showBubble = ref(false)
const currentFrame = ref(0)
const idleShake = ref(false) // Whether the idle shake (car vibration) is active
const shakeOffsetX = ref(0)
const shakeOffsetY = ref(0)
let animationInterval = null
let bubbleTimeout = null
let stopTimeout = null
let shakeInterval = null

const totalFrames = computed(() => props.cols * props.rows)

// Duration to show based on bubble text length: 0.2s per character
const displayDuration = computed(() => {
  return props.bubbleText.length * 200
})

const spriteStyle = computed(() => {
  const col = currentFrame.value % props.cols
  const row = Math.floor(currentFrame.value / props.cols)
  const baseX = col * props.frameWidth
  const baseY = row * props.frameHeight
  return {
    width: props.frameWidth + 'px',
    height: props.frameHeight + 'px',
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

  // Start sprite frame cycling
  animationInterval = setInterval(() => {
    currentFrame.value = (currentFrame.value + 1) % totalFrames.value
  }, props.frameSpeed)

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
  }, totalWait)
}

// Subtle idle vibration — shifts the background crop by small random offsets
const startIdleShake = () => {
  idleShake.value = true
  shakeInterval = setInterval(() => {
    shakeOffsetX.value = (Math.random() - 0.5) * 1.2  // ±0.6px
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
  stopIdleShake()
  showBubble.value = false
  animating.value = false
  currentFrame.value = 0
}

const hide = () => {
  stopAnimation()
  visible.value = false
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

defineExpose({ startAnimation, stopAnimation, hide })
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
  pointer-events: none;
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
}

.speech-bubble.bubble-appear {
  opacity: 1;
  transform: scale(1) translateY(0);
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
