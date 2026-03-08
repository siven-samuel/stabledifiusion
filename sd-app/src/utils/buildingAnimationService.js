/**
 * Service pre animáciu stavania budov
 * Obsahuje celú logiku animácie vrátane construct sprite-ov, 0.png tempSprite a masiek
 */

import { assetUrl } from './assetUrl.js'

const DEFAULT_BUILDING_ANIMATION_DURATION = 10000 // ms - použije sa ak nie je buildCost
const MIN_ANIMATION_DURATION = 3000 // ms - minimálna doba animácie
const TILE_WIDTH = 64
const TILE_HEIGHT = 32

/**
 * Vypočíta dobu animácie na základe buildCost
 * Doba = súčet amount všetkých resources v sekundách
 * @param {Array} buildCost - Pole { resourceId, resourceName, amount }
 * @returns {number} - Doba v ms
 */
function calculateAnimationDuration(buildCost) {
  if (!buildCost || !Array.isArray(buildCost) || buildCost.length === 0) {
    return DEFAULT_BUILDING_ANIMATION_DURATION
  }
  const totalAmount = buildCost.reduce((sum, item) => sum + (item.amount || 0), 0)
  const durationMs = totalAmount * 1000 // 1 sekunda za každý amount
  return Math.max(durationMs, MIN_ANIMATION_DURATION)
}

/**
 * Helper funkcia na kreslenie pie chart progress baru
 * Kreslí kruhový pie chart s výplňou podľa progress
 */
function drawPieChart(graphics, centerX, centerY, radius, progress, bgColor, fgColor, outlineColor) {
  graphics.clear()
  
  // Pozadie kruhu (zostávajúca časť)
  graphics.fillStyle(bgColor, 0.6)
  graphics.beginPath()
  graphics.arc(centerX, centerY, radius, 0, Math.PI * 2)
  graphics.closePath()
  graphics.fillPath()
  
  // Vyplnená časť (hotová časť) - kreslíme od vrchu (-PI/2)
  if (progress > 0) {
    const startAngle = -Math.PI / 2
    const endAngle = startAngle + (Math.PI * 2 * progress)
    
    graphics.fillStyle(fgColor, 0.85)
    graphics.beginPath()
    graphics.moveTo(centerX, centerY)
    graphics.arc(centerX, centerY, radius, startAngle, endAngle, false)
    graphics.lineTo(centerX, centerY)
    graphics.closePath()
    graphics.fillPath()
  }
  
  // Obrys
  graphics.lineStyle(1.5, outlineColor, 0.8)
  graphics.beginPath()
  graphics.arc(centerX, centerY, radius, 0, Math.PI * 2)
  graphics.closePath()
  graphics.strokePath()
  
  // Vnútorný kruh (pre lepší vzhľad - donut efekt)
  const innerRadius = radius * 0.45
  graphics.fillStyle(0x000000, 0.3)
  graphics.beginPath()
  graphics.arc(centerX, centerY, innerRadius, 0, Math.PI * 2)
  graphics.closePath()
  graphics.fillPath()
}

/**
 * Helper funkcia na kreslenie izometrickej masky
 */
function drawIsometricMask(graphics, centerX, bottomY, width, height, maxHeight) {
  graphics.clear()
  graphics.fillStyle(0xffffff)
  if (height <= 0) return
  
  const progress = height / maxHeight
  const currentWidth = width * progress
  const currentHeight = height
  const diamondCenterY = bottomY - currentHeight / 2
  
  graphics.beginPath()
  graphics.moveTo(centerX, bottomY) // Spodný bod
  graphics.lineTo(centerX + currentWidth / 2, diamondCenterY) // Pravý bod
  graphics.lineTo(centerX, bottomY - currentHeight) // Horný bod
  graphics.lineTo(centerX - currentWidth / 2, diamondCenterY) // Ľavý bod
  graphics.closePath()
  graphics.fillPath()
}

/**
 * Spustí REVERZNÚ animáciu budovy (recyklácia/demolícia)
 * Budova sa "rozoberie" zhora dole - maska sa zmenšuje od plnej výšky k nule
 * Obsahuje construct sprite-y a 0.png tempSprite rovnako ako stavebná animácia
 * 
 * @param {Object} scene - Phaser scéna
 * @param {Object} params - Parametre
 * @returns {Object} - { animationControl }
 */
