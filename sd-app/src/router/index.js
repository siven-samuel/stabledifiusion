import { createRouter, createWebHashHistory } from 'vue-router'
import HomePage from '../HomePage.vue'
import App from '../App.vue'
import GameView from '../GameView.vue'
import VersionPage from '../VersionPage.vue'

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
  },
  {
    path: '/version',
    name: 'Version',
    component: VersionPage
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
