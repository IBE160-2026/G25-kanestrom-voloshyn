import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'
import { apiFetch } from '../api/client.js'
import { completeGoogleSignIn, signOut } from '../auth/index.js'
import { takeRememberedRoute } from '../auth/returnTo.js'
import panel from '../components/AuthForm.module.css'
import AuthLayout from '../components/AuthLayout.jsx'
import { LANGUAGES, setLanguage } from '../i18n/index.js'

const HOME = '/projects'

// /auth/callback (FR-19): Google sends the browser back here. supabase-js finishes the PKCE
// exchange (auth/), then POST /api/auth/after-sign-in fills the first name from Google and brings
// the Account's language, and the student lands where Login lands them. A cancelled or refused
// sign-in goes back to Login with the Error line ("Sign-in didn't work. Try again.", or "already
// linked" for a Google account that belongs to another Account); no Account changes. The code in
// the URL is single use and is never shown again: every exit replaces this history entry.
export default function AuthCallback() {
  const { i18n } = useTranslation()
  const navigate = useNavigate()
  const { search, hash } = useLocation()

  useEffect(() => {
    let live = true
    const toLogin = (googleError) => navigate('/', { replace: true, state: { googleError } })
    // The sign-in took over an unverified email Account and ended every session (AD-19): Login says
    // so, and the student signs in with Google once more.
    const toLoginTakenOver = () => navigate('/', { replace: true, state: { googleTakeover: true } })

    async function finish() {
      const result = await completeGoogleSignIn(search, hash)
      if (!live) return
      if (result?.error) return toLogin(result.error === 'identity_in_use' ? 'identityInUse' : 'failed')
      let landing = HOME
      try {
        const profile = await apiFetch('/api/auth/after-sign-in', {
          method: 'POST',
          body: { language: i18n.resolvedLanguage },
        })
        if (!live) return
        if (LANGUAGES.includes(profile?.language)) await setLanguage(profile.language)
        // Land on the last opened active Project (FR-8); a remembered route still wins.
        if (typeof profile?.last_project_id === 'string') landing = `/projects/${profile.last_project_id}`
      } catch (err) {
        if (!live) return
        // Not signed in after all: drop the new session, so Login offers Google again.
        const { ended } = await signOut()
        await ended
        if (!live) return
        if (err?.code === 'google_takeover') toLoginTakenOver()
        else toLogin('failed')
        return
      }
      if (live) navigate(takeRememberedRoute() ?? landing, { replace: true })
    }

    finish()
    return () => {
      live = false
    }
  }, [search, hash, navigate, i18n])

  // Nothing to read while the sign-in finishes: an empty, busy Auth panel.
  return (
    <AuthLayout>
      <div className={panel.panel} aria-busy="true" />
    </AuthLayout>
  )
}
