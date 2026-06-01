import { createRouter, createWebHistory } from 'vue-router'
import Layout from '../layout/MainLayout.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: Layout,
      redirect: '/dashboard',
      children: [
        {
          path: 'dashboard',
          name: 'Dashboard',
          component: () => import('../views/Dashboard.vue'),
        },
        {
          path: 'tasks',
          name: 'Tasks',
          component: () => import('../views/TaskList.vue'),
        },
        {
          path: 'tasks/new',
          name: 'TaskCreate',
          component: () => import('../views/TaskForm.vue'),
        },
        {
          path: 'tasks/:id/edit',
          name: 'TaskEdit',
          component: () => import('../views/TaskForm.vue'),
        },
        {
          path: 'history',
          name: 'History',
          component: () => import('../views/History.vue'),
        },
        {
          path: 'ai',
          name: 'AIAssistant',
          component: () => import('../views/AIAssistant.vue'),
        },
        {
          path: 'settings',
          name: 'Settings',
          component: () => import('../views/Settings.vue'),
        },
      ],
    },
  ],
})

export default router