export function startRecycleAnimation(scene, params) {
  const {
    buildingSprite,
    row,
    col,
    cellsX = 1,
    cellsY = 1,
    x: gridX,
    y: gridY,
    offsetX = 0,
    offsetY = 0,
    targetWidth,
    dontDropShadow = false,
    isTreeTemplate = false,
    baseShadowOffset = 0,
    shadowSprites,
    redrawShadowsAround,
    createConstructionDustEffect,
    buildCost = null,
    waitForCar = true,
    onWaitingForCar = null,
    onAnimationComplete = null
  } = params

  const gridKey = `${row}-${col}`
  const RECYCLE_DURATION = calculateAnimationDuration(buildCost)
  const spriteHeight = buildingSprite.displayHeight
  const finalY = buildingSprite.y
  const diamondHeight = (cellsX + cellsY) * (TILE_HEIGHT / 2)
  const effectiveTargetWidth = targetWidth || buildingSprite.displayWidth

  // === PIE CHART ===
  const pieChartRadius = Math.max(8, Math.min(14, effectiveTargetWidth * 0.12))
  const pieChartX = buildingSprite.x
  let pieChartGraphics = scene.add.graphics()
  pieChartGraphics.setDepth(999999)
  pieChartGraphics.setAlpha(0)
  let pieChartVisible = false

  // Phase 2 progress tracking (same as build animation)
  const phase2StartHeight = diamondHeight / 2
  const phase2TotalHeight = spriteHeight - phase2StartHeight

  // === DUST EFFECT ===
  let constructionEffects = createConstructionDustEffect(
    buildingSprite.x,
    finalY - spriteHeight,
    buildingSprite.displayWidth,
    spriteHeight
  )
  if (constructionEffects) {
    constructionEffects.setDepth(Math.max(buildingSprite.depth + 0.2, 1.0))
  }

  // === MASK FOR BUILDING - starts at full height ===
  const maskShape = scene.make.graphics()
  maskShape.fillStyle(0xffffff)
  maskShape.fillRect(
    buildingSprite.x - buildingSprite.displayWidth / 2,
    finalY - spriteHeight,
    buildingSprite.displayWidth,
    spriteHeight
  )
  const mask = maskShape.createGeometryMask()
  buildingSprite.setMask(mask)

  // === CONSTRUCT SPRITES na 3 cípoch diamantu ===
  const constructSprites = []
  const constructMasks = []
  
  const originYOffset = -(Math.max(cellsX, cellsY) - 1) * TILE_HEIGHT
  const diamondTips = [
    { name: 'left', x: gridX + offsetX - (cellsY * TILE_WIDTH) / 2, y: gridY + offsetY + originYOffset + ((cellsX + cellsY) * TILE_HEIGHT) / 4 },
    { name: 'bottom', x: gridX + offsetX, y: gridY + offsetY + originYOffset + ((cellsX + cellsY) * TILE_HEIGHT) / 2 },
    { name: 'right', x: gridX + offsetX + (cellsY * TILE_WIDTH) / 2, y: gridY + offsetY + originYOffset + ((cellsX + cellsY) * TILE_HEIGHT) / 4 }
  ]
  
  if (scene.textures.exists('construct') && !dontDropShadow) {
    diamondTips.forEach((tip) => {
      const constructSprite = scene.add.sprite(tip.x, tip.y, 'construct')
      const constructScale = (TILE_WIDTH * 0.2) / constructSprite.width
      constructSprite.setScale(constructScale)
      constructSprite.setOrigin(0.5, 1)
      
      if (tip.name === 'left') {
        constructSprite.x += constructSprite.displayWidth
        constructSprite.y += 5
      } else if (tip.name === 'right') {
        constructSprite.x -= constructSprite.displayWidth
        constructSprite.y += 5
      }
      
      // Construct mask - starts hidden (height=0), appears only in phase 2
      const constructMaskShape = scene.make.graphics()
      constructMaskShape.fillStyle(0xffffff)
      constructMaskShape.fillRect(
        constructSprite.x - constructSprite.displayWidth / 2,
        constructSprite.y,
        constructSprite.displayWidth,
        0
      )
      const constructMask = constructMaskShape.createGeometryMask()
      constructSprite.setMask(constructMask)
      
      // Set depth same as during building: buildingSprite.depth + 1
      constructSprite.setDepth(buildingSprite.depth + 1)
      
      constructSprites.push(constructSprite)
      constructMasks.push({ shape: constructMaskShape, sprite: constructSprite, height: spriteHeight, initialY: constructSprite.y })
    })
  }

  // === 0.PNG TEMP SPRITE ===
  const tempBuildingKey = `temp_recycle_${gridKey}_${Date.now()}`
  let tempSprite = null
  let tempSpriteInitialY = 0
  let tempSpriteMaskShape = null
  let tempSpriteHeight = 0
  
  scene.load.image(tempBuildingKey, assetUrl('/templates/cubes1/0.png'))
  scene.load.once('complete', () => {
    tempSprite = scene.add.sprite(gridX + offsetX, gridY + TILE_HEIGHT + offsetY, tempBuildingKey)
    const tempScale = effectiveTargetWidth / tempSprite.width
    tempSprite.setScale(tempScale)
    tempSprite.setOrigin(0.5, 1)
    tempSprite.setDepth(buildingSprite.depth + 2) // Same as build: above building and construct sprites
    tempSprite.setAlpha(1)
    
    tempSpriteInitialY = tempSprite.y
    tempSpriteHeight = tempSprite.displayHeight
    
    // Temp sprite mask - starts hidden, will be revealed based on currentHeight in updateReverseHeight
    tempSpriteMaskShape = scene.make.graphics()
    drawIsometricMask(tempSpriteMaskShape, tempSprite.x, tempSpriteInitialY, tempSprite.displayWidth, 0, tempSpriteHeight)
    const tempMask = tempSpriteMaskShape.createGeometryMask()
    tempSprite.setMask(tempMask)
    
    // Shadow for temp sprite - starts hidden
    shadowSprites[tempBuildingKey] = {
      textureKey: tempBuildingKey,
      x: gridX + offsetX,
      y: gridY + TILE_HEIGHT + offsetY,
      scale: tempScale,
      scaleMultiplier: 0,
      alpha: 1,
      cellsX,
      isTree: isTreeTemplate,
      offsetX: -baseShadowOffset,
      offsetY: baseShadowOffset * 0.375
    }
  })
  scene.load.start()

  // === ANIMATION CONTROL ===
  const animationControl = {
    isPaused: false,
    _tween: null,
    _phase: 1,
    _waitingForPhase2: false,
    _startPhase2: null,
    _workerCount: 1,
    _dispatches: [],
    _buildingData: { buildCost },
    pause() {
      if (this._tween && !this.isPaused) {
        this._tween.pause()
        this.isPaused = true
      }
    },
    resume() {
      if (this._waitingForPhase2) {
        this._waitingForPhase2 = false
        this.isPaused = false
        if (this._startPhase2) this._startPhase2()
      } else if (this._tween && this.isPaused) {
        this._tween.resume()
        this.isPaused = false
      }
    },
    setWorkerCount(count) {
      this._workerCount = Math.max(1, count)
      if (this._tween && this._phase === 2) {
        this._tween.setTimeScale(this._workerCount)
      }
    }
  }

  // === UPDATE FUNCTION - reverse: height goes from spriteHeight down to 0 ===
  // Maps the decreasing height to the BUILD animation phases in reverse order
  function updateReverseHeight(currentHeight) {
    // Main building mask
    maskShape.clear()
    maskShape.fillStyle(0xffffff)
    if (currentHeight > 0) {
      maskShape.fillRect(
        buildingSprite.x - buildingSprite.displayWidth / 2,
        finalY - currentHeight,
        buildingSprite.displayWidth,
        currentHeight
      )
    }

    // Dust effects follow top edge
    if (constructionEffects) {
      constructionEffects.setPosition(buildingSprite.x, finalY - currentHeight)
    }

    // Shadow scale follows progress
    if (shadowSprites[gridKey]) {
      shadowSprites[gridKey].scaleMultiplier = currentHeight / spriteHeight
    }

    // === PIE CHART ===
    if (pieChartGraphics) {
      if (currentHeight <= spriteHeight - phase2StartHeight) {
        if (!pieChartVisible) {
          pieChartVisible = true
          pieChartGraphics.setAlpha(1)
        }
        const phase2Progress = Math.min(1, 1 - (currentHeight / (spriteHeight - phase2StartHeight)))
        const currentPieY = finalY - currentHeight - pieChartRadius - 4
        
        drawPieChart(
          pieChartGraphics,
          pieChartX,
          currentPieY,
          pieChartRadius,
          phase2Progress,
          0x333333,
          0xf59e0b, // orange/yellow for recycle
          0xffffff
        )
      }
    }

    // === CONSTRUCT SPRITES - reverse of build animation ===
    if (!dontDropShadow) {
      constructMasks.forEach(maskInfo => {
        let currentConstructHeight = 0
        
        const constructPhase3Start = dontDropShadow 
          ? spriteHeight - diamondHeight / 0.5
          : spriteHeight - diamondHeight / 1.2
        
        // Reverse: map currentHeight to the same phases as build
        if (currentHeight >= diamondHeight / 2 && currentHeight < constructPhase3Start) {
          const constructAnimDuration = constructPhase3Start - diamondHeight / 2
          const progressInConstruct = (currentHeight - diamondHeight / 2) / constructAnimDuration
          currentConstructHeight = progressInConstruct * maskInfo.height
        } else if (currentHeight >= constructPhase3Start) {
          const phase3Duration = spriteHeight - constructPhase3Start
          const phase3Progress = (currentHeight - constructPhase3Start) / phase3Duration
          currentConstructHeight = maskInfo.height * (1 - phase3Progress)
        }
        
        const maskTopY = finalY - currentHeight
        const maskBottomY = maskInfo.initialY
        const actualMaskHeight = Math.min(currentConstructHeight, maskBottomY - maskTopY)
        
        maskInfo.shape.clear()
        maskInfo.shape.fillStyle(0xffffff)
        if (actualMaskHeight > 0) {
          maskInfo.shape.fillRect(
            maskInfo.sprite.x - maskInfo.sprite.displayWidth / 2,
            maskBottomY - actualMaskHeight,
            maskInfo.sprite.displayWidth,
            actualMaskHeight
          )
        }
      })
    }

    // === 0.PNG TEMP SPRITE - reverse of build animation ===
    if (tempSprite && tempSpriteMaskShape) {
      if (dontDropShadow) {
        // Reverse for dontDropShadow buildings
        if (currentHeight < spriteHeight - diamondHeight / 2.2) {
          tempSprite.y = tempSpriteInitialY
          const tempPhase1Duration = spriteHeight - diamondHeight / 2.2
          const tempPhase1Progress = currentHeight / tempPhase1Duration
          const tempMaskHeight = tempPhase1Progress * tempSpriteHeight
          drawIsometricMask(tempSpriteMaskShape, tempSprite.x, tempSpriteInitialY, tempSprite.displayWidth, tempMaskHeight, tempSpriteHeight)
        } else {
          tempSprite.y = tempSpriteInitialY
          const phase3Progress = (currentHeight - (spriteHeight - diamondHeight / 2.2)) / (diamondHeight / 2.2)
          const remainingMaskHeight = tempSpriteHeight * (1 - phase3Progress)
          const newBottomY = tempSpriteInitialY - (tempSpriteHeight - remainingMaskHeight)
          drawIsometricMask(tempSpriteMaskShape, tempSprite.x, newBottomY, tempSprite.displayWidth, remainingMaskHeight, tempSpriteHeight)
        }
      } else {
        // Reverse for normal buildings - 3 phases mapped by currentHeight
        if (currentHeight < diamondHeight / 2) {
          // Phase 1 of build (low height) - 0.png mask grows from bottom
          tempSprite.y = tempSpriteInitialY
          const tempMaskHeight = (currentHeight / (diamondHeight / 2)) * tempSpriteHeight
          drawIsometricMask(tempSpriteMaskShape, tempSprite.x, tempSpriteInitialY, tempSprite.displayWidth, tempMaskHeight, tempSpriteHeight)
          
          if (shadowSprites[tempBuildingKey]) {
            shadowSprites[tempBuildingKey].scaleMultiplier = 0
          }
        } else if (currentHeight < spriteHeight - diamondHeight / 2.2) {
          // Phase 2 of build (mid height) - 0.png moves up
          const traveledHeight = currentHeight - diamondHeight / 2
          tempSprite.y = tempSpriteInitialY - traveledHeight
          drawIsometricMask(tempSpriteMaskShape, tempSprite.x, tempSprite.y, tempSprite.displayWidth, tempSpriteHeight, tempSpriteHeight)
          
          const tempPhase2Duration = (spriteHeight - diamondHeight / 2.2) - diamondHeight / 2
          const tempPhase2Progress = (currentHeight - diamondHeight / 2) / tempPhase2Duration
          if (shadowSprites[tempBuildingKey]) {
            shadowSprites[tempBuildingKey].scaleMultiplier = tempPhase2Progress
            shadowSprites[tempBuildingKey].y = tempSprite.y
          }
          redrawShadowsAround(row, col)
        } else {
          // Phase 3 of build (high height) - 0.png fades from top
          const finalTempY = tempSpriteInitialY - (spriteHeight - diamondHeight / 2.2 - diamondHeight / 2)
          tempSprite.y = finalTempY
          
          const phase3Progress = (currentHeight - (spriteHeight - diamondHeight / 2.2)) / (diamondHeight / 2.2)
          const remainingMaskHeight = tempSpriteHeight * (1 - phase3Progress)
          const newBottomY = finalTempY - (tempSpriteHeight - remainingMaskHeight)
          drawIsometricMask(tempSpriteMaskShape, tempSprite.x, newBottomY, tempSprite.displayWidth, remainingMaskHeight, tempSpriteHeight)
          
          if (shadowSprites[tempBuildingKey]) {
            shadowSprites[tempBuildingKey].scaleMultiplier = 1
            shadowSprites[tempBuildingKey].y = finalTempY
          }
        }
      }
    }
  }

  // === CLEANUP ===
  function cleanupAnimation() {
    buildingSprite.clearMask(true)
    if (maskShape) maskShape.destroy()
    if (constructionEffects) {
      constructionEffects.stop()
      scene.time.delayedCall(1000, () => {
        constructionEffects.destroy()
      })
    }
    if (pieChartGraphics) {
      pieChartGraphics.destroy()
      pieChartGraphics = null
    }
    // Cleanup tempSprite
    if (tempSprite) {
      tempSprite.destroy()
      tempSprite = null
    }
    if (tempSpriteMaskShape) {
      tempSpriteMaskShape.destroy()
      tempSpriteMaskShape = null
    }
    if (shadowSprites[tempBuildingKey]) {
      delete shadowSprites[tempBuildingKey]
    }
    // Cleanup construct sprites
    constructSprites.forEach(sprite => {
      if (sprite) sprite.destroy()
    })
    constructMasks.forEach(maskInfo => {
      if (maskInfo.shape) maskInfo.shape.destroy()
    })
    // Redraw shadows
    redrawShadowsAround(row, col)
    
    if (onAnimationComplete) onAnimationComplete()
  }

  // Phase 2: actual reverse animation (after car arrives)
  function startPhase2Fn() {
    animationControl._phase = 2
    const phase2Tween = scene.tweens.addCounter({
      from: spriteHeight,
      to: 0,
      duration: RECYCLE_DURATION,
      ease: 'Linear',
      onUpdate: (tween) => updateReverseHeight(tween.getValue()),
      onComplete: cleanupAnimation
    })
    animationControl._tween = phase2Tween
    if (animationControl._workerCount > 1) {
      phase2Tween.setTimeScale(animationControl._workerCount)
    }
    console.log(`♻️ Recycle fáza 2 [${row}, ${col}]: ${RECYCLE_DURATION}ms, ${animationControl._workerCount}x rýchlosť`)
  }
  animationControl._startPhase2 = startPhase2Fn

  if (waitForCar) {
    // Immediately pause and wait for car
    animationControl.isPaused = true
    animationControl._waitingForPhase2 = true
    console.log(`♻️ Recycle [${row}, ${col}] čaká na auto`)
    if (onWaitingForCar) onWaitingForCar()
  } else {
    startPhase2Fn()
  }

  return { animationControl }
}

