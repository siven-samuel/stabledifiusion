<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  events: {
    type: Array,
    default: () => []
  },
  resources: {
    type: Array,
    default: () => []
  },
  workforce: {
    type: Array,
    default: () => []
  },
  images: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['update-events'])

// Formulár pre nový event
const newEventName = ref('')
const newEventDescription = ref('')
const newEventImage = ref(null)
const imageInput = ref(null)
const newEventTrigger = ref('day')

// Trigger typy
const triggerTypes = [
  { value: 'day', label: '📅 Day Event', description: 'Triggers on a specific game day' },
  { value: 'resource', label: '📦 Resource Event', description: 'Triggers on resource change' },
  { value: 'building', label: '🏗️ Building Event', description: 'Triggers on building action' }
]

// Day event konfigurácia
const dayEventDay = ref(1)

// Resource event konfigurácia
const resourceEventType = ref('reaches')
const resourceEventResourceId = ref('')
const resourceEventValue = ref(0)

const resourceConditions = [
  { value: 'reaches', label: 'Reaches value' },
  { value: 'drops_below', label: 'Drops below' },
  { value: 'exceeds', label: 'Exceeds' },
  { value: 'equals', label: 'Equals' }
]

// Building event konfigurácia
const buildingEventType = ref('built')
const buildingEventBuildingId = ref('')

// Computed - reálne resources (všetky vrátane workforce)
const allResources = computed(() => {
  const res = [...(props.resources || []), ...(props.workforce || [])]
  return res
})

// Computed - reálne budovy z images
const allBuildings = computed(() => {
  return (props.images || []).filter(img => img.buildingData?.isBuilding === true)
})

const buildingConditions = [
  { value: 'built', label: 'Building built' },
  { value: 'destroyed', label: 'Building destroyed' },
  { value: 'recycled', label: 'Building recycled' },
  { value: 'production_started', label: 'Production started' },
  { value: 'production_stopped', label: 'Production stopped' }
]

// Akcie pre event
const newActionType = ref('show_message')
const newActionMessage = ref('')
const newActionResourceId = ref('')
const newActionResourceAmount = ref(0)

// Building effect action
const newActionBuildingIds = ref([])
const newActionBuildingEffect = ref('disable_production')

// Resource effect action
const newActionResEffectResourceId = ref('')
const newActionResEffectAmount = ref(0)

// Duration & animation
const newActionDuration = ref(1)
const newActionAnimation = ref('none')

// Pending actions for new event
const pendingActions = ref([])

const actionTypes = [
  { value: 'show_message', label: '💬 Show message' },
  { value: 'add_resource', label: '➕ Add resource' },
  { value: 'remove_resource', label: '➖ Remove resource' },
  { value: 'unlock_building', label: '🔓 Unlock building' },
  { value: 'building_effect', label: '🏗️ Building effect' },
  { value: 'resource_effect', label: '📉 Resource effect' }
]

const buildingEffectTypes = [
  { value: 'disable_production', label: 'Disable production (cannot re-enable)' },
  { value: 'stop_production', label: 'Stop production' }
]

const animationOptions = [
  { value: 'none', label: 'None' },
  { value: 'shake', label: 'Shake' },
  { value: 'flash', label: 'Flash' },
  { value: 'pulse', label: 'Pulse' },
  { value: 'fade', label: 'Fade' },
  { value: 'bounce', label: 'Bounce' },
  { value: 'fire', label: 'Fire' },
  { value: 'smoke', label: 'Smoke' },
  { value: 'night', label: 'Night' }
]

// Edit action state
const editActionType = ref('show_message')
const editActionMessage = ref('')
const editActionResourceId = ref('')
const editActionResourceAmount = ref(0)
const editActionBuildingIds = ref([])
const editActionBuildingEffect = ref('disable_production')
const editActionResEffectResourceId = ref('')
const editActionResEffectAmount = ref(0)
const editActionDuration = ref(1)
const editActionAnimation = ref('none')

// Editácia
const editingIndex = ref(-1)
const editingEvent = ref(null)
const editImageInput = ref(null)

// Image upload handler
const handleImageUpload = (event, target = 'new') => {
  const file = event.target.files[0]
  if (!file) return
  
  const reader = new FileReader()
  reader.onload = (e) => {
    // Resize to max 300px to keep JSON small
    const img = new Image()
    img.onload = () => {
      const maxSize = 300
      let w = img.width
      let h = img.height
      if (w > maxSize || h > maxSize) {
        if (w > h) { h = Math.round(h * maxSize / w); w = maxSize }
        else { w = Math.round(w * maxSize / h); h = maxSize }
      }
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, w, h)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
      
      if (target === 'new') {
        newEventImage.value = dataUrl
      } else if (editingEvent.value) {
        editingEvent.value.image = dataUrl
      }
    }
    img.src = e.target.result
  }
  reader.readAsDataURL(file)
}

