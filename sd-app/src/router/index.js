import { createRouter, createWebHashHistory } from 'vue-router'
import HomePage from '../HomePage.vue'
import App from '../App.vue'
import GameView from '../GameView.vue'
import VersionPage from '../VersionPage.vue'
import ScoreBoard from '../ScoreBoard.vue'

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
  },
  {
    path: '/scoreboard',
    name: 'Scoreboard',
    component: ScoreBoard
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
