<template>
  <div class="workflow-editor">
    <header class="editor-header">
      <div class="header-left">
        <button @click="goBack" class="btn btn-secondary">
          ← Back
        </button>
        <div class="workflow-info">
          <input
            v-model="workflowName"
            @blur="updateWorkflowName"
            class="workflow-name-input"
            placeholder="Workflow Name"
          />
          <input
            v-model="workflowDescription"
            @blur="updateWorkflowDescription"
            class="workflow-description-input"
            placeholder="Add a description..."
          />
        </div>
      </div>
      <div class="header-center">
        <div class="active-users">
          <span v-for="user in workflowStore.activeUsers" :key="user.userId" class="user-avatar">
            {{ user.userName?.charAt(0) || '?' }}
          </span>
          <span v-if="workflowStore.activeUsers.length > 0" class="user-count">
            {{ workflowStore.activeUsers.length }} active
          </span>
        </div>
      </div>
      <div class="header-right">
        <button @click="saveWorkflow" class="btn btn-secondary" :disabled="saving">
          {{ saving ? 'Saving...' : 'Save' }}
        </button>
        <button @click="executeWorkflow" class="btn btn-primary" :disabled="executing">
          {{ executing ? 'Running...' : 'Run Workflow' }}
        </button>
        <button v-if="!isNewWorkflow" @click="deleteWorkflow" class="btn btn-danger">
          Delete
        </button>
      </div>
    </header>

    <div class="editor-content">
      <div class="editor-main">
        <div class="editor-sidebar">
          <h3>Node Types</h3>
          <div class="node-palette">
            <div
              v-for="nodeType in nodeTypes"
              :key="nodeType.type"
              :draggable="true"
              @dragstart="onDragStart($event, nodeType)"
              class="node-type draggable"
            >
              <div class="node-icon">{{ nodeType.icon }}</div>
              <div class="node-label">{{ nodeType.label }}</div>
            </div>
          </div>
        </div>

        <div class="editor-canvas" @drop="onDrop" @dragover.prevent>
          <VueFlow
            v-model:nodes="nodes"
            v-model:edges="edges"
            @nodes-change="onNodesChange"
            @edges-change="onEdgesChange"
            @connect="onConnect"
            @node-click="onNodeClick"
            @node-double-click="onNodeClick"
            :default-viewport="{ x: 0, y: 0, zoom: 1 }"
            :min-zoom="0.5"
            :max-zoom="2"
            :node-types="{ custom: 'custom' }"
          >
            <Background pattern-color="#aaa" :gap="16" />
            <Controls />

            <template #node-custom="{ id, data }">
              <div 
                class="custom-node" 
                :class="[`node-${data.type}`, { selected: selectedNode?.id === id }]" 
                @click.stop="() => handleNodeClick(id)"
              >
                <div class="node-header">
                  <span class="node-icon">{{ data.icon }}</span>
                  <span class="node-title">{{ data.label }}</span>
                </div>
                <Handle type="target" :position="Position.Top" />
                <Handle type="source" :position="Position.Bottom" />
              </div>
            </template>
          </VueFlow>

          <!-- Node Configuration Panel -->
          <div v-if="selectedNode" class="config-panel">
            <h3>Configure {{ selectedNode.data.label }}</h3>
            <div class="config-content">
              <div v-if="selectedNode.data.type === 'httpRequest'" class="config-group">
                <label>URL</label>
                <input v-model="selectedNode.data.config.url" placeholder="https://api.example.com" />
                <label>Method</label>
                <select v-model="selectedNode.data.config.method">
                  <option>GET</option>
                  <option>POST</option>
                  <option>PUT</option>
                  <option>DELETE</option>
                </select>
              </div>
              <div v-else-if="selectedNode.data.type === 'transform'" class="config-group">
                <label>Transform Script</label>
                <textarea v-model="selectedNode.data.config.script" placeholder="return { transformed: data }"></textarea>
              </div>
              <div v-else-if="selectedNode.data.type === 'redisSet'" class="config-group">
                <label>Key</label>
                <input v-model="selectedNode.data.config.key" placeholder="user:${userId}" />
                <label>Value</label>
                <input v-model="selectedNode.data.config.value" placeholder="${data}" />
                <label>TTL (seconds)</label>
                <input v-model.number="selectedNode.data.config.ttl" type="number" placeholder="3600" />
              </div>
              <div v-else-if="selectedNode.data.type === 'redisGet'" class="config-group">
                <label>Key</label>
                <input v-model="selectedNode.data.config.key" placeholder="user:${userId}" />
              </div>
              <div v-else-if="selectedNode.data.type === 'condition'" class="config-group">
                <label>Condition Expression</label>
                <input v-model="selectedNode.data.config.expression" placeholder="data.value > 100" />
              </div>
              <div v-else-if="selectedNode.data.type === 'delay'" class="config-group">
                <label>Delay (ms)</label>
                <input v-model.number="selectedNode.data.config.duration" type="number" placeholder="1000" />
              </div>
              <div v-else-if="selectedNode.data.type === 'logger'" class="config-group">
                <label>Log Message</label>
                <input v-model="selectedNode.data.config.message" placeholder="Process completed" />
                <label>Level</label>
                <select v-model="selectedNode.data.config.level">
                  <option>info</option>
                  <option>success</option>
                  <option>warning</option>
                  <option>error</option>
                </select>
              </div>
              <div style="display: flex; gap: 0.5rem; margin-top: 1rem;">
                <button @click="deleteSelectedNode" class="btn btn-sm btn-danger">Delete Node</button>
                <button @click="selectedNode = null" class="btn btn-sm">Close</button>
              </div>
            </div>
          </div>
          <!-- Execution Result Panel (VSCode Terminal Style) -->
          <div class="execution-result-panel">
        <div class="result-header">
          <div class="result-tabs">
            <div class="result-tab active">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="4 17 10 11 4 5"></polyline>
                <line x1="12" y1="19" x2="20" y2="19"></line>
              </svg>
              <span>Execution Result</span>
            </div>
          </div>
          <div class="result-actions">
            <button @click="executionResult = null" class="action-btn" title="Clear" :disabled="!executionResult">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18"></path>
                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
              </svg>
            </button>
          </div>
        </div>
        <div class="result-body">
          <div v-if="!executionResult" class="empty-state">
            <span>No execution results yet. Click "Run Workflow" to execute.</span>
          </div>
          <template v-else>
            <div v-if="executionResult.status === 'completed'" class="result-status success">
              <span class="status-icon">✓</span>
              <span>Workflow executed successfully</span>
            </div>
            <div v-else-if="executionResult.status === 'failed'" class="result-status error">
              <span class="status-icon">✗</span>
              <span>Workflow execution failed</span>
            </div>
            <div class="result-details">
              <div class="detail-item">
                <span class="detail-label">Execution ID:</span>
                <span class="detail-value">{{ executionResult.executionId }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Timestamp:</span>
                <span class="detail-value">{{ executionResult.executedAt ? new Date(executionResult.executedAt).toLocaleString() : 'N/A' }}</span>
              </div>
            </div>
            <div class="result-output">
              <pre>{{ formatExecutionResult() }}</pre>
            </div>
          </template>
        </div>
      </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useWorkflowStore } from '../stores/workflow'