const removeNewImage = () => {
  newEventImage.value = null
  if (imageInput.value) imageInput.value.value = ''
}

const removeEditImage = () => {
  if (editingEvent.value) editingEvent.value.image = null
  if (editImageInput.value) editImageInput.value.value = ''
}

// Add action to pending list (new event) or editing event
const addActionToPending = () => {
  const action = buildActionObject(
    newActionType.value,
    newActionMessage.value,
    newActionResourceId.value,
    newActionResourceAmount.value,
    newActionBuildingIds.value,
    newActionBuildingEffect.value,
    newActionResEffectResourceId.value,
    newActionResEffectAmount.value,
    newActionDuration.value,
    newActionAnimation.value
  )
  if (!action) return
  pendingActions.value.push(action)
  resetActionForm('new')
}

const addActionToEditing = () => {
  if (!editingEvent.value) return
  const action = buildActionObject(
    editActionType.value,
    editActionMessage.value,
    editActionResourceId.value,
    editActionResourceAmount.value,
    editActionBuildingIds.value,
    editActionBuildingEffect.value,
    editActionResEffectResourceId.value,
    editActionResEffectAmount.value,
    editActionDuration.value,
    editActionAnimation.value
  )
  if (!action) return
  if (!editingEvent.value.actions) editingEvent.value.actions = []
  editingEvent.value.actions.push(action)
  resetActionForm('edit')
}

const buildActionObject = (type, message, resourceId, resourceAmount, buildingIds, buildingEffect, resEffectResourceId, resEffectAmount, duration, animation) => {
  const action = {
    id: Date.now() + Math.random(),
    type,
    animation
  }
  switch (type) {
    case 'show_message':
      if (!message.trim()) return null
      action.message = message.trim()
      break
    case 'add_resource':
    case 'remove_resource':
      action.resourceId = resourceId
      action.resourceName = allResources.value.find(r => r.id === resourceId)?.name || ''
      action.amount = resourceAmount
      break
    case 'unlock_building':
      action.buildingIds = [...buildingIds]
      break
    case 'building_effect':
      action.buildingIds = [...buildingIds]
      action.buildingNames = buildingIds.map(id => allBuildings.value.find(b => b.id === id)?.buildingData?.buildingName || 'Unknown')
      action.effectType = buildingEffect
      action.duration = duration
      break
    case 'resource_effect':
      action.resourceId = resEffectResourceId
      action.resourceName = allResources.value.find(r => r.id === resEffectResourceId)?.name || ''
      action.amount = resEffectAmount
      action.duration = duration
      break
  }
  return action
}

const resetActionForm = (target) => {
  if (target === 'new') {
    newActionType.value = 'show_message'
    newActionMessage.value = ''
    newActionResourceId.value = ''
    newActionResourceAmount.value = 0
    newActionBuildingIds.value = []
    newActionBuildingEffect.value = 'disable_production'
    newActionResEffectResourceId.value = ''
    newActionResEffectAmount.value = 0
    newActionDuration.value = 1
    newActionAnimation.value = 'none'
  } else {
    editActionType.value = 'show_message'
    editActionMessage.value = ''
    editActionResourceId.value = ''
    editActionResourceAmount.value = 0
    editActionBuildingIds.value = []
    editActionBuildingEffect.value = 'disable_production'
    editActionResEffectResourceId.value = ''
    editActionResEffectAmount.value = 0
    editActionDuration.value = 1
    editActionAnimation.value = 'none'
  }
}

const removePendingAction = (index) => {
  pendingActions.value.splice(index, 1)
}

const removeEditAction = (index) => {
  if (editingEvent.value && editingEvent.value.actions) {
    editingEvent.value.actions.splice(index, 1)
  }
}

const getActionLabel = (type) => {
  const found = actionTypes.find(a => a.value === type)
  return found ? found.label : type
}

const getActionSummary = (action) => {
  switch (action.type) {
    case 'show_message':
      return action.message ? `"${action.message.substring(0, 40)}${action.message.length > 40 ? '...' : ''}"` : ''
    case 'add_resource':
      return `+${action.amount} ${action.resourceName || action.resourceId}`
    case 'remove_resource':
      return `-${action.amount} ${action.resourceName || action.resourceId}`
    case 'unlock_building':
      return `${action.buildingIds?.length || 0} building(s)`
    case 'building_effect': {
      const eff = buildingEffectTypes.find(e => e.value === action.effectType)?.label || action.effectType
      return `${eff} — ${action.buildingNames?.join(', ') || 'selected buildings'} (${action.duration} day${action.duration > 1 ? 's' : ''})`
    }
    case 'resource_effect':
      return `-${action.amount} ${action.resourceName || action.resourceId} / day (${action.duration} day${action.duration > 1 ? 's' : ''})`
    default:
      return ''
  }
}

