/**
 * Project Loader Service
 * Spracováva načítanie projektu z JSON a aplikuje všetky potrebné nastavenia
 */

import roadTileManager from './roadTileManager.js'

const BASE_URL = import.meta.env.BASE_URL

/**
 * Načíta road tiles zo sprite sheetu
 * @param {string} spriteUrl - URL sprite sheetu
 * @param {number} opacity - Opacity ciest (0-100)
 * @returns {Promise<Array>} - Pole road tiles
 */
export async function loadRoadTilesFromSprite(spriteUrl, opacity = 100) {
  console.log('🛣️ ProjectLoader: Načítavam road tiles zo sprite:', spriteUrl)
  return await roadTileManager.loadTiles(spriteUrl, opacity)
}

/**
 * Aplikuje background textúru na canvas
 * @param {Object} canvasRef - Referencia na PhaserCanvas
 * @param {Object} textureSettings - Nastavenia textúry
 * @returns {Promise<void>}
 */
export async function applyBackgroundTexture(canvasRef, textureSettings) {
  if (!textureSettings.customTexture || !canvasRef) {
    return
  }
  
  console.log('🎨 ProjectLoader: Aplikujem background textúru')
  
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    
    img.onload = async () => {
      const canvas = document.createElement('canvas')
      const resolution = textureSettings.tileResolution || 512
      canvas.width = resolution
      canvas.height = resolution
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, resolution, resolution)
      const processedTexture = canvas.toDataURL('image/jpeg', 0.9)
      
      if (canvasRef.setBackgroundTiles) {
        await canvasRef.setBackgroundTiles([processedTexture], textureSettings.tilesPerImage || 1)
      }
      
      console.log('✅ ProjectLoader: Background textúra aplikovaná')
      resolve()
    }
    
    img.onerror = () => {
      console.warn('⚠️ ProjectLoader: Nepodarilo sa načítať background textúru')
      resolve() // Resolve aj pri chybe, aby sme mohli pokračovať
    }
    
    img.src = textureSettings.customTexture
  })
}

/**
 * Aplikuje background tiles na canvas
 * @param {Object} canvasRef - Referencia na PhaserCanvas
 * @param {Array} tiles - Pole tile URL
 * @returns {Promise<void>}
 */
export async function applyBackgroundTiles(canvasRef, tiles) {
  if (!tiles || tiles.length === 0 || !canvasRef) {
    return
  }
  
  console.log(`🎨 ProjectLoader: Aplikujem ${tiles.length} background tiles`)
  
  if (canvasRef.setBackgroundTiles) {
    await canvasRef.setBackgroundTiles(tiles, 1)
  }
  
  console.log('✅ ProjectLoader: Background tiles aplikované')
}

/**
 * Načíta a umiestni objekty na canvas
 * @param {Object} canvasRef - Referencia na PhaserCanvas
 * @param {Object} placedImages - Objekt s umiestnenými obrázkami
 * @param {Array} roadTiles - Pole road tiles
 * @param {Array} imageLibrary - Zoznam obrázkov s buildingData (na rekonštrukciu metadát)
 * @param {Function} onProgress - Callback pre progress (progress, status)
 * @returns {Promise<void>}
 */