import { VueFlow, useVueFlow, Handle, Position } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'

// Import Vue Flow styles
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'

const router = useRouter()
const route = useRoute()
const workflowStore = useWorkflowStore()
const { addNodes, addEdges, project, removeNodes, removeEdges } = useVueFlow()

const workflowName = ref('')
const workflowDescription = ref('')
const workflow = ref(null)
const saving = ref(false)
const executing = ref(false)
const executionResult = ref(null)
const selectedNode = ref(null)

const nodes = ref([])
const edges = ref([])

const nodeTypes = [
  { type: 'httpRequest', label: 'HTTP Request', icon: '🌐' },
  { type: 'transform', label: 'Transform', icon: '🔄' },
  { type: 'redisGet', label: 'Redis Get', icon: '📥' },
  { type: 'redisSet', label: 'Redis Set', icon: '📤' },
  { type: 'condition', label: 'Condition', icon: '❓' },
  { type: 'delay', label: 'Delay', icon: '⏱️' },
  { type: 'logger', label: 'Logger', icon: '📝' }
]

const isNewWorkflow = computed(() => route.params.id === undefined || route.name === 'NewWorkflow')

onMounted(async () => {
  // Add keyboard event listener for delete
  window.addEventListener('keydown', handleKeyDown)
  
  if (!isNewWorkflow.value) {
    // Load existing workflow
    try {
      workflow.value = await workflowStore.fetchWorkflow(route.params.id)
      workflowName.value = workflow.value.name
      workflowDescription.value = workflow.value.description || ''
      
      // Ensure currentWorkflow is set in the store
      workflowStore.currentWorkflow = workflow.value
      
      // Convert workflow nodes to Vue Flow format
      nodes.value = workflow.value.nodes.map(node => ({
        id: node.id,
        type: 'custom',
        position: node.position || { x: Math.random() * 500, y: Math.random() * 300 },
        data: {
          label: node.name || node.type,
          type: node.type,
          icon: nodeTypes.find(t => t.type === node.type)?.icon || '📦',
          config: node.config || {}
        }
      }))
      
      // Convert connections to edges
      edges.value = workflow.value.connections.map(conn => ({
        id: conn.id,
        source: conn.source,
        target: conn.target,
        animated: true
      }))
      
      // Connect to WebSocket for collaboration
      workflowStore.connectToWorkflow(route.params.id)
      
      // Set up WebSocket event listeners for real-time updates
      setupRealtimeListeners()
    } catch (error) {
      console.error('Failed to load workflow:', error)
      router.push('/')
    }
  } else {
    // Create new workflow
    workflow.value = {
      name: 'New Workflow',
      description: '',
      nodes: [],
      connections: []
    }
    workflowName.value = workflow.value.name
  }
})

