<script setup>
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import Phaser from 'phaser'
import { PersonManager } from '../utils/personManager.js'
import { CarManager } from '../utils/carManager.js'
import { loadPersonGifFrames } from '../utils/gifFrameExtractor.js'
import { startBuildingAnimation, startRecycleAnimation } from '../utils/buildingAnimationService.js'
import { findNearestCar, dispatchCarToBuilding } from '../utils/carDispatchService.js'

const BASE_URL = import.meta.env.BASE_URL

const props = defineProps({
  images: Array,
  selectedImageId: String,
  lastImageCellsX: {
    type: Number,
    default: 1
  },
  lastImageCellsY: {
    type: Number,
    default: 1
  },
  templateSelected: {
    type: Boolean,
    default: false
  },
  showNumbering: {
    type: Boolean,
    default: true
  },
  showGallery: {
    type: Boolean,
    default: true
  },
  showGrid: {
    type: Boolean,
    default: true
  },
  deleteMode: {
    type: Boolean,
    default: false
  },
  roadBuildingMode: {
    type: Boolean,
    default: false
  },
  roadDeleteMode: {
    type: Boolean,
    default: false
  },
  recycleMode: {
    type: Boolean,
    default: false
  },
  roadTiles: {
    type: Array,
    default: () => []
  },
  personSpawnEnabled: {
    type: Boolean,
    default: false
  },
  personSpawnCount: {
    type: Number,
    default: 0
  },
  carSpawnEnabled: {
    type: Boolean,
    default: false
  },
  carSpawnCount: {
    type: Number,
    default: 0
  },
  isSettingDestination: {
    type: Boolean,
    default: false
  },
  destinationTiles: {
    type: Array,
    default: () => []
  },
  selectedBuildingDestinationTiles: {
    type: Array,
    default: () => []
  },
  selectedBuildingCanBuildOnlyInDestination: {
    type: Boolean,
    default: false
  },
  alwaysShowEffects: {
    type: Boolean,
    default: false
  },
  showPerson: {
    type: Boolean,
    default: true
  },
  isFullscreen: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['cell-selected', 'image-placed', 'toggle-numbering', 'toggle-gallery', 'toggle-grid', 'toggle-person', 'road-placed', 'building-clicked', 'destination-tile-clicked', 'building-deleted', 'building-state-changed', 'building-construction-complete', 'building-recycled'])

const gameContainer = ref(null)
let game = null
let mainScene = null

// Computed pre CSS triedu kurzora
const cursorClass = computed(() => {
  if (props.isSettingDestination) return 'destination-mode'
  if (props.recycleMode) return 'recycle-mode'
  if (props.roadDeleteMode || props.deleteMode) return 'delete-mode'
  if (props.roadBuildingMode) return 'road-mode'
  if (props.selectedImageId) return 'has-selection'
  return ''
})

// Dáta pre uložené obrázky
let cellImages = {}
let backgroundTiles = []

// Grid parametre
const GRID_SIZE = 50
const TILE_WIDTH = 64
const TILE_HEIGHT = 32

// Hlavná Phaser scéna
class IsoScene extends Phaser.Scene {
  constructor() {
    super({ key: 'IsoScene' })
    this.hoveredCell = { row: -1, col: -1 }
    this.selectedCell = { row: -1, col: -1 }
    this.gridGraphics = null
    this.hoverGraphics = null
    this.selectedGraphics = null
    this.buildingSprites = {}
    this.shadowSprites = {}
    this.batchLoading = false
    this.tileSprites = []
    this.tileMasks = []
    this.numberTexts = []
    this.isDragging = false
    this.lastPointer = { x: 0, y: 0 }
    this.cameraOffset = { x: 0, y: 0 }
    this.backgroundTileKey = null
    this.groundRenderTexture = null
    this.groundMask = null
    this.groundMaskGraphics = null
    this.hoverPreviewSprite = null // Preview budovy pri hoveri
    this.flyAwayEffects = {} // Mapa fly-away efektov pre budovy
    
    // Road building mode
    this.roadStartCell = null // Začiatočný bod cesty
    this.roadPath = [] // Aktuálna cesta (pole bunk)
    this.roadPathGraphics = null // Grafika pre preview cesty
    
    // Destination tiles graphics
    this.selectedBuildingDestinationGraphics = null // Grafika pre destination tiles vybranej budovy
    
    // PersonManager pre správu postáv
    this.personManager = null
    
    // CarManager pre správu áut
    this.carManager = null
    
    // Fronta pre sekvenčné spracovanie car dispatchov
    this.carDispatchQueue = []
    this.isProcessingCarDispatch = false
    
    // Aktívne stavebné animácie: { 'row-col': animationControl }
    this.activeAnimations = {}
    
    // Hover highlight tracking (keď nie je vybraná žiadna budova)
    this.highlightedBuildingKey = null // Kľúč aktuálne zvýraznenej budovy
    this.highlightedBuildingSprites = [] // Sprite-y s aplikovaným tintom
    
    // Mapa disabled overlay efektov pre manuálne zastavené budovy
    this.disabledOverlays = {}
    
    // Custom structure sprite URLs
    this.constructSpriteUrl = BASE_URL + 'templates/cubes1/contruct.png'
    this.tempBuildingSpriteUrl = BASE_URL + 'templates/cubes1/0.png'
    
    // Night overlay
    this.nightOverlay = null
    this.nightTween = null
    
    // Building detail highlight
    this.buildingHighlightGraphics = null
  }

  preload() {
    // Vytvoríme placeholder textúru pre tiene
    this.createShadowTexture()
    
    // Person GIF sa načíta asynchrónne v create() cez gifFrameExtractor
    
    // Načítame sprite auta
    this.load.image('car1', BASE_URL + 'templates/roads/sprites/car-dawn-top-right.png')
    this.load.image('car2', BASE_URL + 'templates/roads/sprites/car-down-top-left.png')
    
    // Načítame smoke textúru pre efekt dymu
    this.load.image('smoke', 'https://labs.phaser.io/assets/particles/white-smoke.png')
    
    // Načítame construct.png pre stavebné animácie
    this.load.image('construct', BASE_URL + 'templates/cubes1/contruct.png')
  }

  create() {
    mainScene = this
    
    // Nastavenie kamery
    this.cameras.main.setBackgroundColor(0x000000)
    this.cameras.main.centerOn(0, GRID_SIZE * TILE_HEIGHT / 2)
    
    // Vytvoríme kontajnery pre vrstvy
    this.groundContainer = this.add.container(0, 0)
    this.groundContainer.setDepth(0)
    
    // RenderTexture pre tiene - všetky tiene sa nakreslia sem ako jedna vrstva
    // Toto zabezpečí že sa tiene neprekrývajú (majú vždy rovnakú farbu)
    this.shadowRenderTexture = this.add.renderTexture(0, 0, 4000, 4000)
    this.shadowRenderTexture.setOrigin(0.5, 0.5)
    this.shadowRenderTexture.setPosition(0, GRID_SIZE * TILE_HEIGHT / 2)
    this.shadowRenderTexture.setAlpha(0.25) // Celková priehľadnosť tieňa
    this.shadowRenderTexture.setDepth(0.7) // O trochu väčší depth ako road tiles (0.5) - nad cestami, pod budovami
    
    this.buildingContainer = this.add.container(0, 0)
    this.buildingContainer.setDepth(2)
    
    this.uiContainer = this.add.container(0, 0)
    this.uiContainer.setDepth(9999999) // Najvyšší z-index pre UI elementy (číslovanie, hover, selection)
    
    // Graphics pre destination tiles overlay
    this.destinationTilesGraphics = null
    
    // Nakreslíme mriežku
    this.drawGrid()
    
    // Input handling
    this.input.on('pointermove', this.handlePointerMove, this)
    this.input.on('pointerdown', this.handlePointerDown, this)
    this.input.on('pointerup', this.handlePointerUp, this)
    this.input.on('wheel', this.handleWheel, this)
    
    // Pravé tlačidlo pre dragging
    this.input.mouse.disableContextMenu()
    
    // Načítame animovaný GIF s postavami - extrahujeme 3. postavu (index 2)
    // a vytvoríme walk animáciu zo všetkých GIF framov
    this.loadPersonGif().then(() => {
      console.log('✅ Person GIF framy načítané, PersonManager pripravený')
    })
    
    // Night overlay - tmavý obdĺžnik cez celú hraciu plochu
    this.nightOverlay = this.add.rectangle(0, GRID_SIZE * TILE_HEIGHT / 2, 8000, 8000, 0x050510)
    this.nightOverlay.setDepth(9999990) // Pod UI ale nad všetkým ostatným
    this.nightOverlay.setAlpha(0)
    this.nightOverlay.setScrollFactor(1)
    this.nightOverlay.setBlendMode(Phaser.BlendModes.MULTIPLY)
    
    // Inicializujeme PersonManager (sprites sa nastavia po načítaní GIF)
    this.personManager = new PersonManager(this, cellImages, {
      personCount: 200,
      TILE_WIDTH,
      TILE_HEIGHT,
      moveDuration: 6000, // Výrazne spomalené pre pomalý realistický pohyb
      initialDelayRange: [0, 4000]
    })
    
    // Inicializujeme CarManager
    this.carManager = new CarManager(this, cellImages, {
      carCount: 200,
      TILE_WIDTH,
      TILE_HEIGHT,
      moveDuration: 2000, // 2x rýchlejšie (pôvodne 4000)
      initialDelayRange: [0, 4000]
    })

    // Refresh Graphics objects after tab regains focus (WebGL context restore)
    this._onVisibilityChange = () => {
      if (!document.hidden && this.scene.isActive()) {
        // Small delay to let WebGL context fully restore
        this.time.delayedCall(300, () => {
          this.refreshWarningIndicators()
        })
      }
    }
    document.addEventListener('visibilitychange', this._onVisibilityChange)

    // Edge scrolling - scroll camera when mouse is near screen edge (only in fullscreen)
    this._edgeScrollMargin = 1
    this._edgeScrollMarginTop = 7
    this._edgeScrollSpeed = 6
    this._edgeScrollDx = 0
    this._edgeScrollDy = 0
    this._edgeScrollTimer = null

    this._onEdgeMouseMove = (e) => {
      if (!props.isFullscreen) {
        this._edgeScrollDx = 0
        this._edgeScrollDy = 0
        return
      }
      const w = window.innerWidth
      const h = window.innerHeight
      const mx = e.clientX
      const my = e.clientY
      const m = this._edgeScrollMargin
      let dx = 0, dy = 0
      if (mx <= m) dx = -1
      else if (mx >= w - m - 1) dx = 1
      if (my <= this._edgeScrollMarginTop) dy = -1
      else if (my >= h - m - 1) dy = 1
      this._edgeScrollDx = dx
      this._edgeScrollDy = dy
    }
    document.addEventListener('mousemove', this._onEdgeMouseMove)

    this._edgeScrollTimer = this.time.addEvent({
      delay: 16,
      loop: true,
      callback: () => {
        if (this.isDragging) return
        const dx = this._edgeScrollDx
        const dy = this._edgeScrollDy
        if (dx !== 0 || dy !== 0) {
          const speed = this._edgeScrollSpeed / this.cameras.main.zoom
          this.cameras.main.scrollX += dx * speed
          this.cameras.main.scrollY += dy * speed
        }
      }
    })
  }

  // Zapne/vypne efekt na celú hraciu plochu
  applyEffect(effectName) {
    // Najprv vypni všetky efekty
    this.clearAllEffects()
    
    if (effectName === 'none') return
    
    switch (effectName) {
      case 'night':
        this.applyNightEffect()
        break
      case 'shake':
        this.applyShakeEffect()
        break
      case 'flash':
        this.applyFlashEffect()
        break
      case 'pulse':
        this.applyPulseEffect()
        break
      case 'fade':
        this.applyFadeEffect()
        break
      case 'bounce':
        this.applyBounceEffect()
        break
      case 'fire':
        this.applyFireEffect()
        break
      case 'smoke':
        this.applySmokeEffect()
        break
    }
  }
  
  clearAllEffects() {
    // Stop night
    if (this.nightTween) { this.nightTween.stop(); this.nightTween = null }
    if (this.nightOverlay) this.nightOverlay.setAlpha(0)
    
    // Restore shadows
    if (this.shadowTween) { this.shadowTween.stop(); this.shadowTween = null }
    if (this.shadowRenderTexture) {
      this.shadowTween = this.tweens.add({
        targets: this.shadowRenderTexture,
        alpha: 0.25,
        duration: 1500,
        ease: 'Sine.easeInOut'
      })
    }
    
    // Stop effect overlay
    if (this.effectTween) { this.effectTween.stop(); this.effectTween = null }
    if (this.effectOverlay) { this.effectOverlay.destroy(); this.effectOverlay = null }
    
    // Stop camera effects
    this.cameras.main.setAlpha(1)
    this.cameras.main.resetFX()
    
    // Stop shake timer
    if (this.shakeTimer) { this.shakeTimer.remove(); this.shakeTimer = null }
    
    // Stop bounce tween
    if (this.bounceTween) { this.bounceTween.stop(); this.bounceTween = null }
    if (this.buildingContainer) this.buildingContainer.setY(0)
  }
  
  applyNightEffect() {
    if (!this.nightOverlay) return
    this.nightOverlay.setBlendMode(Phaser.BlendModes.NORMAL)
    this.nightTween = this.tweens.add({
      targets: this.nightOverlay,
      alpha: 0.5,
      duration: 2000,
      ease: 'Sine.easeInOut'
    })
    
    // Fade out shadows
    if (this.shadowTween) { this.shadowTween.stop(); this.shadowTween = null }
    if (this.shadowRenderTexture) {
      this.shadowTween = this.tweens.add({
        targets: this.shadowRenderTexture,
        alpha: 0,
        duration: 2000,
        ease: 'Sine.easeInOut'
      })
    }
  }
  
  applyShakeEffect() {
    this.cameras.main.shake(500, 0.01)
    this.shakeTimer = this.time.addEvent({
      delay: 3000,
      callback: () => { this.cameras.main.shake(500, 0.01) },
      loop: true
    })
  }
  
  applyFlashEffect() {
    this.effectOverlay = this.add.rectangle(0, GRID_SIZE * TILE_HEIGHT / 2, 8000, 8000, 0xffffff)
    this.effectOverlay.setDepth(9999990)
    this.effectOverlay.setAlpha(0)
    this.effectTween = this.tweens.add({
      targets: this.effectOverlay,
      alpha: 0.6,
      duration: 300,
      yoyo: true,
      repeat: -1,
      repeatDelay: 2000,
      ease: 'Sine.easeInOut'
    })
  }
  
  applyPulseEffect() {
    this.effectOverlay = this.add.rectangle(0, GRID_SIZE * TILE_HEIGHT / 2, 8000, 8000, 0x3333aa)
    this.effectOverlay.setDepth(9999990)
    this.effectOverlay.setAlpha(0)
    this.effectTween = this.tweens.add({
      targets: this.effectOverlay,
      alpha: 0.35,
      duration: 1500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    })
  }
  
  applyFadeEffect() {
    this.effectOverlay = this.add.rectangle(0, GRID_SIZE * TILE_HEIGHT / 2, 8000, 8000, 0x000000)
    this.effectOverlay.setDepth(9999990)
    this.effectOverlay.setAlpha(0)
    this.effectTween = this.tweens.add({
      targets: this.effectOverlay,
      alpha: 0.7,
      duration: 3000,
      ease: 'Sine.easeIn'
    })
  }
  
  applyBounceEffect() {
    if (!this.buildingContainer) return
    this.bounceTween = this.tweens.add({
      targets: this.buildingContainer,
      y: -8,
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    })
  }
  
  applyFireEffect() {
    this.effectOverlay = this.add.rectangle(0, GRID_SIZE * TILE_HEIGHT / 2, 8000, 8000, 0xff4400)
    this.effectOverlay.setDepth(9999990)
    this.effectOverlay.setAlpha(0)
    this.effectTween = this.tweens.add({
      targets: this.effectOverlay,
      alpha: { from: 0.15, to: 0.4 },
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    })
  }
  
  applySmokeEffect() {
    this.effectOverlay = this.add.rectangle(0, GRID_SIZE * TILE_HEIGHT / 2, 8000, 8000, 0x888888)
    this.effectOverlay.setDepth(9999990)
    this.effectOverlay.setAlpha(0)
    this.effectTween = this.tweens.add({
      targets: this.effectOverlay,
      alpha: 0.5,
      duration: 4000,
      ease: 'Sine.easeIn'
    })
  }

  // Zobrazí plávajúci efekt mínus resources pri postavení budovy
  // resources: [{ id, name, icon, amount }]
  showFloatingResourceCost(row, col, resources) {
    if (!resources || resources.length === 0) return

    // Nájdi origin bunku ak je sekundárna
    let key = `${row}-${col}`
    const originCellData = cellImages[key]
    if (originCellData?.isSecondary) {
      row = originCellData.originRow
      col = originCellData.originCol
      key = `${row}-${col}`
    }

    const buildingSprite = this.buildingSprites[key]
    const { x, y } = this.gridToIso(row, col)

    // Offset pre multi-cell budovy
    const cellData = cellImages[key]
    const cellsX = cellData?.cellsX || 1
    const cellsY = cellData?.cellsY || 1
    let offsetX = 0
    let offsetY = 0
    if (cellsX === 1 && cellsY === 2) {
      offsetX = -TILE_WIDTH / 4
      offsetY = TILE_HEIGHT / 2
    } else if (cellsX === 2 && cellsY === 2) {
      offsetY = TILE_HEIGHT
    } else if (cellsX >= 3) {
      offsetY = TILE_HEIGHT * (cellsX - 1)
    }

    // Štartovacia pozícia - nad budovou
    const startX = x + offsetX
    let startY = y + TILE_HEIGHT + offsetY
    if (buildingSprite) {
      startY -= buildingSprite.height * buildingSprite.scaleY + 10
    } else {
      startY -= 60
    }

    // Najprv načítaj ikony ktoré ešte nie sú v cache
    const unloadedIcons = resources.filter(r => r.icon && !this.textures.exists(`float_icon_${r.id}`))
    if (unloadedIcons.length > 0) {
      unloadedIcons.forEach(r => {
        this.load.image(`float_icon_${r.id}`, r.icon)
      })
      this.load.once('complete', () => {
        this._createFloatingItems(startX, startY, resources)
      })
      this.load.start()
    } else {
      this._createFloatingItems(startX, startY, resources)
    }
  }

  // Interná metóda - vytvorí jednotlivé plávajúce položky
  _createFloatingItems(startX, startY, resources) {
    const itemSpacing = 28
    const totalHeight = resources.length * itemSpacing
    const baseY = startY - totalHeight / 2

    resources.forEach((resource, index) => {
      const itemY = baseY + index * itemSpacing
      const delay = index * 150 // Postupné objavovanie

      this.time.delayedCall(delay, () => {
        const elements = []
        const gap = 4 // Medzera medzi prvkami

        // 1) Číslo (červený text) — naľavo
        const amountText = this.add.text(0, itemY, `-${resource.amount}`, {
          fontFamily: 'Arial, sans-serif',
          fontSize: '14px',
          fontStyle: 'bold',
          color: '#ff4444',
          stroke: '#000000',
          strokeThickness: 3
        })
        amountText.setOrigin(0, 0.5)
        amountText.setDepth(9999998)
        amountText.setAlpha(0)
        elements.push(amountText)

        // 2) Ikona resource — v strede
        const iconKey = `float_icon_${resource.id}`
        let iconSprite = null
        let iconWidth = 0
        if (resource.icon && this.textures.exists(iconKey)) {
          iconSprite = this.add.sprite(0, itemY, iconKey)
          iconSprite.setDisplaySize(18, 18)
          iconSprite.setOrigin(0, 0.5)
          iconSprite.setDepth(9999998)
          iconSprite.setAlpha(0)
          elements.push(iconSprite)
          iconWidth = 20
        }

        // 3) Názov resource (biely text) — napravo
        const nameText = this.add.text(0, itemY, resource.name, {
          fontFamily: 'Arial, sans-serif',
          fontSize: '13px',
          fontStyle: 'bold',
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 3
        })
        nameText.setOrigin(0, 0.5)
        nameText.setDepth(9999998)
        nameText.setAlpha(0)
        elements.push(nameText)

        // Centrovanie skupiny okolo startX
        const totalW = amountText.width + gap + iconWidth + (iconWidth > 0 ? gap : 0) + nameText.width
        let curX = startX - totalW / 2

        amountText.setX(curX)
        curX += amountText.width + gap

        if (iconSprite) {
          iconSprite.setX(curX + iconWidth / 2)
          iconSprite.setOrigin(0.5, 0.5)
          curX += iconWidth + gap
        }

        nameText.setX(curX)

        // Animácia: pomalšia – fade in, plávanie hore, fade out
        const floatDistance = 80 + resources.length * 10
        const duration = 3500

        elements.forEach(el => {
          // Fade in
          this.tweens.add({
            targets: el,
            alpha: 1,
            duration: 300,
            ease: 'Power2'
          })

          // Pohyb hore
          this.tweens.add({
            targets: el,
            y: el.y - floatDistance,
            duration: duration,
            ease: 'Sine.easeOut'
          })

          // Fade out — začne po 50% animácie
          this.tweens.add({
            targets: el,
            alpha: 0,
            delay: duration * 0.5,
            duration: duration * 0.5,
            ease: 'Power2',
            onComplete: () => {
              el.destroy()
            }
          })
        })
      })
    })
  }

  createPerson() {
    if (this.personManager) {
      this.personManager.createPersons()
    }
  }

  createPersonsAt(row, col, count) {
    if (this.personManager) {
      this.personManager.createPersonsAtTile(count, row, col)
    }
  }
  
  togglePerson(visible) {
    if (this.personManager) {
      this.personManager.togglePersons(visible)
    }
  }

  createCar() {
    if (this.carManager) {
      this.carManager.createCars()
    }
  }

  createCarsAt(row, col, count) {
    if (this.carManager) {
      this.carManager.createCarsAtTile(count, row, col)
    }
  }
  
  toggleCar(visible) {
    if (this.carManager) {
      this.carManager.toggleCars(visible)
    }
  }

  // Funkcia na vykreslenie destination tiles overlay
  drawDestinationTiles() {
    // Vyčisti staré destination tiles
    if (this.destinationTilesGraphics) {
      this.destinationTilesGraphics.destroy()
      this.destinationTilesGraphics = null
    }
    
    // Ak nie sme v destination mode alebo nemáme žiadne tiles, return
    if (!props.isSettingDestination || !props.destinationTiles || props.destinationTiles.length === 0) {
      return
    }
    
    // Vytvor nové graphics
    this.destinationTilesGraphics = this.add.graphics()
    this.uiContainer.add(this.destinationTilesGraphics)
    
    // Vykresli každý destination tile
    for (const tile of props.destinationTiles) {
      const { x, y } = this.gridToIso(tile.row, tile.col)
      
      // Zelený filled tile
      this.destinationTilesGraphics.fillStyle(0x10b981, 0.6)
      this.destinationTilesGraphics.beginPath()
      this.destinationTilesGraphics.moveTo(x, y)
      this.destinationTilesGraphics.lineTo(x + TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
      this.destinationTilesGraphics.lineTo(x, y + TILE_HEIGHT)
      this.destinationTilesGraphics.lineTo(x - TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
      this.destinationTilesGraphics.closePath()
      this.destinationTilesGraphics.fillPath()
      
      // Tmavá zelená outline
      this.destinationTilesGraphics.lineStyle(3, 0x059669, 1)
      this.destinationTilesGraphics.strokePath()
    }
  }

  // Funkcia na vykreslenie allowed destination tiles pre vybranú budovu
  drawSelectedBuildingDestinationTiles() {
    // Vyčisti staré destination tiles
    if (this.selectedBuildingDestinationGraphics) {
      this.selectedBuildingDestinationGraphics.destroy()
      this.selectedBuildingDestinationGraphics = null
    }
    
    // Ak nie je vybraná budova s destination restriction alebo nemáme žiadne tiles, return
    if (!props.selectedBuildingCanBuildOnlyInDestination || !props.selectedBuildingDestinationTiles || props.selectedBuildingDestinationTiles.length === 0) {
      return
    }
    
    // Vytvor nové graphics
    this.selectedBuildingDestinationGraphics = this.add.graphics()
    this.uiContainer.add(this.selectedBuildingDestinationGraphics)
    
    // Vykresli každý destination tile
    for (const tile of props.selectedBuildingDestinationTiles) {
      const { x, y } = this.gridToIso(tile.row, tile.col)
      
      // Zelený filled tile (trochu priehľadnejší ako destination setting mode)
      this.selectedBuildingDestinationGraphics.fillStyle(0x10b981, 0.4)
      this.selectedBuildingDestinationGraphics.beginPath()
      this.selectedBuildingDestinationGraphics.moveTo(x, y)
      this.selectedBuildingDestinationGraphics.lineTo(x + TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
      this.selectedBuildingDestinationGraphics.lineTo(x, y + TILE_HEIGHT)
      this.selectedBuildingDestinationGraphics.lineTo(x - TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
      this.selectedBuildingDestinationGraphics.closePath()
      this.selectedBuildingDestinationGraphics.fillPath()
      
      // Svetlá zelená outline
      this.selectedBuildingDestinationGraphics.lineStyle(2, 0x10b981, 0.8)
      this.selectedBuildingDestinationGraphics.strokePath()
    }
  }

  // Mapa warning indikátorov pre budovy
  warningIndicators = {}
  
  // Mapa auto-production indikátorov pre budovy
  autoProductionIndicators = {}
  
  // Zoznam work-force alokačných highlightov
  workforceHighlights = []

  // Zobrazí warning indikátor nad budovou
  // type: 'resources' (žltý) alebo 'storage' (červený)
  // missingResources: array objektov s chýbajúcimi surovinami [{name, needed, available}, ...]
  showWarningIndicator(row, col, type = 'resources', missingResources = []) {
    let key = `${row}-${col}`
    console.log(`🚨 showWarningIndicator volaný pre [${row}, ${col}], typ: ${type}`, missingResources)
    
    // Skontroluj či je táto bunka sekundárna a nájdi origin
    const originCellData = cellImages[key]
    if (originCellData?.isSecondary) {
      row = originCellData.originRow
      col = originCellData.originCol
      key = `${row}-${col}`
      console.log(`🔄 Sekundárna bunka - používam origin: [${row}, ${col}]`)
    }
    
    // Ak už existuje indikátor s rovnakým typom a rovnakými resources, preskočíme
    const existing = this.warningIndicators[key]
    if (existing?.type === type && JSON.stringify(existing.missingResources) === JSON.stringify(missingResources)) {
      console.log(`⏭️ Indikátor už existuje s rovnakými údajmi`)
      return
    }
    
    // Odstránime existujúci indikátor
    this.hideWarningIndicator(row, col)
    
    // Nájdeme budovu na danej pozícii
    const buildingSprite = this.buildingSprites[key]
    if (!buildingSprite) {
      console.warn(`⚠️ Budova na pozícii [${row}, ${col}] neexistuje`)
      return
    }
    
    // Získame pozíciu a rozmery budovy
    const { x, y } = this.gridToIso(row, col)
    
    // Získame veľkosť budovy z cellImages
    const cellData = cellImages[key]
    const cellsX = cellData?.cellsX || 1
    const cellsY = cellData?.cellsY || 1
    
    // Vypočítame offset pre multi-cell objekty (rovnaký ako v addBuildingWithShadow)
    let offsetX = 0
    let offsetY = 0
    
    if (cellsX === 1 && cellsY === 2) {
      offsetX = -TILE_WIDTH / 4
      offsetY = TILE_HEIGHT / 2
    } else if (cellsX === 2 && cellsY === 2) {
      offsetY = TILE_HEIGHT
    } else if (cellsX >= 3) {
      offsetY = TILE_HEIGHT * (cellsX - 1)
    }
    
    // Výška indikátora nad budovou
    const indicatorY = y + TILE_HEIGHT + offsetY - buildingSprite.height * buildingSprite.scaleY - 25
    const indicatorX = x + offsetX
    
    console.log(`📍 Pozícia indikátora: x=${indicatorX}, y=${indicatorY}`)
    console.log(`🔍 DEBUG: type='${type}', missingResources=`, missingResources)
    console.log(`🔍 DEBUG: missingResources.length=${missingResources ? missingResources.length : 'undefined'}`)
    
    const elements = []
    
    // Ak máme chýbajúce resources a type je 'resources', zobrazíme ich
    if (type === 'resources' && missingResources && missingResources.length > 0) {
      console.log(`✅ Zobrazujem resource box s ${missingResources.length} položkami`)
      
      // Najprv skontroluj či všetky ikony sú načítané - ak nie, načítaj ich a potom znovu zavolaj showWarningIndicator
      const unloadedIcons = missingResources.filter(r => r.icon && !this.textures.exists(`warning_icon_${r.id}`))
      if (unloadedIcons.length > 0) {
        console.log(`📦 Načítavam ${unloadedIcons.length} ikon pre warning indikátor`)
        unloadedIcons.forEach(r => {
          this.load.image(`warning_icon_${r.id}`, r.icon)
        })
        this.load.once('complete', () => {
          console.log(`✅ Ikony načítané, rekreujem warning indikátor pre [${row}, ${col}]`)
          // Ak medzitým nebol indikátor zrušený, znovu vytvor
          // (hideWarningIndicator mohol byť medzitým volaný)
          this.hideWarningIndicator(row, col)
          this.showWarningIndicator(row, col, type, missingResources)
        })
        this.load.start()
        
        // Zatiaľ zobraz jednoduchý text indikátor (bez ikon)
        // Toto sa nahradí keď sa ikony načítajú
      }
      
      // Vytvoríme semi-transparentný box na pozadí
      const padding = 8
      const itemHeight = 24
      const boxHeight = missingResources.length * itemHeight + padding * 2
      const boxWidth = 140
      
      const bg = this.add.graphics()
      bg.setPosition(indicatorX, indicatorY)
      bg.fillStyle(0x000000, 0.85)
      bg.fillRoundedRect(-boxWidth/2, -boxHeight/2, boxWidth, boxHeight, 6)
      bg.lineStyle(2, 0xffcc00, 1)
      bg.strokeRoundedRect(-boxWidth/2, -boxHeight/2, boxWidth, boxHeight, 6)
      bg.setDepth(9999999)
      elements.push(bg)
      
      // Pre každú chýbajúcu surovinu vytvoríme ikonu + text (všetko synchronne)
      missingResources.forEach((resource, index) => {
        const yOffset = -boxHeight/2 + padding + index * itemHeight + itemHeight/2
        
        // Skús použiť cached ikonu
        const iconKey = `warning_icon_${resource.id}`
        if (resource.icon && this.textures.exists(iconKey)) {
          const iconSprite = this.add.sprite(
            indicatorX - boxWidth/2 + padding + 10,
            indicatorY + yOffset,
            iconKey
          )
          iconSprite.setDisplaySize(16, 16)
          iconSprite.setDepth(9999999)
          elements.push(iconSprite)
          
          let displayName = resource.name
          if (displayName.length > 10) {
            displayName = displayName.substring(0, 8) + '..'
          }
          
          const text = this.add.text(
            indicatorX - boxWidth/2 + padding + 26,
            indicatorY + yOffset,
            displayName,
            {
              fontSize: '11px',
              fontFamily: 'Arial, sans-serif',
              color: '#ffcc00',
              fontStyle: 'bold',
              stroke: '#000000',
              strokeThickness: 2
            }
          )
          text.setOrigin(0, 0.5)
          text.setDepth(9999999)
          elements.push(text)
        } else {
          // Fallback - len text ak nemá ikonu alebo ikona ešte nie je načítaná
          let displayName = resource.name
          if (displayName.length > 12) {
            displayName = displayName.substring(0, 10) + '..'
          }
          
          const text = this.add.text(
            indicatorX,
            indicatorY + yOffset,
            displayName,
            {
              fontSize: '11px',
              fontFamily: 'Arial, sans-serif',
              color: '#ffcc00',
              fontStyle: 'bold',
              stroke: '#000000',
              strokeThickness: 2
            }
          )
          text.setOrigin(0.5, 0.5)
          text.setDepth(9999999)
          elements.push(text)
        }
      })
      
      // Pridáme jemnú pulzujúcu animáciu
      const tween = this.tweens.add({
        targets: elements,
        alpha: { from: 0.8, to: 1 },
        duration: 800,
        ease: 'Sine.easeInOut',
        yoyo: true,
        repeat: -1
      })
      
      // Uložíme referenciu vrátane tweenu
      this.warningIndicators[key] = {
        elements,
        tween,
        type,
        missingResources
      }
      
    } else {
      // Pôvodný výkričník pre storage alebo keď nemáme info o resources
      console.log(`⚠️ Zobrazujem výkričník - dôvod: type='${type}', missingResources.length=${missingResources ? missingResources.length : 'undefined'}`)
      const color = type === 'storage' ? 0xff3333 : 0xffcc00
      const bgColor = type === 'storage' ? 0x990000 : 0x996600
      
      const bg = this.add.graphics()
      bg.setPosition(indicatorX, indicatorY)
      bg.fillStyle(bgColor, 0.9)
      bg.fillCircle(0, 0, 14)
      bg.lineStyle(2, 0xffffff, 1)
      bg.strokeCircle(0, 0, 14)
      bg.setDepth(9999999)
      elements.push(bg)
      
      const exclamation = this.add.text(indicatorX, indicatorY, '!', {
        fontSize: '20px',
        fontFamily: 'Arial Black, sans-serif',
        color: '#ffffff',
        fontStyle: 'bold'
      })
      exclamation.setOrigin(0.5, 0.5)
      exclamation.setDepth(9999999)
      elements.push(exclamation)
      
      // Pridáme pulzujúcu animáciu
      const tween = this.tweens.add({
        targets: elements,
        scaleX: { from: 1, to: 1.2 },
        scaleY: { from: 1, to: 1.2 },
        duration: 500,
        ease: 'Sine.easeInOut',
        yoyo: true,
        repeat: -1
      })
      
      // Uložíme referenciu vrátane tweenu
      this.warningIndicators[key] = {
        elements,
        tween,
        type,
        missingResources
      }
    }
    
    console.log(`✅ Warning indikátor vytvorený a zobrazený na [${row}, ${col}], typ: ${type}`)
  }

  // Skryje warning indikátor
  hideWarningIndicator(row, col) {
    const key = `${row}-${col}`
    
    if (this.warningIndicators[key]) {
      // Zastav tween ak existuje
      if (this.warningIndicators[key].tween) {
        this.warningIndicators[key].tween.stop()
      }
      // Destroy všetky elementy
      if (this.warningIndicators[key].elements) {
        this.warningIndicators[key].elements.forEach(el => {
          if (el && !el.destroyed) el.destroy()
        })
      }
      delete this.warningIndicators[key]
      console.log(`✅ Warning indikátor skrytý na [${row}, ${col}]`)
    }
  }

  // Refresh all warning indicators after WebGL context restore (tab focus regained)
  refreshWarningIndicators() {
    const keys = Object.keys(this.warningIndicators)
    if (keys.length === 0) return
    console.log(`🔄 Refreshing ${keys.length} warning indicators after visibility change`)
    
    // Save current indicator data, destroy old ones, recreate
    const savedIndicators = []
    for (const key of keys) {
      const indicator = this.warningIndicators[key]
      const [row, col] = key.split('-').map(Number)
      savedIndicators.push({
        row, col,
        type: indicator.type,
        missingResources: indicator.missingResources || []
      })
    }
    
    // Destroy all existing indicators
    for (const { row, col } of savedIndicators) {
      this.hideWarningIndicator(row, col)
    }
    
    // Recreate them
    for (const { row, col, type, missingResources } of savedIndicators) {
      this.showWarningIndicator(row, col, type, missingResources)
    }
  }

  // Zobrazí indikátor auto-produkcie nad budovou (zelený krúžok s rotujúcou šípkou)
  showAutoProductionIndicator(row, col) {
    let key = `${row}-${col}`
    console.log(`🔄 showAutoProductionIndicator volaný pre [${row}, ${col}]`)
    
    // Skontroluj či je táto bunka sekundárna a nájdi origin
    const originCellData = cellImages[key]
    if (originCellData?.isSecondary) {
      row = originCellData.originRow
      col = originCellData.originCol
      key = `${row}-${col}`
      console.log(`🔄 Sekundárna bunka - používam origin: [${row}, ${col}]`)
    }
    
    // Ak už existuje, preskočíme
    if (this.autoProductionIndicators[key]) {
      console.log(`⏭️ Auto-production indikátor už existuje`)
      return
    }
    
    // Nájdeme budovu na danej pozícii
    const buildingSprite = this.buildingSprites[key]
    if (!buildingSprite) {
      console.warn(`⚠️ Budova na pozícii [${row}, ${col}] neexistuje`)
      return
    }
    
    // Získame pozíciu a rozmery budovy
    const { x, y } = this.gridToIso(row, col)
    
    // Získame veľkosť budovy z cellImages
    const cellData = cellImages[key]
    const cellsX = cellData?.cellsX || 1
    const cellsY = cellData?.cellsY || 1
    
    // Vypočítame offset pre multi-cell objekty
    let offsetX = 0
    let offsetY = 0
    
    if (cellsX === 1 && cellsY === 2) {
      offsetX = -TILE_WIDTH / 4
      offsetY = TILE_HEIGHT / 2
    } else if (cellsX === 2 && cellsY === 2) {
      offsetY = TILE_HEIGHT
    } else if (cellsX >= 3) {
      offsetY = TILE_HEIGHT * (cellsX - 1)
    }
    
    // Pozícia vľavo hore od budovy (aby neblokoval warning indikátory)
    const indicatorY = y + TILE_HEIGHT + offsetY - buildingSprite.height * buildingSprite.scaleY - 25
    const indicatorX = x + offsetX - 30 // Posun vľavo
    
    console.log(`📍 Pozícia auto-production indikátora: x=${indicatorX}, y=${indicatorY}`)
    
    // Vytvoríme graphics objekty priamo bez kontajnera
    const bg = this.add.graphics()
    bg.setPosition(indicatorX, indicatorY)
    bg.fillStyle(0x10b981, 0.9) // Zelená farba
    bg.fillCircle(0, 0, 14)
    bg.lineStyle(2, 0xffffff, 1)
    bg.strokeCircle(0, 0, 14)
    bg.setDepth(9999999)
    
    // Rotujúca šípka
    const arrow = this.add.graphics()
    arrow.setPosition(indicatorX, indicatorY)
    arrow.lineStyle(2, 0xffffff, 1)
    arrow.fillStyle(0xffffff, 1)
    
    // Nakresli kruhový path pre šípku (ako reload symbol)
    const radius = 7
    arrow.beginPath()
    arrow.arc(0, 0, radius, Phaser.Math.DegToRad(-90), Phaser.Math.DegToRad(180), false)
    arrow.strokePath()
    
    // Šípka na konci
    arrow.fillTriangle(
      -radius * 0.7, -radius * 0.7,
      -radius * 0.7 - 4, -radius * 0.7 - 4,
      -radius * 0.7 + 4, -radius * 0.7
    )
    arrow.setDepth(9999999)
    
    // Pridáme rotačnú animáciu
    this.tweens.add({
      targets: arrow,
      rotation: Phaser.Math.PI2,
      duration: 2000,
      ease: 'Linear',
      repeat: -1
    })
    
    // Pridáme jemné pulzovanie
    this.tweens.add({
      targets: [bg, arrow],
      scaleX: { from: 1, to: 1.1 },
      scaleY: { from: 1, to: 1.1 },
      duration: 1000,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1
    })
    
    // Uložíme referenciu
    this.autoProductionIndicators[key] = {
      bg,
      arrow
    }
    
    // Auto-hide po 3 sekundách
    this.time.delayedCall(3000, () => {
      this.hideAutoProductionIndicator(row, col)
    })
    
    console.log(`✅ Auto-production indikátor vytvorený a zobrazený na [${row}, ${col}]`)
  }

  // Skryje indikátor auto-produkcie
  hideAutoProductionIndicator(row, col) {
    const key = `${row}-${col}`
    
    if (this.autoProductionIndicators[key]) {
      this.autoProductionIndicators[key].bg?.destroy()
      this.autoProductionIndicators[key].arrow?.destroy()
      delete this.autoProductionIndicators[key]
      console.log(`✅ Auto-production indikátor skrytý na [${row}, ${col}]`)
    }
  }

  // Zobrazí ikony work-force alokácií na canvase
  showWorkforceAllocations(positions) {
    // Najprv vyčisti predchádzajúce
    this.hideWorkforceAllocations()
    
    if (!this.workforceHighlights) {
      this.workforceHighlights = []
    }
    
    positions.forEach(pos => {
      let { row, col } = pos
      let key = `${row}-${col}`
      
      // Skontroluj sekundárnu bunku
      const originCellData = cellImages[key]
      if (originCellData?.isSecondary) {
        row = originCellData.originRow
        col = originCellData.originCol
        key = `${row}-${col}`
      }
      
      const buildingSprite = this.buildingSprites[key]
      if (!buildingSprite) return
      
      const { x, y } = this.gridToIso(row, col)
      
      const cellData = cellImages[key]
      const cellsX = cellData?.cellsX || 1
      const cellsY = cellData?.cellsY || 1
      
      let offsetX = 0
      let offsetY = 0
      
      if (cellsX === 1 && cellsY === 2) {
        offsetX = -TILE_WIDTH / 4
        offsetY = TILE_HEIGHT / 2
      } else if (cellsX === 2 && cellsY === 2) {
        offsetY = TILE_HEIGHT
      } else if (cellsX >= 3) {
        offsetY = TILE_HEIGHT * (cellsX - 1)
      }
      
      const iconY = y + TILE_HEIGHT + offsetY - buildingSprite.height * buildingSprite.scaleY - 10
      const iconX = x + offsetX + 30 // Posun vpravo od stredu
      
      // Pozadie ikony
      const bg = this.add.graphics()
      bg.setPosition(iconX, iconY)
      bg.fillStyle(pos.type === 'build' ? 0xf59e0b : 0x3b82f6, 0.9) // žltá pre build, modrá pre production
      bg.fillRoundedRect(-18, -14, 36, 28, 6)
      bg.lineStyle(2, 0xffffff, 1)
      bg.strokeRoundedRect(-18, -14, 36, 28, 6)
      bg.setDepth(9999999)
      
      // Ikona + číslo
      const emoji = pos.type === 'build' ? '🔨' : '⚙️'
      const label = this.add.text(iconX, iconY, `${emoji}${pos.amount}`, {
        fontSize: '12px',
        fontFamily: 'Arial',
        color: '#ffffff',
        fontStyle: 'bold'
      })
      label.setOrigin(0.5, 0.5)
      label.setDepth(9999999)
      
      // Tooltip s názvom budovy
      const tooltip = this.add.text(iconX, iconY - 24, pos.buildingName, {
        fontSize: '10px',
        fontFamily: 'Arial',
        color: '#ffffff',
        backgroundColor: '#000000aa',
        padding: { x: 4, y: 2 }
      })
      tooltip.setOrigin(0.5, 0.5)
      tooltip.setDepth(9999999)
      
      // Pulzovanie
      this.tweens.add({
        targets: [bg, label, tooltip],
        scaleX: { from: 1, to: 1.15 },
        scaleY: { from: 1, to: 1.15 },
        alpha: { from: 1, to: 0.8 },
        duration: 600,
        ease: 'Sine.easeInOut',
        yoyo: true,
        repeat: -1
      })
      
      this.workforceHighlights.push(bg, label, tooltip)
    })
    
    console.log(`👷 Zobrazených ${positions.length} work-force alokácií na canvase`)
  }
  
  // Skryje ikony work-force alokácií
  hideWorkforceAllocations() {
    if (this.workforceHighlights) {
      this.workforceHighlights.forEach(obj => obj?.destroy())
      this.workforceHighlights = []
      console.log('👷 Work-force alokácie skryté z canvasu')
    }
  }

  // Zvýrazní tile pod budovou (pri otvorenom building detail paneli)
  highlightBuildingTile(row, col, cellsX = 1, cellsY = 1) {
    this.clearBuildingHighlight()
    this.buildingHighlightGraphics = this.add.graphics()
    this.uiContainer.add(this.buildingHighlightGraphics)
    
    const cells = this.getAffectedCells(row, col, cellsX, cellsY)
    for (const cell of cells) {
      const { x, y } = this.gridToIso(cell.row, cell.col)
      this.buildingHighlightGraphics.fillStyle(0x667eea, 0.35)
      this.buildingHighlightGraphics.beginPath()
      this.buildingHighlightGraphics.moveTo(x, y)
      this.buildingHighlightGraphics.lineTo(x + TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
      this.buildingHighlightGraphics.lineTo(x, y + TILE_HEIGHT)
      this.buildingHighlightGraphics.lineTo(x - TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
      this.buildingHighlightGraphics.closePath()
      this.buildingHighlightGraphics.fillPath()
      this.buildingHighlightGraphics.lineStyle(2, 0x667eea, 0.8)
      this.buildingHighlightGraphics.strokePath()
    }
  }
  
  clearBuildingHighlight() {
    if (this.buildingHighlightGraphics) {
      this.buildingHighlightGraphics.destroy()
      this.buildingHighlightGraphics = null
    }
  }

  // Zobrazí produkčné efekty (dym/svetlo) len keď je budova v production stave
  showProductionEffects(row, col) {
    let key = `${row}-${col}`
    const originCellData = cellImages[key]
    if (originCellData?.isSecondary) {
      row = originCellData.originRow
      col = originCellData.originCol
      key = `${row}-${col}`
    }

    // Ak už efekty existujú, nič nerob
    if (this.smokeEffects && this.smokeEffects[key]) {
      return
    }

    const cellData = cellImages[key]
    const buildingData = cellData?.buildingData
    if (!cellData || !buildingData) return

    if (!buildingData.hasSmokeEffect && !buildingData.hasLightEffect && !buildingData.hasFlyAwayEffect) return

    const buildingSprite = this.buildingSprites[key]
    if (!buildingSprite) return

    const cellsX = cellData.cellsX || 1
    const cellsY = cellData.cellsY || 1

    const useBottomOrigin = !!buildingData.hasFlyAwayEffect
    const originPoint = useBottomOrigin
      ? buildingSprite.getBottomCenter()
      : buildingSprite.getTopCenter()
    const effectX = originPoint.x
    const effectY = originPoint.y

    if (!this.smokeEffects) {
      this.smokeEffects = {}
    }
    if (!this.smokeEffects[key]) {
      this.smokeEffects[key] = []
    } else if (!Array.isArray(this.smokeEffects[key])) {
      this.smokeEffects[key] = [this.smokeEffects[key]]
    }

    if (buildingData.hasSmokeEffect) {
      const smokeSpeed = buildingData.smokeSpeed || 1
      const smokeScale = buildingData.smokeScale || 1
      const smokeAlpha = buildingData.smokeAlpha !== undefined ? buildingData.smokeAlpha : 0.5
      const smokeTint = buildingData.smokeTint || 1
      const smokeDirection = buildingData.hasFlyAwayEffect ? 'down' : 'up'
      const smokeDepthOffset = buildingData.hasFlyAwayEffect ? -1 : 1
      const smokeParticles = this.createSmokeEffect(
        effectX,
        effectY,
        key,
        smokeSpeed,
        smokeScale,
        smokeAlpha,
        smokeTint,
        row,
        col,
        cellsX,
        cellsY,
        smokeDirection,
        smokeDepthOffset
      )
      if (smokeParticles) {
        this.smokeEffects[key].push(smokeParticles)
        console.log('💨 Production smoke effect zapnutý', key)
      }
    }

    if (buildingData.hasLightEffect) {
      const lightBlinkSpeed = buildingData.lightBlinkSpeed || 1
      const lightColor = buildingData.lightColor || '#ffff00'
      const lightSize = buildingData.lightSize || 1
      const lightEffect = this.createLightEffect(
        effectX,
        effectY,
        key,
        lightBlinkSpeed,
        lightColor,
        lightSize,
        row,
        col,
        cellsX,
        cellsY
      )
      if (lightEffect) {
        this.smokeEffects[key].push(lightEffect)
        console.log('💡 Production light effect zapnutý', key)
      }
    }

    // Fly-away efekt už nie je súčasťou showProductionEffects
    // Spúšťa sa samostatne v addBuildingWithShadow po dokončení stavby
  }

  // Skryje produkčné efekty (dym/svetlo)
  hideProductionEffects(row, col) {
    let key = `${row}-${col}`
    const originCellData = cellImages[key]
    if (originCellData?.isSecondary) {
      row = originCellData.originRow
      col = originCellData.originCol
      key = `${row}-${col}`
    }

    if (this.smokeEffects && this.smokeEffects[key]) {
      const effects = Array.isArray(this.smokeEffects[key])
        ? this.smokeEffects[key]
        : [this.smokeEffects[key]]

      effects.forEach(effect => effect?.destroy())
      delete this.smokeEffects[key]
      console.log('🧹 Production effects vypnuté', key)
    }

    if (this.flyAwayEffects && this.flyAwayEffects[key]) {
      const effect = this.flyAwayEffects[key]
      effect?.tween?.stop()
      if (effect?.sprite && effect?.originalY !== undefined) {
        effect.sprite.y = effect.originalY
      }
      const shadowInfo = this.shadowSprites[key]
      if (shadowInfo) {
        shadowInfo.alpha = 1
        shadowInfo.scaleMultiplier = 1
      }
      delete this.flyAwayEffects[key]
    }
  }

  // Zobrazí disabled overlay nad budovou (tmavý pulzujúci odtieň - brightness)
  showDisabledOverlay(row, col) {
    let key = `${row}-${col}`
    const originCellData = cellImages[key]
    if (originCellData?.isSecondary) {
      row = originCellData.originRow
      col = originCellData.originCol
      key = `${row}-${col}`
    }
    
    // Ak už existuje overlay, preskočíme
    if (this.disabledOverlays[key]) return
    
    const buildingSprite = this.buildingSprites[key]
    if (!buildingSprite) return
    
    // Pulzujúca animácia brightness cez tint (0xffffff = normálne, 0x555555 = tmavé)
    const tweenData = { brightness: 1.0 }
    const tween = this.tweens.add({
      targets: tweenData,
      brightness: { from: 1.0, to: 0.35 },
      duration: 1500,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
      onUpdate: () => {
        const b = Math.floor(tweenData.brightness * 255)
        const tintColor = (b << 16) | (b << 8) | b
        buildingSprite.setTint(tintColor)
      }
    })
    
    this.disabledOverlays[key] = { tween, sprite: buildingSprite }
    console.log(`🌑 Disabled overlay zobrazený pre [${row}, ${col}]`)
  }
  
  // Skryje disabled overlay
  hideDisabledOverlay(row, col) {
    let key = `${row}-${col}`
    const originCellData = cellImages[key]
    if (originCellData?.isSecondary) {
      row = originCellData.originRow
      col = originCellData.originCol
      key = `${row}-${col}`
    }
    
    const overlay = this.disabledOverlays[key]
    if (!overlay) return
    
    // Zastav tween
    overlay.tween?.stop()
    
    // Obnov pôvodný vzhľad
    if (overlay.sprite) {
      overlay.sprite.clearTint()
      overlay.sprite.setAlpha(1)
    }
    
    delete this.disabledOverlays[key]
    console.log(`☀️ Disabled overlay skrytý pre [${row}, ${col}]`)
  }

  // Spustí fly-away efekt podľa row/col (wrapper pre volanie z vonku)
  triggerFlyAwayEffect(row, col) {
    let key = `${row}-${col}`
    const originCellData = cellImages[key]
    if (originCellData?.isSecondary) {
      row = originCellData.originRow
      col = originCellData.originCol
      key = `${row}-${col}`
    }
    const buildingSprite = this.buildingSprites[key]
    if (!buildingSprite) {
      console.warn('⚠️ triggerFlyAwayEffect: buildingSprite nenájdený pre', key)
      return
    }
    // Ak už beží fly-away, zastav ho a resetni pozíciu pred novým spustením
    if (this.flyAwayEffects && this.flyAwayEffects[key]) {
      const effect = this.flyAwayEffects[key]
      effect?.tween?.stop()
      if (effect?.sprite && effect?.originalY !== undefined) {
        effect.sprite.y = effect.originalY
      }
      const shadowInfo = this.shadowSprites[key]
      if (shadowInfo) {
        shadowInfo.alpha = 1
        shadowInfo.scaleMultiplier = 1
        this.redrawAllShadows()
      }
      delete this.flyAwayEffects[key]
    }
    this.startFlyAwayEffect(key, buildingSprite)
  }

  // Spustí fly-away efekt (5s: 2.5s hore, 2.5s späť)
  startFlyAwayEffect(key, buildingSprite) {
    if (this.flyAwayEffects[key]) return

    const camera = this.cameras.main
    const viewHeight = camera.height / camera.zoom
    const travelDistance = viewHeight + buildingSprite.height + 200
    const originalY = buildingSprite.y

    const [row, col] = key.split('-').map(Number)
    const shadowInfo = this.shadowSprites[key]

    const tween = this.tweens.add({
      targets: buildingSprite,
      y: originalY - travelDistance,
      duration: 2500,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: 0,
      onUpdate: () => {
        if (!shadowInfo) return
        const distance = Math.abs(buildingSprite.y - originalY)
        const t = Math.min(1, distance / travelDistance)
        shadowInfo.alpha = 1 - t
        shadowInfo.scaleMultiplier = 1 - t
        this.redrawAllShadows()

        // Posúvaj efekty spolu s budovou (dym/svetlo)
        const effects = this.smokeEffects?.[key]
        if (effects && effects.length) {
          const cellData = cellImages[key]
          const useBottomOrigin = !!cellData?.buildingData?.hasFlyAwayEffect
          const originPoint = useBottomOrigin
            ? buildingSprite.getBottomCenter()
            : buildingSprite.getTopCenter()
          const effectX = originPoint.x
          const effectY = originPoint.y
          const list = Array.isArray(effects) ? effects : [effects]
          list.forEach(effect => {
            if (effect?.setPosition) {
              effect.setPosition(effectX, effectY)
            }
          })
        }
      },
      onComplete: () => {
        if (shadowInfo) {
          shadowInfo.alpha = 1
          shadowInfo.scaleMultiplier = 1
          this.redrawAllShadows()
        }
        
        // Plynule zruš smoke efekty keď skončí fly-away animácia
        if (this.smokeEffects && this.smokeEffects[key]) {
          const effects = Array.isArray(this.smokeEffects[key])
            ? this.smokeEffects[key]
            : [this.smokeEffects[key]]
          
          // Fade out efekt pred zničením
          effects.forEach(effect => {
            if (effect?.setAlpha) {
              this.tweens.add({
                targets: effect,
                alpha: 0,
                duration: 500,
                ease: 'Power2',
                onComplete: () => {
                  effect?.destroy()
                }
              })
            } else {
              effect?.destroy()
            }
          })
          
          // Vymaž referenciu po fade out
          this.time.delayedCall(500, () => {
            delete this.smokeEffects[key]
          })
          console.log('💨 Smoke effect fade-out po fly-away', key)
        }
        
        // Zruš fly-away záznam
        delete this.flyAwayEffects[key]
        console.log('🛫 Fly-away efekt dokončený', key)
      }
    })

    this.flyAwayEffects[key] = { tween, sprite: buildingSprite, originalY }
    console.log('🛫 Fly-away efekt spustený', key)
  }

  createShadowTexture() {
    // Vytvoríme gradient textúru pre tieň
    const graphics = this.make.graphics({ x: 0, y: 0, add: false })
    graphics.fillStyle(0x000000, 0.4)
    graphics.fillRect(0, 0, 128, 64)
    graphics.generateTexture('shadow', 128, 64)
    graphics.destroy()
  }

  /**
   * Načíta animovaný GIF, extrahuje 3. postavu (index 2) = front walk
   * a 2. postavu (index 1) = back walk, vytvorí 2 Phaser walk animácie
   */
  async loadPersonGif() {
    try {
      const gifUrl = this.customPersonSpriteUrl || (BASE_URL + 'templates/roads/sprites/persons-mini-astro.gif')
      // Extrahujeme 3. postavu (index 2) pre front walk (row+, col+ smer)
      const front = await loadPersonGifFrames(
        this,
        gifUrl,
        5,  // 5 postáv vedľa seba v GIF
        2,  // index 2 = 3. postava
        'person_front'
      )
      
      // Extrahujeme 2. postavu (index 1) pre back walk (col-, row- smer)
      const back = await loadPersonGifFrames(
        this,
        gifUrl,
        5,  // 5 postáv vedľa seba v GIF
        1,  // index 1 = 2. postava
        'person_back'
      )
      
      if (front.frameKeys.length === 0 || back.frameKeys.length === 0) {
        console.warn('⚠️ Žiadne framy z GIF, person animácia nebude fungovať')
        return
      }
      
      // Vytvoríme 'person1' textúru pre kompatibilitu s PersonManager
      if (!this.textures.exists('person1')) {
        const firstFrameCanvas = this.textures.get(front.frameKeys[0]).getSourceImage()
        const copyCanvas = document.createElement('canvas')
        copyCanvas.width = firstFrameCanvas.width
        copyCanvas.height = firstFrameCanvas.height
        copyCanvas.getContext('2d').drawImage(firstFrameCanvas, 0, 0)
        this.textures.addCanvas('person1', copyCanvas)
      }
      
      // Vypočítame frameRate z GIF delay (zvýšený pre plynulejšiu animáciu)
      const frameRate = Math.max(4, Math.min(30, Math.round(1000 / front.delay) * 2))
      
      // Vytvoríme front walk animáciu (3. postava) - pre row+ a col+ smery
      if (this.anims.exists('person_walk_front')) this.anims.remove('person_walk_front')
      this.anims.create({
        key: 'person_walk_front',
        frames: front.frameKeys.map(key => ({ key })),
        frameRate: frameRate,
        repeat: -1
      })
      
      // Vytvoríme back walk animáciu (2. postava) - pre col- a row- smery
      if (this.anims.exists('person_walk_back')) this.anims.remove('person_walk_back')
      this.anims.create({
        key: 'person_walk_back',
        frames: back.frameKeys.map(key => ({ key })),
        frameRate: frameRate,
        repeat: -1
      })
      
      // Zachováme aj 'person_walk' ako default (front)
      if (this.anims.exists('person_walk')) this.anims.remove('person_walk')
      this.anims.create({
        key: 'person_walk',
        frames: front.frameKeys.map(key => ({ key })),
        frameRate: frameRate,
        repeat: -1
      })
      
      console.log(`🎭 Person walk animácie: front=${front.frameKeys.length} framov, back=${back.frameKeys.length} framov, ${frameRate} fps`)
      
      // Reštartujeme animácie na existujúcich osobách (sprite aj tieň)
      if (this.personManager && this.personManager.persons) {
        this.personManager.persons.forEach(person => {
          if (person.sprite && person.sprite.active) {
            person.sprite.play('person_walk_front')
          }
          if (person.shadow && person.shadow.active) {
            person.shadow.play('person_walk_front')
          }
        })
      }
      
    } catch (error) {
      console.error('❌ Chyba pri načítaní person GIF:', error)
    }
  }

  // Konverzia grid súradníc na izometrické
  gridToIso(row, col) {
    const x = (col - row) * (TILE_WIDTH / 2)
    const y = (col + row) * (TILE_HEIGHT / 2)
    return { x, y }
  }

  // Konverzia izometrických súradníc na grid
  isoToGrid(x, y) {
    const col = (x / (TILE_WIDTH / 2) + y / (TILE_HEIGHT / 2)) / 2
    const row = (y / (TILE_HEIGHT / 2) - x / (TILE_WIDTH / 2)) / 2
    return { row: Math.floor(row), col: Math.floor(col) }
  }

  drawGrid() {
    // Vyčistíme existujúcu mriežku
    if (this.gridGraphics) {
      this.gridGraphics.destroy()
    }
    this.numberTexts.forEach(t => t.destroy())
    this.numberTexts = []
    
    // Mriežka sa zobrazí len ak:
    // 1. showGrid je true (globálne nastavenie)
    // 2. Je vybraná budova (selectedImageId) alebo aktívny road building mode
    const shouldShowGrid = props.showGrid && (props.selectedImageId || props.roadBuildingMode)
    if (!shouldShowGrid) return
    
    this.gridGraphics = this.add.graphics()
    this.groundContainer.add(this.gridGraphics)
    
    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {
        const { x, y } = this.gridToIso(row, col)
        
        // Farba políčka
        const isEven = (row + col) % 2 === 0
        this.gridGraphics.fillStyle(isEven ? 0xe8e8e8 : 0xf8f8f8, 1)
        
        // Nakreslíme kosoštvorcové políčko
        this.gridGraphics.beginPath()
        this.gridGraphics.moveTo(x, y)
        this.gridGraphics.lineTo(x + TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
        this.gridGraphics.lineTo(x, y + TILE_HEIGHT)
        this.gridGraphics.lineTo(x - TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
        this.gridGraphics.closePath()
        this.gridGraphics.fillPath()
        
        // Okraj
        this.gridGraphics.lineStyle(1, 0x999999, 0.5)
        this.gridGraphics.strokePath()
        
        // Číslovanie
        if (props.showNumbering) {
          const text = this.add.text(x, y + TILE_HEIGHT / 2, `${row},${col}`, {
            fontSize: '10px',
            color: '#ff0000',
            fontStyle: 'bold'
          })
          text.setOrigin(0.5, 0.5)
          text.setDepth(999999) // Najvyšší z-index
          this.uiContainer.add(text)
          this.numberTexts.push(text)
        }
      }
    }
  }

  // Nakreslí grid s textúrou pozadia
  drawGridWithTexture() {
    // Vyčistíme existujúcu mriežku
    if (this.gridGraphics) {
      this.gridGraphics.destroy()
    }
    
    // Vyčistíme čísla
    this.numberTexts.forEach(t => t.destroy())
    this.numberTexts = []
    
    // Skontroluj či máme textúru
    const hasTexture = this.backgroundTileKey && this.textures.exists(this.backgroundTileKey)
    
    // Ak nemáme textúru a grid je vypnutý, skonči
    if (!hasTexture && !props.showGrid) return
    
    // Ak máme textúru ale ešte nie sú vytvorené sprite-y, vytvor ich
    if (hasTexture && (!this.tileSprites || this.tileSprites.length === 0)) {
      // Vyčistíme groundRenderTexture
      if (this.groundRenderTexture) {
        this.groundRenderTexture.destroy()
        this.groundRenderTexture = null
      }
      
      // Vyčistíme masku
      if (this.groundMask) {
        this.groundMask.destroy()
        this.groundMask = null
      }
      if (this.groundMaskGraphics) {
        this.groundMaskGraphics.destroy()
        this.groundMaskGraphics = null
      }
      
      // Veľkosť bloku textúry - použi uloženú hodnotu alebo default 5
      const blockSize = this.backgroundTileSize || 5
      console.log('🎨 drawGridWithTexture: blockSize =', blockSize)
      
      // Získame textúru
      const texture = this.textures.get(this.backgroundTileKey)
      const frame = texture.get()
      
      // Vypočítame aspect ratio textúry (môže byť roztiahnutá perspektívou)
      const textureAspectRatio = frame.width / frame.height
      console.log(`🎨 Textúra aspect ratio: ${textureAspectRatio.toFixed(2)} (${frame.width}x${frame.height})`)
      
      // Vytvoríme samostatné sprite-y pre každý blok (podobne ako road tiles)
      for (let blockRow = 0; blockRow < GRID_SIZE; blockRow += blockSize) {
        for (let blockCol = 0; blockCol < GRID_SIZE; blockCol += blockSize) {
          // Vypočítame stred bloku
          const centerRow = blockRow + Math.floor(blockSize / 2)
          const centerCol = blockCol + Math.floor(blockSize / 2)
          const center = this.gridToIso(centerRow, centerCol)
          
          // Vypočítame rozmery bloku v izometrii
          const blockWidthIso = blockSize * TILE_WIDTH
          const blockHeightIso = blockSize * TILE_HEIGHT
          
          // Vytvoríme sprite pre tento blok
          const tileSprite = this.add.sprite(center.x, center.y, this.backgroundTileKey)
          
          // Zohľadnime aspect ratio textúry pri nastavení veľkosti
          // Ak je textúra roztiahnutá (aspect ratio > 1), rozšírime šírku
          tileSprite.setDisplaySize(blockWidthIso * textureAspectRatio, blockHeightIso)
          tileSprite.setOrigin(0.5, 0.5)
          // Background textúra je najnižšie - pod všetkým
          tileSprite.setDepth(-1)
          
          // Vytvoríme izometrickú diamantovú masku pre tento blok
          const maskGraphics = this.make.graphics({ x: 0, y: 0, add: false })
          maskGraphics.fillStyle(0xffffff)
          
          // Vypočítame body izometrického diamantu pre celý blok
          const halfWidth = (blockWidthIso * textureAspectRatio) / 2
          const halfHeight = blockHeightIso / 2
          
          // Nakreslíme diamant (4 body izometrie)
          maskGraphics.beginPath()
          maskGraphics.moveTo(center.x, center.y - halfHeight) // Horný bod
          maskGraphics.lineTo(center.x + halfWidth, center.y) // Pravý bod
          maskGraphics.lineTo(center.x, center.y + halfHeight) // Dolný bod
          maskGraphics.lineTo(center.x - halfWidth, center.y) // Ľavý bod
          maskGraphics.closePath()
          maskGraphics.fillPath()
          
          // Vytvoríme geometry masku z graphics
          const mask = maskGraphics.createGeometryMask()
          tileSprite.setMask(mask)
          
          // Uložíme masku aby sme ju mohli neskôr vyčistiť
          if (!this.tileMasks) this.tileMasks = []
          this.tileMasks.push(maskGraphics)
          
          // Nepridávame do ground containera - pridávame priamo aby depth fungoval správne
          this.tileSprites.push(tileSprite)
          
          // Uložíme do cellImages ako background tiles
          for (let r = 0; r < blockSize; r++) {
            for (let c = 0; c < blockSize; c++) {
              const row = blockRow + r
              const col = blockCol + c
              if (row < GRID_SIZE && col < GRID_SIZE) {
                const key = `${row}-${col}`
                if (!cellImages[key] || cellImages[key].isBackground) {
                  cellImages[key] = {
                    isBackground: true,
                    cellsX: 1,
                    cellsY: 1,
                    url: this.backgroundTileKey
                  }
                }
              }
            }
          }
        }
      }
    }
    
    // Nakresli čiary a čísla len ak je showGrid zapnuté
    if (props.showGrid) {
      // Pridáme okraje a číslovanie pomocou Graphics
      this.gridGraphics = this.add.graphics()
      this.groundContainer.add(this.gridGraphics)
      
      for (let row = 0; row < GRID_SIZE; row++) {
        for (let col = 0; col < GRID_SIZE; col++) {
          const { x, y } = this.gridToIso(row, col)
          
          // Okraj
          this.gridGraphics.lineStyle(1, 0x666666, 0.3)
          this.gridGraphics.beginPath()
          this.gridGraphics.moveTo(x, y)
          this.gridGraphics.lineTo(x + TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
          this.gridGraphics.lineTo(x, y + TILE_HEIGHT)
          this.gridGraphics.lineTo(x - TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
          this.gridGraphics.closePath()
          this.gridGraphics.strokePath()
          
          // Číslovanie
          if (props.showNumbering) {
            const text = this.add.text(x, y + TILE_HEIGHT / 2, `${row},${col}`, {
              fontSize: '10px',
              color: '#ff0000',
              fontStyle: 'bold'
            })
            text.setOrigin(0.5, 0.5)
            text.setDepth(999999) // Najvyšší z-index
            this.uiContainer.add(text)
            this.numberTexts.push(text)
          }
        }
      }
    }
    
    // Fallback na pôvodné kreslenie bez textúry (len ak showGrid je true)
    if (!hasTexture && props.showGrid) {
      this.drawGrid()
    }
  }

  drawHover() {
    if (this.hoverGraphics) {
      this.hoverGraphics.destroy()
      this.hoverGraphics = null
    }
    
    // Vymažeme starý preview sprite
    if (this.hoverPreviewSprite) {
      this.hoverPreviewSprite.destroy()
      this.hoverPreviewSprite = null
    }
    
    // Vykresli destination tiles ak sme v destination mode
    this.drawDestinationTiles()
    
    // Vykresli destination tiles pre vybraný building (ak má destination restriction)
    this.drawSelectedBuildingDestinationTiles()
    
    // Pre destination mode zobraz zelený hover
    if (props.isSettingDestination && this.hoveredCell.row !== -1) {
      this.hoverGraphics = this.add.graphics()
      this.uiContainer.add(this.hoverGraphics)
      
      const { x, y } = this.gridToIso(this.hoveredCell.row, this.hoveredCell.col)
      
      // Zelený hover pre destination building
      this.hoverGraphics.fillStyle(0x10b981, 0.5)
      this.hoverGraphics.beginPath()
      this.hoverGraphics.moveTo(x, y)
      this.hoverGraphics.lineTo(x + TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
      this.hoverGraphics.lineTo(x, y + TILE_HEIGHT)
      this.hoverGraphics.lineTo(x - TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
      this.hoverGraphics.closePath()
      this.hoverGraphics.fillPath()
      
      this.hoverGraphics.lineStyle(3, 0x10b981, 1)
      this.hoverGraphics.strokePath()
      
      return
    }
    
    // Pre road building mode zobraz hover aj keď ešte nekreslím
    if (props.roadBuildingMode && this.hoveredCell.row !== -1) {
      this.hoverGraphics = this.add.graphics()
      this.uiContainer.add(this.hoverGraphics)
      
      const { x, y } = this.gridToIso(this.hoveredCell.row, this.hoveredCell.col)
      
      // Kontrola či susedí s existujúcou cestou
      const hasSomeRoads = Object.values(cellImages).some(cell => cell.isRoadTile)
      const hasAdjacentRoad = this.hasAdjacentRoad(this.hoveredCell.row, this.hoveredCell.col)
      const canPlaceRoad = !hasSomeRoads || hasAdjacentRoad
      
      // Semi-transparent modrý hover pre road building (červený ak nemožno postaviť)
      const roadColor = canPlaceRoad ? 0x3b82f6 : 0xff0000
      const roadAlpha = canPlaceRoad ? 0.4 : 0.3
      
      this.hoverGraphics.fillStyle(roadColor, roadAlpha)
      this.hoverGraphics.beginPath()
      this.hoverGraphics.moveTo(x, y)
      this.hoverGraphics.lineTo(x + TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
      this.hoverGraphics.lineTo(x, y + TILE_HEIGHT)
      this.hoverGraphics.lineTo(x - TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
      this.hoverGraphics.closePath()
      this.hoverGraphics.fillPath()
      
      this.hoverGraphics.lineStyle(2, roadColor, 0.8)
      this.hoverGraphics.strokePath()
      
      return
    }
    
    // === IDLE HOVER - keď nie je vybraná žiadna budova/template/delete mode ===
    const canInteract = props.templateSelected || props.selectedImageId || props.roadBuildingMode || props.roadDeleteMode || props.isSettingDestination
    
    // Vyčistime predchádzajúci building highlight (tint)
    if (this.highlightedBuildingSprites.length > 0) {
      this.highlightedBuildingSprites.forEach(sprite => {
        if (sprite && sprite.active) sprite.clearTint()
      })
      this.highlightedBuildingSprites = []
      this.highlightedBuildingKey = null
    }
    
    const isSpecialMode = props.recycleMode || props.deleteMode
    
    if ((!canInteract || isSpecialMode) && this.hoveredCell.row !== -1) {
      // Hover na tile pod myškou: biely v idle, oranžový v recycle, červený v delete
      this.hoverGraphics = this.add.graphics()
      this.uiContainer.add(this.hoverGraphics)
      
      const hoverKey = `${this.hoveredCell.row}-${this.hoveredCell.col}`
      const cellData = cellImages[hoverKey]
      
      // Zistime origin key budovy (ak je to sekundárna bunka)
      let originKey = null
      if (cellData) {
        originKey = cellData.isSecondary ? `${cellData.originRow}-${cellData.originCol}` : hoverKey
      }
      
      if (originKey && cellImages[originKey]) {
        // Myška je nad budovou - zvýrazni všetky jej tiles
        const origin = cellImages[originKey]
        const cellsX = origin.cellsX || 1
        const cellsY = origin.cellsY || 1
        const [oRow, oCol] = originKey.split('-').map(Number)
        
        // Farby podľa režimu: recycle=oranžový, delete=červený, idle=biely
        let tileFillColor, tileFillAlpha, tileStrokeColor, tileStrokeAlpha, tintColor
        if (props.recycleMode) {
          tileFillColor = 0xff8800; tileFillAlpha = 0.3
          tileStrokeColor = 0xff8800; tileStrokeAlpha = 0.6
          tintColor = 0xffcc88
        } else if (props.deleteMode) {
          tileFillColor = 0xff0000; tileFillAlpha = 0.3
          tileStrokeColor = 0xff0000; tileStrokeAlpha = 0.6
          tintColor = 0xff8888
        } else {
          tileFillColor = 0xffffff; tileFillAlpha = 0.2
          tileStrokeColor = 0xffffff; tileStrokeAlpha = 0.4
          tintColor = 0xddddff
        }
        
        const affectedCells = this.getAffectedCells(oRow, oCol, cellsX, cellsY)
        for (const cell of affectedCells) {
          const { x, y } = this.gridToIso(cell.row, cell.col)
          this.hoverGraphics.fillStyle(tileFillColor, tileFillAlpha)
          this.hoverGraphics.beginPath()
          this.hoverGraphics.moveTo(x, y)
          this.hoverGraphics.lineTo(x + TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
          this.hoverGraphics.lineTo(x, y + TILE_HEIGHT)
          this.hoverGraphics.lineTo(x - TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
          this.hoverGraphics.closePath()
          this.hoverGraphics.fillPath()
          
          this.hoverGraphics.lineStyle(1, tileStrokeColor, tileStrokeAlpha)
          this.hoverGraphics.strokePath()
        }
        
        // Tintni building sprite
        const buildingSprite = this.buildingSprites[originKey]
        if (buildingSprite && buildingSprite.active) {
          buildingSprite.setTint(tintColor)
          this.highlightedBuildingSprites.push(buildingSprite)
          this.highlightedBuildingKey = originKey
        }
      } else if (!isSpecialMode) {
        // Prázdny tile - jemný biely highlight (len v idle, nie v recycle/delete mode)
        const { x, y } = this.gridToIso(this.hoveredCell.row, this.hoveredCell.col)
        this.hoverGraphics.fillStyle(0xffffff, 0.12)
        this.hoverGraphics.beginPath()
        this.hoverGraphics.moveTo(x, y)
        this.hoverGraphics.lineTo(x + TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
        this.hoverGraphics.lineTo(x, y + TILE_HEIGHT)
        this.hoverGraphics.lineTo(x - TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
        this.hoverGraphics.closePath()
        this.hoverGraphics.fillPath()
        
        this.hoverGraphics.lineStyle(1, 0xffffff, 0.25)
        this.hoverGraphics.strokePath()
      }
      
      return
    }
    
    if (!canInteract || this.hoveredCell.row === -1) return
    
    this.hoverGraphics = this.add.graphics()
    this.uiContainer.add(this.hoverGraphics)
    
    const cellsX = props.lastImageCellsX || 1
    const cellsY = props.lastImageCellsY || 1
    
    // Skontrolujeme kolíziu
    const hasCollision = this.checkCollision(this.hoveredCell.row, this.hoveredCell.col, cellsX, cellsY)
    
    // Skontrolujeme či budova susedí s cestou
    const hasSomeRoads = Object.values(cellImages).some(cell => cell.isRoadTile)
    const hasAdjacentToRoad = !hasSomeRoads || this.hasBuildingAdjacentToRoad(this.hoveredCell.row, this.hoveredCell.col, cellsX, cellsY)
    
    // Určíme farbu - červená ak je kolízia alebo ak nesusedí s cestou
    const isInvalid = hasCollision || !hasAdjacentToRoad
    let fillColor = props.deleteMode ? 0xff0000 : (isInvalid ? 0xff0000 : 0x667eea)
    let alpha = props.deleteMode ? 0.5 : (isInvalid ? 0.3 : 0.5)
    
    // Nakreslíme hover pre všetky políčka
    const cells = this.getAffectedCells(this.hoveredCell.row, this.hoveredCell.col, cellsX, cellsY)
    
    for (const cell of cells) {
      const { x, y } = this.gridToIso(cell.row, cell.col)
      
      this.hoverGraphics.fillStyle(fillColor, alpha)
      this.hoverGraphics.beginPath()
      this.hoverGraphics.moveTo(x, y)
      this.hoverGraphics.lineTo(x + TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
      this.hoverGraphics.lineTo(x, y + TILE_HEIGHT)
      this.hoverGraphics.lineTo(x - TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
      this.hoverGraphics.closePath()
      this.hoverGraphics.fillPath()
      
      this.hoverGraphics.lineStyle(3, isInvalid ? 0xff0000 : 0x667eea, 1)
      this.hoverGraphics.strokePath()
    }
    
    // Ak NIE JE kolízia a máme vybraný obrázok, zobrazíme preview budovy
    if (!hasCollision && props.selectedImageId && !props.deleteMode) {
      this.showBuildingPreview(this.hoveredCell.row, this.hoveredCell.col, cellsX, cellsY)
    }
  }

  showBuildingPreview(row, col, cellsX, cellsY) {
    // Nájdeme vybraný obrázok
    const selectedImage = props.images?.find(img => img.id === props.selectedImageId)
    if (!selectedImage) return
    
    // Použijeme URL ako kľúč pre cachovanie textúry
    const previewKey = `preview_${selectedImage.id}`
    
    // Načítame textúru ak ešte nie je načítaná
    if (!this.textures.exists(previewKey)) {
      this.load.image(previewKey, selectedImage.url)
      this.load.once('complete', () => {
        this.createPreviewSprite(previewKey, row, col, cellsX, cellsY)
      })
      this.load.start()
    } else {
      this.createPreviewSprite(previewKey, row, col, cellsX, cellsY)
    }
  }
  
  createPreviewSprite(textureKey, row, col, cellsX, cellsY) {
    // Kontrola či sa hover nezmenil medzitým (asynchrónne načítanie)
    if (this.hoveredCell.row !== row || this.hoveredCell.col !== col) {
      return // Hover sa už zmenil, nechceme vytvoriť starý preview
    }
    
    // Vypočítaj izometrickú pozíciu
    const { x, y } = this.gridToIso(row, col)
    
    // Vyppočítame offset pre multi-cell objekty (rovnaká logika ako v addBuildingWithShadow)
    let offsetX = 0
    let offsetY = 0
    
    if (cellsX === 1 && cellsY === 2) {
      offsetX = -TILE_WIDTH / 4
      offsetY = TILE_HEIGHT / 2
    } else if (cellsX === 2 && cellsY === 2) {
      offsetY = TILE_HEIGHT
    } else if (cellsX >= 3) {
      offsetY = TILE_HEIGHT * (cellsX - 1)
    }
    
    // Vytvoríme sprite
    this.hoverPreviewSprite = this.add.sprite(x + offsetX, y + TILE_HEIGHT + offsetY, textureKey)
    
    // Nastavíme veľkosť
    const targetWidth = TILE_WIDTH * cellsX * 0.95
    const scale = targetWidth / this.hoverPreviewSprite.width
    this.hoverPreviewSprite.setScale(scale)
    this.hoverPreviewSprite.setOrigin(0.5, 1)
    
    // Nastavíme alpha na 0.2 pre preview efekt
    this.hoverPreviewSprite.setAlpha(0.35)
    
    // Vysoký depth aby bol viditeľný
    this.hoverPreviewSprite.setDepth(100000)
    
    // Pridáme do UI kontajnera
    this.uiContainer.add(this.hoverPreviewSprite)
  }

  drawSelected() {
    if (this.selectedGraphics) {
      this.selectedGraphics.destroy()
    }
    
    if (this.selectedCell.row === -1) return
    
    this.selectedGraphics = this.add.graphics()
    this.uiContainer.add(this.selectedGraphics)
    
    const cellsX = props.lastImageCellsX || 1
    const cellsY = props.lastImageCellsY || 1
    const cells = this.getAffectedCells(this.selectedCell.row, this.selectedCell.col, cellsX, cellsY)
    
    for (const cell of cells) {
      const { x, y } = this.gridToIso(cell.row, cell.col)
      
      this.selectedGraphics.fillStyle(0x22c55e, 0.6)
      this.selectedGraphics.beginPath()
      this.selectedGraphics.moveTo(x, y)
      this.selectedGraphics.lineTo(x + TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
      this.selectedGraphics.lineTo(x, y + TILE_HEIGHT)
      this.selectedGraphics.lineTo(x - TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
      this.selectedGraphics.closePath()
      this.selectedGraphics.fillPath()
      
      this.selectedGraphics.lineStyle(4, 0x22c55e, 1)
      this.selectedGraphics.strokePath()
    }
  }

  getAffectedCells(row, col, cellsX, cellsY) {
    const cells = []
    
    if (cellsX === 1 && cellsY === 1) {
      cells.push({ row, col })
    } else if (cellsX === 1 && cellsY === 2) {
      cells.push({ row, col })
      cells.push({ row: row + 1, col })
    } else if (cellsX === 2 && cellsY === 2) {
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 2; c++) {
          cells.push({ row: row + r, col: col + c })
        }
      }
    } else if (cellsX === 3 && cellsY === 3) {
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          cells.push({ row: row + r, col: col + c })
        }
      }
    } else if (cellsX === 4 && cellsY === 4) {
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          cells.push({ row: row + r, col: col + c })
        }
      }
    } else if (cellsX === 5 && cellsY === 5) {
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          cells.push({ row: row + r, col: col + c })
        }
      }
    }
    
    return cells
  }

  checkCollision(row, col, cellsX, cellsY) {
    // Ak má vybraná budova destination restriction, skontroluj či je na povolených tiles
    if (props.selectedBuildingCanBuildOnlyInDestination && props.selectedBuildingDestinationTiles && props.selectedBuildingDestinationTiles.length > 0) {
      // Zisti všetky bunky ktoré by budova zabrala
      const affectedCells = this.getAffectedCells(row, col, cellsX, cellsY)
      
      // Všetky affected cells musia byť v destinationTiles
      const isValidPlacement = affectedCells.every(cell => {
        return props.selectedBuildingDestinationTiles.some(destTile => 
          destTile.row === cell.row && destTile.col === cell.col
        )
      })
      
      // Ak nie je valid placement, vráť true (kolízia)
      if (!isValidPlacement) {
        return true
      }
    }
    
    const newCells = this.getAffectedCells(row, col, cellsX, cellsY)
      .map(c => `${c.row}-${c.col}`)
    
    for (const key in cellImages) {
      const existing = cellImages[key]
      if (existing.isBackground) continue
      
      // Preskočíme sekundárne bunky multi-cell budov
      if (existing.isSecondary) continue
      
      // Políčka s cestou (road tiles) sú vždy blokované na stavanie
      if (existing.isRoadTile) {
        const [existingRow, existingCol] = key.split('-').map(Number)
        const existingCells = this.getAffectedCells(existingRow, existingCol, existing.cellsX || 1, existing.cellsY || 1)
          .map(c => `${c.row}-${c.col}`)
        
        for (const cell of newCells) {
          if (existingCells.includes(cell)) {
            return true // Kolízia - político má cestu
          }
        }
      } else {
        // Normálne obrázky/budovy
        const [existingRow, existingCol] = key.split('-').map(Number)
        const existingCells = this.getAffectedCells(existingRow, existingCol, existing.cellsX || 1, existing.cellsY || 1)
          .map(c => `${c.row}-${c.col}`)
        
        for (const cell of newCells) {
          if (existingCells.includes(cell)) {
            return true
          }
        }
      }
    }
    
    return false
  }
  
  // Kontrola či bunka susedí s existujúcou cestou
  hasAdjacentRoad(row, col) {
    // Kontrola 4 susedných buniek (hore, dole, vľavo, vpravo)
    const adjacentCells = [
      { row: row - 1, col: col }, // hore
      { row: row + 1, col: col }, // dole
      { row: row, col: col - 1 }, // vľavo
      { row: row, col: col + 1 }  // vpravo
    ]
    
    for (const cell of adjacentCells) {
      const key = `${cell.row}-${cell.col}`
      const cellData = cellImages[key]
      if (cellData && cellData.isRoadTile) {
        return true
      }
    }
    
    return false
  }
  
  // Kontrola či akýkoľvek tile budovy (multi-cell) susedí s cestou
  hasBuildingAdjacentToRoad(row, col, cellsX, cellsY) {
    // Zistíme všetky bunky, ktoré budova zaberá
    const affectedCells = this.getAffectedCells(row, col, cellsX, cellsY)
    
    // Skontrolujeme či aspoň jedna z týchto buniek susedí s cestou
    for (const cell of affectedCells) {
      if (this.hasAdjacentRoad(cell.row, cell.col)) {
        return true
      }
    }
    
    return false
  }

  handlePointerMove(pointer) {
    if (this.isDragging && pointer.rightButtonDown()) {
      // Posun kamery
      const dx = pointer.x - this.lastPointer.x
      const dy = pointer.y - this.lastPointer.y
      
      this.cameras.main.scrollX -= dx
      this.cameras.main.scrollY -= dy
      
      this.lastPointer.x = pointer.x
      this.lastPointer.y = pointer.y
      return
    }
    
    // Hover detekcia
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
    const cell = this.isoToGrid(worldPoint.x, worldPoint.y)
    
    if (cell.row >= 0 && cell.row < GRID_SIZE && cell.col >= 0 && cell.col < GRID_SIZE) {
      if (this.hoveredCell.row !== cell.row || this.hoveredCell.col !== cell.col) {
        this.hoveredCell = cell
        
        // Road building mode - aktualizuj cestu
        if (props.roadBuildingMode && this.roadStartCell) {
          this.updateRoadPath(cell)
        }
        
        this.drawHover()
      }
    } else {
      if (this.hoveredCell.row !== -1) {
        this.hoveredCell = { row: -1, col: -1 }
        this.drawHover()
      }
    }
  }
  
  // Vypočítaj cestu od štartu po aktuálnu bunku (len rovné čiary - vertikálne alebo horizontálne)
  updateRoadPath(endCell) {
    if (!this.roadStartCell) return
    
    const path = []
    const startRow = this.roadStartCell.row
    const startCol = this.roadStartCell.col
    const endRow = endCell.row
    const endCol = endCell.col
    
    // Zisti vzdialenosti v oboch smeroch
    const rowDiff = Math.abs(endRow - startRow)
    const colDiff = Math.abs(endCol - startCol)
    
    // 🛣️ Určíme orientáciu cesty podľa toho, kde je väčší posun
    const isVertical = rowDiff >= colDiff
    const direction = isVertical ? 'vertical' : 'horizontal'
    const pathType = isVertical ? '📏 ROVNÁ ČIARA (vertikálne)' : '📏 ROVNÁ ČIARA (horizontálne)'
    
    console.log(`🛣️ ${pathType}: [${startRow}, ${startCol}] → [${endRow}, ${endCol}]`)
    
    if (isVertical) {
      // Vertikálna cesta - mení sa row, col zostáva konštantný
      const rowDirection = endRow > startRow ? 1 : (endRow < startRow ? -1 : 0)
      if (rowDirection !== 0) {
        for (let row = startRow; row !== endRow + rowDirection; row += rowDirection) {
          path.push({ 
            row: row, 
            col: startCol, 
            direction: 'vertical',
            fromDir: null,
            toDir: null
          })
        }
      } else {
        // Len jeden bod
        path.push({ 
          row: startRow, 
          col: startCol, 
          direction: 'vertical',
          fromDir: null,
          toDir: null
        })
      }
    } else {
      // Horizontálna cesta - mení sa col, row zostáva konštantný
      const colDirection = endCol > startCol ? 1 : (endCol < startCol ? -1 : 0)
      if (colDirection !== 0) {
        for (let col = startCol; col !== endCol + colDirection; col += colDirection) {
          path.push({ 
            row: startRow, 
            col: col, 
            direction: 'horizontal',
            fromDir: null,
            toDir: null
          })
        }
      } else {
        // Len jeden bod
        path.push({ 
          row: startRow, 
          col: startCol, 
          direction: 'horizontal',
          fromDir: null,
          toDir: null
        })
      }
    }
    
    // Určíme smery pre každý segment (pre rohy)
    for (let i = 0; i < path.length; i++) {
      const prev = path[i - 1]
      const curr = path[i]
      const next = path[i + 1]
      
      // Odkiaľ prichádza
      if (prev) {
        if (prev.row < curr.row) curr.fromDir = 'N' // z hora (nižší row)
        else if (prev.row > curr.row) curr.fromDir = 'S' // z dola (vyšší row)
        else if (prev.col < curr.col) curr.fromDir = 'W' // z ľava (nižší col)
        else if (prev.col > curr.col) curr.fromDir = 'E' // z prava (vyšší col)
      }
      
      // Kam odchádza
      if (next) {
        if (next.row < curr.row) curr.toDir = 'N'
        else if (next.row > curr.row) curr.toDir = 'S'
        else if (next.col < curr.col) curr.toDir = 'W'
        else if (next.col > curr.col) curr.toDir = 'E'
      }
      
      // Určíme typ tile
      curr.tileType = this.determineTileType(curr.fromDir, curr.toDir, curr.direction)
    }
    
    this.roadPath = path
    this.drawRoadPath()
  }
  
  // Určí typ tile podľa smeru odkiaľ a kam
  determineTileType(fromDir, toDir, defaultDirection) {
    // Ak nemáme oba smery, použijeme rovnú cestu
    if (!fromDir && !toDir) {
      return defaultDirection === 'horizontal' ? 'straight_h' : 'straight_v'
    }
    
    // Len začiatok alebo koniec
    if (!fromDir || !toDir) {
      // Určíme smer podľa toho čo máme
      const dir = fromDir || toDir
      if (dir === 'N' || dir === 'S') return 'straight_v'
      return 'straight_h'
    }
    
    // Máme oba smery - môže byť roh
    const combo = fromDir + toDir
    
    // Rovné cesty
    if (combo === 'NS' || combo === 'SN') return 'straight_v'
    if (combo === 'WE' || combo === 'EW') return 'straight_h'
    
    // Rohy - mapovanie na naše tile názvy
    // V izometrii: N=hore-vpravo, S=dole-vľavo, W=hore-vľavo, E=dole-vpravo
    if (combo === 'NE' || combo === 'EN') return 'corner_SW' // Roh ↙
    if (combo === 'NW' || combo === 'WN') return 'corner_SE' // Roh ↘
    if (combo === 'SE' || combo === 'ES') return 'corner_NW' // Roh ↖
    if (combo === 'SW' || combo === 'WS') return 'corner_NE' // Roh ↗
    
    return defaultDirection === 'horizontal' ? 'straight_h' : 'straight_v'
  }
  
  // Nakresli preview cesty
  drawRoadPath() {
    if (this.roadPathGraphics) {
      this.roadPathGraphics.destroy()
    }
    
    if (this.roadPath.length === 0) return
    
    this.roadPathGraphics = this.add.graphics()
    this.uiContainer.add(this.roadPathGraphics)
    
    for (const cell of this.roadPath) {
      const { x, y } = this.gridToIso(cell.row, cell.col)
      
      // Modrá farba pre preview
      this.roadPathGraphics.fillStyle(0x667eea, 0.5)
      this.roadPathGraphics.beginPath()
      this.roadPathGraphics.moveTo(x, y)
      this.roadPathGraphics.lineTo(x + TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
      this.roadPathGraphics.lineTo(x, y + TILE_HEIGHT)
      this.roadPathGraphics.lineTo(x - TILE_WIDTH / 2, y + TILE_HEIGHT / 2)
      this.roadPathGraphics.closePath()
      this.roadPathGraphics.fillPath()
      
      this.roadPathGraphics.lineStyle(3, 0x667eea, 1)
      this.roadPathGraphics.strokePath()
    }
  }
  
  // Vyčisti road building stav
  clearRoadBuilding() {
    this.roadStartCell = null
    this.roadPath = []
    if (this.roadPathGraphics) {
      this.roadPathGraphics.destroy()
      this.roadPathGraphics = null
    }
  }

  handlePointerDown(pointer) {
    if (pointer.rightButtonDown()) {
      this.isDragging = true
      this.lastPointer.x = pointer.x
      this.lastPointer.y = pointer.y
      return
    }
    
    if (pointer.leftButtonDown()) {
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
      const cell = this.isoToGrid(worldPoint.x, worldPoint.y)
      
      if (cell.row >= 0 && cell.row < GRID_SIZE && cell.col >= 0 && cell.col < GRID_SIZE) {
        
        // Destination mode - kliknutie na tile pre nastavenie destination
        if (props.isSettingDestination) {
          console.log(`🎯 Destination tile clicked: [${cell.row}, ${cell.col}]`)
          emit('destination-tile-clicked', { row: cell.row, col: cell.col })
          return
        }
        
        // Ak nie je žiadny špeciálny mód, skontroluj či sa kliklo na existujúcu budovu
        if (!props.roadDeleteMode && !props.roadBuildingMode && !props.deleteMode && !props.selectedImageId && !props.recycleMode) {
          const key = `${cell.row}-${cell.col}`
          const buildingData = cellImages[key]
          
          if (buildingData && !buildingData.isRoadTile) {
            console.log('🏗️ Kliknuté na budovu:', buildingData)
            emit('building-clicked', { row: cell.row, col: cell.col, buildingData })
            return
          }
        }
        
        // Recycle mode - kliknutie na budovu spustí recykláciu
        if (props.recycleMode) {
          const key = `${cell.row}-${cell.col}`
          if (cellImages[key]) {
            const imageData = cellImages[key]
            const originRow = imageData.originRow !== undefined ? imageData.originRow : cell.row
            const originCol = imageData.originCol !== undefined ? imageData.originCol : cell.col
            const originKey = `${originRow}-${originCol}`
            const originData = cellImages[originKey]
            
            // Len budovy (nie cesty), a len ak nie je už v recyklovom/stavebnom procese
            if (originData && !originData.isRoadTile && originData.buildingData?.isBuilding) {
              const activeKey = `${originRow}-${originCol}`
              if (this.activeAnimations[activeKey]) {
                // Budova je už v animácii - otvor modal pre zobrazenie detailov
                console.log(`♻️ Budova [${originRow}, ${originCol}] je už v animácii - otváram detail`)
                emit('building-clicked', { row: originRow, col: originCol, buildingData: originData })
                return
              }
              
              console.log(`♻️ Recycle: Kliknuté na budovu [${originRow}, ${originCol}]`)
              emit('building-recycled', { 
                row: originRow, 
                col: originCol, 
                buildingData: originData.buildingData,
                cellsX: originData.cellsX || 1,
                cellsY: originData.cellsY || 1
              })
            }
          }
          return
        }
        
        // Road delete mode (mazanie budov aj ciest)
        if (props.roadDeleteMode) {
          const key = `${cell.row}-${cell.col}`
          
          // Kontrola či tam niečo je
          if (cellImages[key]) {
            const imageData = cellImages[key]
            
            // Ak je to sekundárne políčko, použi originálnu pozíciu
            const originRow = imageData.originRow !== undefined ? imageData.originRow : cell.row
            const originCol = imageData.originCol !== undefined ? imageData.originCol : cell.col
            const originKey = `${originRow}-${originCol}`
            const originData = cellImages[originKey]
            
            // Mazanie road tile
            if (imageData.isRoadTile) {
              if (this.buildingSprites[key]) {
                this.buildingSprites[key].destroy()
                delete this.buildingSprites[key]
              }
              delete cellImages[key]
              console.log(`🚜 Cesta zmazaná: [${cell.row}, ${cell.col}]`)
              
              // Aktualizuj PersonManager cache
              if (this.personManager) {
                this.personManager.updateWorkerRoadTiles()
              }
              
              // Aktualizuj CarManager cache
              if (this.carManager) {
                this.carManager.updateWorkerRoadTiles()
              }
            } 
            // Mazanie budovy
            else {
              const cellsX = originData?.cellsX || imageData.cellsX || 1
              const cellsY = originData?.cellsY || imageData.cellsY || 1

              const deletedBuildingData = originData?.buildingData || imageData.buildingData || null
              if (deletedBuildingData?.isBuilding) {
                emit('building-deleted', { row: originRow, col: originCol, buildingData: deletedBuildingData })
              }
              
              // Zmazať všetky bunky budovy od originálnej pozície
              for (let r = originRow; r < originRow + cellsX; r++) {
                for (let c = originCol; c < originCol + cellsY; c++) {
                  const cellKey = `${r}-${c}`
                  delete cellImages[cellKey]
                }
              }
              
              // Zmazať sprite z originálnej pozície
              this.removeBuilding(originKey)
              console.log(`🚜 Budova zmazaná: [${originRow}, ${originCol}] (${cellsX}x${cellsY})`)
              
              // Emit event pre aktualizáciu v GameView
              emit('image-placed')
            }
          } else {
            console.log(`⚠️ Na pozícii [${cell.row}, ${cell.col}] nie je žiadny objekt (key: ${key})`)
            console.log(`📋 Existujúce kľúče:`, Object.keys(cellImages))
          }
          return
        }
        
        // Road building mode
        if (props.roadBuildingMode) {
          if (!this.roadStartCell) {
            // Prvý klik - nastav štartovací bod
            // Kontrola či je to prvá cesta alebo či susedí s existujúcou cestou
            const hasSomeRoads = Object.values(cellImages).some(cell => cell.isRoadTile)
            
            if (hasSomeRoads && !this.hasAdjacentRoad(cell.row, cell.col)) {
              console.log('❌ Cesta musí susediť s existujúcou cestou!')
              return
            }
            
            this.roadStartCell = { row: cell.row, col: cell.col }
            this.roadPath = [{ row: cell.row, col: cell.col, direction: 'horizontal' }]
            this.drawRoadPath()
            console.log(`🛣️ Začiatok cesty: [${cell.row}, ${cell.col}]`)
          } else {
            // Druhý klik - postav cestu
            if (this.roadPath.length > 0) {
              console.log(`🛣️ Staviam cestu s ${this.roadPath.length} segmentami`)
              emit('road-placed', { path: [...this.roadPath] })
            }
            this.clearRoadBuilding()
          }
          return
        }
        
        // Normálny režim
        const canSelect = props.templateSelected || props.deleteMode || props.selectedImageId
        if (!canSelect) return
        
        if (!props.deleteMode) {
          const cellsX = props.lastImageCellsX || 1
          const cellsY = props.lastImageCellsY || 1
          
          if (this.checkCollision(cell.row, cell.col, cellsX, cellsY)) {
            console.log('❌ Kolízia!')
            return
          }
          
          // Kontrola či budova susedí s cestou
          const hasSomeRoads = Object.values(cellImages).some(cell => cell.isRoadTile)
          if (hasSomeRoads && !this.hasBuildingAdjacentToRoad(cell.row, cell.col, cellsX, cellsY)) {
            console.log('❌ Budova musí susediť s cestou!')
            return
          }
        }
        
        this.selectedCell = { row: cell.row, col: cell.col }
        this.drawSelected()
        
        emit('cell-selected', { row: cell.row, col: cell.col })
        console.log(`✅ Políčko vybrané: [${cell.row}, ${cell.col}]`)
      }
    }
  }

  handlePointerUp(pointer) {
    this.isDragging = false
  }

  handleWheel(pointer, gameObjects, deltaX, deltaY, deltaZ) {
    const zoomChange = deltaY > 0 ? 0.9 : 1.1
    const newZoom = Phaser.Math.Clamp(this.cameras.main.zoom * zoomChange, 0.3, 3)
    this.cameras.main.setZoom(newZoom)
  }

  // Vytvorenie smoke effectu pre budovu
  createSmokeEffect(x, y, key, speed = 1, scale = 1, alpha = 0.5, tint = 1, row = 0, col = 0, cellsX = 1, cellsY = 1, direction = 'up', depthOffset = 1) {
    if (!this.textures.exists('smoke')) {
      console.warn('⚠️ Smoke textúra nie je načítaná')
      return null
    }

    // Aplikujeme multiplikátory
    const speedMultiplier = speed || 1
    const scaleMultiplier = scale || 1
    const alphaValue = alpha !== undefined ? alpha : 0.5
    const tintValue = tint || 1
    const baseSpeedY = direction === 'down'
      ? { min: 100, max: 200 }
      : { min: -100, max: -200 }
    const baseSpeedX = { min: -20, max: 20 }
    const baseFrequency = 100
    const baseLifespan = 3000
    const baseScaleStart = 0.2
    const baseScaleEnd = 1.5

    // Aplikujeme tint pre tmavosť (brightness)
    // tint < 1 = tmavší, tint > 1 = svetlejší
    const tintColor = Phaser.Display.Color.GetColor(
      Math.min(255, 255 * tintValue),
      Math.min(255, 255 * tintValue),
      Math.min(255, 255 * tintValue)
    )

    const particles = this.add.particles(x, y, 'smoke', {
      speedY: { 
        min: baseSpeedY.min * speedMultiplier, 
        max: baseSpeedY.max * speedMultiplier 
      },
      speedX: { 
        min: baseSpeedX.min * speedMultiplier, 
        max: baseSpeedX.max * speedMultiplier 
      },
      scale: { 
        start: baseScaleStart * scaleMultiplier, 
        end: baseScaleEnd * scaleMultiplier 
      },
      alpha: { start: alphaValue, end: 0 },
      lifespan: baseLifespan / speedMultiplier,
      blendMode: 'SCREEN',
      frequency: baseFrequency / speedMultiplier,
      rotate: { min: 0, max: 360 },
      tint: tintColor
    })

    // Footprint sort point - rovnaký výpočet ako pre budovu
    const baseR = row + cellsX - 1
    const baseC = col + (cellsY - 1) / 2
    const depthSum = baseR + baseC
    const depth = Math.round(depthSum * 10000 + baseC * 10) + depthOffset
    particles.setDepth(depth)
    
    console.log(`💨 Smoke effect vytvorený: speed=${speedMultiplier}x, scale=${scaleMultiplier}x, alpha=${alphaValue}, tint=${tintValue}x, depth=${depth}, direction=${direction}`)
    
    return particles
  }

  // Vytvorenie blikajúceho svetelného efektu
  createLightEffect(x, y, key, blinkSpeed = 1, color = 0xffff00, size = 1, row = 0, col = 0, cellsX = 1, cellsY = 1) {
    // Parsuj farbu ak je string (hex)
    let lightColor = color
    if (typeof color === 'string') {
      lightColor = parseInt(color.replace('#', ''), 16)
    }
    
    // Vytvoríme grafický objekt pre svetlo (kruh s gradient efektom)
    const lightGraphics = this.add.graphics()
    lightGraphics.setPosition(x, y + 17) // Ešte nižšie
    
    // Nakreslíme svetelný kruh - veľkosť podľa parametra
    const baseRadius = 0.5
    const radius = baseRadius * size
    lightGraphics.fillStyle(lightColor, 1)
    lightGraphics.fillCircle(0, 0, radius)
    
    // Pridáme veľmi jemný blur efekt
    const glowRadius = radius + (0.5 * size)
    lightGraphics.fillStyle(lightColor, 0.5)
    lightGraphics.fillCircle(0, 0, glowRadius)
    
    // Footprint sort point - rovnaký výpočet ako pre budovu
    const baseR = row + cellsX - 1
    const baseC = col + (cellsY - 1) / 2
    const depthSum = baseR + baseC
    const depth = Math.round(depthSum * 10000 + baseC * 10) + 1 // +1 aby bolo svetlo tesne pred budovou
    lightGraphics.setDepth(depth)
    
    // Vytvoríme blikací efekt pomocou tween animácie
    // blinkSpeed ovláda ako rýchlo bliká (vyššie číslo = rýchlejšie)
    const blinkDuration = Math.max(200, 1000 / blinkSpeed)
    
    this.tweens.add({
      targets: lightGraphics,
      alpha: { from: 1, to: 0.2 },
      duration: blinkDuration,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1
    })
    
    // Pridáme svetlo do smoke effects pre neskoršie odstránenie
    if (!this.smokeEffects) {
      this.smokeEffects = {}
    }
    
    if (!this.smokeEffects[key]) {
      this.smokeEffects[key] = []
    } else if (!Array.isArray(this.smokeEffects[key])) {
      // Ak je to starý formát (len particles), prekonvertuj na pole
      this.smokeEffects[key] = [this.smokeEffects[key]]
    }
    
    this.smokeEffects[key].push(lightGraphics)
    
    console.log(`💡 Light effect vytvorený: blinkSpeed=${blinkSpeed}, color=${color}, duration=${blinkDuration}ms`)
    return lightGraphics
  }

  // Vytvorenie stavebného efektu dymu/prachu pre animáciu stavby budovy
  createConstructionDustEffect(x, y, width, height) {
    // Skontrolujeme či máme smoke textúru
    if (!this.textures.exists('smoke')) {
      console.warn('⚠️ Smoke textúra nie je načítaná pre construction effect')
      return null
    }
    
    // Vytvoríme časticový systém pre stavebný prach
    // Rozložíme emiter po celej šírke budovy
    const particles = this.add.particles(x, y, 'smoke', {
      // Emitujeme po celej šírke budovy
      emitZone: {
        type: 'random',
        source: new Phaser.Geom.Rectangle(-width/2, -10, width, 20)
      },
      // Prach letí nahor a do strán
      speedY: { min: -60, max: -120 },
      speedX: { min: -40, max: 40 },
      // Veľkosť částíc
      scale: { start: 0.3, end: 1.2 },
      // Postupne miznú
      alpha: { start: 0.3, end: 0 },
      // Krátky život častíc
      lifespan: 1200,
      // Hustota emitácie
      frequency: 60,
      // Rotácia pre prirodzenejší efekt
      rotate: { min: 0, max: 360 },
      // Hnedá/šedá farba pre prach
      tint: [0x8B7355, 0xA0826D, 0x696969, 0x808080],
      // Blend mode pre lepší vizuál
      blendMode: 'ADD',
      // Gravitácia smerom nahor (prach sa rozptýli)
      gravityY: -20
    })
    
    // Depth bude nastavený zvonka (buildingSprite.depth + 0.2)
    // particles.setDepth(999999)
    
    console.log(`🏗️ Construction dust effect vytvorený na pozícii [${x}, ${y}], šírka: ${width}`)
    
    return particles
  }

  // Aktualizuje textúru existujúcej budovy na canvase (pri výmene obrázka v galérii)
  updateBuildingTexture(key, newUrl) {
    const sprite = this.buildingSprites[key]
    if (!sprite) return
    
    const newTextureKey = `building_${key}_${Date.now()}`
    this.load.image(newTextureKey, newUrl)
    this.load.once('complete', () => {
      this.time.delayedCall(0, () => {
        if (sprite && sprite.active) {
          const oldScaleX = sprite.scaleX
          const oldScaleY = sprite.scaleY
          sprite.setTexture(newTextureKey)
          // Zachovaj pôvodné škálovanie podľa pômeru šírok
          const newScale = (TILE_WIDTH * (cellImages[key]?.cellsX || 1)) / sprite.width
          sprite.setScale(newScale)
          console.log(`🔄 Textúra budovy aktualizovaná: ${key}`)
        }
      })
    })
    this.load.start()
  }

  // Pridanie obrázka s tieňom
  addBuildingWithShadow(key, imageUrl, row, col, cellsX, cellsY, isBackground = false, templateName = '', isRoadTile = false, bitmap = null, skipShadows = false, dontDropShadow = false, buildingData = null) {
    console.log('🏗️ addBuildingWithShadow called with dontDropShadow:', dontDropShadow, 'buildingData:', buildingData)
    // Pre road tiles - jednoduchá logika bez cache
    if (isRoadTile) {
      // Unikátny kľúč s timestampom aby sa vždy načítala nová textúra
      const roadTextureKey = `road_${key}_${Date.now()}`
      
      // Asynchrónne načítanie aby neblokoval hlavné vlákno
      this.load.image(roadTextureKey, imageUrl)
      
      // Použijeme once namiesto on aby sa callback zavolal len raz
      this.load.once('complete', () => {
        // Zabezpečíme že load je dokončený v nasledujúcom frame
        this.time.delayedCall(0, () => {
          const { x, y } = this.gridToIso(row, col)
          
          // Vytvoríme sprite pre road tile
          const roadSprite = this.add.sprite(x, y + TILE_HEIGHT / 2, roadTextureKey)
          
          // Škáluj obrázok aby jeho šírka zodpovedala šírke políčka
          const scale = TILE_WIDTH / roadSprite.width
          roadSprite.setScale(scale)
          roadSprite.setOrigin(0.5, 0.5)
          
          // Road tiles sú nad mriežkou ale pod budovami
          roadSprite.setDepth(0.5)
          
          // Vytvor izometrickú masku pre políčko
          const maskGraphics = this.make.graphics({ x: 0, y: 0, add: false })
          maskGraphics.fillStyle(0xffffff)
          
          const maskX = x
          const maskY = y + TILE_HEIGHT / 2
          maskGraphics.beginPath()
          maskGraphics.moveTo(maskX, maskY - TILE_HEIGHT / 2)
          maskGraphics.lineTo(maskX + TILE_WIDTH / 2, maskY)
          maskGraphics.lineTo(maskX, maskY + TILE_HEIGHT / 2)
          maskGraphics.lineTo(maskX - TILE_WIDTH / 2, maskY)
          maskGraphics.closePath()
          maskGraphics.fillPath()
          
          const mask = maskGraphics.createGeometryMask()
          roadSprite.setMask(mask)
          
          // Uložíme referenciu (bez tieňa)
          this.buildingSprites[key] = roadSprite
          
          console.log(`🛣️ Road tile umiestnený: ${key}`)
        })
      })
      
      // Spustíme loading asynchrónne (neblokuje)
      this.load.start()
      return
    }
    
    // Unikátny kľúč s timestampom aby sa vždy načítala nová textúra
    // (rovnaký prístup ako pre road tiles)
    const textureKey = `building_${key}_${Date.now()}`
    
    // Asynchrónne načítanie textúry
    this.load.image(textureKey, imageUrl)
    this.load.once('complete', () => {
      // Odložíme vykreslenie do nasledujúceho frame
      this.time.delayedCall(0, () => {
        const { x, y } = this.gridToIso(row, col)
        
        // Vypočítame offset pre multi-cell objekty
        let offsetX = 0
        let offsetY = 0
        
        if (cellsX === 1 && cellsY === 2) {
          offsetX = -TILE_WIDTH / 4
          offsetY = TILE_HEIGHT / 2
        } else if (cellsX === 2 && cellsY === 2) {
          offsetY = TILE_HEIGHT
        } else if (cellsX >= 3) {
          offsetY = TILE_HEIGHT * (cellsX - 1)
        }
        
        // Vytvoríme sprite pre budovu (normálny flow)
        const buildingSprite = this.add.sprite(x + offsetX, y + TILE_HEIGHT + offsetY, textureKey)
        
        // Nastavíme veľkosť - zvýšená aby pokrývala celú šírku izometrického diamantu
        const targetWidth = TILE_WIDTH * cellsX * 0.95
        const scale = targetWidth / buildingSprite.width
        buildingSprite.setScale(scale)
        buildingSprite.setOrigin(0.5, 1) // Spodný stred
        
        // Uložíme info o tieni pre renderovanie
        // Fixný offset založený na veľkosti bunky, nie na rozmeroch obrázka
        const baseShadowOffset = TILE_WIDTH * cellsX * 0.4
        
        // Zistíme či je to tree šablóna z názvu šablóny
        const isTreeTemplate = templateName.toLowerCase().includes('tree')
        
        // Premenná pre construct sprite-y - musí byť dostupná aj mimo shouldAnimate bloku
        let constructSprites = []
        let animationControl = null
        
        // === ANIMÁCIA STAVBY - len pri manuálnom umiestnení (nie pri načítavaní projektu) ===
        // V editor mode (alwaysShowEffects) sa budovy stavajú okamžite bez animácie
        const shouldAnimate = !skipShadows && !this.batchLoading && !props.alwaysShowEffects
        
        // Zistíme či existujú autá na mape (ak áno, animácia čaká na auto)
        const hasCars = this.carManager && this.carManager.cars && this.carManager.cars.length > 0
        
        if (shouldAnimate) {
          // Emit počiatočný stav - vždy začíname ako 'building', pri waitForCar sa zmení na 'waiting' keď dosiahne fázu 1
          emit('building-state-changed', { row, col, state: hasCars ? 'waiting' : 'building' })
          
          const animResult = startBuildingAnimation(this, {
            buildingSprite,
            key: textureKey,
            x,
            y,
            offsetX,
            offsetY,
            targetWidth,
            cellsX,
            cellsY,
            dontDropShadow,
            isTreeTemplate,
            baseShadowOffset,
            shadowSprites: this.shadowSprites,
            redrawShadowsAround: (r, c) => this.redrawShadowsAround(r, c),
            row,
            col,
            createConstructionDustEffect: (cx, cy, cw, ch) => this.createConstructionDustEffect(cx, cy, cw, ch),
            buildCost: buildingData?.buildCost || null,
            waitForCar: hasCars,
            onWaitingForCar: () => {
              // Animácia dosiahla koniec fázy 1 a je SKUTOČNE pozastavená
              // Teraz je správny moment na vyhľadanie a dispatchovanie auta
              emit('building-state-changed', { row, col, state: 'waiting' })
              
              // Pridáme do dispatch fronty AŽ TERAZ (animácia je zaručene pozastavená)
              this.carDispatchQueue.push({
                row,
                col,
                animationControl: animResult.animationControl
              })
              console.log(`📋 Budova [${row}, ${col}] čaká na auto - pridaná do dispatch fronty (celkom: ${this.carDispatchQueue.length})`)
              this.processNextCarDispatch()
            },
            onAnimationComplete: () => {
              // Animácia je kompletne dokončená - okamžite vrátime všetky autá na cestu
              console.log(`✅ Animácia stavby [${row}, ${col}] kompletne dokončená`)
              const key = `${row}-${col}`
              const anim = this.activeAnimations[key]
              if (anim && anim._dispatches) {
                anim._dispatches.forEach(d => {
                  if (d.instantReturn) d.instantReturn()
                })
                anim._dispatches = []
              }
              // Odstráň z aktívnych animácií
              delete this.activeAnimations[key]
              emit('building-construction-complete', { row, col })
            }
          })
          constructSprites = animResult.constructSprites
          animationControl = animResult.animationControl
          
          // Ulož animationControl pre neskoršie zmeny rýchlosti
          this.activeAnimations[`${row}-${col}`] = animationControl
        }
        
        // Vytvor shadowInfo len ak nemá dontDropShadow flag
        if (!dontDropShadow) {
          console.log('✅ Vytváram tieň pre budovu', key)
          const shadowInfo = {
            textureKey,
            x: x + offsetX,
            y: y + TILE_HEIGHT + offsetY,
            scale,
            scaleMultiplier: shouldAnimate ? 0 : 1, // Začíname s 0 len pri stavebnej animácii
            alpha: 1,
            cellsX, // Veľkosť pre výber správneho offsetu
            isTree: isTreeTemplate, // Špeciálny flag pre stromy
            offsetX: -baseShadowOffset,
            offsetY: baseShadowOffset * 0.375
          }
          this.shadowSprites[key] = shadowInfo // Uložíme info pre RenderTexture
        } else {
          console.log('🚫 Preskakujem tieň pre budovu (dontDropShadow=true)', key)
        }
        
        // Uložíme referencie
        this.buildingSprites[key] = buildingSprite
        
        
        // Zoradíme budovy podľa depth (row + col)
        this.sortBuildings()
        
        // Nastavíme depth pre construct sprite-y AŽ PO sortBuildings()
        if (constructSprites && constructSprites.length > 0) {
          const finalBuildingDepth = buildingSprite.depth
          constructSprites.forEach(sprite => {
            sprite.setDepth(finalBuildingDepth + 1)
          })
          console.log(`🔨 Construct sprites depth nastavený na ${finalBuildingDepth + 1} (budova má ${finalBuildingDepth})`)
        }

        // Fly-away efekt - pri batch loading (načítanie projektu) sa spúšťa okamžite
        // Pri manuálnom umiestnení sa spúšťa až po dokončení stavebnej animácie (v onAnimationComplete)
        if (!shouldAnimate && buildingData?.hasFlyAwayEffect) {
          this.startFlyAwayEffect(key, buildingSprite)
        }

        // V editor mode zobraz ostatné produkčné efekty (dym, svetlo - BEZ fly-away)
        if (props.alwaysShowEffects) {
          if (shouldAnimate) {
            // Ak prebehla animácia stavby, odložíme produkčné efekty o 5 sekúnd
            this.time.delayedCall(5000, () => {
              this.showProductionEffects(row, col)
            })
          } else {
            // Žiadna animácia stavby - zobrazíme efekty hneď
            this.showProductionEffects(row, col)
          }
        }
        
        // Prekreslíme tiene len ak nie sme v batch loading mode
        if (!skipShadows && !this.batchLoading) {
          this.redrawShadowsAround(row, col)
        }
      })
    })
    
    this.load.start()
  }

  /**
   * Sekvenčné spracovanie car dispatch fronty
   * Vyhľadávanie najbližšieho auta pre ďalšiu budovu
   * začne až keď je predchádzajúce auto označené ako dispatched.
   * Animácia budovy je ZARUČENE pozastavená keď sa request spracuje.
   */
  processNextCarDispatch() {
    // Ak už spracovávame, nič nerobíme - zavolá sa znova po dokončení
    if (this.isProcessingCarDispatch) return
    
    // Ak je fronta prázdna, koniec
    if (this.carDispatchQueue.length === 0) return
    
    this.isProcessingCarDispatch = true
    
    // Vyberieme prvý request z fronty
    const request = this.carDispatchQueue.shift()
    const { row, col, animationControl } = request
    
    console.log(`🔄 Spracovávam dispatch pre budovu [${row}, ${col}], zostáva vo fronte: ${this.carDispatchQueue.length}`)
    
    // Nájdeme najbližšie auto (teraz je bezpečné - predchádzajúce auto je už dispatched)
    const carResult = findNearestCar(this.carManager.cars, row, col, cellImages)
    
    if (carResult) {
      const dispatch = dispatchCarToBuilding(
        this,
        carResult.car,
        carResult.path,
        carResult.nearestRoad,
        row,
        col,
        {
          onArrive: () => {
            // Auto prišlo - obnovíme animáciu stavby (je zaručene pozastavená)
            console.log(`🚗✅ Auto dorazilo k budove [${row}, ${col}] - obnovujem animáciu`)
            emit('building-state-changed', { row, col, state: 'building' })
            animationControl.resume()
            
            // Uložíme dispatch na animationControl - auto sa vráti okamžite pri dokončení animácie
            animationControl._dispatches.push(dispatch)
          },
          moveSpeed: 400,
          carManager: this.carManager
        }
      )
      
      // Auto je teraz dispatched - môžeme spracovať ďalší request
      this.isProcessingCarDispatch = false
      // Spracujeme ďalší v nasledujúcom frame aby neblokovalo
      this.time.delayedCall(0, () => {
        this.processNextCarDispatch()
      })
    } else {
      // Žiadne auto nenájdené - obnovíme animáciu bez čakania (animácia je pozastavená)
      console.log(`⚠️ Žiadne auto nenájdené pre budovu [${row}, ${col}] - animácia pokračuje bez auta`)
      emit('building-state-changed', { row, col, state: 'building' })
      animationControl.resume()
      
      this.isProcessingCarDispatch = false
      // Skúsime ďalší request
      this.time.delayedCall(0, () => {
        this.processNextCarDispatch()
      })
    }
  }

  createShadowForBuilding(buildingSprite, x, y) {
    // Táto funkcia už nie je potrebná - tieň sa vytvára v addBuildingWithShadow
    // Ponechávam prázdnu pre spätná kompatibilita
    return null
  }

  // Prekreslí všetky tiene do RenderTexture - zabezpečí že sa neprekrývajú
  redrawAllShadows() {
    // Odložíme prekreslenie do nasledujúceho frame aby sme neblokovali animácie
    requestAnimationFrame(() => {
      this.performShadowRedraw()
    })
  }

  // Prekreslí tiene len pre budovu a jej susedov (optimalizované)
  redrawShadowsAround(centerRow, centerCol) {
    // Susediace bunky podľa príkladu: (r,c), (r,c-1), (r+1,c-1), (r+1,c)
    const offsets = [
      { dr: 0, dc: 0 },
      { dr: 0, dc: -1 },
      { dr: 1, dc: -1 },
      { dr: 1, dc: 0 }
    ]

    const keys = offsets
      .map(({ dr, dc }) => `${centerRow + dr}-${centerCol + dc}`)
      .filter(key => this.shadowSprites[key])

    if (keys.length === 0) return

    requestAnimationFrame(() => {
      this.performShadowRedrawForKeys(keys)
    })
  }
  
  // Skutočné prekreslenie tieňov
  performShadowRedraw() {
    // Vyčistíme RenderTexture
    this.shadowRenderTexture.clear()
    
    // Offset pre RenderTexture (stred je na 2000, 2000)
    const rtOffsetX = 2000
    const rtOffsetY = 2000 - GRID_SIZE * TILE_HEIGHT / 2
    
    // Nakreslíme všetky tiene do RenderTexture
    for (const key in this.shadowSprites) {
      const shadowInfo = this.shadowSprites[key]
      if (!shadowInfo || !shadowInfo.textureKey) continue
      if (shadowInfo.alpha !== undefined && shadowInfo.alpha <= 0) continue
      
      // Skontrolujeme či textúra existuje
      if (!this.textures.exists(shadowInfo.textureKey)) continue
      
      // Vypočítame pozíciu tieňa v RenderTexture koordinátoch
      const drawX = shadowInfo.x + shadowInfo.offsetX + rtOffsetX
      const drawY = shadowInfo.y + shadowInfo.offsetY + rtOffsetY
      
      // Vytvoríme dočasný sprite pre kreslenie
      const tempSprite = this.make.sprite({
        key: shadowInfo.textureKey,
        add: false
      })
      
      // Získame rozmery textúry
      const texture = this.textures.get(shadowInfo.textureKey)
      const frame = texture.get()
      
      // Nastavíme scale pre tieň
      const scaleMultiplier = shadowInfo.scaleMultiplier !== undefined ? shadowInfo.scaleMultiplier : 1
      const shadowScaleX = shadowInfo.scale * 0.45 * scaleMultiplier
      const shadowScaleY = shadowInfo.scale * 1.3 * scaleMultiplier
      
      tempSprite.setScale(shadowScaleX, shadowScaleY)
      // Origin na spodný stred - rovnaký ako budova
      tempSprite.setOrigin(0.5, 1)
      tempSprite.setAngle(-90)
      tempSprite.setTint(0x000000)
      tempSprite.setAlpha(shadowInfo.alpha !== undefined ? shadowInfo.alpha : 1)
      
      // Po rotácii o -90° sa výška obrázka stane šírkou tieňa
      // Kompenzujeme pozíciu tak, aby tieň bol vždy rovnako ďaleko od spodku budovy
      // Výška obrázka * scale určuje, ako ďaleko je stred obrázka od spodku
      const imageHeight = frame.height * shadowInfo.scale
      
      // Offset tieňa pre rôzne veľkosti - dolaď tieto hodnoty
      const shadowOffsets = {
        '1x1': { x: 44, y: -23 },
        '2x2': { x: 89 , y: -45 },
        '3x3': { x: 138, y: -68 },
        '4x4': { x: 180, y: -89 },
        '5x5': { x: 219, y: -112 },
        // Špeciálne offsety pre stromy (tree šablóna)
        'tree1x1': { x: 26, y: -11 },
        'tree2x2': { x: 44, y: -19 },
        'tree3x3': { x: 75, y: -32 },
        'tree4x4': { x: 100, y: -45 },
        'tree5x5': { x: 125, y: -58 }
      }
      
      // Získame veľkosť z shadowInfo (zatiaľ len cellsX, predpokladáme štvorcové)
      const cellsX = shadowInfo.cellsX || 1
      const isTree = shadowInfo.isTree || false
      const sizeKey = isTree ? `tree${cellsX}x${cellsX}` : `${cellsX}x${cellsX}`
      const offsets = shadowOffsets[sizeKey] || shadowOffsets[`${cellsX}x${cellsX}`] || shadowOffsets['1x1']
      
      const fixedOffsetX = offsets.x
      const fixedOffsetY = offsets.y
      
      // Nakreslíme do RenderTexture
      this.shadowRenderTexture.draw(tempSprite, drawX + fixedOffsetX, drawY + fixedOffsetY)
      
      tempSprite.destroy()
    }
  }

  // Skutočné prekreslenie tieňov len pre vybrané kľúče (bez čistenia celej RT)
  performShadowRedrawForKeys(keys) {
    const rtOffsetX = 2000
    const rtOffsetY = 2000 - GRID_SIZE * TILE_HEIGHT / 2

    keys.forEach(key => {
      const shadowInfo = this.shadowSprites[key]
      if (!shadowInfo || !shadowInfo.textureKey) return
      if (!this.textures.exists(shadowInfo.textureKey)) return
      if (shadowInfo.alpha !== undefined && shadowInfo.alpha <= 0) return

      const drawX = shadowInfo.x + shadowInfo.offsetX + rtOffsetX
      const drawY = shadowInfo.y + shadowInfo.offsetY + rtOffsetY

      const tempSprite = this.make.sprite({
        key: shadowInfo.textureKey,
        add: false
      })

      const texture = this.textures.get(shadowInfo.textureKey)
      const frame = texture.get()

      const scaleMultiplier = shadowInfo.scaleMultiplier !== undefined ? shadowInfo.scaleMultiplier : 1
      const shadowScaleX = shadowInfo.scale * 0.45 * scaleMultiplier
      const shadowScaleY = shadowInfo.scale * 1.3 * scaleMultiplier
      tempSprite.setScale(shadowScaleX, shadowScaleY)
      tempSprite.setOrigin(0.5, 1)
      tempSprite.setAngle(-90)
      tempSprite.setTint(0x000000)
      tempSprite.setAlpha(shadowInfo.alpha !== undefined ? shadowInfo.alpha : 1)

      const shadowOffsets = {
        '1x1': { x: 44, y: -23 },
        '2x2': { x: 89 , y: -45 },
        '3x3': { x: 138, y: -68 },
        '4x4': { x: 180, y: -89 },
        '5x5': { x: 219, y: -112 },
        'tree1x1': { x: 26, y: -11 },
        'tree2x2': { x: 44, y: -19 },
        'tree3x3': { x: 75, y: -32 },
        'tree4x4': { x: 100, y: -45 },
        'tree5x5': { x: 125, y: -58 }
      }

      const cellsX = shadowInfo.cellsX || 1
      const isTree = shadowInfo.isTree || false
      const sizeKey = isTree ? `tree${cellsX}x${cellsX}` : `${cellsX}x${cellsX}`
      const offsets = shadowOffsets[sizeKey] || shadowOffsets[`${cellsX}x${cellsX}`] || shadowOffsets['1x1']

      const fixedOffsetX = offsets.x
      const fixedOffsetY = offsets.y

      // Najprv sa pokús vymazať starý tieň ak engine podporuje erase
      if (typeof this.shadowRenderTexture.erase === 'function') {
        this.shadowRenderTexture.erase(tempSprite, drawX + fixedOffsetX, drawY + fixedOffsetY)
      }

      this.shadowRenderTexture.draw(tempSprite, drawX + fixedOffsetX, drawY + fixedOffsetY)
      tempSprite.destroy()
    })
  }

  sortBuildings() {
    // Zoradíme budovy podľa ich pozície pre správny z-index
    // Pre multi-cell budovy použijeme spodný roh (najvyšší row + col)
    for (const key in this.buildingSprites) {
      const [row, col] = key.split('-').map(Number)
      
      // Získame veľkosť budovy z cellImages
      const imageData = cellImages[key]
      const cellsX = imageData?.cellsX || 1
      const cellsY = imageData?.cellsY || 1
      
      // Preskočíme road tiles - tie majú fixný depth 0.5
      if (imageData?.isRoadTile) {
        continue
      }
      
      // Budovy s dontDropShadow majú rovnaký depth ako cesty (0.5)
      if (imageData?.buildingData?.dontDropShadow) {
        this.buildingSprites[key].setDepth(0.5)
        console.log(`🏠 Building ${key}: dontDropShadow=true, depth=0.5 (ako road)`)
        continue
      }
      
      // Spodný roh budovy (najbližší k pozorovateľovi) je na row + cellsX - 1, col + cellsY - 1
      const bottomRow = row + cellsX - 1
      const bottomCol = col + cellsY - 1
      
      // Footprint sort point - spodná hrana footprintu
      // baseR = spodný riadok footprintu (r + h - 1)
      // baseC = stred spodnej hrany footprintu (c + (w-1)/2)
      // Primárne: vyšší súčet (baseR + baseC) = bližšie k pozorovateľovi = vpredu
      // Sekundárne: pri rovnakom súčte, vyšší baseC = vpredu
      const baseR = row + cellsX - 1  // spodný riadok
      const baseC = col + (cellsY - 1) / 2  // stred spodnej hrany
      const depthSum = baseR + baseC
      const depth = Math.round(depthSum * 10000 + baseC * 10)
      
      this.buildingSprites[key].setDepth(depth)
      
      console.log(`🏠 Building ${key}: row=${row}, col=${col}, cellsX=${cellsX}, cellsY=${cellsY}, baseR=${baseR}, baseC=${baseC}, depthSum=${depthSum}, depth=${depth}`)
    }
  }

  removeBuilding(key) {
    console.log(`🗑️ removeBuilding: key=${key}, existuje v buildingSprites=${!!this.buildingSprites[key]}`)
    console.log(`🗑️ Všetky kľúče v buildingSprites:`, Object.keys(this.buildingSprites))
    if (this.buildingSprites[key]) {
      this.buildingSprites[key].destroy()
      delete this.buildingSprites[key]
      console.log(`✅ Sprite ${key} zmazaný`)
    } else {
      console.log(`⚠️ Sprite ${key} neexistuje v buildingSprites!`)
    }
    if (this.shadowSprites[key]) {
      delete this.shadowSprites[key]
      // Prekreslíme tiene
      this.redrawAllShadows()
    }

    if (this.flyAwayEffects && this.flyAwayEffects[key]) {
      const effect = this.flyAwayEffects[key]
      effect?.tween?.stop()
      if (effect?.sprite && effect?.originalY !== undefined) {
        effect.sprite.y = effect.originalY
      }
      delete this.flyAwayEffects[key]
    }
    
    // Odstránime smoke effect ak existuje
    if (this.smokeEffects && this.smokeEffects[key]) {
      const effects = Array.isArray(this.smokeEffects[key]) 
        ? this.smokeEffects[key] 
        : [this.smokeEffects[key]]
      
      effects.forEach(effect => {
        if (effect && effect.destroy) {
          effect.destroy()
        }
      })
      delete this.smokeEffects[key]
      console.log(`💨 Smoke/Light effects ${key} odstránené`)
    }
    
    // Odstránime warning indikátor ak existuje
    if (this.warningIndicators && this.warningIndicators[key]) {
      if (this.warningIndicators[key].elements) {
        this.warningIndicators[key].elements.forEach(el => el?.destroy())
      }
      this.warningIndicators[key].bg?.destroy()
      this.warningIndicators[key].exclamation?.destroy()
      delete this.warningIndicators[key]
      console.log(`🚨 Warning indikátor ${key} odstránený`)
    }
    
    // Odstránime auto-production indikátor ak existuje
    if (this.autoProductionIndicators && this.autoProductionIndicators[key]) {
      this.autoProductionIndicators[key].bg?.destroy()
      this.autoProductionIndicators[key].arrow?.destroy()
      delete this.autoProductionIndicators[key]
      console.log(`🔄 Auto-production indikátor ${key} odstránený`)
    }
    
    // Odstránime disabled overlay ak existuje
    if (this.disabledOverlays && this.disabledOverlays[key]) {
      const overlay = this.disabledOverlays[key]
      overlay.tween?.stop()
      if (overlay.sprite) {
        overlay.sprite.clearTint()
        overlay.sprite.setAlpha(1)
      }
      delete this.disabledOverlays[key]
      console.log(`☀️ Disabled overlay ${key} odstránený`)
    }
    
    // Aktualizuj PersonManager cache aby postavy vedeli o vymazaní bunky
    if (this.personManager) {
      this.personManager.updateWorkerRoadTiles()
    }
  }

  clearSelection() {
    this.selectedCell = { row: -1, col: -1 }
    this.drawSelected()
  }

  refreshGrid() {
    // Ak máme textúru, použijeme drawGridWithTexture, inak štandardné drawGrid
    if (this.backgroundTileKey && this.textures.exists(this.backgroundTileKey)) {
      this.drawGridWithTexture()
    } else {
      this.drawGrid()
    }
    this.drawHover()
    this.drawSelected()
  }
}

// Funkcia na vloženie obrázka
const placeImageAtSelectedCell = (imageUrl, cellsX, cellsY, imageDataOrIsBackground = false, templateName = '', isRoadTile = false, imageBitmap = null) => {
  console.log('🖼️ PhaserCanvas.placeImageAtSelectedCell()')
  console.log('   imageDataOrIsBackground:', imageDataOrIsBackground)
  
  // Parsuj parametre - ak je 4. parameter objekt, je to imageData s metaúdajmi
  let isBackground = false
  let imageData = imageDataOrIsBackground
  
  if (typeof imageDataOrIsBackground === 'boolean') {
    // Staré volanie s boolean parametrom
    isBackground = imageDataOrIsBackground
    imageData = null
  } else if (typeof imageDataOrIsBackground === 'object' && imageDataOrIsBackground !== null) {
    // Nové volanie s image objektom - extrahuj metaúdaje
    isBackground = imageDataOrIsBackground.isBackground || false
    if (!templateName && imageDataOrIsBackground.name) {
      templateName = imageDataOrIsBackground.name
    }
    if (imageDataOrIsBackground.isRoadTile !== undefined) {
      isRoadTile = imageDataOrIsBackground.isRoadTile
    }
    console.log('   📍 Road tile metaúdaje:', { name: imageDataOrIsBackground.name, x: imageDataOrIsBackground.x, y: imageDataOrIsBackground.y, width: imageDataOrIsBackground.width, height: imageDataOrIsBackground.height, rotation: imageDataOrIsBackground.rotation })
  }
  
  if (!mainScene || mainScene.selectedCell.row === -1) {
    console.log('❌ Žiadne políčko nie je vybrané')
    return false
  }
  
  const row = mainScene.selectedCell.row
  const col = mainScene.selectedCell.col
  const key = `${row}-${col}`
  
  // Priprav dáta pre uloženie
  const cellData = {
    url: imageUrl,
    bitmap: imageBitmap,  // Priamo bitmap pre rýchle kreslenie
    cellsX,
    cellsY,
    isBackground,
    templateName,
    isRoadTile,
    // Ulož ID obrázka z image library pre stabilné matchovanie (nemení sa pri výmene obrázka)
    libraryImageId: imageData?.id || null,
    // Ulož building metadata ak existujú
    buildingData: imageData?.buildingData || null,
    // Ulož aj metaúdaje road tile-u (optimalizácia - pri load sa rekreuje z sprite)
    tileMetadata: imageData && typeof imageData === 'object' ? {
      name: imageData.name,
      tileIndex: imageData.tileIndex, // Pridaný tileIndex pre rekre\u00e1ciu
      x: imageData.x,
      y: imageData.y,
      width: imageData.width,
      height: imageData.height,
      rotation: imageData.rotation
    } : null,
    // Ulož aj počiatočnú pozíciu (pre viacpolickovú budovu)
    originRow: row,
    originCol: col
  }
  
  // Ulož do cellImages na hlavnej pozícii
  cellImages[key] = cellData
  
  // Pre budovy väčšie ako 1x1, ulož referenciu na všetky zabraté políčka
  if (cellsX > 1 || cellsY > 1) {
    for (let r = 0; r < cellsX; r++) {
      for (let c = 0; c < cellsY; c++) {
        if (r === 0 && c === 0) continue // Hlavné políčko už je uložené
        const cellKey = `${row + r}-${col + c}`
        cellImages[cellKey] = {
          ...cellData,
          isSecondary: true, // Označenie že toto je sekundárne políčko
          originRow: row,
          originCol: col
        }
      }
    }
  }
  
  // Pridaj budovu s tieňom (alebo bez tieňa ak má dontDropShadow)
  const dontDropShadow = cellData.buildingData?.dontDropShadow || false
  console.log('🔍 dontDropShadow check:', {
    hasBuildingData: !!cellData.buildingData,
    dontDropShadow: cellData.buildingData?.dontDropShadow,
    finalValue: dontDropShadow,
    imageData: imageData,
    buildingData: imageData?.buildingData
  })
  mainScene.addBuildingWithShadow(key, imageUrl, row, col, cellsX, cellsY, isBackground, templateName, isRoadTile, imageBitmap, false, dontDropShadow, cellData.buildingData)
  
  // Vyčisti výber
  mainScene.clearSelection()
  
  emit('image-placed', { row, col })
  
  return true
}

// Funkcia na nastavenie pozadia
const setBackgroundTiles = (tiles, tileSize = 1) => {
  console.log('🎨 PhaserCanvas.setBackgroundTiles()')
  console.log('   Počet tile-ov:', tiles.length)
  console.log('   Tile size:', tileSize)
  
  backgroundTiles = tiles
  
  if (!mainScene || !tiles || tiles.length === 0) {
    console.log('⚠️ PhaserCanvas: Žiadne tiles alebo scéna neexistuje')
    return
  }
  
  // Uložíme veľkosť tile-u do scény
  mainScene.backgroundTileSize = tileSize
  
  // Načítaj tile textúry a prekresli grid
  // Použijeme timestamp pre unikátny kľúč aby sme predišli konfliktom
  const tileKey = `background_tile_${Date.now()}`
  
  // Ak existujú staré sprite-y s textúrou, odstránime ich pred načítaním novej
  if (mainScene.tileSprites && mainScene.tileSprites.length > 0) {
    console.log('🧹 Odstraňujem staré background sprite-y pred načítaním novej textúry')
    mainScene.tileSprites.forEach(sprite => sprite.destroy())
    mainScene.tileSprites = []
  }
  
  // Odstránime staré masky
  if (mainScene.tileMasks && mainScene.tileMasks.length > 0) {
    console.log('🧹 Odstraňujem staré masky')
    mainScene.tileMasks.forEach(mask => mask.destroy())
    mainScene.tileMasks = []
  }
  
  // Odstránime starú textúru ak existuje
  if (mainScene.backgroundTileKey && mainScene.textures.exists(mainScene.backgroundTileKey)) {
    console.log('🗑️ Odstraňujem starú textúru:', mainScene.backgroundTileKey)
    mainScene.textures.remove(mainScene.backgroundTileKey)
  }
  
  // Načítame prvý tile ako textúru
  mainScene.load.image(tileKey, tiles[0])
  mainScene.load.once('complete', () => {
    console.log('✅ Tile textúra načítaná, prekresľujem grid s textúrou')
    mainScene.backgroundTileKey = tileKey
    mainScene.drawGridWithTexture()
  })
  mainScene.load.start()
}

// Funkcia na vymazanie obrázka
const deleteImageAtCell = (row, col) => {
  const key = `${row}-${col}`
  console.log(`🗑️ PhaserCanvas: Vymazanie obrázka na [${row}, ${col}], key=${key}`)
  
  let deleted = false
  let originKey = key
  
  // Ak je toto sekundárna bunka, nájdi origin
  if (cellImages[key] && cellImages[key].isSecondary) {
    const originRow = cellImages[key].originRow
    const originCol = cellImages[key].originCol
    originKey = `${originRow}-${originCol}`
    console.log(`🗑️ Toto je sekundárna bunka, origin je ${originKey}`)
  }
  
  // Vymaž origin bunku
  if (cellImages[originKey]) {
    const originData = cellImages[originKey]
    console.log(`🗑️ Nájdený origin ${originKey}, mažem...`)
    mainScene.removeBuilding(originKey)
    delete cellImages[originKey]
    deleted = true
    
    // Vymaž všetky sekundárne bunky tejto budovy
    const cellsX = originData.cellsX || 1
    const cellsY = originData.cellsY || 1
    
    if (cellsX > 1 || cellsY > 1) {
      const [originRow, originCol] = originKey.split('-').map(Number)
      for (let r = 0; r < cellsY; r++) {
        for (let c = 0; c < cellsX; c++) {
          if (r === 0 && c === 0) continue // Skip origin
          const secondaryKey = `${originRow + r}-${originCol + c}`
          if (cellImages[secondaryKey] && cellImages[secondaryKey].isSecondary) {
            console.log(`🗑️ Mažem sekundárnu bunku ${secondaryKey}`)
            delete cellImages[secondaryKey]
          }
        }
      }
    }
  }
  
  // Ak nebola nájdená origin bunka, hľadaj obrázok ktorý zaberá túto bunku
  if (!deleted) {
    for (const imgKey in cellImages) {
      const [imgRow, imgCol] = imgKey.split('-').map(Number)
      const img = cellImages[imgKey]
      const cells = mainScene.getAffectedCells(imgRow, imgCol, img.cellsX || 1, img.cellsY || 1)
      
      if (cells.some(c => c.row === row && c.col === col)) {
        console.log(`🗑️ Nájdený obrázok ${imgKey} zaberajúci [${row}, ${col}], mažem...`)
        mainScene.removeBuilding(imgKey)
        delete cellImages[imgKey]
        
        // Vymaž aj sekundárne bunky
        const cellsX = img.cellsX || 1
        const cellsY = img.cellsY || 1
        if (cellsX > 1 || cellsY > 1) {
          for (let r = 0; r < cellsY; r++) {
            for (let c = 0; c < cellsX; c++) {
              if (r === 0 && c === 0) continue
              const secondaryKey = `${imgRow + r}-${imgCol + c}`
              if (cellImages[secondaryKey] && cellImages[secondaryKey].isSecondary) {
                console.log(`🗑️ Mažem sekundárnu bunku ${secondaryKey}`)
                delete cellImages[secondaryKey]
              }
            }
          }
        }
        
        deleted = true
        break
      }
    }
  }
  
  if (deleted && mainScene && mainScene.personManager) {
    // Aktualizuj PersonManager cache po vymazaní
    mainScene.personManager.updateWorkerRoadTiles()
    console.log('🔄 PersonManager cache aktualizovaný po vymazaní')
  }
  
  if (deleted && mainScene && mainScene.carManager) {
    // Aktualizuj CarManager cache po vymazaní
    mainScene.carManager.updateWorkerRoadTiles()
    console.log('🔄 CarManager cache aktualizovaný po vymazaní')
  }
  
  if (!deleted) {
    console.log(`⚠️ Žiadny obrázok na [${row}, ${col}] nebol nájdený`)
  }
  
  return deleted
}

// Expose funkcie
let isBatchLoading = false // Flag pre batch loading

defineExpose({
  placeImageAtSelectedCell,
  setBackgroundTiles,
  deleteImageAtCell,
  cellImages: () => cellImages,
  backgroundTiles: () => backgroundTiles,
  // Update structure sprite (construct or tempBuilding)
  updateStructureSprite: (type, url) => {
    if (!mainScene) return
    if (type === 'construct') {
      mainScene.constructSpriteUrl = url
      if (mainScene.textures.exists('construct')) {
        mainScene.textures.remove('construct')
      }
      mainScene.load.image('construct', url)
      mainScene.load.start()
      console.log('🏗️ Construct sprite texture updated')
    } else if (type === 'tempBuilding') {
      mainScene.tempBuildingSpriteUrl = url
      console.log('🏠 Temp building sprite URL updated')
    }
  },
  // Update car sprite (car1 or car2)
  updateCarSprite: (type, url) => {
    if (!mainScene) return
    if (mainScene.textures.exists(type)) {
      mainScene.textures.remove(type)
    }
    mainScene.load.image(type, url)
    mainScene.load.once('complete', () => {
      console.log(`🚗 Car sprite '${type}' texture updated`)
    })
    mainScene.load.start()
  },
  // Update person sprite (GIF)
  updatePersonSprite: (url) => {
    if (!mainScene) return
    mainScene.customPersonSpriteUrl = url
    // Remove old person textures to force reload
    const texturesToRemove = ['person1', 'person_front_0', 'person_front_1', 'person_front_2', 'person_front_3', 'person_back_0', 'person_back_1', 'person_back_2', 'person_back_3']
    texturesToRemove.forEach(key => {
      if (mainScene.textures.exists(key)) {
        mainScene.textures.remove(key)
      }
    })
    // Remove old animations
    if (mainScene.anims.exists('person_walk_front')) mainScene.anims.remove('person_walk_front')
    if (mainScene.anims.exists('person_walk_back')) mainScene.anims.remove('person_walk_back')
    // Reload person GIF with new URL
    mainScene.loadPersonGif().then(() => {
      console.log('🚶 Person sprite updated from custom URL')
    }).catch(err => {
      console.error('❌ Failed to update person sprite:', err)
    })
  },
  // Zapne batch loading mode - preskakuje tiene a osoby
  startBatchLoading: () => {
    isBatchLoading = true
    if (mainScene) {
      mainScene.batchLoading = true
    }
    console.log('📦 Batch loading ZAČATÝ')
  },
  // Ukončí batch loading a vykoná všetky odložené operácie
  finishBatchLoading: () => {
    isBatchLoading = false
    if (mainScene) {
      mainScene.batchLoading = false
      // Teraz prekresli tiene RAZ
      console.log('🌓 Prekreslenie všetkých tieňov...')
      mainScene.redrawAllShadows()
      // Aktualizuj road tiles pre worker, ale NEVYTVÁRAJ osoby automaticky!
      // (Osoby sa vytvárajú iba keď užívateľ pridáva road tiles v editore)
      if (mainScene.personManager) {
        mainScene.personManager.updateWorkerRoadTiles()
        console.log('🚶 Worker road tiles aktualizovaný (osoby sa nevytvárajú pri načítaní projektu)')
      }
    }
    console.log('📦 Batch loading DOKONČENÝ')
  },
  clearAll: () => {
    Object.keys(cellImages).forEach(key => {
      mainScene?.removeBuilding(key)
      delete cellImages[key] // Vymaž vlastnosť namiesto prepísania objektu
    })
    // NEPREPISUJ cellImages = {} lebo PersonManager má referenciu na tento objekt!
  },
  placeImageAtCell: (row, col, url, cellsX = 1, cellsY = 1, isBackground = false, isRoadTile = false, bitmap = null, tileName = '', tileMetadata = null, buildingData = null) => {
    const key = `${row}-${col}`
    // Najprv vymaž existujúci obrázok ak tam je
    if (cellImages[key]) {
      mainScene?.removeBuilding(key)
      delete cellImages[key]
    }
    
    // Priprav dáta pre uloženie
    const cellData = { 
      url, 
      cellsX, 
      cellsY, 
      isBackground, 
      isRoadTile,
      bitmap,
      templateName: tileName,
      libraryImageId: null, // Pri load z JSON sa nastaví cez updateCellImageLibraryId
      tileMetadata: tileMetadata || (isRoadTile && tileName ? { name: tileName } : null),
      buildingData: buildingData || null,
      originRow: row,
      originCol: col
    }
    
    // Ulož na hlavnej pozícii
    cellImages[key] = cellData
    
    // Pre budovy väčšie ako 1x1, ulož referenciu na všetky zabraté políčka
    if (cellsX > 1 || cellsY > 1) {
      for (let r = 0; r < cellsX; r++) {
        for (let c = 0; c < cellsY; c++) {
          if (r === 0 && c === 0) continue // Hlavné políčko už je uložené
          const cellKey = `${row + r}-${col + c}`
          cellImages[cellKey] = {
            ...cellData,
            isSecondary: true,
            originRow: row,
            originCol: col
          }
        }
      }
    }
    
    // Počas batch loadingu preskočíme tiene (vykonajú sa na konci)
    const dontDropShadow = cellData.buildingData?.dontDropShadow || false
    mainScene?.addBuildingWithShadow(key, url, row, col, cellsX, cellsY, isBackground, tileName, isRoadTile, bitmap, isBatchLoading, dontDropShadow, cellData.buildingData)
    
    // Počas batch loadingu preskočíme vytváranie osôb a aktualizciu workera
    if (!isBatchLoading) {
      if (isRoadTile && mainScene && mainScene.personManager && props.personSpawnEnabled) {
        const spawnCount = Math.max(0, Math.min(500, Math.round(props.personSpawnCount || 0)))
        if (spawnCount > 0) {
          mainScene.createPersonsAt(row, col, spawnCount)
        }
      }
      
      if (isRoadTile && mainScene && mainScene.carManager && props.carSpawnEnabled) {
        const carSpawnCount = Math.max(0, Math.min(500, Math.round(props.carSpawnCount || 0)))
        if (carSpawnCount > 0) {
          mainScene.createCarsAt(row, col, carSpawnCount)
        }
      }

      if (mainScene && mainScene.personManager) {
        mainScene.personManager.updateWorkerRoadTiles()
      }
      
      if (mainScene && mainScene.carManager) {
        mainScene.carManager.updateWorkerRoadTiles()
      }
    }
  },
  clearRoadBuilding: () => {
    mainScene?.clearRoadBuilding()
  },
  togglePerson: (visible) => {
    mainScene?.togglePerson(visible)
  },
  // Zobrazí warning indikátor nad budovou
  // type: 'resources' (žltý - nedostatok surovín) alebo 'storage' (červený - plný sklad)
  showWarningIndicator: (row, col, type = 'resources', missingResources = []) => {
    mainScene?.showWarningIndicator(row, col, type, missingResources)
  },
  // Skryje warning indikátor
  hideWarningIndicator: (row, col) => {
    mainScene?.hideWarningIndicator(row, col)
  },
  // Zobrazí indikátor auto-produkcie
  showAutoProductionIndicator: (row, col) => {
    mainScene?.showAutoProductionIndicator(row, col)
  },
  // Skryje indikátor auto-produkcie
  hideAutoProductionIndicator: (row, col) => {
    mainScene?.hideAutoProductionIndicator(row, col)
  },
  // Zapne produkčné efekty (dym/svetlo)
  showProductionEffects: (row, col) => {
    mainScene?.showProductionEffects(row, col)
  },
  // Vypne produkčné efekty (dym/svetlo)
  hideProductionEffects: (row, col) => {
    mainScene?.hideProductionEffects(row, col)
  },
  // Spustí fly-away efekt pre budovu
  triggerFlyAwayEffect: (row, col) => {
    mainScene?.triggerFlyAwayEffect(row, col)
  },
  // Zobrazí disabled overlay (tmavý pulzujúci odtieň) - manuálne zastavená budova
  showDisabledOverlay: (row, col) => {
    mainScene?.showDisabledOverlay(row, col)
  },
  // Skryje disabled overlay
  hideDisabledOverlay: (row, col) => {
    mainScene?.hideDisabledOverlay(row, col)
  },
  // Zobrazí ikony work-force alokácií na canvase
  showWorkforceAllocations: (positions) => {
    mainScene?.showWorkforceAllocations(positions)
  },
  // Skryje ikony work-force alokácií
  hideWorkforceAllocations: () => {
    mainScene?.hideWorkforceAllocations()
  },
  // Zvýrazní tile pod budovou
  highlightBuildingTile: (row, col, cellsX, cellsY) => {
    mainScene?.highlightBuildingTile(row, col, cellsX, cellsY)
  },
  // Zruší zvýraznenie tile pod budovou
  clearBuildingHighlight: () => {
    mainScene?.clearBuildingHighlight()
  },
  // Aplikuje efekt na hraciu plochu
  applyEffect: (effectName) => {
    mainScene?.applyEffect(effectName)
  },
  // Zobrazí plávajúci efekt mínus resources pri stavbe budovy
  showFloatingResourceCost: (row, col, resources) => {
    mainScene?.showFloatingResourceCost(row, col, resources)
  },
  // Spawn cars náhodne na road tiles
  spawnCarsOnAllRoads: (totalCount) => {
    if (!mainScene || !mainScene.carManager || totalCount <= 0) return
    // Nájdi všetky road tiles
    const roadKeys = Object.entries(cellImages)
      .filter(([key, data]) => data.isRoadTile && !data.isSecondary)
      .map(([key]) => key)
    if (roadKeys.length === 0) return
    console.log(`🚗 Spawning ${totalCount} cars na ${roadKeys.length} road tiles`)
    // Rozdeľ autá náhodne medzi road tiles
    for (let i = 0; i < totalCount; i++) {
      const randomKey = roadKeys[Math.floor(Math.random() * roadKeys.length)]
      const [row, col] = randomKey.split('-').map(Number)
      mainScene.createCarsAt(row, col, 1)
    }
  },
  // Spawn persons náhodne na road tiles
  spawnPersonsOnAllRoads: (totalCount) => {
    if (!mainScene || !mainScene.personManager || totalCount <= 0) return
    // Nájdi všetky road tiles
    const roadKeys = Object.entries(cellImages)
      .filter(([key, data]) => data.isRoadTile && !data.isSecondary)
      .map(([key]) => key)
    if (roadKeys.length === 0) return
    console.log(`🚶 Spawning ${totalCount} persons na ${roadKeys.length} road tiles`)
    // Rozdeľ osoby náhodne medzi road tiles
    for (let i = 0; i < totalCount; i++) {
      const randomKey = roadKeys[Math.floor(Math.random() * roadKeys.length)]
      const [row, col] = randomKey.split('-').map(Number)
      mainScene.createPersonsAt(row, col, 1)
    }
  },
  // Odstráni zadaný počet áut z canvasu
  removeCars: (count) => {
    if (!mainScene || !mainScene.carManager || count <= 0) return
    mainScene.carManager.removeCars(count)
  },
  // Odstráni zadaný počet osôb z canvasu
  removePersons: (count) => {
    if (!mainScene || !mainScene.personManager || count <= 0) return
    mainScene.personManager.removePersons(count)
  },
  // Získa aktuálny počet áut na canvase
  getCarCount: () => {
    return mainScene?.carManager?.getCarCount() || 0
  },
  // Získa aktuálny počet osôb na canvase
  getPersonCount: () => {
    return mainScene?.personManager?.getPersonCount() || 0
  },
  // Spawn cars na road tiles vedľa konkrétnej budovy
  spawnCarsOnAdjacentRoads: (buildingRow, buildingCol, totalCount, cellsX = 1, cellsY = 1) => {
    if (!mainScene || !mainScene.carManager || totalCount <= 0) return
    // Nájdi všetky bunky budovy
    const buildingCells = new Set()
    for (let dy = 0; dy < cellsY; dy++) {
      for (let dx = 0; dx < cellsX; dx++) {
        buildingCells.add(`${buildingRow + dy}-${buildingCol + dx}`)
      }
    }
    // Nájdi susedné road tiles - postupne rozširuj radius ak nenájde
    let adjacentRoads = []
    const maxSearchRadius = 5
    for (let radius = 1; radius <= maxSearchRadius && adjacentRoads.length === 0; radius++) {
      for (let dy = -radius; dy < cellsY + radius; dy++) {
        for (let dx = -radius; dx < cellsX + radius; dx++) {
          const r = buildingRow + dy
          const c = buildingCol + dx
          const k = `${r}-${c}`
          if (buildingCells.has(k)) continue
          const cell = cellImages[k]
          if (cell && cell.isRoadTile && !cell.isSecondary) {
            adjacentRoads.push({ row: r, col: c })
          }
        }
      }
      if (adjacentRoads.length > 0) {
        console.log(`🚗 Nájdené ${adjacentRoads.length} road tiles v radius ${radius} od budovy [${buildingRow},${buildingCol}]`)
      }
    }
    if (adjacentRoads.length === 0) {
      console.warn('⚠️ Žiadne road tiles v dosahu pre spawn cars pri budove', buildingRow, buildingCol)
      return
    }
    // Vyber najbližšiu road tile k stredu budovy
    const centerRow = buildingRow + (cellsY - 1) / 2
    const centerCol = buildingCol + (cellsX - 1) / 2
    let nearest = adjacentRoads[0]
    let minDist = Math.abs(nearest.row - centerRow) + Math.abs(nearest.col - centerCol)
    for (let i = 1; i < adjacentRoads.length; i++) {
      const dist = Math.abs(adjacentRoads[i].row - centerRow) + Math.abs(adjacentRoads[i].col - centerCol)
      if (dist < minDist) { minDist = dist; nearest = adjacentRoads[i] }
    }
    console.log(`🚗 Port: Spawning ${totalCount} cars na najbližšej road tile [${nearest.row},${nearest.col}]`)
    mainScene.createCarsAt(nearest.row, nearest.col, totalCount)
  },
  // Spawn persons pred konkrétnou budovou
  spawnPersonsAtBuilding: (buildingRow, buildingCol, totalCount, cellsX = 1, cellsY = 1) => {
    if (!mainScene || !mainScene.personManager || totalCount <= 0) return
    // Nájdi susedné road tiles - postupne rozširuj radius ak nenájde
    let adjacentRoads = []
    const maxSearchRadius = 5
    for (let radius = 1; radius <= maxSearchRadius && adjacentRoads.length === 0; radius++) {
      for (let dy = -radius; dy < cellsY + radius; dy++) {
        for (let dx = -radius; dx < cellsX + radius; dx++) {
          const r = buildingRow + dy
          const c = buildingCol + dx
          if (dy >= 0 && dy < cellsY && dx >= 0 && dx < cellsX) continue
          const k = `${r}-${c}`
          const cell = cellImages[k]
          if (cell && cell.isRoadTile && !cell.isSecondary) {
            adjacentRoads.push({ row: r, col: c })
          }
        }
      }
      if (adjacentRoads.length > 0) {
        console.log(`🚶 Nájdené ${adjacentRoads.length} road tiles v radius ${radius} od budovy [${buildingRow},${buildingCol}]`)
      }
    }
    // Ak nie sú road tiles, spawn priamo pred budovu (spodný riadok + 1)
    if (adjacentRoads.length === 0) {
      const spawnRow = buildingRow + cellsY
      const spawnCol = buildingCol
      console.log(`🚶 Port: Žiadne cesty v dosahu, spawn ${totalCount} persons priamo pred budovu [${spawnRow}, ${spawnCol}]`)
      mainScene.createPersonsAt(spawnRow, spawnCol, totalCount)
      return
    }
    // Vyber najbližšiu road tile k stredu budovy
    const centerRow = buildingRow + (cellsY - 1) / 2
    const centerCol = buildingCol + (cellsX - 1) / 2
    let nearest = adjacentRoads[0]
    let minDist = Math.abs(nearest.row - centerRow) + Math.abs(nearest.col - centerCol)
    for (let i = 1; i < adjacentRoads.length; i++) {
      const dist = Math.abs(adjacentRoads[i].row - centerRow) + Math.abs(adjacentRoads[i].col - centerCol)
      if (dist < minDist) { minDist = dist; nearest = adjacentRoads[i] }
    }
    console.log(`🚶 Port: Spawning ${totalCount} persons na najbližšej road tile [${nearest.row},${nearest.col}]`)
    mainScene.createPersonsAt(nearest.row, nearest.col, totalCount)
  },
  // Nastaví počet pracovníkov na stavbe a upraví rýchlosť animácie
  setConstructionWorkers: (row, col, workerCount) => {
    if (!mainScene) return false
    const key = `${row}-${col}`
    const animControl = mainScene.activeAnimations[key]
    if (!animControl) {
      console.warn(`⚠️ Žiadna aktívna animácia pre budovu [${row}, ${col}]`)
      return false
    }
    animControl.setWorkerCount(workerCount)
    return true
  },
  // Dispatchne ďalšie auto k budove pod stavbou
  dispatchExtraCarToBuilding: (targetRow, targetCol) => {
    if (!mainScene || !mainScene.carManager) return false
    const carResult = findNearestCar(mainScene.carManager.cars, targetRow, targetCol, cellImages)
    if (!carResult) {
      console.warn(`⚠️ Žiadne dostupné auto pre dispatch k [${targetRow}, ${targetCol}]`)
      return false
    }
    const key = `${targetRow}-${targetCol}`
    const animControl = mainScene.activeAnimations[key]
    
    const dispatch = dispatchCarToBuilding(
      mainScene,
      carResult.car,
      carResult.path,
      carResult.nearestRoad,
      targetRow,
      targetCol,
      {
        onArrive: () => {
          console.log(`🚗✅ Ďalšie auto dorazilo k budove [${targetRow}, ${targetCol}]`)
          // Uložíme dispatch na animationControl - vráti sa okamžite pri dokončení animácie
          if (animControl) {
            animControl._dispatches.push(dispatch)
          }
        },
        moveSpeed: 400,
        carManager: mainScene.carManager
      }
    )
    return true
  },
  // Spustí recykláciu budovy - reverzná animácia s dispatchom auta
  startRecycleForBuilding: (targetRow, targetCol, buildCost, onComplete) => {
    if (!mainScene) return false
    const key = `${targetRow}-${targetCol}`
    const buildingSprite = mainScene.buildingSprites[key]
    if (!buildingSprite) {
      console.warn(`⚠️ Žiadny sprite pre budovu [${targetRow}, ${targetCol}]`)
      return false
    }

    const cellData = cellImages[key]
    const cellsX = cellData?.cellsX || 1
    const cellsY = cellData?.cellsY || 1
    const hasCars = mainScene.carManager && mainScene.carManager.cars && mainScene.carManager.cars.length > 0

    // Compute positioning params (same as addBuildingWithShadow)
    const { x, y } = mainScene.gridToIso(targetRow, targetCol)
    let offsetX = 0
    let offsetY = 0
    if (cellsX === 1 && cellsY === 2) {
      offsetX = -TILE_WIDTH / 4
      offsetY = TILE_HEIGHT / 2
    } else if (cellsX === 2 && cellsY === 2) {
      offsetY = TILE_HEIGHT
    } else if (cellsX >= 3) {
      offsetY = TILE_HEIGHT * (cellsX - 1)
    }
    const targetWidth = TILE_WIDTH * cellsX * 0.95
    const baseShadowOffset = TILE_WIDTH * cellsX * 0.4
    const buildingData = cellData?.buildingData || {}
    const dontDropShadow = buildingData.dontDropShadow || false
    const isTreeTemplate = (cellData?.templateName || '').toLowerCase().includes('tree')

    // Emit initial state
    emit('building-state-changed', { row: targetRow, col: targetCol, state: hasCars ? 'recycling-waiting' : 'recycling' })

    const animResult = startRecycleAnimation(mainScene, {
      buildingSprite,
      row: targetRow,
      col: targetCol,
      cellsX,
      cellsY,
      x,
      y,
      offsetX,
      offsetY,
      targetWidth,
      dontDropShadow,
      isTreeTemplate,
      baseShadowOffset,
      shadowSprites: mainScene.shadowSprites,
      redrawShadowsAround: (r, c) => mainScene.redrawShadowsAround(r, c),
      createConstructionDustEffect: (cx, cy, cw, ch) => mainScene.createConstructionDustEffect(cx, cy, cw, ch),
      buildCost,
      waitForCar: hasCars,
      onWaitingForCar: () => {
        // Dispatch car to building
        if (mainScene.carManager && mainScene.carManager.cars.length > 0) {
          const carResult = findNearestCar(mainScene.carManager.cars, targetRow, targetCol, cellImages)
          if (carResult) {
            const dispatch = dispatchCarToBuilding(
              mainScene,
              carResult.car,
              carResult.path,
              carResult.nearestRoad,
              targetRow,
              targetCol,
              {
                onArrive: () => {
                  console.log(`♻️🚗 Auto dorazilo k recyklovanej budove [${targetRow}, ${targetCol}]`)
                  emit('building-state-changed', { row: targetRow, col: targetCol, state: 'recycling' })
                  animResult.animationControl.resume()
                  animResult.animationControl._dispatches.push(dispatch)
                },
                moveSpeed: 400,
                carManager: mainScene.carManager
              }
            )
          } else {
            // No car available - start without
            emit('building-state-changed', { row: targetRow, col: targetCol, state: 'recycling' })
            animResult.animationControl.resume()
          }
        } else {
          emit('building-state-changed', { row: targetRow, col: targetCol, state: 'recycling' })
          animResult.animationControl.resume()
        }
      },
      onAnimationComplete: () => {
        console.log(`♻️✅ Recycle animácia dokončená [${targetRow}, ${targetCol}]`)
        // Return all dispatched cars
        const anim = mainScene.activeAnimations[key]
        if (anim && anim._dispatches) {
          anim._dispatches.forEach(d => {
            if (d.instantReturn) d.instantReturn()
          })
          anim._dispatches = []
        }
        delete mainScene.activeAnimations[key]

        // Remove the building from canvas
        mainScene.removeBuilding(key)
        // Remove all cells
        const cX = cellData?.cellsX || 1
        const cY = cellData?.cellsY || 1
        for (let r = 0; r < cX; r++) {
          for (let c = 0; c < cY; c++) {
            delete cellImages[`${targetRow + r}-${targetCol + c}`]
          }
        }
        emit('image-placed') // Trigger canvas update

        if (onComplete) onComplete()
      }
    })

    // Store animation control
    mainScene.activeAnimations[key] = animResult.animationControl
    return true
  },
  // Dispatch extra car for recycle
  dispatchExtraCarToRecycle: (targetRow, targetCol) => {
    if (!mainScene || !mainScene.carManager) return false
    const carResult = findNearestCar(mainScene.carManager.cars, targetRow, targetCol, cellImages)
    if (!carResult) return false
    const key = `${targetRow}-${targetCol}`
    const animControl = mainScene.activeAnimations[key]

    const dispatch = dispatchCarToBuilding(
      mainScene,
      carResult.car,
      carResult.path,
      carResult.nearestRoad,
      targetRow,
      targetCol,
      {
        onArrive: () => {
          console.log(`♻️🚗 Extra auto dorazilo k recyklovanej budove [${targetRow}, ${targetCol}]`)
          if (animControl) {
            animControl._dispatches.push(dispatch)
          }
        },
        moveSpeed: 400,
        carManager: mainScene.carManager
      }
    )
    return true
  },
  // Aktualizuje URL a buildingData vo všetkých cellImages ktoré majú dané libraryImageId
  updateCellImagesByLibraryId: (libraryImageId, newUrl, newBuildingData) => {
    if (!libraryImageId) return
    let updatedCount = 0
    Object.entries(cellImages).forEach(([key, data]) => {
      if (data.libraryImageId === libraryImageId) {
        data.url = newUrl
        if (newBuildingData !== undefined) {
          data.buildingData = newBuildingData
        }
        // Aktualizuj aj sprite na canvase
        if (mainScene && !data.isSecondary) {
          mainScene.updateBuildingTexture(key, newUrl)
        }
        updatedCount++
      }
    })
    if (updatedCount > 0) {
      console.log(`🔄 PhaserCanvas: Aktualizovaných ${updatedCount} cellImages pre libraryImageId ${libraryImageId}`)
    }
    return updatedCount
  },
  // Nastaví libraryImageId pre cellImage na danom kľúči (používa sa po load z JSON)
  setCellImageLibraryId: (key, libraryImageId) => {
    if (cellImages[key]) {
      cellImages[key].libraryImageId = libraryImageId
      // Aktualizuj aj sekundárne bunky
      const data = cellImages[key]
      if (data.cellsX > 1 || data.cellsY > 1) {
        for (let r = 0; r < data.cellsX; r++) {
          for (let c = 0; c < data.cellsY; c++) {
            if (r === 0 && c === 0) continue
            const cellKey = `${data.originRow + r}-${data.originCol + c}`
            if (cellImages[cellKey]) {
              cellImages[cellKey].libraryImageId = libraryImageId
            }
          }
        }
      }
    }
  }
})

// Watch pre zmeny props
watch(() => props.showGrid, () => {
  mainScene?.refreshGrid()
})

watch(() => props.showNumbering, () => {
  mainScene?.refreshGrid()
})

// Watch pre zobrazenie osoby
watch(() => props.showPerson, (newVal) => {
  mainScene?.togglePerson(newVal)
})

// Watch pre alwaysShowEffects (editor mode)
watch(() => props.alwaysShowEffects, (enabled) => {
  if (!mainScene) return

  const keys = Object.keys(cellImages)
    .filter(key => !cellImages[key]?.isSecondary)

  keys.forEach(key => {
    const [row, col] = key.split('-').map(Number)
    if (enabled) {
      mainScene.showProductionEffects(row, col)
    } else {
      mainScene.hideProductionEffects(row, col)
    }
  })
})

// Watch pre road building mode - vyčisti stav keď sa vypne
watch(() => props.roadBuildingMode, (newVal) => {
  if (!newVal && mainScene) {
    mainScene.clearRoadBuilding()
  }
})

// Watch pre zmeny destination tiles restriction - prekresli hover keď sa zmení vybraná budova
watch([() => props.selectedBuildingCanBuildOnlyInDestination, () => props.selectedBuildingDestinationTiles], () => {
  if (mainScene) {
    mainScene.drawHover()
  }
}, { deep: true })

onMounted(() => {
  const config = {
    type: Phaser.AUTO,
    parent: gameContainer.value,
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: '#000000',
    scene: IsoScene,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH
    },
    input: {
      mouse: {
        preventDefaultWheel: true
      }
    }
  }
  
  game = new Phaser.Game(config)
  
  // Resize handler
  window.addEventListener('resize', () => {
    if (game) {
      game.scale.resize(window.innerWidth, window.innerHeight)
    }
  })
})

onUnmounted(() => {
  // Remove visibility change listener
  if (mainScene?._onVisibilityChange) {
    document.removeEventListener('visibilitychange', mainScene._onVisibilityChange)
  }
  // Remove edge scroll listener
  if (mainScene?._onEdgeMouseMove) {
    document.removeEventListener('mousemove', mainScene._onEdgeMouseMove)
  }
  if (game) {
    game.destroy(true)
    game = null
    mainScene = null
  }
})
</script>

<template>
  <div class="phaser-container">
    <div ref="gameContainer" class="game-container" :class="cursorClass"></div>
  </div>
</template>

<style scoped>
.phaser-container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  z-index: 1;
}

.game-container {
  width: 100%;
  height: 100%;
  cursor: default;
}

.game-container.has-selection {
  cursor: crosshair;
}

.game-container.road-mode {
  cursor: crosshair;
}

.game-container.delete-mode {
  cursor: not-allowed;
}

.game-container.recycle-mode {
  cursor: crosshair;
}

.game-container.destination-mode {
  cursor: crosshair;
}

.game-container canvas {
  display: block;
}


</style>
