// The SPA's routes. FastAPI serves index.html for every deep link (AD-17).
import AppShell from './components/AppShell.jsx'
import RequireSession from './components/RequireSession.jsx'
import CreateAccount from './pages/CreateAccount.jsx'
import EmailVerified from './pages/EmailVerified.jsx'
import ForgotPassword from './pages/ForgotPassword.jsx'
import Login from './pages/Login.jsx'
import ProjectHome from './pages/ProjectHome.jsx'
import Projects from './pages/Projects.jsx'
import ResetPassword from './pages/ResetPassword.jsx'

export const routes = [
  { path: '/', element: <Login /> },
  { path: '/signup', element: <CreateAccount /> },
  { path: '/email-verified', element: <EmailVerified /> },
  { path: '/forgot-password', element: <ForgotPassword /> },
  { path: '/reset-password', element: <ResetPassword /> },
  // Signed-in pages: without a session they go to Login and come back after it (FR-2). They share
  // the app shell: Sidebar, Top bar, and the page (Story 2.1).
  {
    element: <RequireSession />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/projects', element: <Projects /> },
          { path: '/projects/:projectId', element: <ProjectHome /> },
        ],
      },
    ],
  },
  // Until the other screens exist, unknown paths show Login, as before.
  { path: '*', element: <Login /> },
]
