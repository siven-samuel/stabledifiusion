import { createRouter, createWebHashHistory } from 'vue-router'
import HomePage from '../HomePage.vue'
import App from '../App.vue'
import GameView from '../GameView.vue'

const routes = [
  {
    path: '/',
    name: 'Home',
    component: HomePage
  },
  {
    path: '/editor',
    name: 'Editor',
    component: App
  },
  {
    path: '/gameplay',
    name: 'Gameplay',
    component: GameView
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