onUnmounted(() => {
  // Disconnect from WebSocket
  workflowStore.disconnectFromWorkflow()
  
  // Remove keyboard event listener
  window.removeEventListener('keydown', handleKeyDown)
})

function onDragStart(event, nodeType) {
  event.dataTransfer.setData('nodeType', JSON.stringify(nodeType))
  event.dataTransfer.effectAllowed = 'move'
}

function onDrop(event) {
  event.preventDefault()
  const nodeTypeData = event.dataTransfer.getData('nodeType')
  if (!nodeTypeData) return
  
  const nodeType = JSON.parse(nodeTypeData)
  const { left, top } = event.currentTarget.getBoundingClientRect()
  
  const position = project({
    x: event.clientX - left - 75,
    y: event.clientY - top - 20
  })
  
  const newNode = {
    id: `node_${Date.now()}`,
    type: 'custom',
    position,
    data: {
      label: nodeType.label,
      type: nodeType.type,
      icon: nodeType.icon,
      config: getDefaultConfig(nodeType.type)
    }
  }
  
  // Add to nodes array
  nodes.value.push(newNode)
  
  // Emit change for real-time collaboration
  workflowStore.emitWorkflowChange({
    type: 'node-add',
    node: newNode
  })
}

function onNodesChange(changes) {
  // Handle node changes (position, removal, etc.)
  changes.forEach(change => {
    if (change.type === 'remove') {
      // Don't emit if this is from a remote update
      if (!change.fromRemote) {
        workflowStore.emitWorkflowChange({
          type: 'node-delete',
          nodeId: change.id
        })
      }
    } else if (change.type === 'position' && change.dragging === false) {
      // Don't emit if this is from a remote update
      if (!change.fromRemote) {
        workflowStore.emitWorkflowChange({
          type: 'node-move',
          nodeId: change.id,
          position: change.position
        })
      }
    }
  })
}

function onEdgesChange(changes) {
  // Handle edge changes
  changes.forEach(change => {
    if (change.type === 'remove') {
      workflowStore.emitWorkflowChange({
        type: 'edge-delete',
        edgeId: change.id
      })
    }
  })
}

function onConnect(params) {
  const newEdge = {
    id: `edge_${Date.now()}`,
    source: params.source,
    target: params.target,
    animated: true
  }
  
  addEdges([newEdge])
  
  workflowStore.emitWorkflowChange({
    type: 'edge-add',
    edge: newEdge
  })
}

function onNodeClick(event) {
  console.log('Node clicked event:', event)
  const node = event.node
  if (!node) return
  
  console.log('Node clicked:', node)
  
  // Ensure config object exists
  if (!node.data.config) {
    node.data.config = {}
  }
  
  // Initialize default values based on node type
  if (node.data.type === 'httpRequest' && !node.data.config.method) {
    node.data.config.method = 'GET'
  } else if (node.data.type === 'logger' && !node.data.config.level) {
    node.data.config.level = 'info'
  }
  
  selectedNode.value = node
}

