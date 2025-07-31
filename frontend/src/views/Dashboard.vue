<template>
  <div class="dashboard">
    <header class="dashboard-header">
      <div class="header-content">
        <h1>RedisFlow</h1>
        <p class="tagline">Real-time Collaborative Workflow Automation</p>
      </div>
      <div class="header-actions">
        <button @click="createNewWorkflow" class="btn btn-primary">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          New Workflow
        </button>
      </div>
    </header>

    <div class="dashboard-content">
      <div class="stats-grid">
        <div class="stat-card">
          <h3>Total Workflows</h3>
          <p class="stat-value">{{ workflowStore.workflowCount }}</p>
          <p class="stat-label">Created workflows</p>
        </div>
        <div class="stat-card">
          <h3>Executions Today</h3>
          <p class="stat-value">{{ executionCount }}</p>
          <p class="stat-label">Workflow runs</p>
        </div>
        <div class="stat-card">
          <h3>Redis Features</h3>
          <p class="stat-value">{{ redisFeatureCount }}+</p>
          <p class="stat-label">Features utilized</p>
        </div>
      </div>

      <div class="recent-workflows">
        <div class="section-header">
          <h2>Recent Workflows</h2>
          <button @click="refreshWorkflows" class="btn btn-secondary btn-sm" :disabled="workflowStore.loading">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M23 4v6h-6"></path>
              <path d="M1 20v-6h6"></path>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
            {{ workflowStore.loading ? 'Refreshing...' : 'Refresh' }}
          </button>
        </div>
        <div v-if="workflowStore.loading" class="loading">
          Loading workflows...
        </div>
        <div v-else-if="workflowStore.error" class="error">
          Error: {{ workflowStore.error }}
        </div>
        <div v-else-if="!workflowStore.hasWorkflows" class="empty-state">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="9" y1="9" x2="15" y2="9"></line>
            <line x1="9" y1="12" x2="15" y2="12"></line>
            <line x1="9" y1="15" x2="11" y2="15"></line>
          </svg>
          <h3>No workflows yet</h3>
          <p>Create your first workflow to get started</p>
          <button @click="createNewWorkflow" class="btn btn-primary">
            Create Workflow
          </button>
        </div>
        <div v-else class="workflow-grid">
          <div
            v-for="workflow in recentWorkflows"
            :key="workflow.id"
            @click="openWorkflow(workflow.id)"
            class="workflow-card"
          >
            <h3>{{ workflow.name }}</h3>
            <p>{{ workflow.description || 'No description' }}</p>
            <div class="workflow-meta">
              <span>{{ workflow.nodes?.length || 0 }} nodes</span>
              <span>{{ formatDate(workflow.updated) }}</span>
            </div>
            <div v-if="workflow.metrics?.activeUsers > 0" class="active-indicator">
              <span class="pulse"></span>
              {{ workflow.metrics.activeUsers }} active
            </div>
          </div>
        </div>
      </div>

      <div class="features-section">
        <h2>Redis Features Showcase</h2>
        <div class="features-grid">
          <div class="feature-card">
            <div class="feature-icon">📊</div>
            <h4>Primary Database</h4>
            <p>Workflows stored as JSON documents</p>
          </div>
          <div class="feature-card">
            <div class="feature-icon">📡</div>
            <h4>Pub/Sub</h4>
            <p>Real-time collaboration</p>
          </div>
          <div class="feature-card">
            <div class="feature-icon">🌊</div>
            <h4>Streams</h4>
            <p>Event sourcing & logs</p>
          </div>
          <div class="feature-card">
            <div class="feature-icon">🔍</div>
            <h4>Search</h4>
            <p>Full-text workflow search</p>
          </div>
          <div class="feature-card">
            <div class="feature-icon">⚡</div>
            <h4>Sorted Sets</h4>
            <p>Efficient sorting</p>
          </div>
          <div class="feature-card">
            <div class="feature-icon">👥</div>
            <h4>Sets</h4>
            <p>User presence tracking</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useWorkflowStore } from '../stores/workflow'
import axios from 'axios'

const router = useRouter()
const workflowStore = useWorkflowStore()

const executionCount = ref(0)
const redisFeatureCount = ref(12)

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const recentWorkflows = computed(() => {
  return workflowStore.workflows.slice(0, 6)
})