/**
 * Spustí animáciu stavania budovy
 * @param {Object} scene - Phaser scéna (this z PhaserCanvas)
 * @param {Object} params - Parametre animácie
 * @returns {Object} - { constructSprites, animationControl }
 *   constructSprites - Pole construct sprite-ov (na neskoršie nastavenie depth)
 *   animationControl - { pause(), resume(), isPaused } pre pozastavenie/obnovenie animácie
 */
export function startBuildingAnimation(scene, params) {
  const {
    buildingSprite,
    key,
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
    shadowSprites,
    redrawShadowsAround,
    row,
    col,
    createConstructionDustEffect,
    waitForCar = false, // Ak true, animácia sa zastaví po fáze 1 a čaká na resumeAnimation()
    onAnimationComplete = null, // Callback keď animácia skutočne dobehne (rešpektuje pauzy)
    onWaitingForCar = null, // Callback keď animácia čaká na auto (fáza 1 dokončená)
    buildCost = null // Pole resources s amount - určuje dobu trvania animácie
  } = params
  
  // Grid kľúč pre prístup k shadowSprites (shadow je uložený pod "row-col", nie pod textureKey)
  const gridKey = `${row}-${col}`
  
  // Vypočítame dobu animácie na základe buildCost
  const BUILDING_ANIMATION_DURATION = calculateAnimationDuration(buildCost)
  const totalBuildAmount = buildCost ? buildCost.reduce((sum, item) => sum + (item.amount || 0), 0) : 0
  console.log(`🏗️ Animácia stavby [${row}, ${col}]: trvanie ${BUILDING_ANIMATION_DURATION}ms (buildCost total: ${totalBuildAmount})`)
  
  // Kontrolný objekt pre pause/resume
  const animationControl = {
    isPaused: false,
    _tween: null,
    _phase: 1, // 1 = fáza 1 (0.png), 2 = fáza 2 (stavba)
    _waitingForPhase2: false, // Čaká sa na auto pred spustením fázy 2
    _startPhase2: null, // Funkcia na spustenie fázy 2
    _buildingData: { buildCost }, // Uložíme buildCost pre prístup z PhaserCanvas
    _workerCount: 1, // Počet pracovníkov na stavbe
    _dispatches: [], // Pole dispatch objektov (cars) pri stavbe
    pause() {
      if (this._tween && !this.isPaused) {
        this._tween.pause()
        this.isPaused = true
        console.log(`⏸️ Animácia stavby pozastavená pre [${row}, ${col}]`)
      }
    },
    resume() {
      if (this._waitingForPhase2) {
        // Fáza 1 dokončená, spúšťame fázu 2
        this._waitingForPhase2 = false
        this.isPaused = false
        if (this._startPhase2) this._startPhase2()
        console.log(`▶️ Animácia stavby obnovená pre [${row}, ${col}] - štart fázy 2`)
      } else if (this._tween && this.isPaused) {
        this._tween.resume()
        this.isPaused = false
        console.log(`▶️ Animácia stavby obnovená pre [${row}, ${col}]`)
      }
    },
    /**
     * Nastaví počet pracovníkov a upravia rýchlosť animácie
     * 1 worker = základná rýchlosť, 2 = 2x rýchlejsie, 3 = 3x rýchlejsie atď.
     * Ovplyvňuje len fázu 2 (skutočná stavba)
     * @param {number} count - Počet pracovníkov
     */
    setWorkerCount(count) {
      this._workerCount = Math.max(1, count)
      if (this._tween && this._phase === 2) {
        this._tween.setTimeScale(this._workerCount)
      }
      console.log(`👷 Stavba [${row}, ${col}]: ${this._workerCount} pracovníkov, rýchlosť ${this._workerCount}x`)
    }
  }
  
  // Uložíme si pôvodné rozmery
  const spriteHeight = buildingSprite.displayHeight
  const finalY = buildingSprite.y
  
  // Vypočítame výšku diamantu tile na izometrickej ploche
  const diamondHeight = (cellsX + cellsY) * (TILE_HEIGHT / 2)
  
  // Umiestnime obrazok 0.png na tile pri začiatku animácie
  const tempBuildingKey = `temp_building_${key}_${Date.now()}`
  let tempSprite = null
  let tempSpriteInitialY = 0
  let tempSpriteMaskShape = null
  let tempSpriteHeight = 0
  
  scene.load.image(tempBuildingKey, assetUrl('/templates/cubes1/0.png'))
  scene.load.once('complete', () => {
    tempSprite = scene.add.sprite(x + offsetX, y + TILE_HEIGHT + offsetY, tempBuildingKey)
    const tempScale = targetWidth / tempSprite.width
    tempSprite.setScale(tempScale)
    tempSprite.setOrigin(0.5, 1)
    tempSprite.setDepth(buildingSprite.depth + 2) // Najvrchnejšia vrstva - nad všetkým
    tempSprite.setAlpha(1)
    
    // Uložíme počiatočnú Y pozíciu a výšku
    tempSpriteInitialY = tempSprite.y
    tempSpriteHeight = tempSprite.displayHeight
    
    // Vytvoríme masku pre tempSprite s izometrickou šikmosťou
    tempSpriteMaskShape = scene.make.graphics()
    drawIsometricMask(tempSpriteMaskShape, tempSprite.x, tempSpriteInitialY, tempSprite.displayWidth, 0, tempSpriteHeight)
    const tempMask = tempSpriteMaskShape.createGeometryMask()
    tempSprite.setMask(tempMask)
    
    // Vytvoríme shadowInfo pre tempSprite s nulovou veľkosťou (žiadny tieň na začiatku)
    shadowSprites[tempBuildingKey] = {
      textureKey: tempBuildingKey,
      x: x + offsetX,
      y: y + TILE_HEIGHT + offsetY,
      scale: tempScale,
      scaleMultiplier: 0,
      alpha: 1,
      cellsX,
      isTree: isTreeTemplate,
      offsetX: -baseShadowOffset,
      offsetY: baseShadowOffset * 0.375
    }
    
    // Cleanup tempSprite sa vykoná v onComplete hlavného tweenu (nie cez delayedCall)
  })
  scene.load.start()
  
  // === CONSTRUCT SPRITES V 3 CÍPOCH DIAMANTU ===
  const constructSprites = []
  const constructMasks = []
  
  const originYOffset = -(Math.max(cellsX, cellsY) - 1) * TILE_HEIGHT
  const diamondTips = [
    { name: 'left', x: x + offsetX - (cellsY * TILE_WIDTH) / 2, y: y + offsetY + originYOffset + ((cellsX + cellsY) * TILE_HEIGHT) / 4 },
    { name: 'bottom', x: x + offsetX, y: y + offsetY + originYOffset + ((cellsX + cellsY) * TILE_HEIGHT) / 2 },
    { name: 'right', x: x + offsetX + (cellsY * TILE_WIDTH) / 2, y: y + offsetY + originYOffset + ((cellsX + cellsY) * TILE_HEIGHT) / 4 }
  ]
  
  if (scene.textures.exists('construct') && !dontDropShadow) {
    diamondTips.forEach((tip) => {
      const constructSprite = scene.add.sprite(tip.x, tip.y, 'construct')
      const constructScale = (TILE_WIDTH * 0.2) / constructSprite.width
      constructSprite.setScale(constructScale)
      constructSprite.setOrigin(0.5, 1)
      
      if (tip.name === 'left') {
        constructSprite.x += constructSprite.displayWidth
        constructSprite.y += 5
        constructSprite.x -= 0
      } else if (tip.name === 'right') {
        constructSprite.x -= constructSprite.displayWidth
        constructSprite.y += 5
        constructSprite.x += 0
      }
      
      // Vytvoríme masku pre construct sprite
      const constructMaskShape = scene.make.graphics()
      constructMaskShape.fillStyle(0xffffff)
      constructMaskShape.fillRect(
        constructSprite.x - constructSprite.displayWidth / 2,
        constructSprite.y,
        constructSprite.displayWidth,
        0
      )
      const constructMask = constructMaskShape.createGeometryMask()
      constructSprite.setMask(constructMask)
      
      constructSprites.push(constructSprite)
      constructMasks.push({ shape: constructMaskShape, sprite: constructSprite, height: spriteHeight, initialY: constructSprite.y })
    })
  } else {
    console.warn('⚠️ Textúra construct.png nebola nájdená')
  }
  
  // Cleanup construct sprite-ov sa vykoná v onComplete hlavného tweenu (nie cez delayedCall)
  
  // Vytvoríme rect masku pre hlavnú budovu
  const maskShape = scene.make.graphics()
  maskShape.fillStyle(0xffffff)
  maskShape.fillRect(
    buildingSprite.x - buildingSprite.displayWidth / 2,
    finalY,
    buildingSprite.displayWidth,
    0
  )
  const mask = maskShape.createGeometryMask()
  buildingSprite.setMask(mask)
  
  // Vytvoríme efekt stavebného dymu/prachu na vrchu masky
  const constructionEffects = createConstructionDustEffect(
    buildingSprite.x,
    finalY - spriteHeight,
    buildingSprite.displayWidth,
    spriteHeight
  )
  if (constructionEffects) {
    // Zabezpečíme že dym bude vždy nad road tiles (depth 0.5)
    constructionEffects.setDepth(Math.max(buildingSprite.depth + 0.2, 1.0))
  }
  
  // === PIE CHART PROGRESS BAR ===
  const pieChartRadius = Math.max(8, Math.min(14, targetWidth * 0.12))
  const pieChartX = buildingSprite.x
  const pieChartY = finalY - spriteHeight - pieChartRadius - 4 // Nad budovou
  
  let pieChartGraphics = null
  let pieChartVisible = false // Zobrazíme až od fázy 2 (keď príde auto)
  
  // Vytvoríme pie chart graphics
  pieChartGraphics = scene.add.graphics()
  pieChartGraphics.setDepth(999999) // Najvyšší depth - vždy nad všetkým
  pieChartGraphics.setAlpha(0) // Skrytý na začiatku
  
  // Fáza 1 je od 0 do diamondHeight/2 v hodnotách height
  // Fáza 2+ je od diamondHeight/2 do spriteHeight
  // Progress bar sleduje fázu 2+ (od príchodu auta)
  const phase2StartHeight = diamondHeight / 2
  const phase2TotalHeight = spriteHeight - phase2StartHeight
  
  // === SPOLOČNÁ FUNKCIA PRE AKTUALIZÁCIU ANIMÁCIE ===
  // Volá sa z oboch fáz tweenu s aktuálnou hodnotou výšky
  function updateAnimationHeight(height) {
    maskShape.clear()
    maskShape.fillStyle(0xffffff)
    maskShape.fillRect(
      buildingSprite.x - buildingSprite.displayWidth / 2,
      finalY - height,
      buildingSprite.displayWidth,
      height
    )
    
    // Posúvame efekty dymu/prachu s hornou hranou masky
    if (constructionEffects) {
      constructionEffects.setPosition(
        buildingSprite.x,
        finalY - height
      )
    }
    
    // === PIE CHART PROGRESS BAR UPDATE ===
    if (pieChartGraphics) {
      if (height >= phase2StartHeight) {
        // Zobrazíme pie chart od fázy 2
        if (!pieChartVisible) {
          pieChartVisible = true
          pieChartGraphics.setAlpha(1)
        }
        
        // Progress od 0 do 1 počas fázy 2+
        const phase2Progress = Math.min(1, (height - phase2StartHeight) / phase2TotalHeight)
        
        // Pozícia pie chartu sa posúva s vrchom budovy
        const currentPieY = finalY - height - pieChartRadius - 4
        
        drawPieChart(
          pieChartGraphics,
          pieChartX,
          currentPieY,
          pieChartRadius,
          phase2Progress,
          0x333333,  // bgColor - tmavosivá
          0x44cc44,  // fgColor - zelená
          0xffffff   // outlineColor - biela
        )
      }
    }
    
    // Animujeme masky construct sprite-ov
    if (!dontDropShadow) {
      constructMasks.forEach(maskInfo => {
        let currentHeight = 0
        
        const constructPhase3Start = dontDropShadow 
          ? spriteHeight - diamondHeight / 0.5
          : spriteHeight - diamondHeight / 1.2
        
        if (height >= diamondHeight / 2 && height < constructPhase3Start) {
          const constructAnimDuration = constructPhase3Start - diamondHeight / 2
          const progressInConstruct = (height - diamondHeight / 2) / constructAnimDuration
          currentHeight = progressInConstruct * maskInfo.height
        } else if (height >= constructPhase3Start) {
          const phase3Duration = spriteHeight - constructPhase3Start
          const phase3Progress = (height - constructPhase3Start) / phase3Duration
          currentHeight = maskInfo.height * (1 - phase3Progress)
        }
        
        const maskTopY = finalY - height
        const maskBottomY = maskInfo.initialY
        const actualMaskHeight = Math.min(currentHeight, maskBottomY - maskTopY)
        
        maskInfo.shape.clear()
        maskInfo.shape.fillStyle(0xffffff)
        if (actualMaskHeight > 0) {
          maskInfo.shape.fillRect(
            maskInfo.sprite.x - maskInfo.sprite.displayWidth / 2,
            maskBottomY - actualMaskHeight,
            maskInfo.sprite.displayWidth,
            actualMaskHeight
          )
        }
      })
    }
    
    // 3 fázy pohybu tempSprite:
    if (tempSprite && tempSpriteMaskShape) {
      // Pre budovy s dontDropShadow: len fáza 1 a fáza 3 (bez pohybu hore)
      if (dontDropShadow) {
        // Fáza 1: Vykresľovanie masky 0.png zdola hore do plnej výšky
        if (height < spriteHeight - diamondHeight / 2.2) {
          tempSprite.y = tempSpriteInitialY
          
          const tempPhase1Duration = spriteHeight - diamondHeight / 2.2
          const tempPhase1Progress = height / tempPhase1Duration
          const tempMaskHeight = tempPhase1Progress * tempSpriteHeight
          
          drawIsometricMask(tempSpriteMaskShape, tempSprite.x, tempSpriteInitialY, tempSprite.displayWidth, tempMaskHeight, tempSpriteHeight)
        }
        // Fáza 3: Stojí a maska mizne zhora dole (opačný smer)
        else {
          tempSprite.y = tempSpriteInitialY
          
          const phase3Progress = (height - (spriteHeight - diamondHeight / 2.2)) / (diamondHeight / 2.2)
          const remainingMaskHeight = tempSpriteHeight * (1 - phase3Progress)
          const newBottomY = tempSpriteInitialY - (tempSpriteHeight - remainingMaskHeight)
          
          drawIsometricMask(tempSpriteMaskShape, tempSprite.x, newBottomY, tempSprite.displayWidth, remainingMaskHeight, tempSpriteHeight)
        }
      }
      // Pre normálne budovy: všetky 3 fázy
      else {
        // Fáza 1: Vykresľovanie masky 0.png zdola hore kým maska nedosiahne diamondHeight / 2
        if (height < diamondHeight / 2) {
          tempSprite.y = tempSpriteInitialY
          
          const tempMaskHeight = (height / (diamondHeight / 2)) * tempSpriteHeight
          drawIsometricMask(tempSpriteMaskShape, tempSprite.x, tempSpriteInitialY, tempSprite.displayWidth, tempMaskHeight, tempSpriteHeight)
          
          if (shadowSprites[tempBuildingKey]) {
            shadowSprites[tempBuildingKey].scaleMultiplier = 0
          }
          if (shadowSprites[gridKey]) {
            shadowSprites[gridKey].scaleMultiplier = 0
          }
        }
        // Fáza 2: Pohyb hore kým nie je diamondHeight / 2.2 od vrchu obrázka
        else if (height < spriteHeight - diamondHeight / 2.2) {
          const traveledHeight = height - diamondHeight / 2
          tempSprite.y = tempSpriteInitialY - traveledHeight
          
          drawIsometricMask(tempSpriteMaskShape, tempSprite.x, tempSprite.y, tempSprite.displayWidth, tempSpriteHeight, tempSpriteHeight)
          
          const tempPhase2Duration = (spriteHeight - diamondHeight / 2.2) - diamondHeight / 2
          const tempPhase2Progress = (height - diamondHeight / 2) / tempPhase2Duration
          if (shadowSprites[tempBuildingKey]) {
            shadowSprites[tempBuildingKey].scaleMultiplier = tempPhase2Progress
            shadowSprites[tempBuildingKey].y = tempSprite.y
          }
          if (shadowSprites[gridKey]) {
            shadowSprites[gridKey].scaleMultiplier = tempPhase2Progress
          }
          redrawShadowsAround(row, col)
        }
        // Fáza 3: Stojí a maska mizne zhora dole (opačný smer)
        else {
          const finalTempY = tempSpriteInitialY - (spriteHeight - diamondHeight / 2.2 - diamondHeight / 2)
          tempSprite.y = finalTempY
          
          const phase3Progress = (height - (spriteHeight - diamondHeight / 2.2)) / (diamondHeight / 2.2)
          const remainingMaskHeight = tempSpriteHeight * (1 - phase3Progress)
          const newBottomY = finalTempY - (tempSpriteHeight - remainingMaskHeight)
          
          drawIsometricMask(tempSpriteMaskShape, tempSprite.x, newBottomY, tempSprite.displayWidth, remainingMaskHeight, tempSpriteHeight)
          
          if (shadowSprites[tempBuildingKey]) {
            shadowSprites[tempBuildingKey].scaleMultiplier = 1
            shadowSprites[tempBuildingKey].y = finalTempY
          }
          if (shadowSprites[gridKey]) {
            shadowSprites[gridKey].scaleMultiplier = 1
          }
        }
      }
    }
  }
  
  // === CLEANUP FUNKCIA PO DOKONČENÍ CELEJ ANIMÁCIE ===
  function cleanupAnimation() {
    // Odstránime masku po dokončení
    buildingSprite.clearMask(true)
    
    // Zastavíme a odstránime časticový efekt
    if (constructionEffects) {
      constructionEffects.stop()
      scene.time.delayedCall(2000, () => {
        constructionEffects.destroy()
      })
    }
    
    // Cleanup tempSprite
    if (tempSprite) {
      tempSprite.destroy()
      tempSprite = null
    }
    if (tempSpriteMaskShape) {
      tempSpriteMaskShape.destroy()
      tempSpriteMaskShape = null
    }
    if (shadowSprites[tempBuildingKey]) {
      delete shadowSprites[tempBuildingKey]
    }
    
    // Uistíme sa že hlavný tieň má scaleMultiplier=1 po dokončení animácie
    if (shadowSprites[gridKey]) {
      shadowSprites[gridKey].scaleMultiplier = 1
    }
    
    // Vždy prekreslíme tiene po dokončení animácie
    redrawShadowsAround(row, col)
    
    // Cleanup pie chart
    if (pieChartGraphics) {
      pieChartGraphics.destroy()
      pieChartGraphics = null
    }
    
    // Cleanup construct sprite-ov
    constructSprites.forEach(sprite => {
      if (sprite) sprite.destroy()
    })
    constructMasks.forEach(maskInfo => {
      if (maskInfo.shape) maskInfo.shape.destroy()
    })
    
    // Oznámime že animácia je kompletne dokončená
    if (onAnimationComplete) onAnimationComplete()
  }
  
  // === FÁZA 2: SKUTOČNÁ STAVBA (spustí sa po fáze 1 alebo po príchode auta) ===
  const phase1Height = diamondHeight / 2
  
  function startPhase2Fn() {
    animationControl._phase = 2
    const phase2Tween = scene.tweens.addCounter({
      from: phase1Height,
      to: spriteHeight,
      duration: BUILDING_ANIMATION_DURATION,
      ease: 'Linear',
      onUpdate: (tween) => updateAnimationHeight(tween.getValue()),
      onComplete: cleanupAnimation
    })
    animationControl._tween = phase2Tween
    // Aplikuj aktuálny worker count timeScale
    if (animationControl._workerCount > 1) {
      phase2Tween.setTimeScale(animationControl._workerCount)
    }
    console.log(`🏗️ Fáza 2 stavby [${row}, ${col}] spustená: ${BUILDING_ANIMATION_DURATION}ms, ${animationControl._workerCount}x rýchlosť`)
  }
  animationControl._startPhase2 = startPhase2Fn
  
  // === FÁZA 1: RÝCHLE OBJAVENIE 0.PNG (< 1 sekunda) ===
  const PHASE1_DURATION = 800 // ms - rýchla fáza 1
  
  const phase1Tween = scene.tweens.addCounter({
    from: 0,
    to: phase1Height,
    duration: PHASE1_DURATION,
    ease: 'Linear',
    onUpdate: (tween) => updateAnimationHeight(tween.getValue()),
    onComplete: () => {
      if (waitForCar) {
        // Fáza 1 dokončená, čakáme na príchod auta
        animationControl.isPaused = true
        animationControl._waitingForPhase2 = true
        console.log(`⏸️ Fáza 1 dokončená, čaká sa na auto pre [${row}, ${col}]`)
        if (onWaitingForCar) onWaitingForCar()
      } else {
        // Bez čakania na auto - hneď spustíme fázu 2
        startPhase2Fn()
      }
    }
  })
  
  // Uložíme referenciu na aktuálny tween (fáza 1)
  animationControl._tween = phase1Tween
  
  // Vrátime construct sprites a animation control
  return { constructSprites, animationControl }
}