function handleNodeClick(nodeId) {
  console.log('Direct node click:', nodeId)
  const node = nodes.value.find(n => n.id === nodeId)
  if (node) {
    // Ensure config object exists
    if (!node.data.config) {
      node.data.config = {}
    }
    
    // Initialize default values based on node type
    if (node.data.type === 'httpRequest' && !node.data.config.method) {
      node.data.config.method = 'GET'
    } else if (node.data.type === 'logger' && !node.data.config.level) {
      node.data.config.level = 'info'
    }
    
    selectedNode.value = node
  }
}

function goBack() {
  router.push('/')
}

async function updateWorkflowName() {
  if (workflow.value && workflowName.value !== workflow.value.name) {
    workflow.value.name = workflowName.value
    if (!isNewWorkflow.value) {
      await saveWorkflow()
    }
  }
}

async function updateWorkflowDescription() {
  if (workflow.value && workflowDescription.value !== workflow.value.description) {
    workflow.value.description = workflowDescription.value
    if (!isNewWorkflow.value) {
      await saveWorkflow()
    }
  }
}

async function saveWorkflow() {
  saving.value = true
  try {
    // Convert Vue Flow format back to workflow format
    const workflowData = {
      name: workflowName.value,
      description: workflowDescription.value,
      nodes: nodes.value.map(node => ({
        id: node.id,
        type: node.data.type,
        name: node.data.label,
        config: node.data.config || {},
        position: node.position
      })),
      connections: edges.value.map(edge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target
      }))
    }
    
    if (isNewWorkflow.value) {
      // Create new workflow
      const created = await workflowStore.createWorkflow(workflowData)
      workflow.value = created
      // Ensure currentWorkflow is set in the store
      workflowStore.currentWorkflow = created
      // Redirect to edit mode
      router.replace(`/workflow/${created.id}`)
      // Connect to WebSocket for the new workflow
      workflowStore.connectToWorkflow(created.id)
      setupRealtimeListeners()
    } else {
      // Update existing workflow
      await workflowStore.updateWorkflow(workflow.value.id, workflowData)
    }
  } catch (error) {
    console.error('Failed to save workflow:', error)
    alert('Failed to save workflow')
  } finally {
    saving.value = false
  }
}

async function executeWorkflow() {
  if (!nodes.value || nodes.value.length === 0) {
    alert('Add some nodes to the workflow first!')
    return
  }
  
  executing.value = true
  executionResult.value = null
  
  try {
    // Save workflow first if new
    if (isNewWorkflow.value) {
      await saveWorkflow()
    }
    
    // Execute workflow
    const result = await workflowStore.executeWorkflow(workflow.value.id)
    executionResult.value = result
  } catch (error) {
    console.error('Failed to execute workflow:', error)
    alert('Failed to execute workflow')
  } finally {
    executing.value = false
  }
}

async function deleteWorkflow() {
  if (confirm('Are you sure you want to delete this workflow? This action cannot be undone.')) {
    try {
      await workflowStore.deleteWorkflow(workflow.value.id)
      router.push('/')
    } catch (error) {
      console.error('Failed to delete workflow:', error)
      alert('Failed to delete workflow')
    }
  }
}

function formatExecutionResult() {
  if (!executionResult.value) return ''
  
  // Extract the actual result data
  const resultData = executionResult.value.result || executionResult.value
  
  // If it's already a string, return it as is
  if (typeof resultData === 'string') {
    return resultData
  }
  
  // Otherwise, format it as pretty JSON
  return JSON.stringify(resultData, null, 2)
}

function getDefaultConfig(nodeType) {
  switch (nodeType) {
    case 'httpRequest':
      return { method: 'GET', url: '' }
    case 'transform':
      return { script: 'return data' }
    case 'redisSet':
      return { key: '', value: '', ttl: null }
    case 'redisGet':
      return { key: '' }
    case 'condition':
      return { expression: '' }
    case 'delay':
      return { duration: 1000 }
    case 'logger':
      return { message: '', level: 'info' }
    default:
      return {}
  }
}

