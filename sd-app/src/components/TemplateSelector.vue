<script setup>
import { ref, watch, onMounted } from 'vue'

const emit = defineEmits(['template-selected', 'tab-changed', 'road-sprite-selected'])

const activeTemplateTab = ref('buildings')
const templateImages = ref({
  'buildings': ['0-5.png', '0.png', '0x1.png', '0x2.png', '0x3.png', '1.png', '1x3.png', '4x1.png', '4x2-1.png', '4x2-2.png', '4x3-1.png', '4x3-2.png', '4x3-3.png', 'cilinder.png', 'cilnderTower.png', 'halfsphere.png', 'piramide.png', 'pog.png', 'rocket.png', 'sphere.png', 'tube.png', 'tube2.png', 'cone.png'],
  'terrian': ['bush.png', 'bushes.png', 'rock.png', 'rockbig.png', 'tree1.png', 'trees.png', 'tree2.png'],
  'roads': ['basic.png', 'futureroad.png', 'presentroad.png', 'pastroad.png', 'egpyt.png']
})
const selectedTemplate = ref(null)

// Funkcia na emitovanie veľkosti podľa tabu
const emitTabSize = (tab) => {
  let cellsX = 1, cellsY = 1
  // Všetky taby majú 1x1 políčko
  emit('tab-changed', { cellsX, cellsY })
}

// Sleduj zmeny tabu a pošli info o veľkosti políčok
watch(activeTemplateTab, (newTab) => {
  emitTabSize(newTab)
})

// Pri prvom načítaní pošli aktuálnu veľkosť
onMounted(() => {
  emitTabSize(activeTemplateTab.value)
})

// Mapovanie tabov na priečinky
const getTemplateFolder = (tab) => {
  const folderMap = {
    'buildings': 'buildings',
    'terrian': 'terrian',
    'roads': 'roads/sprites'
  }
  return folderMap[tab] || 'buildings'
}

const selectTemplate = (template) => {
  const folder = getTemplateFolder(activeTemplateTab.value)
  const templatePath = `/templates/${folder}/${template}`
  
  selectedTemplate.value = template
  
  // Ak je to roads tab, emituj sprite URL pre ImageGallery
  const isRoadSprite = activeTemplateTab.value === 'roads'
  if (isRoadSprite) {
    emit('road-sprite-selected', templatePath)
  }
  
  // Zisti počet políčok podľa tabu (ULOŽÍME DO KONŠTANTY aby sa nezmenili)
  const currentCellsX = 1
  const currentCellsY = 1
  
  console.log(`📐 TemplateSelector: Vybraná šablóna "${template}" v tabe "${activeTemplateTab.value}"`)
  console.log(`   Priečinok: ${folder}`)
  console.log(`   Políčka: ${currentCellsX}x${currentCellsY}`)
  
  // Načítaj šablónu ako blob a zisti jej rozmery
  fetch(templatePath)
    .then(res => res.blob())
    .then(blob => {
      const reader = new FileReader()
      reader.onload = (e) => {
        // Pre roads tab použij fixné rozmery
        if (activeTemplateTab.value === 'roads') {
          const width = 1024
          const height = 585
          
          console.log(`📤 TemplateSelector: Emitujem template-selected (Roads)`)
          console.log(`   Fixné rozmery: ${width}x${height}`)
          console.log(`   Políčka: ${currentCellsX}x${currentCellsY}`)
          
          emit('template-selected', {
            dataUrl: e.target.result,
            templateName: template,
            width: width,
            height: height,
            cellsX: currentCellsX,
            cellsY: currentCellsY,
            isRoadSprite: isRoadSprite
          })
          return
        }
        
        // Pre ostatné taby - načítaj obrázok aby sme zistili rozmery
        const img = new Image()
        img.onload = () => {
          // Zachováme pomer strán, ale max šírka bude 400px
          const maxWidth = 400
          let width = img.width
          let height = img.height
          
          // Ak je šírka väčšia ako 400px, zmenšíme so zachovaním pomeru
          if (width > maxWidth) {
            const aspectRatio = height / width
            width = maxWidth
            height = width * aspectRatio
          }
          
          // Zaokrúhli rozmery na násobok 8 (požiadavka SD)
          width = Math.round(width / 8) * 8
          height = Math.round(height / 8) * 8
          
          console.log(`📤 TemplateSelector: Emitujem template-selected`)
          console.log(`   Originálne rozmery: ${img.width}x${img.height}`)
          console.log(`   Finálne rozmery (max 400px šírka): ${width}x${height}`)
          console.log(`   Políčka: ${currentCellsX}x${currentCellsY}`)
          
          emit('template-selected', {
            dataUrl: e.target.result,
            templateName: template,
            width: width,
            height: height,
            cellsX: currentCellsX,
            cellsY: currentCellsY,
            isRoadSprite: isRoadSprite
          })
        }
        img.src = e.target.result
      }
      reader.readAsDataURL(blob)
    })
    .catch(err => {
      console.error('Chyba pri načítaní šablóny:', err)
    })
}
</script>

<template>
  <div class="template-selector">  
    <!-- Tab navigácia -->
    <div class="template-tabs">
      <button 
        @click="activeTemplateTab = 'buildings'" 
        :class="{ active: activeTemplateTab === 'buildings' }"
        class="tab-btn"
        type="button"
      >
        🏢 Buildings
      </button>
      <button 
        @click="activeTemplateTab = 'terrian'" 
        :class="{ active: activeTemplateTab === 'terrian' }"
        class="tab-btn"
        type="button"
      >
        🌳 Terrian
      </button>
      <button 
        @click="activeTemplateTab = 'roads'" 
        :class="{ active: activeTemplateTab === 'roads' }"
        class="tab-btn"
        type="button"
      >
        🛣️ Roads
      </button>
    </div>
    
    <!-- Galéria šablón -->
    <div class="templates-gallery">
      <div 
        v-for="template in templateImages[activeTemplateTab]" 
        :key="template"
        @click="selectTemplate(template)"
        :class="{ selected: selectedTemplate === template }"
        class="template-item"
      >
        <img 
          :src="`/templates/${getTemplateFolder(activeTemplateTab)}/${template}`" 
          :alt="template"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.template-selector {
  margin-bottom: 0.25rem;
}

.template-selector label {
  display: block;
  margin-bottom: 0.25rem;
  font-weight: 600;
  color: #333;
  font-size: 0.8rem;
}

/* Template tabs */
.template-tabs {
  display: flex;
  gap: 0.25rem;
  margin-bottom: 0.5rem;
}

.tab-btn {
  width: 100%;
  padding: 0.4rem 0.5rem;
  border: 2px solid #e0e0e0;
  border-radius: 6px;
  background: white;
  font-weight: 600;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.2s;
  color: #666;
}

.tab-btn:hover {
  border-color: #667eea;
  background: rgba(102, 126, 234, 0.05);
}

.tab-btn.active {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border-color: #667eea;
}

/* Templates gallery */
.templates-gallery {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.4rem;
  max-height: 130px;
  overflow-y: auto;
  padding: 0.25rem;
  background: rgba(0, 0, 0, 0.02);
  border-radius: 6px;
}

.template-item {
  border: 2px solid #e0e0e0;
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.2s;
  background: white;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 55px;
  max-height: 70px;
}

.template-item:hover {
  border-color: #667eea;
  transform: scale(1.02);
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
}

.template-item.selected {
  border-color: #667eea;
  border-width: 3px;
  box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.2);
}

.template-item img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
</style>