export async function loadPlacedObjects(canvasRef, placedImages, roadTiles, imageLibrary, onProgress) {
  if (!canvasRef || !placedImages || Object.keys(placedImages).length === 0) {
    console.log('⚠️ ProjectLoader: Žiadne objekty na načítanie')
    return
  }
  
  console.log('🏗️ ProjectLoader: Začínam načítavať objekty na canvas')
  console.log(`📚 ProjectLoader: ImageLibrary obsahuje ${imageLibrary?.length || 0} obrázkov`)
  
  // Vyčistiť canvas
  if (typeof canvasRef.clearAll === 'function') {
    canvasRef.clearAll()
  }
  
  const totalObjects = Object.keys(placedImages).length
  
  // Začni batch loading
  if (typeof canvasRef.startBatchLoading === 'function') {
    canvasRef.startBatchLoading()
  }
  
  const objectsToLoad = Object.entries(placedImages)
  const BATCH_SIZE = 10
  let currentIndex = 0
  let successCount = 0
  
  return new Promise((resolve) => {
  const loadBatch = async () => {
    const batchEnd = Math.min(currentIndex + BATCH_SIZE, totalObjects)
    
    for (let i = currentIndex; i < batchEnd; i++) {
      const [key, imageData] = objectsToLoad[i]
      const { row, col, url, cellsX, cellsY, isBackground, isRoadTile, templateName, tileMetadata, buildingData, imageId, libraryImageId } = imageData
      
      let finalUrl = url
      let finalBitmap = null
      let finalBuildingData = buildingData || null
      
      // Ak URL chýba alebo je null, rekonštruuj z imageLibrary podľa imageId
      if (!finalUrl && imageId && imageLibrary && imageLibrary.length > 0) {
        const sourceImage = imageLibrary.find(img => img.id === imageId)
        if (sourceImage && sourceImage.url) {
          finalUrl = sourceImage.url
        }
      }

      // Ak buildingData chýba, skús ho rekonštruovať z imageLibrary podľa imageId alebo url
      if (!finalBuildingData && imageLibrary && imageLibrary.length > 0) {
        // Najprv skús nájsť pomocou imageId
        let sourceImage = null
        if (imageId) {
          sourceImage = imageLibrary.find(img => img.id === imageId)
        }
        
        // Ak nenájdené cez imageId, skús podľa url
        if (!sourceImage) {
          sourceImage = imageLibrary.find(img => img.url === url)
        }
        
        // Ak našiel zdroj, skopíruj buildingData
        if (sourceImage && sourceImage.buildingData) {
          finalBuildingData = { ...sourceImage.buildingData }
          console.log(`🔧 ProjectLoader: Rekonštruované buildingData pre [${row}, ${col}] z imageLibrary (${finalBuildingData.buildingName || 'unknown'})`)
        }
      }

      // Fallback: rekonštruuj buildingData z images galérie podľa libraryImageId
      if (!finalBuildingData && libraryImageId && imageLibrary) {
        // imageLibrary môže byť tiež projectData.images (viď loadProject)
        // Skús nájsť v hlavnom images poli (galéria) cez libraryImageId
        const galleryImages = imageLibrary._galleryImages
        if (galleryImages && galleryImages.length > 0) {
          const galleryImg = galleryImages.find(img => String(img.id) === String(libraryImageId))
          if (galleryImg && galleryImg.buildingData) {
            finalBuildingData = { ...galleryImg.buildingData }
            console.log(`🔧 ProjectLoader: Rekonštruované buildingData pre [${row}, ${col}] z galérie (${finalBuildingData.buildingName || 'unknown'})`)
          }
        }
      }
      
      // Pre road tiles nájdi správny tile z roadTiles
      if (isRoadTile && tileMetadata && roadTiles.length > 0) {
        const tile = roadTiles.find(t => t.tileIndex === tileMetadata.tileIndex)
        if (tile) {
          finalUrl = tile.url
          finalBitmap = tile.bitmap
        }
      }
      
      if (canvasRef && typeof canvasRef.placeImageAtCell === 'function') {
        try {
          canvasRef.placeImageAtCell(
            row, 
            col, 
            finalUrl, 
            cellsX, 
            cellsY, 
            isBackground || false, 
            isRoadTile || false, 
            finalBitmap,
            templateName || '',
            tileMetadata || null,
            finalBuildingData  // Použiť rekonštruované buildingData
          )
          // Nastav libraryImageId pre stabilné matchovanie budov po výmene obrázka
          if (libraryImageId && typeof canvasRef.setCellImageLibraryId === 'function') {
            canvasRef.setCellImageLibraryId(key, libraryImageId)
          }
          successCount++
        } catch (error) {
          console.error(`❌ ProjectLoader: Chyba pri umiestnení objektu na [${row}, ${col}]:`, error)
        }
      }
    }
    
    currentIndex = batchEnd
    const progress = Math.round((currentIndex / totalObjects) * 100)
    const status = `Načítavam mapu (${currentIndex}/${totalObjects})...`
    
    if (onProgress) {
      onProgress(progress, status)
    }
    
    if (currentIndex < totalObjects) {
      requestAnimationFrame(loadBatch)
    } else {
      // Dokončenie načítania
      if (onProgress) {
        onProgress(100, 'Finalizujem tiene a postavy...')
      }
      
      setTimeout(() => {
        if (canvasRef && typeof canvasRef.finishBatchLoading === 'function') {
          canvasRef.finishBatchLoading()
        }
        
        console.log(`✅ ProjectLoader: Načítaných ${successCount}/${totalObjects} objektov`)
        
        if (onProgress) {
          onProgress(100, 'Hotovo!')
        }
        resolve()
      }, 100)
    }
  }
  
  // Spusti loading
  requestAnimationFrame(loadBatch)
  })
}

