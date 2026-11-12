// The SPA's routes. FastAPI serves index.html for every deep link (AD-17).
import CreateAccount from './pages/CreateAccount.jsx'
import Login from './pages/Login.jsx'
import Projects from './pages/Projects.jsx'

export const routes = [
  { path: '/', element: <Login /> },
  { path: '/signup', element: <CreateAccount /> },
  { path: '/projects', element: <Projects /> },
  // Until the other screens exist, unknown paths show Login, as before.
  { path: '*', element: <Login /> },
]
