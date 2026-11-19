import { useEffect, useRef, useState } from 'react'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router'
import { onSignedOut } from '../api/client.js'
import { hasSession } from '../auth/index.js'
import { rememberRoute } from '../auth/returnTo.js'

// Guards the signed-in pages (FR-2). Without a session it remembers the route and shows Login;
// the next login returns here. While signed in, it registers the api/client.js listener: when the
// backend says the session has ended, client.js signs out locally and this sends the student to
// Login with the session-expired notice, remembering where they were.
export default function RequireSession() {
  const location = useLocation()
  const navigate = useNavigate()
  const [status, setStatus] = useState('checking') // 'checking' | 'in' | 'out'
  const here = `${location.pathname}${location.search}`
  const hereRef = useRef(here)

  useEffect(() => {
    hereRef.current = here
  }, [here])

  useEffect(() => {
    const run = { live: true }
    const signedOut = () => {
      if (!run.live) return
      rememberRoute(hereRef.current)
      setStatus('out')
    }
    hasSession()
      .then((signedIn) => (signedIn ? run.live && setStatus('in') : signedOut()))
      .catch(signedOut)
    return () => {
      run.live = false
    }
  }, [])

  useEffect(
    () =>
      onSignedOut((code) => {
        rememberRoute(hereRef.current)
        const state = code === 'google_takeover' ? { googleTakeover: true } : { sessionExpired: true }
        navigate('/', { replace: true, state })
      }),
    [navigate],
  )

  if (status === 'checking') return null
  if (status === 'out') return <Navigate to="/" replace />
  return <Outlet />
}