const addEvent = () => {
  if (!newEventName.value.trim()) return

  const event = {
    id: Date.now(),
    name: newEventName.value.trim(),
    description: newEventDescription.value.trim(),
    image: newEventImage.value,
    trigger: newEventTrigger.value,
    enabled: true,
    triggerConfig: getTriggerConfig(),
    actions: [...pendingActions.value]
  }

  const updated = [...props.events, event]
  emit('update-events', updated)

  // Reset formulár
  newEventName.value = ''
  newEventDescription.value = ''
  newEventImage.value = null
  if (imageInput.value) imageInput.value.value = ''
  newEventTrigger.value = 'day'
  dayEventDay.value = 1
  resourceEventType.value = 'reaches'
  resourceEventResourceId.value = ''
  resourceEventValue.value = 0
  buildingEventType.value = 'built'
  buildingEventBuildingId.value = ''
  pendingActions.value = []
  resetActionForm('new')
}

const getTriggerConfig = () => {
  switch (newEventTrigger.value) {
    case 'day':
      return { day: dayEventDay.value }
    case 'resource':
      return {
        condition: resourceEventType.value,
        resourceId: resourceEventResourceId.value,
        resourceName: allResources.value.find(r => r.id === resourceEventResourceId.value)?.name || '',
        value: resourceEventValue.value
      }
    case 'building':
      return { 
        condition: buildingEventType.value,
        buildingId: buildingEventBuildingId.value,
        buildingName: allBuildings.value.find(b => b.id === buildingEventBuildingId.value)?.buildingData?.buildingName || ''
      }
    default:
      return {}
  }
}

const removeEvent = (index) => {
  const updated = props.events.filter((_, i) => i !== index)
  emit('update-events', updated)
}

const toggleEvent = (index) => {
  const updated = [...props.events]
  updated[index] = { ...updated[index], enabled: !updated[index].enabled }
  emit('update-events', updated)
}

const startEdit = (index) => {
  editingIndex.value = index
  editingEvent.value = JSON.parse(JSON.stringify(props.events[index]))
}

const saveEdit = () => {
  if (editingIndex.value < 0 || !editingEvent.value) return
  const updated = [...props.events]
  updated[editingIndex.value] = editingEvent.value
  emit('update-events', updated)
  editingIndex.value = -1
  editingEvent.value = null
}

const cancelEdit = () => {
  editingIndex.value = -1
  editingEvent.value = null
}

const getTriggerLabel = (trigger) => {
  const found = triggerTypes.find(t => t.value === trigger)
  return found ? found.label : trigger
}

const getTriggerDescription = (event) => {
  if (!event.triggerConfig) return ''
  switch (event.trigger) {
    case 'day':
      return `Day ${event.triggerConfig.day}`
    case 'resource': {
      const cond = resourceConditions.find(c => c.value === event.triggerConfig.condition)
      const resName = event.triggerConfig.resourceName || allResources.value.find(r => r.id === event.triggerConfig.resourceId)?.name || event.triggerConfig.resourceId
      return `${resName}: ${cond?.label || event.triggerConfig.condition} ${event.triggerConfig.value}`
    }
    case 'building': {
      const cond = buildingConditions.find(c => c.value === event.triggerConfig.condition)
      const bldName = event.triggerConfig.buildingName || allBuildings.value.find(b => b.id === event.triggerConfig.buildingId)?.buildingData?.buildingName || ''
      return `${cond?.label || event.triggerConfig.condition}${bldName ? ' - ' + bldName : ''}`
    }
    default:
      return ''
  }
}
</script>