/**
 * Kompletné načítanie projektu
 * @param {Object} projectData - Dáta projektu z JSON
 * @param {Object} canvasRef - Referencia na PhaserCanvas
 * @param {Function} onProgress - Callback pre progress
 * @returns {Promise<Object>} - Načítané dáta
 */
export async function loadProject(projectData, canvasRef, onProgress = null) {
  console.log('📦 ProjectLoader: Začínam načítavať projekt')
  
  try {
    // 1. Načítaj road tiles
    const roadSpriteUrl = projectData.roadSpriteUrl || (BASE_URL + 'templates/roads/sprites/pastroad.png')
    const roadOpacity = projectData.roadOpacity || 100
    
    let roadTiles = []
    
    if (onProgress) {
      onProgress(10, 'Načítavam road tiles...')
    }
    
    try {
      roadTiles = await loadRoadTilesFromSprite(roadSpriteUrl, roadOpacity)
    } catch (error) {
      console.error('❌ ProjectLoader: Chyba pri načítaní road tiles:', error)
    }
    
    // 2. Aplikuj background textúru
    if (onProgress) {
      onProgress(20, 'Aplikujem textúry...')
    }
    
    const textureSettings = projectData.textureSettings || { tilesPerImage: 1, tileResolution: 512, customTexture: null }
    await applyBackgroundTexture(canvasRef, textureSettings)
    
    // 3. Aplikuj background tiles (only if no customTexture, since it was already applied in step 2)
    const backgroundTiles = projectData.backgroundTiles || []
    if (backgroundTiles.length > 0 && !textureSettings.customTexture) {
      await applyBackgroundTiles(canvasRef, backgroundTiles)
    }
    
    // 4. Načítaj umiestnené objekty
    const placedImages = projectData.placedImages || {}
    const imageLibrary = projectData.imageLibrary || projectData.images || []
    // Attach gallery images for fallback buildingData reconstruction
    imageLibrary._galleryImages = projectData.images || []
    
    if (Object.keys(placedImages).length > 0) {
      await loadPlacedObjects(canvasRef, placedImages, roadTiles, imageLibrary, (progress, status) => {
        if (onProgress) {
          // Progress 20-100 pre načítanie objektov
          const adjustedProgress = 20 + Math.round(progress * 0.8)
          onProgress(adjustedProgress, status)
        }
      })
    }
    
    console.log('✅ ProjectLoader: Projekt úspešne načítaný')
    
    return {
      images: projectData.images || [],
      roadTiles,
      environmentColors: projectData.environmentColors || { hue: 0, saturation: 100, brightness: 100 },
      textureSettings,
      resources: projectData.resources || [],
      workforce: projectData.workforce || [],
      roadSpriteUrl,
      roadOpacity,
      constructSpriteUrl: projectData.constructSpriteUrl || null,
      tempBuildingSpriteUrl: projectData.tempBuildingSpriteUrl || null,
      carSprite1Url: projectData.carSprite1Url || null,
      carSprite2Url: projectData.carSprite2Url || null,
      personSpriteUrl: projectData.personSpriteUrl || null,
      advisorSpriteUrl: projectData.advisorSpriteUrl || null,
      gameTime: projectData.gameTime || 0,
      buildingProductionStates: projectData.buildingProductionStates || {},
      events: projectData.events || []
    }
    
  } catch (error) {
    console.error('❌ ProjectLoader: Chyba pri načítaní projektu:', error)
    throw error
  }
}
