// Account actions shared by the Account menu and the Settings page (Story 7.3a): the language switch,
// saved to the Account (FR-29), and Log out (FR-2).
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { apiFetch, detachSignedOutListener } from '../api/client.js'
import { signOut } from '../auth/index.js'
import { forgetRoute } from '../auth/returnTo.js'
import { LANGUAGES, setLanguage } from '../i18n/index.js'

/**
 * `chooseLanguage(lng)`: the interface switches at once, then PATCH /api/me saves it. A failed save
 * keeps the switch and is reported through `onSaveError(error)`; `onSaveError(null)` clears it when a
 * new save starts. The latest choice wins: a reply to a superseded save is ignored.
 */
export function useChooseLanguage(onSaveError) {
  const { i18n } = useTranslation()
  const latestSave = useRef(0)

  return async function chooseLanguage(lng) {
    if (!LANGUAGES.includes(lng) || lng === i18n.resolvedLanguage) return
    const save = ++latestSave.current
    onSaveError?.(null)
    await setLanguage(lng)
    try {
      await apiFetch('/api/me', { method: 'PATCH', body: { language: lng } })
    } catch (err) {
      if (save === latestSave.current) onSaveError?.(err)
    }
  }
}

/** `logOut()`: immediate, no confirmation (EXPERIENCE.md); ends the session and goes to Login. */
export function useLogOut() {
  const navigate = useNavigate()

  return async function logOut() {
    // Deliberate: refusals still in flight show no expiry notice and remember no route. signOut
    // clears the session locally before resolving; the server call finishes in the background.
    detachSignedOutListener()
    forgetRoute()
    await signOut()
    navigate('/', { replace: true })
  }
}