onMounted(async () => {
  await workflowStore.fetchWorkflows()
  
  // Fetch real statistics
  try {
    const response = await axios.get(`${API_URL}/api/stats/dashboard`)
    executionCount.value = response.data.executionsToday
    redisFeatureCount.value = response.data.redisFeatures.count
  } catch (error) {
    console.error('Failed to fetch dashboard stats:', error)
    // Fallback to defaults if API fails
    executionCount.value = 0
  }
})

function createNewWorkflow() {
  router.push('/workflow/new')
}

function openWorkflow(id) {
  router.push(`/workflow/${id}`)
}

function formatDate(dateString) {
  const date = new Date(dateString)
  const now = new Date()
  const diff = now - date
  
  if (diff < 60000) return 'Just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return date.toLocaleDateString()
}

async function refreshWorkflows() {
  await workflowStore.fetchWorkflows()
  
  // Also refresh stats
  try {
    const response = await axios.get(`${API_URL}/api/stats/dashboard`)
    executionCount.value = response.data.executionsToday
    redisFeatureCount.value = response.data.redisFeatures.count
  } catch (error) {
    console.error('Failed to fetch dashboard stats:', error)
  }
}
</script>

<style scoped>
.dashboard {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: #f9fafb;
}

.dashboard-header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 2rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.header-content h1 {
  font-size: 2.5rem;
  margin-bottom: 0.5rem;
}

.tagline {
  font-size: 1.1rem;
  opacity: 0.9;
}

.dashboard-content {
  flex: 1;
  overflow-y: auto;
  padding: 2rem;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1.5rem;
  margin-bottom: 3rem;
}

.stat-card {
  background: white;
  padding: 1.5rem;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  transition: transform 0.2s, box-shadow 0.2s;
}

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.stat-card h3 {
  font-size: 0.875rem;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.5rem;
}

.stat-value {
  font-size: 2.5rem;
  font-weight: 700;
  color: #1f2937;
  margin: 0;
}

.stat-label {
  font-size: 0.875rem;
  color: #9ca3af;
  margin: 0;
}

.recent-workflows {
  margin-bottom: 3rem;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.section-header h2 {
  font-size: 1.5rem;
  color: #1f2937;
  margin: 0;
}

.workflow-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1.5rem;
}

.workflow-card {
  background: white;
  padding: 1.5rem;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
}

.workflow-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.workflow-card h3 {
  font-size: 1.25rem;
  margin-bottom: 0.5rem;
  color: #1f2937;
}

.workflow-card p {
  color: #6b7280;
  margin-bottom: 1rem;
}

.workflow-meta {
  display: flex;
  justify-content: space-between;
  font-size: 0.875rem;
  color: #9ca3af;
}

.active-indicator {
  position: absolute;
  top: 1rem;
  right: 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: #10b981;
  font-weight: 500;
}

.pulse {
  width: 8px;
  height: 8px;
  background: #10b981;
  border-radius: 50%;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4);
  }
  70% {
    box-shadow: 0 0 0 10px rgba(16, 185, 129, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);
  }
}

.empty-state {
  text-align: center;
  padding: 4rem 2rem;
  background: white;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.empty-state svg {
  color: #e5e7eb;
  margin-bottom: 1rem;
}

.empty-state h3 {
  font-size: 1.5rem;
  margin-bottom: 0.5rem;
  color: #1f2937;
}

.empty-state p {
  color: #6b7280;
  margin-bottom: 1.5rem;
}

.features-section {
  margin-top: 3rem;
}

.features-section h2 {
  font-size: 1.5rem;
  margin-bottom: 1.5rem;
  color: #1f2937;
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1.5rem;
}

.feature-card {
  background: white;
  padding: 1.5rem;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  text-align: center;
  transition: transform 0.2s;
}

.feature-card:hover {
  transform: translateY(-2px);
}

.feature-icon {
  font-size: 2rem;
  margin-bottom: 0.5rem;
}

.feature-card h4 {
  font-size: 1rem;
  margin-bottom: 0.5rem;
  color: #1f2937;
}

.feature-card p {
  font-size: 0.875rem;
  color: #6b7280;
}

.loading, .error {
  text-align: center;
  padding: 2rem;
  color: #6b7280;
}

.error {
  color: #ef4444;
}
</style>
