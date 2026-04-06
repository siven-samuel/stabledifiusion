import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: "AIzaSyBRSN9B_oyhWW_pg41HK2xLdV-2XEqDeoA",
  authDomain: "artemis-156a1.firebaseapp.com",
  projectId: "artemis-156a1",
  storageBucket: "artemis-156a1.firebasestorage.app",
  messagingSenderId: "1079686990968",
  appId: "1:1079686990968:web:f3dc1c187627bb9d9af18d",
  measurementId: "G-CL9Y3P3TV3"
}

const app = initializeApp(firebaseConfig)
const db = getFirestore(app)

export { db }