function deleteSelectedNode() {
  if (!selectedNode.value) return
  
  const nodeId = selectedNode.value.id
  
  // Remove the node from the nodes array
  const nodeIndex = nodes.value.findIndex(n => n.id === nodeId)
  if (nodeIndex > -1) {
    nodes.value.splice(nodeIndex, 1)
  }
  
  // Remove any edges connected to this node
  edges.value = edges.value.filter(edge => 
    edge.source !== nodeId && edge.target !== nodeId
  )
  
  // Emit change for real-time collaboration (only if not from remote)
  if (!applyingRemoteChanges) {
    workflowStore.emitWorkflowChange({
      type: 'node-delete',
      nodeId: nodeId
    })
  }
  
  // Clear selection
  selectedNode.value = null
}

function handleKeyDown(event) {
  // Check if Delete or Backspace key is pressed
  if ((event.key === 'Delete' || event.key === 'Backspace') && selectedNode.value) {
    // Prevent default behavior if we're not in an input field
    const target = event.target
    if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
      event.preventDefault()
      deleteSelectedNode()
    }
  }
}

// Track if we're applying remote changes
let applyingRemoteChanges = false

function setupRealtimeListeners() {
  if (!workflowStore.socket) return
  
  // Remove any existing listeners first
  workflowStore.socket.off('workflow-update')
  
  // Listen for workflow updates from other users
  workflowStore.socket.on('workflow-update', (data) => {
    console.log('Received workflow update:', data)
    
    // Only apply changes from other users
    if (data.userId === workflowStore.userId) return
    
    const change = data.change
    applyingRemoteChanges = true
    
    switch (change.type) {
      case 'node-add':
        // Check if node already exists
        if (!nodes.value.find(n => n.id === change.node.id)) {
          // Add the new node to the canvas
          const newNode = {
            ...change.node,
            type: 'custom' // Ensure it uses our custom node type
          }
          nodes.value.push(newNode)
          console.log('Added remote node:', newNode)
        }
        break
        
      case 'node-delete':
        // Find the node to delete
        const nodeToDelete = nodes.value.find(n => n.id === change.nodeId)
        if (nodeToDelete) {
          // Remove the node
          const nodeIndex = nodes.value.findIndex(n => n.id === change.nodeId)
          if (nodeIndex > -1) {
            nodes.value.splice(nodeIndex, 1)
          }
          
          // Remove connected edges
          edges.value = edges.value.filter(e => 
            e.source !== change.nodeId && e.target !== change.nodeId
          )
          
          // Clear selection if this was the selected node
          if (selectedNode.value?.id === change.nodeId) {
            selectedNode.value = null
          }
        }
        break
        
      case 'node-move':
        // Update node position
        const movedNode = nodes.value.find(n => n.id === change.nodeId)
        if (movedNode) {
          // Use Vue's reactivity system to update position
          movedNode.position = { ...change.position }
        }
        break
        
      case 'edge-add':
        // Check if edge already exists
        if (!edges.value.find(e => e.id === change.edge.id)) {
          edges.value.push(change.edge)
        }
        break
        
      case 'edge-delete':
        // Remove edge
        const edgeIndex = edges.value.findIndex(e => e.id === change.edgeId)
        if (edgeIndex > -1) {
          edges.value.splice(edgeIndex, 1)
        }
        break
    }
    
    applyingRemoteChanges = false
  })
}
</script>

<style scoped>
.workflow-editor {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  background-color: #f9fafb;
  overflow: hidden;
}

.editor-header {
  background: white;
  padding: 1rem 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  gap: 1rem;
  z-index: 10;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex: 1;
  min-width: 0;
}

.header-center {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-shrink: 0;
}

.workflow-info {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  flex: 1;
  min-width: 0;
}

.workflow-name-input {
  font-size: 1.125rem;
  font-weight: 600;
  border: 1px solid #e5e7eb;
  background: #f9fafb;
  padding: 0.375rem 0.75rem;
  border-radius: 6px;
  transition: all 0.2s;
  color: #1f2937;
  width: 100%;
  max-width: 400px;
}

.workflow-name-input:hover {
  background: #f3f4f6;
  border-color: #d1d5db;
}

