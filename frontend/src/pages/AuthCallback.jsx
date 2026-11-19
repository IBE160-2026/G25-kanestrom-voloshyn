import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate } from 'react-router'
import { SIGNED_OUT_CODES, apiFetch } from '../api/client.js'
import { completeOAuth, googleSetting, signOut } from '../auth/index.js'
import { takeRememberedRoute } from '../auth/returnTo.js'
import panel from '../components/AuthForm.module.css'
import AuthLayout from '../components/AuthLayout.jsx'
import { LANGUAGES, setLanguage } from '../i18n/index.js'
import Login from './Login.jsx'

// The Projects page; it forwards to the last opened Project when there is one (FR-8).
const HOME = '/projects'

// /auth/callback: where Supabase returns after Google consent (FR-19). Without Google configured
// it behaves as before (Login), since no sign-in can return here. A failed /api/config load is not
// "Google off": it goes to Login with "Sign-in didn't work. Try again.".
export default function AuthCallback() {
  const [setting, setSetting] = useState(null) // null while /api/config loads
  useEffect(() => {
    let live = true
    googleSetting().then((value) => live && setSetting(value))
    return () => {
      live = false
    }
  }, [])
  if (setting === null) return null
  if (setting === 'unknown') return <Navigate to="/" replace state={{ googleError: 'failed' }} />
  return setting === 'on' ? <CompleteGoogleSignIn /> : <Login />
}

// Finishes the session (supabase-js reads it from the URL), then runs the normal post-sign-in path:
// POST /api/auth/after-sign-in (the Account's language, the Google first name, and the server-side
// takeover check), then the remembered route or Projects. Any failure leaves no session and goes
// back to Login with the matching Error line: the Google identity already linked elsewhere, or
// "Sign-in didn't work. Try again." for a cancelled consent and everything else.
function CompleteGoogleSignIn() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const started = useRef(false)
  // Mounted right now. React StrictMode unmounts and remounts once in development, so this is
  // read when the work settles, not when it starts.
  const alive = useRef(false)

  useEffect(() => {
    alive.current = true
    if (!started.current) {
      started.current = true
      finish().then((to) => {
        if (alive.current) navigate(to.path, { replace: true, state: to.state ?? null })
      })
    }
    return () => {
      alive.current = false
    }

    async function finish() {
      const result = await completeOAuth()
      if (result.error) return { path: '/', state: { googleError: result.error } }
      try {
        const profile = await apiFetch('/api/auth/after-sign-in', {
          method: 'POST',
          body: { language: i18n.resolvedLanguage },
        })
        // The Account's language wins over this browser's (it follows the student, FR-29).
        if (LANGUAGES.includes(profile?.language)) await setLanguage(profile.language)
        const landing = typeof profile?.last_project_id === 'string' ? `/projects/${profile.last_project_id}` : HOME
        return { path: takeRememberedRoute() ?? landing }
      } catch (err) {
        // A refused session is already signed out locally by api/client.js; otherwise end it here,
        // so Login shows the form and both ways in can be retried.
        if (!SIGNED_OUT_CODES.has(err?.code)) await signOut()
        return { path: '/', state: { googleError: 'failed' } }
      }
    }
  }, [i18n, navigate])

  return (
    <AuthLayout>
      <div className={panel.panel} aria-busy="true" aria-label={t('login.google')} />
    </AuthLayout>
  )
}
