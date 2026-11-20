import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'
import { SIGNED_OUT_CODES, apiFetch } from '../api/client.js'
import { completeGoogleSignIn, signOut } from '../auth/index.js'
import { consentCancelled, forgetLinkRoute, peekLinkRoute, takeRememberedRoute } from '../auth/returnTo.js'
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
//
// A return from Settings › Link Google account (Story 7.3b) carries the link marker (auth/returnTo.js).
// Then a completed link calls POST /api/me/google-link (the name now follows Google), and every exit
// lands on the marked route with Settings open: `state.settings.linkError` is null (linked, or consent
// cancelled: nothing is shown) or an API-style error `{ code }` for Settings' error line. The marker is
// read without clearing and dropped only on an exit, so React StrictMode's second effect still sees it.
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

    async function finishLink(route) {
      const toSettings = (linkError = null) => {
        forgetLinkRoute()
        navigate(route, { replace: true, state: { settings: { linkError } } })
      }
      // Cancelled consent changes nothing and shows nothing. Awaited like the exchange, so only the
      // live effect navigates.
      const cancelled = consentCancelled(search, hash)
      const result = await (cancelled ? null : completeGoogleSignIn(search, hash))
      if (!live) return
      if (cancelled) return toSettings()
      if (result?.error) {
        return toSettings({ code: result.error === 'identity_in_use' ? 'google_identity_in_use' : 'link_failed' })
      }
      try {
        await apiFetch('/api/me/google-link', { method: 'POST' })
      } catch (err) {
        if (!live) return
        // A signed-out session is the app's: api/client.js takes the student to Login.
        if (SIGNED_OUT_CODES.has(err?.code)) return forgetLinkRoute()
        return toSettings({ code: typeof err?.code === 'string' ? err.code : 'link_failed', params: err?.params ?? {} })
      }
      if (live) toSettings()
    }

    async function finish() {
      const linkRoute = peekLinkRoute()
      if (linkRoute) return finishLink(linkRoute)
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
