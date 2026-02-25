/**
 * Resource Priority Service
 * Určuje, ktorým budovám zastaviť/spustiť produkciu podľa spotreby surovín.
 * Pri nedostatku surovín sa zastavujú budovy s NAJVÄČŠOU spotrebou danej suroviny ako prvé.
 * Pri dostatku sa automaticky reštartujú.
 * 
 * Optimalizované - volá sa len každé 3 sekundy cez setInterval.
 * Zoznam spotreby sa aktualizuje len pri zmene budov (postavenie/recyklácia/vymazanie).
 */

// Cache pre workResource lookup - prebuduje sa pri buildConsumptionMap
let workResourceIds = new Set()

/**
 * Zostaví mapu spotreby a produkcie surovín pre všetky budovy na canvase.
 * Pre každú surovinu vráti zoznam budov zoradených podľa spotreby (od najväčšej po najmenšiu).
 * Volá sa LEN pri zmene budov na canvase, nie pri zmene resources.
 * @returns {{ consumptionMap: Object, productionMap: Object }}
 */
export function buildConsumptionMap(canvasImagesMap, images, buildingProductionStates = {}, animatingBuildings = null, resources = []) {
  // Prebuduj workResource cache
  workResourceIds = new Set()
  for (const r of resources) {
    if (r.workResource) workResourceIds.add(r.id)
  }

  // Vytvor image lookup mapu pre rýchly prístup
  const imageMap = new Map()
  for (const img of images) {
    imageMap.set(img.id, img)
  }

  const consumptionMap = {}
  const productionMap = {}
  const entries = Object.entries(canvasImagesMap || {})

  for (let i = 0; i < entries.length; i++) {
    const [key, canvasItem] = entries[i]

    // Preskočíme budovy v stavebnej animácii
    if (animatingBuildings && animatingBuildings.has && animatingBuildings.has(key)) continue

    const image = imageMap.get(canvasItem.imageId)
    const bd = canvasItem.buildingData || image?.buildingData
    if (!bd || !bd.isBuilding || bd.isCommandCenter || bd.isPort) continue

    const dashIdx = key.indexOf('-')
    const row = parseInt(key.substring(0, dashIdx))
    const col = parseInt(key.substring(dashIdx + 1))

    // Spotreba (operationalCost)
    const operationalCost = bd.operationalCost
    if (operationalCost && operationalCost.length > 0) {
      for (let j = 0; j < operationalCost.length; j++) {
        const cost = operationalCost[j]
        // Preskočíme work-force
        if (workResourceIds.has(cost.resourceId)) continue

        if (!consumptionMap[cost.resourceId]) {
          consumptionMap[cost.resourceId] = []
        }
        consumptionMap[cost.resourceId].push({
          key, row, col,
          consumption: cost.amount || 0,
          buildingData: bd
        })
      }
    }

    // Produkcia (production) - pre výpočet čistej spotreby
    const production = bd.production
    if (production && production.length > 0) {
      for (let j = 0; j < production.length; j++) {
        const prod = production[j]
        if (workResourceIds.has(prod.resourceId)) continue

        if (!productionMap[prod.resourceId]) {
          productionMap[prod.resourceId] = []
        }
        productionMap[prod.resourceId].push({
          key, row, col,
          production: prod.amount || 0,
          buildingData: bd
        })
      }
    }
  }

  // Zoraď od najväčšej spotreby po najmenšiu
  const resourceIds = Object.keys(consumptionMap)
  for (let i = 0; i < resourceIds.length; i++) {
    consumptionMap[resourceIds[i]].sort((a, b) => b.consumption - a.consumption)
  }

  return { consumptionMap, productionMap }
}

/**
 * Hlavná funkcia - vyhodnotí všetky suroviny a vráti zoznamy budov na zastavenie a reštart.
 * Optimalizovaná verzia - iteruje len cez suroviny, ktoré majú spotrebiteľov v consumptionMap.
 * Zohľadňuje produkciu surovín - zastavenie len pri čistom deficite (spotreba > produkcia + zásoby).
 */