<template>
  <div class="event-emitter">
    <!-- Formulár pre nový event -->
    <div class="new-event-form">
      <h3>➕ Create new event</h3>
      
      <div class="form-row">
        <label>Event name</label>
        <input 
          v-model="newEventName" 
          type="text" 
          placeholder="E.g. Reinforcements arrive..." 
          class="form-input"
        />
      </div>

      <div class="form-row">
        <label>Event description</label>
        <textarea 
          v-model="newEventDescription" 
          placeholder="Longer description of what happens..." 
          class="form-textarea"
          rows="3"
        ></textarea>
      </div>

      <div class="form-row">
        <label>Image (optional)</label>
        <div class="image-upload-area">
          <input 
            ref="imageInput"
            type="file" 
            accept="image/*" 
            @change="handleImageUpload($event, 'new')" 
            class="file-input"
          />
          <div v-if="newEventImage" class="image-preview">
            <img :src="newEventImage" alt="Event preview" />
            <button @click="removeNewImage" class="btn-remove-img" title="Remove image">✕</button>
          </div>
        </div>
      </div>

      <div class="form-row">
        <label>Event Trigger</label>
        <select v-model="newEventTrigger" class="form-select">
          <option v-for="t in triggerTypes" :key="t.value" :value="t.value">
            {{ t.label }}
          </option>
        </select>
        <span class="trigger-description">
          {{ triggerTypes.find(t => t.value === newEventTrigger)?.description }}
        </span>
      </div>

      <!-- Day Event konfigurácia -->
      <div v-if="newEventTrigger === 'day'" class="trigger-config">
        <div class="form-row">
          <label>Game day</label>
          <input v-model.number="dayEventDay" type="number" min="1" class="form-input small" />
        </div>
      </div>

      <!-- Resource Event konfigurácia -->
      <div v-if="newEventTrigger === 'resource'" class="trigger-config">
        <div class="form-row">
          <label>Condition</label>
          <select v-model="resourceEventType" class="form-select">
            <option v-for="c in resourceConditions" :key="c.value" :value="c.value">
              {{ c.label }}
            </option>
          </select>
        </div>
        <div class="form-row">
          <label>Resource</label>
          <select v-model="resourceEventResourceId" class="form-select">
            <option value="" disabled>-- Select resource --</option>
            <option v-for="r in allResources" :key="r.id" :value="r.id">
              {{ r.name }} {{ r.workResource ? '(👷 work)' : '' }}
            </option>
          </select>
          <span v-if="allResources.length === 0" class="trigger-description">* No resources are defined</span>
        </div>
        <div class="form-row">
          <label>Value</label>
          <input v-model.number="resourceEventValue" type="number" min="0" class="form-input small" />
        </div>
      </div>

      <!-- Building Event konfigurácia -->
      <div v-if="newEventTrigger === 'building'" class="trigger-config">
        <div class="form-row">
          <label>Event type</label>
          <select v-model="buildingEventType" class="form-select">
            <option v-for="c in buildingConditions" :key="c.value" :value="c.value">
              {{ c.label }}
            </option>
          </select>
        </div>
        <div class="form-row">
          <label>Building (optional)</label>
          <select v-model="buildingEventBuildingId" class="form-select">
            <option value="">-- Any building --</option>
            <option v-for="b in allBuildings" :key="b.id" :value="b.id">
              {{ b.buildingData?.buildingName || 'Unnamed' }}
            </option>
          </select>
          <span v-if="allBuildings.length === 0" class="trigger-description">* No buildings in gallery</span>
        </div>
      </div>

      <!-- Actions section -->
      <div class="actions-section">
        <h4>⚡ Actions</h4>
        
        <!-- Pending actions list -->
        <div v-if="pendingActions.length > 0" class="actions-list-mini">
          <div v-for="(action, ai) in pendingActions" :key="action.id" class="action-item-mini">
            <span class="action-badge">{{ getActionLabel(action.type) }}</span>
            <span class="action-summary">{{ getActionSummary(action) }}</span>
            <span v-if="action.animation && action.animation !== 'none'" class="action-anim-badge">🎬 {{ action.animation }}</span>
            <button @click="removePendingAction(ai)" class="btn-remove-action" title="Remove">✕</button>
          </div>
        </div>

        <!-- Add action form -->
        <div class="action-form">
          <div class="form-row">
            <label>Action type</label>
            <select v-model="newActionType" class="form-select">
              <option v-for="a in actionTypes" :key="a.value" :value="a.value">
                {{ a.label }}
              </option>
            </select>
          </div>

          <!-- Show message -->
          <div v-if="newActionType === 'show_message'" class="action-config">
            <div class="form-row">
              <label>Message</label>
              <textarea v-model="newActionMessage" class="form-textarea" rows="2" placeholder="Message to display..."></textarea>
            </div>
          </div>

          <!-- Add/Remove resource -->
          <div v-if="newActionType === 'add_resource' || newActionType === 'remove_resource'" class="action-config">
            <div class="form-row">
              <label>Resource</label>
              <select v-model="newActionResourceId" class="form-select">
                <option value="" disabled>-- Select resource --</option>
                <option v-for="r in allResources" :key="r.id" :value="r.id">
                  {{ r.name }}
                </option>
              </select>
            </div>
            <div class="form-row">
              <label>Amount</label>
              <input v-model.number="newActionResourceAmount" type="number" min="0" class="form-input small" />
            </div>
          </div>

          <!-- Unlock building -->
          <div v-if="newActionType === 'unlock_building'" class="action-config">
            <div class="form-row">
              <label>Buildings to unlock</label>
              <div class="checkbox-list">
                <label v-for="b in allBuildings" :key="b.id" class="checkbox-item">
                  <input type="checkbox" :value="b.id" v-model="newActionBuildingIds" />
                  {{ b.buildingData?.buildingName || 'Unnamed' }}
                </label>
              </div>
              <span v-if="allBuildings.length === 0" class="trigger-description">* No buildings in gallery</span>
            </div>
          </div>

          <!-- Building effect -->
          <div v-if="newActionType === 'building_effect'" class="action-config">
            <div class="form-row">
              <label>Effect type</label>
              <select v-model="newActionBuildingEffect" class="form-select">
                <option v-for="e in buildingEffectTypes" :key="e.value" :value="e.value">
                  {{ e.label }}
                </option>
              </select>
            </div>
            <div class="form-row">
              <label>Affected buildings</label>
              <div class="checkbox-list">
                <label v-for="b in allBuildings" :key="b.id" class="checkbox-item">
                  <input type="checkbox" :value="b.id" v-model="newActionBuildingIds" />
                  {{ b.buildingData?.buildingName || 'Unnamed' }}
                </label>
              </div>
              <span v-if="allBuildings.length === 0" class="trigger-description">* No buildings in gallery</span>
            </div>
            <div class="form-row">
              <label>Effect duration (days)</label>
              <input v-model.number="newActionDuration" type="number" min="1" class="form-input small" />
            </div>
          </div>

          <!-- Resource effect -->
          <div v-if="newActionType === 'resource_effect'" class="action-config">
            <div class="form-row">
              <label>Resource</label>
              <select v-model="newActionResEffectResourceId" class="form-select">
                <option value="" disabled>-- Select resource --</option>
                <option v-for="r in allResources" :key="r.id" :value="r.id">
                  {{ r.name }}
                </option>
              </select>
            </div>
            <div class="form-row">
              <label>Amount to lose per day</label>
              <input v-model.number="newActionResEffectAmount" type="number" min="0" class="form-input small" />
            </div>
            <div class="form-row">
              <label>Effect duration (days)</label>
              <input v-model.number="newActionDuration" type="number" min="1" class="form-input small" />
            </div>
          </div>

          <!-- Animation select (for all action types) -->
          <div class="form-row">
            <label>Animation</label>
            <select v-model="newActionAnimation" class="form-select">
              <option v-for="a in animationOptions" :key="a.value" :value="a.value">
                {{ a.label }}
              </option>
            </select>
          </div>

          <button @click="addActionToPending" class="btn-add-action" type="button">
            ➕ Add Action
          </button>
        </div>
      </div>

      <button @click="addEvent" class="btn-add" :disabled="!newEventName.trim()">
        ✅ Add Event
      </button>
    </div>

    <!-- Zoznam existujúcich eventov -->
    <div class="events-list">
      <h3>📋 Existing events ({{ events.length }})</h3>
      
      <div v-if="events.length === 0" class="empty-state">
        <p>No events. Create your first event above.</p>
      </div>

      <div 
        v-for="(event, index) in events" 
        :key="event.id" 
        class="event-item"
        :class="{ disabled: !event.enabled, editing: editingIndex === index }"
      >
        <!-- Normálny pohľad -->
        <template v-if="editingIndex !== index">
          <div class="event-header">
            <div class="event-name">
              <span class="event-status" :class="{ active: event.enabled }">●</span>
              {{ event.name }}
            </div>
            <div class="event-actions">
              <button @click="toggleEvent(index)" class="action-btn" :title="event.enabled ? 'Disable' : 'Enable'">
                {{ event.enabled ? '⏸️' : '▶️' }}
              </button>
              <button @click="startEdit(index)" class="action-btn" title="Edit">✏️</button>
              <button @click="removeEvent(index)" class="action-btn delete" title="Delete">🗑️</button>
            </div>
          </div>
          <div v-if="event.description" class="event-description">
            {{ event.description }}
          </div>
          <div v-if="event.image" class="event-image-thumb">
            <img :src="event.image" alt="Event image" />
          </div>
          <div class="event-details">
            <span class="event-trigger-badge">{{ getTriggerLabel(event.trigger) }}</span>
            <span class="event-trigger-desc">{{ getTriggerDescription(event) }}</span>
          </div>
          <!-- Actions display -->
          <div v-if="event.actions && event.actions.length > 0" class="event-actions-list">
            <div class="actions-label">⚡ Actions ({{ event.actions.length }}):</div>
            <div v-for="action in event.actions" :key="action.id" class="action-display-item">
              <span class="action-badge-sm">{{ getActionLabel(action.type) }}</span>
              <span class="action-summary-sm">{{ getActionSummary(action) }}</span>
              <span v-if="action.animation && action.animation !== 'none'" class="action-anim-badge-sm">🎬 {{ action.animation }}</span>
            </div>
          </div>
        </template>

        <!-- Editácia -->
        <template v-else>
          <div class="edit-form">
            <div class="form-row">
              <label>Name</label>
              <input v-model="editingEvent.name" type="text" class="form-input" />
            </div>
            <div class="form-row">
              <label>Description</label>
              <textarea v-model="editingEvent.description" class="form-textarea" rows="3" placeholder="Event description..."></textarea>
            </div>
            <div class="form-row">
              <label>Image</label>
              <div class="image-upload-area">
                <input 
                  ref="editImageInput"
                  type="file" 
                  accept="image/*" 
                  @change="handleImageUpload($event, 'edit')" 
                  class="file-input"
                />
                <div v-if="editingEvent.image" class="image-preview">
                  <img :src="editingEvent.image" alt="Event preview" />
                  <button @click="removeEditImage" class="btn-remove-img" title="Remove image">✕</button>
                </div>
              </div>
            </div>
            <div class="form-row">
              <label>Trigger</label>
              <select v-model="editingEvent.trigger" class="form-select">
                <option v-for="t in triggerTypes" :key="t.value" :value="t.value">
                  {{ t.label }}
                </option>
              </select>
            </div>

            <!-- Edit actions section -->
            <div class="actions-section">
              <h4>⚡ Actions</h4>
              <div v-if="editingEvent.actions && editingEvent.actions.length > 0" class="actions-list-mini">
                <div v-for="(action, ai) in editingEvent.actions" :key="action.id" class="action-item-mini">
                  <span class="action-badge">{{ getActionLabel(action.type) }}</span>
                  <span class="action-summary">{{ getActionSummary(action) }}</span>
                  <span v-if="action.animation && action.animation !== 'none'" class="action-anim-badge">🎬 {{ action.animation }}</span>
                  <button @click="removeEditAction(ai)" class="btn-remove-action" title="Remove">✕</button>
                </div>
              </div>

              <div class="action-form">
                <div class="form-row">
                  <label>Action type</label>
                  <select v-model="editActionType" class="form-select">
                    <option v-for="a in actionTypes" :key="a.value" :value="a.value">
                      {{ a.label }}
                    </option>
                  </select>
                </div>

                <div v-if="editActionType === 'show_message'" class="action-config">
                  <div class="form-row">
                    <label>Message</label>
                    <textarea v-model="editActionMessage" class="form-textarea" rows="2" placeholder="Message to display..."></textarea>
                  </div>
                </div>

                <div v-if="editActionType === 'add_resource' || editActionType === 'remove_resource'" class="action-config">
                  <div class="form-row">
                    <label>Resource</label>
                    <select v-model="editActionResourceId" class="form-select">
                      <option value="" disabled>-- Select resource --</option>
                      <option v-for="r in allResources" :key="r.id" :value="r.id">{{ r.name }}</option>
                    </select>
                  </div>
                  <div class="form-row">
                    <label>Amount</label>
                    <input v-model.number="editActionResourceAmount" type="number" min="0" class="form-input small" />
                  </div>
                </div>

                <div v-if="editActionType === 'unlock_building'" class="action-config">
                  <div class="form-row">
                    <label>Buildings to unlock</label>
                    <div class="checkbox-list">
                      <label v-for="b in allBuildings" :key="b.id" class="checkbox-item">
                        <input type="checkbox" :value="b.id" v-model="editActionBuildingIds" />
                        {{ b.buildingData?.buildingName || 'Unnamed' }}
                      </label>
                    </div>
                  </div>
                </div>

                <div v-if="editActionType === 'building_effect'" class="action-config">
                  <div class="form-row">
                    <label>Effect type</label>
                    <select v-model="editActionBuildingEffect" class="form-select">
                      <option v-for="e in buildingEffectTypes" :key="e.value" :value="e.value">{{ e.label }}</option>
                    </select>
                  </div>
                  <div class="form-row">
                    <label>Affected buildings</label>
                    <div class="checkbox-list">
                      <label v-for="b in allBuildings" :key="b.id" class="checkbox-item">
                        <input type="checkbox" :value="b.id" v-model="editActionBuildingIds" />
                        {{ b.buildingData?.buildingName || 'Unnamed' }}
                      </label>
                    </div>
                  </div>
                  <div class="form-row">
                    <label>Effect duration (days)</label>
                    <input v-model.number="editActionDuration" type="number" min="1" class="form-input small" />
                  </div>
                </div>

                <div v-if="editActionType === 'resource_effect'" class="action-config">
                  <div class="form-row">
                    <label>Resource</label>
                    <select v-model="editActionResEffectResourceId" class="form-select">
                      <option value="" disabled>-- Select resource --</option>
                      <option v-for="r in allResources" :key="r.id" :value="r.id">{{ r.name }}</option>
                    </select>
                  </div>
                  <div class="form-row">
                    <label>Amount to lose per day</label>
                    <input v-model.number="editActionResEffectAmount" type="number" min="0" class="form-input small" />
                  </div>
                  <div class="form-row">
                    <label>Effect duration (days)</label>
                    <input v-model.number="editActionDuration" type="number" min="1" class="form-input small" />
                  </div>
                </div>

                <div class="form-row">
                  <label>Animation</label>
                  <select v-model="editActionAnimation" class="form-select">
                    <option v-for="a in animationOptions" :key="a.value" :value="a.value">{{ a.label }}</option>
                  </select>
                </div>

                <button @click="addActionToEditing" class="btn-add-action" type="button">
                  ➕ Add Action
                </button>
              </div>
            </div>

            <div class="edit-actions">
              <button @click="saveEdit" class="btn-save-edit">💾 Save</button>
              <button @click="cancelEdit" class="btn-cancel-edit">❌ Cancel</button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.event-emitter {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.new-event-form {
  background: #f8f9fa;
  border-radius: 12px;
  padding: 1.25rem;
  border: 1px solid #e0e0e0;
}

.new-event-form h3,
.events-list h3 {
  margin: 0 0 1rem 0;
  font-size: 1rem;
  color: #374151;
  font-weight: 700;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin-bottom: 0.75rem;
}

.form-row label {
  font-size: 0.8rem;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.form-input {
  padding: 0.5rem 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 0.9rem;
  background: white;
  transition: border-color 0.2s;
}

.form-input:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
}

.form-input.small {
  max-width: 120px;
}

.form-select {
  padding: 0.5rem 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 0.9rem;
  background: white;
  cursor: pointer;
  transition: border-color 0.2s;
}

.form-select:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
}

