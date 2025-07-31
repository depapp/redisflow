<template>
  <div class="workflow-list">
    <header class="list-header">
      <h1>All Workflows</h1>
      <button @click="createNewWorkflow" class="btn btn-primary">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        New Workflow
      </button>
    </header>

    <div class="list-content">
      <div v-if="workflowStore.loading" class="loading">
        Loading workflows...
      </div>
      <div v-else-if="workflowStore.error" class="error">
        Error: {{ workflowStore.error }}
      </div>
      <div v-else-if="!workflowStore.hasWorkflows" class="empty-state">
        <h3>No workflows yet</h3>
        <p>Create your first workflow to get started</p>
        <button @click="createNewWorkflow" class="btn btn-primary">
          Create Workflow
        </button>
      </div>
      <div v-else class="workflow-table">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Description</th>
              <th>Nodes</th>
              <th>Last Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="workflow in workflowStore.workflows" :key="workflow.id">
              <td>
                <a @click="openWorkflow(workflow.id)" class="workflow-link">
                  {{ workflow.name }}
                </a>
              </td>
              <td>{{ workflow.description || '-' }}</td>
              <td>{{ workflow.nodes?.length || 0 }}</td>
              <td>{{ formatDate(workflow.updated) }}</td>
              <td class="actions">
                <button @click="openWorkflow(workflow.id)" class="btn btn-sm">Edit</button>
                <button @click="executeWorkflow(workflow.id)" class="btn btn-sm btn-success">Run</button>
                <button @click="deleteWorkflow(workflow.id)" class="btn btn-sm btn-danger">Delete</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useWorkflowStore } from '../stores/workflow'

const router = useRouter()
const workflowStore = useWorkflowStore()

onMounted(async () => {
  await workflowStore.fetchWorkflows()
})

function createNewWorkflow() {
  router.push('/workflow/new')
}

function openWorkflow(id) {
  router.push(`/workflow/${id}`)
}

async function executeWorkflow(id) {
  try {
    const result = await workflowStore.executeWorkflow(id)
    alert(`Workflow executed successfully! Check the console for details.`)
    console.log('Execution result:', result)
  } catch (error) {
    alert(`Failed to execute workflow: ${error.message}`)
  }
}

async function deleteWorkflow(id) {
  if (confirm('Are you sure you want to delete this workflow?')) {
    await workflowStore.deleteWorkflow(id)
  }
}

function formatDate(dateString) {
  return new Date(dateString).toLocaleString()
}
</script>

<style scoped>
.workflow-list {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: #f9fafb;
}

.list-header {
  background: white;
  padding: 2rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.list-content {
  flex: 1;
  overflow-y: auto;
  padding: 2rem;
}

.workflow-table {
  background: white;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

table {
  width: 100%;
  border-collapse: collapse;
}

th {
  background: #f3f4f6;
  padding: 1rem;
  text-align: left;
  font-weight: 600;
  color: #374151;
}

td {
  padding: 1rem;
  border-top: 1px solid #e5e7eb;
}

.workflow-link {
  color: #3b82f6;
  cursor: pointer;
  text-decoration: none;
}

.workflow-link:hover {
  text-decoration: underline;
}

.btn-sm {
  padding: 4px 12px;
  font-size: 0.875rem;
  margin-right: 0.5rem;
}

.empty-state {
  text-align: center;
  padding: 4rem;
  background: white;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.loading, .error {
  text-align: center;
  padding: 2rem;
}

.error {
  color: #ef4444;
}
</style>
