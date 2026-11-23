// The SPA's routes. FastAPI serves index.html for every deep link (AD-17).
import AppShell from './components/AppShell.jsx'
import RequireSession from './components/RequireSession.jsx'
import AuthCallback from './pages/AuthCallback.jsx'
import CreateAccount from './pages/CreateAccount.jsx'
import EmailVerified from './pages/EmailVerified.jsx'
import FlashcardSession from './pages/FlashcardSession.jsx'
import FlashcardSetup from './pages/FlashcardSetup.jsx'
import ForgotPassword from './pages/ForgotPassword.jsx'
import Login from './pages/Login.jsx'
import PhoneUpload from './pages/PhoneUpload.jsx'
import ProjectHome from './pages/ProjectHome.jsx'
import Projects from './pages/Projects.jsx'
import QuizPage from './pages/QuizPage.jsx'
import QuizSetup from './pages/QuizSetup.jsx'
import ResetPassword from './pages/ResetPassword.jsx'
import ReviewSession from './pages/ReviewSession.jsx'
import ReviewStart from './pages/ReviewStart.jsx'

export const routes = [
  { path: '/', element: <Login /> },
  { path: '/signup', element: <CreateAccount /> },
  { path: '/email-verified', element: <EmailVerified /> },
  { path: '/forgot-password', element: <ForgotPassword /> },
  { path: '/reset-password', element: <ResetPassword /> },
  // Google sign-in returns here (FR-19); config.toml allows it as a redirect URL.
  { path: '/auth/callback', element: <AuthCallback /> },
  // The phone upload page (FR-21, AD-24): public, no sign-in; the token in the path is the capability.
  { path: '/u/:token', element: <PhoneUpload /> },
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
          { path: '/projects/:projectId/quiz', element: <QuizSetup /> },
          { path: '/projects/:projectId/quizzes/:quizId', element: <QuizPage /> },
          { path: '/projects/:projectId/flashcards', element: <FlashcardSetup /> },
          { path: '/projects/:projectId/flashcard-sets/:setId', element: <FlashcardSession /> },
          { path: '/projects/:projectId/review', element: <ReviewStart /> },
          { path: '/projects/:projectId/review/:roundId', element: <ReviewSession /> },
        ],
      },
    ],
  },
  // Until the other screens exist, unknown paths show Login, as before.
  { path: '*', element: <Login /> },
]