.trigger-description {
  font-size: 0.78rem;
  color: #9ca3af;
  font-style: italic;
}

.trigger-config {
  margin: 0.5rem 0;
  padding: 0.75rem;
  background: white;
  border-radius: 8px;
  border: 1px dashed #d1d5db;
}

.btn-add {
  width: 100%;
  padding: 0.65rem 1rem;
  border: none;
  border-radius: 8px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  margin-top: 0.5rem;
}

.btn-add:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.35);
}

.btn-add:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Zoznam eventov */
.events-list {
  background: #f8f9fa;
  border-radius: 12px;
  padding: 1.25rem;
  border: 1px solid #e0e0e0;
}

.empty-state {
  text-align: center;
  padding: 1.5rem;
  color: #9ca3af;
  font-style: italic;
}

.event-item {
  padding: 0.75rem;
  margin-bottom: 0.5rem;
  background: white;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  transition: all 0.2s;
}

.event-item:hover {
  border-color: #667eea;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.1);
}

.event-item.disabled {
  opacity: 0.55;
  background: #f9fafb;
}

.event-item.editing {
  border-color: #f59e0b;
  box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.2);
}

.event-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.35rem;
}

.event-name {
  font-weight: 600;
  font-size: 0.9rem;
  color: #1f2937;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.event-status {
  font-size: 0.6rem;
  color: #9ca3af;
}

