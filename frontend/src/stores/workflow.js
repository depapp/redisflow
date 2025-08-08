import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import axios from 'axios'
import { io } from 'socket.io-client'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

export const useWorkflowStore = defineStore('workflow', () => {
  // State
  const workflows = ref([])
  const currentWorkflow = ref(null)
  const socket = ref(null)
  const activeUsers = ref([])
  const isConnected = ref(false)
  const loading = ref(false)
  const error = ref(null)

  // User info
  const userId = ref(localStorage.getItem('userId') || generateUserId())
  const userName = ref(localStorage.getItem('userName') || 'User ' + userId.value.slice(0, 6))

  // Getters
  const workflowCount = computed(() => workflows.value.length)
  const hasWorkflows = computed(() => workflows.value.length > 0)

  // Actions
  async function fetchWorkflows() {
    loading.value = true
    error.value = null
    try {
      const response = await axios.get(`${API_URL}/api/workflows`)
      workflows.value = response.data.workflows
    } catch (err) {
      error.value = err.message
      console.error('Error fetching workflows:', err)
    } finally {
      loading.value = false
    }
  }

  async function fetchWorkflow(id) {
    loading.value = true
    error.value = null
    try {
      const response = await axios.get(`${API_URL}/api/workflows/${id}`)
      currentWorkflow.value = response.data
      return response.data
    } catch (err) {
      error.value = err.message
      console.error('Error fetching workflow:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  async function createWorkflow(workflowData) {
    // Validate workflow data before sending to server
    if (!workflowData.name || workflowData.name.trim() === '') {
      throw new Error('Workflow name is required')
    }
    
    // Prevent creating empty workflows with default name
    if (workflowData.name === 'Workflow' && (!workflowData.nodes || workflowData.nodes.length === 0)) {
      throw new Error('Cannot create empty workflow with default name')
    }
    
    loading.value = true
    error.value = null
    try {
      const response = await axios.post(`${API_URL}/api/workflows`, workflowData)
      workflows.value.unshift(response.data)
      return response.data
    } catch (err) {
      error.value = err.response?.data?.error || err.message
      console.error('Error creating workflow:', err)
      // Re-throw with more specific error message
      if (err.response?.data?.error) {
        throw new Error(err.response.data.error)
      }
      throw err
    } finally {
      loading.value = false
    }
  }

  async function updateWorkflow(id, updates) {
    loading.value = true
    error.value = null
    try {
      const response = await axios.put(`${API_URL}/api/workflows/${id}`, updates)
      const index = workflows.value.findIndex(w => w.id === id)
      if (index !== -1) {
        workflows.value[index] = response.data
      }
      if (currentWorkflow.value?.id === id) {
        currentWorkflow.value = response.data
      }
      return response.data
    } catch (err) {
      error.value = err.message
      console.error('Error updating workflow:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  async function deleteWorkflow(id) {
    loading.value = true
    error.value = null
    try {
      await axios.delete(`${API_URL}/api/workflows/${id}`)
      workflows.value = workflows.value.filter(w => w.id !== id)
      if (currentWorkflow.value?.id === id) {
        currentWorkflow.value = null
      }
    } catch (err) {
      error.value = err.message
      console.error('Error deleting workflow:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  async function executeWorkflow(workflowId, inputs = {}) {
    try {
      const response = await axios.post(`${API_URL}/api/executions`, {
        workflowId,
        inputs,
        mode: 'sync'
      })
      return response.data
    } catch (err) {
      error.value = err.message
      console.error('Error executing workflow:', err)
      throw err
    }
  }

  // WebSocket connection
  function connectToWorkflow(workflowId) {
    console.log('Connecting to workflow:', workflowId)
    
    if (socket.value) {
      socket.value.disconnect()
    }

    socket.value = io(API_URL, {
      transports: ['websocket', 'polling']
    })

    socket.value.on('connect', () => {
      isConnected.value = true
      console.log('Connected to WebSocket, socket ID:', socket.value.id)
      
      // Join workflow room
      socket.value.emit('join-workflow', {
        workflowId,
        userId: userId.value,
        userName: userName.value
      })
      console.log('Emitted join-workflow event')
    })

    socket.value.on('disconnect', () => {
      isConnected.value = false
      console.log('Disconnected from WebSocket')
    })

    socket.value.on('current-users', (users) => {
      activeUsers.value = users
    })

    socket.value.on('user-joined', (data) => {
      console.log('User joined:', data)
      if (!activeUsers.value.find(u => u.userId === data.userId)) {
        activeUsers.value.push(data)
      }
    })

    socket.value.on('user-left', (data) => {
      console.log('User left:', data)
      activeUsers.value = activeUsers.value.filter(u => u.userId !== data.userId)
    })

    socket.value.on('workflow-update', (data) => {
      console.log('Workflow update:', data)
      // Handle workflow updates from other users
      if (data.userId !== userId.value && currentWorkflow.value) {
        applyWorkflowChange(data.change)
      }
    })

    socket.value.on('cursor-update', (data) => {
      // Handle cursor updates from other users
      const user = activeUsers.value.find(u => u.userId === data.userId)
      if (user) {
        user.cursor = data.position
      }
    })
  }

  function disconnectFromWorkflow() {
    if (socket.value) {
      socket.value.disconnect()
      socket.value = null
      activeUsers.value = []
      isConnected.value = false
    }
  }

  function emitWorkflowChange(change) {
    if (socket.value && currentWorkflow.value) {
      console.log('Emitting workflow change:', change)
      socket.value.emit('workflow-change', {
        workflowId: currentWorkflow.value.id,
        change,
        userId: userId.value
      })
    } else {
      console.warn('Cannot emit change - socket or workflow not available', {
        socket: !!socket.value,
        currentWorkflow: !!currentWorkflow.value
      })
    }
  }

  function emitCursorMove(position) {
    if (socket.value && currentWorkflow.value) {
      socket.value.emit('cursor-move', {
        workflowId: currentWorkflow.value.id,
        position,
        userId: userId.value
      })
    }
  }

  function applyWorkflowChange(change) {
    // Apply changes to current workflow based on change type
    if (!currentWorkflow.value) return

    switch (change.type) {
      case 'node-add':
        currentWorkflow.value.nodes.push(change.node)
        break
      case 'node-update':
        const nodeIndex = currentWorkflow.value.nodes.findIndex(n => n.id === change.nodeId)
        if (nodeIndex !== -1) {
          currentWorkflow.value.nodes[nodeIndex] = { ...currentWorkflow.value.nodes[nodeIndex], ...change.updates }
        }
        break
      case 'node-delete':
        currentWorkflow.value.nodes = currentWorkflow.value.nodes.filter(n => n.id !== change.nodeId)
        break
      case 'node-move':
        const movedNodeIndex = currentWorkflow.value.nodes.findIndex(n => n.id === change.nodeId)
        if (movedNodeIndex !== -1) {
          currentWorkflow.value.nodes[movedNodeIndex].position = change.position
        }
        break
      case 'edge-add':
        currentWorkflow.value.connections.push(change.edge)
        break
      case 'edge-delete':
        currentWorkflow.value.connections = currentWorkflow.value.connections.filter(
          c => c.id !== change.edgeId
        )
        break
      case 'connection-add':
        currentWorkflow.value.connections.push(change.connection)
        break
      case 'connection-delete':
        currentWorkflow.value.connections = currentWorkflow.value.connections.filter(
          c => c.id !== change.connectionId
        )
        break
    }
  }

  function initialize() {
    // Load user preferences
    const savedUserId = localStorage.getItem('userId')
    if (!savedUserId) {
      localStorage.setItem('userId', userId.value)
    }
    
    const savedUserName = localStorage.getItem('userName')
    if (!savedUserName) {
      localStorage.setItem('userName', userName.value)
    }
  }

  function generateUserId() {
    return 'user_' + Math.random().toString(36).substr(2, 9)
  }

  return {
    // State
    workflows,
    currentWorkflow,
    activeUsers,
    isConnected,
    loading,
    error,
    userId,
    userName,
    socket,
    
    // Getters
    workflowCount,
    hasWorkflows,
    
    // Actions
    fetchWorkflows,
    fetchWorkflow,
    createWorkflow,
    updateWorkflow,
    deleteWorkflow,
    executeWorkflow,
    connectToWorkflow,
    disconnectFromWorkflow,
    emitWorkflowChange,
    emitCursorMove,
    initialize
  }
})
