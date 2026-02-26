/**
 * Resource Priority Service - SIMPLIFIED
 * 
 * Simple rules:
 * 1. Build a sorted list of consumers per resource (highest consumption first)
 * 2. When resource is insufficient, pause the highest consumer first
 * 3. When resource becomes sufficient, resume paused buildings (lowest consumer first)
 * 4. Only check free resources for work-force (not allocated)
 * 5. Manually stopped buildings are never auto-restarted
 * 6. Check runs every 3 seconds via setInterval in GameView
 * 
 * consumptionMap is rebuilt only when buildings change (placed/deleted/recycled).
 */

// Cache pre workResource lookup
let workResourceIds = new Set()

/**
 * Build consumption map - sorted list of consumers per resource.
 * Called ONLY when buildings on canvas change (not on resource changes).
 * @returns {{ consumptionMap: Object }}
 */
export function buildConsumptionMap(canvasImagesMap, images, buildingProductionStates = {}, animatingBuildings = null, resources = []) {
  workResourceIds = new Set()
  for (const r of resources) {
    if (r.workResource) workResourceIds.add(r.id)
  }

  const imageMap = new Map()
  for (const img of images) {
    imageMap.set(img.id, img)
  }

  const consumptionMap = {}
  const entries = Object.entries(canvasImagesMap || {})

  for (let i = 0; i < entries.length; i++) {
    const [key, canvasItem] = entries[i]

    // Skip buildings in construction animation
    if (animatingBuildings && animatingBuildings.has && animatingBuildings.has(key)) continue

    const image = imageMap.get(canvasItem.imageId)
    const bd = canvasItem.buildingData || image?.buildingData
    if (!bd || !bd.isBuilding || bd.isCommandCenter || bd.isPort) continue

    const dashIdx = key.indexOf('-')
    const row = parseInt(key.substring(0, dashIdx))
    const col = parseInt(key.substring(dashIdx + 1))

    // Consumption (operationalCost) - includes work-force
    const operationalCost = bd.operationalCost
    if (operationalCost && operationalCost.length > 0) {
      for (let j = 0; j < operationalCost.length; j++) {
        const cost = operationalCost[j]
        if (!consumptionMap[cost.resourceId]) {
          consumptionMap[cost.resourceId] = []
        }
        consumptionMap[cost.resourceId].push({
          key, row, col,
          consumption: cost.amount || 0,
          buildingData: bd,
          isWorkForce: workResourceIds.has(cost.resourceId)
        })
      }
    }
  }

  // Sort by consumption descending (highest first = stopped first)
  const resourceIds = Object.keys(consumptionMap)
  for (let i = 0; i < resourceIds.length; i++) {
    consumptionMap[resourceIds[i]].sort((a, b) => b.consumption - a.consumption)
  }

  return { consumptionMap }
}

/**
 * Evaluate which buildings to pause/resume.
 * Simple logic:
 * - For each resource, if total consumption exceeds available → pause highest consumers until balanced
 * - For stopped buildings (in stoppedByResources), if available >= their consumption → resume (lowest first)
 * - Work-force: available = free + already allocated by active buildings (total capacity), since WF is reserved, not consumed
 * - Materials: available = current stockpile (resource.amount)
 * - Manually stopped buildings are skipped entirely
 * 
 * @param {Array} resources - current resources
 * @param {Object} consumptionMap - from buildConsumptionMap
 * @param {Object} buildingProductionStates - { key: { enabled } }
 * @param {Object} manuallyStoppedBuildings - { key: true }
 * @param {Object} stoppedByResources - { key: { row, col, buildingData } } - buildings stopped due to resources
 * @returns {{ toPause: Map<string, Array<{resourceId, resourceName, icon, needed, available}>>, toResume: Set }}
 */
export function evaluateResourcePriority(resources, consumptionMap, buildingProductionStates = {}, manuallyStoppedBuildings = {}, stoppedByResources = {}) {
  const toPause = new Map()  // key → [{resourceId, resourceName, icon, needed, available}]
  const toResume = new Set()

  const resourceMap = new Map()
  for (const r of resources) {
    resourceMap.set(r.id, r)
  }

  const consumedResourceIds = Object.keys(consumptionMap)

  for (let i = 0; i < consumedResourceIds.length; i++) {
    const resourceId = consumedResourceIds[i]
    const resource = resourceMap.get(resourceId)
    if (!resource) continue

    const consumers = consumptionMap[resourceId]
    const isWorkForce = workResourceIds.has(resourceId)

    // Calculate total consumption from active buildings
    let totalActiveConsumption = 0
    for (let j = 0; j < consumers.length; j++) {
      const c = consumers[j]
      if (manuallyStoppedBuildings[c.key]) continue
      const state = buildingProductionStates[c.key]
      if (state?.enabled) {
        totalActiveConsumption += c.consumption
      }
    }

    // For work-force: resource.amount is FREE (unallocated) amount, but active
    // buildings already deducted their share via allocation. Add it back to get
    // total production capacity. For materials: resource.amount is the stockpile.
    const available = isWorkForce
      ? resource.amount + totalActiveConsumption
      : resource.amount

    // --- PAUSE: if not enough resources, pause highest consumers first ---
    if (totalActiveConsumption > available) {
      let remaining = totalActiveConsumption
      for (let j = 0; j < consumers.length; j++) {
        if (remaining <= available) break
        const c = consumers[j]
        if (manuallyStoppedBuildings[c.key]) continue
        const state = buildingProductionStates[c.key]
        if (!state?.enabled) continue
        // Add deficit info for this building
        if (!toPause.has(c.key)) toPause.set(c.key, [])
        toPause.get(c.key).push({
          id: resourceId,
          name: resource.name || resourceId,
          icon: resource.icon || '',
          needed: c.consumption,
          available: available
        })
        remaining -= c.consumption
      }
    }

    // --- RESUME: try to resume stopped buildings (lowest consumption first) ---
    // Calculate projected consumption after pauses
    let projectedConsumption = 0
    for (let j = 0; j < consumers.length; j++) {
      const c = consumers[j]
      if (manuallyStoppedBuildings[c.key]) continue
      const state = buildingProductionStates[c.key]
      if (state?.enabled && !toPause.get(c.key)) {
        projectedConsumption += c.consumption
      }
    }

    // Iterate stopped-by-resources buildings from lowest consumption (end of array)
    for (let j = consumers.length - 1; j >= 0; j--) {
      const c = consumers[j]
      if (manuallyStoppedBuildings[c.key]) continue
      // Only resume buildings that are stopped due to resources (not running, not manually stopped)
      if (!stoppedByResources[c.key]) continue
      if (buildingProductionStates[c.key]?.enabled) continue
      if (toPause.get(c.key)) continue

      if (projectedConsumption + c.consumption <= available) {
        toResume.add(c.key)
        projectedConsumption += c.consumption
      }
    }
  }

  return { toPause, toResume }
}