.event-status.active {
  color: #10b981;
}

.event-actions {
  display: flex;
  gap: 0.25rem;
}

.action-btn {
  padding: 0.25rem 0.4rem;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 0.85rem;
  border-radius: 4px;
  transition: background 0.15s;
}

.action-btn:hover {
  background: #f3f4f6;
}

.action-btn.delete:hover {
  background: #fee2e2;
}

.event-details {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.event-trigger-badge {
  font-size: 0.75rem;
  padding: 0.2rem 0.5rem;
  background: linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%);
  color: #6d28d9;
  border-radius: 12px;
  font-weight: 600;
}

.event-trigger-desc {
  font-size: 0.78rem;
  color: #6b7280;
}

/* Editácia */
.edit-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.edit-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.25rem;
}

.btn-save-edit,
.btn-cancel-edit {
  flex: 1;
  padding: 0.45rem 0.75rem;
  border: none;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-save-edit {
  background: #10b981;
  color: white;
}

.btn-save-edit:hover {
  background: #059669;
}

.btn-cancel-edit {
  background: #e5e7eb;
  color: #4b5563;
}

.btn-cancel-edit:hover {
  background: #d1d5db;
}

/* Textarea */
.form-textarea {
  padding: 0.5rem 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 0.9rem;
  background: white;
  resize: vertical;
  font-family: inherit;
  min-height: 60px;
  transition: border-color 0.2s;
}

.form-textarea:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
}