.workflow-name-input:focus {
  background: white;
  border-color: #3b82f6;
  outline: none;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.workflow-description-input {
  font-size: 0.8125rem;
  font-weight: 400;
  border: 1px solid #e5e7eb;
  background: #f9fafb;
  padding: 0.25rem 0.75rem;
  border-radius: 6px;
  transition: all 0.2s;
  color: #6b7280;
  width: 100%;
  max-width: 400px;
}

.workflow-description-input:hover {
  background: #f3f4f6;
  border-color: #d1d5db;
}

.workflow-description-input:focus {
  background: white;
  border-color: #3b82f6;
  outline: none;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  color: #1f2937;
}

.active-users {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.user-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #3b82f6;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.875rem;
  font-weight: 600;
}

.user-count {
  font-size: 0.875rem;
  color: #6b7280;
}

.editor-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
  position: relative;
}

.editor-main {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
  position: relative;
}

.editor-sidebar {
  width: 220px;
  background: white;
  padding: 1.25rem;
  border-right: 1px solid #e5e7eb;
  overflow-y: auto;
  flex-shrink: 0;
}

.editor-sidebar h3 {
  font-size: 1rem;
  margin-bottom: 1rem;
  color: #374151;
}

.node-palette {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.node-type {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  cursor: move;
  transition: all 0.2s;
}

.node-type.draggable {
  cursor: grab;
}

.node-type.draggable:active {
  cursor: grabbing;
}

.node-type:hover {
  background: #f3f4f6;
  border-color: #d1d5db;
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.node-icon {
  font-size: 1.5rem;
}

.node-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: #374151;
}

.editor-canvas {
  flex: 1;
  position: relative;
  background: #fafafa;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

/* Custom node styles */
.custom-node {
  background: white;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  padding: 10px 15px;
  min-width: 150px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  transition: all 0.2s;
  cursor: pointer;
  user-select: none;
}

.custom-node:hover {
  border-color: #3b82f6;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
}

.custom-node.selected {
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.2);
}

.node-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.node-title {
  font-weight: 500;
  font-size: 0.875rem;
}

/* Node type specific colors */
.node-httpRequest { border-color: #3b82f6; }
.node-transform { border-color: #8b5cf6; }
.node-redisGet { border-color: #10b981; }
.node-redisSet { border-color: #f59e0b; }
.node-condition { border-color: #ef4444; }
.node-delay { border-color: #6b7280; }
.node-logger { border-color: #06b6d4; }

/* Configuration panel */
.config-panel {
  position: absolute;
  right: 20px;
  top: 20px;
  width: 300px;
  max-width: calc(100% - 40px);
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 1.5rem;
  z-index: 20;
  max-height: calc(100vh - 120px);
  overflow-y: auto;
}

.config-panel h3 {
  margin-bottom: 1rem;
  font-size: 1.125rem;
  color: #1f2937;
}

.config-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.config-group label {
  font-size: 0.875rem;
  font-weight: 500;
  color: #374151;
}

.config-group input,
.config-group select,
.config-group textarea {
  padding: 0.5rem;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  font-size: 0.875rem;
}

.config-group textarea {
  min-height: 80px;
  resize: vertical;
}

/* Execution Result Panel - VSCode Terminal Style */
.execution-result-panel {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 250px;
  background: #1e1e1e;
  border-top: 1px solid #3c3c3c;
  display: flex;
  flex-direction: column;
  z-index: 15;
}

.execution-result-panel ~ .vue-flow__controls {
  bottom: 270px !important;
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0;
  background: #252526;
  border-bottom: 1px solid #3c3c3c;
  height: 35px;
  flex-shrink: 0;
}

.result-tabs {
  display: flex;
  height: 100%;
}

.result-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 16px;
  background: #1e1e1e;
  color: #cccccc;
  font-size: 13px;
  border-right: 1px solid #3c3c3c;
  cursor: pointer;
}

.result-tab.active {
  background: #1e1e1e;
  color: white;
}

.result-tab svg {
  opacity: 0.8;
}

.result-actions {
  display: flex;
  align-items: center;
  padding-right: 8px;
  gap: 4px;
}

.action-btn {
  background: none;
  border: none;
  color: #cccccc;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.action-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-btn:disabled:hover {
  background: none;
}

.result-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: auto;
  padding: 12px 20px 40px 20px;
  font-family: 'SF Mono', Monaco, Consolas, 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.5;
  color: #cccccc;
  position: relative;
}

.empty-state {
  color: #858585;
  font-style: italic;
}

.result-status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-weight: normal;
}

.result-status.success {
  color: #4ec9b0;
  background: none;
  padding: 0;
}

.result-status.error {
  color: #f48771;
  background: none;
  padding: 0;
}

.status-icon {
  font-size: 14px;
}

.result-details {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 16px;
  padding: 0;
  background: none;
  border-radius: 0;
}

.detail-item {
  display: flex;
  gap: 8px;
  align-items: baseline;
}

.detail-label {
  font-size: 13px;
  font-weight: normal;
  color: #858585;
}

.detail-value {
  font-size: 13px;
  color: #cccccc;
  font-family: inherit;
}

.result-output {
  margin-top: 8px;
  padding-bottom: 40px; /* Add padding to ensure last line is visible */
  min-height: 0;
}

.result-output pre {
  background: none;
  color: #cccccc;
  padding: 0;
  border-radius: 0;
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.5;
  font-family: inherit;
  margin: 0;
  white-space: pre;
  text-align: left;
}

/* Button styles */
.btn-sm {
  padding: 0.25rem 0.75rem;
  font-size: 0.875rem;
}

.btn-danger {
  background-color: #ef4444;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.btn-danger:hover {
  background-color: #dc2626;
}

/* Vue Flow overrides */
.vue-flow {
  background: #fafafa;
  position: absolute !important;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100% !important;
  height: 100% !important;
}

.vue-flow__controls {
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  bottom: 20px !important;
  right: 20px !important;
}

.vue-flow__container {
  width: 100% !important;
  height: 100% !important;
}

.vue-flow__viewport {
  width: 100% !important;
  height: 100% !important;
}

.vue-flow__background {
  width: 100% !important;
  height: 100% !important;
}

/* Handle styles */
.vue-flow__handle {
  width: 10px;
  height: 10px;
  background: #3b82f6;
  border: 2px solid white;
}

.vue-flow__handle:hover {
  background: #2563eb;
}

/* Edge styles */
.vue-flow__edge-path {
  stroke: #3b82f6;
  stroke-width: 2;
}

.vue-flow__edge.animated path {
  stroke-dasharray: 5;
  animation: dashdraw 0.5s linear infinite;
}

@keyframes dashdraw {
  to {
    stroke-dashoffset: -10;
  }
}

/* Responsive Design */
@media (max-width: 1024px) {
  .editor-header {
    padding: 0.75rem 1rem;
  }
  
  .workflow-name-input {
    font-size: 1rem;
  }
  
  .editor-sidebar {
    width: 200px;
    padding: 1rem;
  }
  
  .config-panel {
    width: 280px;
    right: 10px;
    top: 10px;
  }
}

@media (max-width: 768px) {
  .editor-header {
    gap: 0.75rem;
  }
  
  .header-left {
    flex: 1 1 100%;
    order: 1;
  }
  
  .header-center {
    order: 3;
    flex: 1 1 auto;
  }
  
  .header-right {
    order: 2;
    flex: 1 1 auto;
    justify-content: flex-end;
  }
  
  .workflow-info {
    max-width: none;
  }
  
  .editor-sidebar {
    width: 180px;
  }
  
  .node-type {
    padding: 0.5rem;
  }
  
  .node-icon {
    font-size: 1.25rem;
  }
  
  .execution-result-panel {
    height: 200px;
  }
  
  .vue-flow__controls {
    bottom: 220px !important;
  }
}

@media (max-width: 640px) {
  .editor-sidebar {
    display: none;
  }
  
  .config-panel {
    position: fixed;
    top: auto;
    bottom: 0;
    left: 0;
    right: 0;
    width: 100%;
    max-height: 50vh;
    border-radius: 16px 16px 0 0;
    overflow-y: auto;
  }
  
  .btn {
    padding: 0.375rem 0.75rem;
    font-size: 0.875rem;
  }
  
  .header-right .btn-danger {
    display: none;
  }
}

/* Button responsive styles */
.btn {
  white-space: nowrap;
}

.btn-secondary {
  background-color: #f3f4f6;
  color: #374151;
}

.btn-secondary:hover {
  background-color: #e5e7eb;
}

.btn-primary {
  background-color: #3b82f6;
  color: white;
}

.btn-primary:hover {
  background-color: #2563eb;
}

.btn-primary:disabled,
.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
