import { createRouter, createWebHistory } from 'vue-router'
import Dashboard from '../views/Dashboard.vue'
import WorkflowEditor from '../views/WorkflowEditor.vue'
import WorkflowList from '../views/WorkflowList.vue'

const routes = [
  {
    path: '/',
    name: 'Dashboard',
    component: Dashboard
  },
  {
    path: '/workflows',
    name: 'WorkflowList',
    component: WorkflowList
  },
  {
    path: '/workflow/:id',
    name: 'WorkflowEditor',
    component: WorkflowEditor,
    props: true
  },
  {
    path: '/workflow/new',
    name: 'NewWorkflow',
    component: WorkflowEditor
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