/* Image upload */
.image-upload-area {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.file-input {
  font-size: 0.82rem;
  color: #6b7280;
}

.file-input::file-selector-button {
  padding: 0.35rem 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: white;
  color: #374151;
  font-size: 0.82rem;
  cursor: pointer;
  margin-right: 0.5rem;
  transition: all 0.15s;
}

.file-input::file-selector-button:hover {
  background: #f3f4f6;
  border-color: #667eea;
}

.image-preview {
  position: relative;
  display: inline-block;
  max-width: 200px;
}

.image-preview img {
  width: 100%;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}

.btn-remove-img {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: rgba(239, 68, 68, 0.85);
  color: white;
  font-size: 0.7rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  transition: background 0.15s;
}

.btn-remove-img:hover {
  background: #dc2626;
}

/* Event description & image thumb in list */
.event-description {
  font-size: 0.82rem;
  color: #6b7280;
  margin-bottom: 0.35rem;
  line-height: 1.4;
  white-space: pre-wrap;
}

.event-image-thumb {
  margin-bottom: 0.35rem;
}

.event-image-thumb img {
  max-width: 120px;
  max-height: 80px;
  border-radius: 6px;
  border: 1px solid #e5e7eb;
  object-fit: cover;
}

/* Actions section */
.actions-section {
  margin-top: 0.75rem;
  padding: 0.75rem;
  background: #f0f1f5;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
}

.actions-section h4 {
  margin: 0 0 0.5rem 0;
  font-size: 0.9rem;
  color: #374151;
  font-weight: 700;
}

.actions-list-mini {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 0.75rem;
}

.action-item-mini {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.5rem;
  background: white;
  border-radius: 6px;
  border: 1px solid #e5e7eb;
  font-size: 0.82rem;
}

.action-badge {
  font-size: 0.72rem;
  padding: 0.15rem 0.4rem;
  background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%);
  color: #1d4ed8;
  border-radius: 10px;
  font-weight: 600;
  white-space: nowrap;
}