export function evaluateResourcePriority(resources, consumptionMap, productionMap = {}, buildingProductionStates = {}, stoppedByResources = {}, manuallyStoppedBuildings = {}) {
  const toStop = new Set()
  const toRestart = new Set()
  const stopReasons = {} // { buildingKey: [{ resourceId, resourceName, needed, available }] }

  // Vytvor resource lookup pre rýchly prístup podľa ID
  const resourceMap = new Map()
  for (const r of resources) {
    resourceMap.set(r.id, r)
  }

  // Iteruj len cez suroviny, ktoré majú spotrebiteľov
  const consumedResourceIds = Object.keys(consumptionMap)

  for (let i = 0; i < consumedResourceIds.length; i++) {
    const resourceId = consumedResourceIds[i]
    const resource = resourceMap.get(resourceId)
    if (!resource || resource.workResource) continue

    const available = resource.amount
    const consumers = consumptionMap[resourceId]

    // Spočítaj celkovú produkciu tejto suroviny z aktívnych budov
    let totalProduced = 0
    const producers = productionMap[resourceId] || []
    for (let j = 0; j < producers.length; j++) {
      const p = producers[j]
      if (buildingProductionStates[p.key]?.enabled && !manuallyStoppedBuildings[p.key]) {
        totalProduced += p.production
      }
    }

    // --- ZASTAVENIE: Spočítaj aktívnu spotrebu a zastavuj najväčších ---
    let totalActive = 0
    let activeCount = 0

    for (let j = 0; j < consumers.length; j++) {
      const c = consumers[j]
      if (buildingProductionStates[c.key]?.enabled && !manuallyStoppedBuildings[c.key]) {
        totalActive += c.consumption
        activeCount++
      }
    }

    // Čistá spotreba = spotreba - produkcia
    // Zastavujeme len ak čistá spotreba presahuje zásoby
    const netConsumption = totalActive - totalProduced
    if (netConsumption > available && activeCount > 0) {
      // Zastavujeme od najväčšej spotreby (consumers sú už zoradené)
      let remaining = netConsumption
      for (let j = 0; j < consumers.length; j++) {
        if (remaining <= available) break
        const c = consumers[j]
        if (!buildingProductionStates[c.key]?.enabled || manuallyStoppedBuildings[c.key]) continue
        toStop.add(c.key)
        remaining -= c.consumption

        // Zaznač dôvod zastavenia
        if (!stopReasons[c.key]) stopReasons[c.key] = []
        stopReasons[c.key].push({
          resourceId,
          resourceName: resource.name || 'Unknown',
          icon: resource.icon || '',
          needed: c.consumption,
          available: available
        })
      }
    }

    // --- REŠTART: Skús reštartovať zastavené budovy (od najmenšej spotreby) ---
    // Spočítaj spotrebu po zastavení vrátane produkcie
    let projectedConsumption = 0
    for (let j = 0; j < consumers.length; j++) {
      const c = consumers[j]
      if (buildingProductionStates[c.key]?.enabled && !toStop.has(c.key)) {
        projectedConsumption += c.consumption
      }
    }
    let projectedNet = projectedConsumption - totalProduced

    // Iteruj zastavené od najmenšej (koniec poľa = najmenšia spotreba)
    for (let j = consumers.length - 1; j >= 0; j--) {
      const c = consumers[j]
      if (manuallyStoppedBuildings[c.key]) continue
      if (buildingProductionStates[c.key]?.enabled) continue
      if (!stoppedByResources[c.key]) continue
      if (toStop.has(c.key)) continue

      if (projectedNet + c.consumption <= available) {
        toRestart.add(c.key)
        projectedNet += c.consumption
      }
    }
  }

  return { toStop, toRestart, stopReasons }
}