.action-summary {
  flex: 1;
  color: #4b5563;
  font-size: 0.8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.action-anim-badge {
  font-size: 0.7rem;
  padding: 0.1rem 0.35rem;
  background: #fef3c7;
  color: #92400e;
  border-radius: 8px;
  white-space: nowrap;
}

.btn-remove-action {
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: #fee2e2;
  color: #dc2626;
  font-size: 0.65rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.15s;
}

.btn-remove-action:hover {
  background: #fca5a5;
}

.action-form {
  padding: 0.5rem;
  background: white;
  border-radius: 6px;
  border: 1px dashed #d1d5db;
}

.action-config {
  margin: 0.25rem 0 0.5rem;
  padding: 0.5rem;
  background: #fafbfc;
  border-radius: 6px;
  border: 1px solid #e5e7eb;
}

.btn-add-action {
  width: 100%;
  padding: 0.45rem 0.75rem;
  border: 1px dashed #667eea;
  border-radius: 6px;
  background: rgba(102, 126, 234, 0.05);
  color: #667eea;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  margin-top: 0.25rem;
}

.btn-add-action:hover {
  background: rgba(102, 126, 234, 0.12);
  border-color: #4f46e5;
}

/* Checkbox list for building selection */
.checkbox-list {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  max-height: 150px;
  overflow-y: auto;
  padding: 0.25rem;
}

.checkbox-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.82rem;
  color: #374151;
  cursor: pointer;
  padding: 0.2rem 0.3rem;
  border-radius: 4px;
  transition: background 0.15s;
}

.checkbox-item:hover {
  background: #f3f4f6;
}

.checkbox-item input[type="checkbox"] {
  accent-color: #667eea;
}

/* Actions display in event list */
.event-actions-list {
  margin-top: 0.4rem;
  padding-top: 0.35rem;
  border-top: 1px dashed #e5e7eb;
}

.actions-label {
  font-size: 0.72rem;
  font-weight: 600;
  color: #6b7280;
  margin-bottom: 0.25rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.action-display-item {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.15rem 0;
  font-size: 0.78rem;
}

.action-badge-sm {
  font-size: 0.68rem;
  padding: 0.1rem 0.35rem;
  background: linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%);
  color: #6d28d9;
  border-radius: 8px;
  font-weight: 600;
  white-space: nowrap;
}

.action-summary-sm {
  color: #6b7280;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.action-anim-badge-sm {
  font-size: 0.65rem;
  padding: 0.05rem 0.25rem;
  background: #fef3c7;
  color: #92400e;
  border-radius: 6px;
  white-space: nowrap;
}
</style>
