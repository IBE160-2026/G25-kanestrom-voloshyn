import { Dialog } from 'radix-ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SIGNED_OUT_CODES, apiFetch } from '../api/client.js'
import { errorText } from '../i18n/errors.js'
import ErrorLine from './ErrorLine.jsx'
import styles from './QrDialog.module.css'
import { TILE, fileState } from './fileStatus.js'
import { phoneUrl, qrPath } from './qrCode.js'

// QR dialog (FR-21, AD-24; EXPERIENCE.md › Phone upload, State Patterns › Phone link; DESIGN.md › QR
// dialog). Each opening creates a phone link for the open Project (POST .../phone-links) and shows the
// QR code for `{app_public_url}/u/{token}`, drawn here in the browser with the `qrcode` package, the
// 10-minute line, and "Waiting for photos…". While it is open the Project's files are polled (the
// caller passes `live` to useProjectFiles), and each phone batch that arrives shows here with its file
// status. Closing it revokes the link (DELETE .../phone-links/{id}); leaving the page while it is open
// revokes it with `navigator.sendBeacon`, since a beacon can't carry the bearer token. When the link
// expires while the dialog is open, or the page comes back from the back-forward cache, a fresh link
// (and QR code) replaces it; an expired link isn't revoked, so a phone can still finalize a batch in
// the 10 minutes after expiry. Without a public URL from /api/config, the generic error shows instead
// of a code the phone might not reach.
//
// `open`: whether it shows. `materials`: the Project's live file list (null while unknown).
// `onClose()`: Esc or Close.

function revoke(projectId, link) {
  // An expired link is left as it is: its batches may still be finalized for 10 minutes (AD-24).
  if (Date.parse(link.expires_at) <= Date.now()) return
  apiFetch(`/api/projects/${projectId}/phone-links/${link.link_id}`, { method: 'DELETE' }).catch(() => {})
}

export default function QrDialog({ open, projectId, materials, onClose }) {
  const { t } = useTranslation()
  const close = useRef(null)
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.scrim} />
        <Dialog.Content
          className={styles.dialog}
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            close.current?.focus()
          }}
        >
          <Dialog.Title className={styles.title}>{t('qr.title')}</Dialog.Title>
          {/* Mounted only while open: one link per opening, revoked when it unmounts. */}
          <PhoneLink projectId={projectId} materials={materials} />
          <div className={styles.actions}>
            <Dialog.Close asChild>
              <button ref={close} type="button" className={styles.ghost}>
                {t('qr.close')}
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function PhoneLink({ projectId, materials }) {
  const { t } = useTranslation()
  const [link, setLink] = useState(null) // { link_id, token, expires_at, url }
  const [error, setError] = useState(null)
  const [round, setRound] = useState(0) // a new round makes a fresh link
  const renew = () => {
    setLink(null)
    setRound((n) => n + 1)
  }
  // The files there when it opened; a phone batch after that has "arrived".
  const [baseline, setBaseline] = useState(() => (materials ? new Set(materials.map((m) => m.id)) : null))
  if (baseline === null && materials) setBaseline(new Set(materials.map((m) => m.id)))

  // A link is made when this mounts (and for each new round) and revoked when it is replaced or this
  // unmounts (the dialog closed, the Project changed, or the page went away).
  useEffect(() => {
    let live = true
    let created = null
    Promise.all([
      apiFetch(`/api/projects/${projectId}/phone-links`, { method: 'POST' }),
      apiFetch('/api/config', { auth: false }).catch(() => null),
    ])
      .then(([made, config]) => {
        if (!live) return revoke(projectId, made)
        const url = phoneUrl(config?.app_public_url, made.token)
        if (!url) {
          revoke(projectId, made)
          setError({ code: 'config_unavailable', params: {} })
          return
        }
        created = made
        setLink({ ...made, url })
      })
      .catch((err) => {
        if (live && !SIGNED_OUT_CODES.has(err?.code)) setError(err)
      })
    return () => {
      live = false
      if (created) revoke(projectId, created)
    }
  }, [projectId, round])

  // The link expires while the dialog is open: a fresh one replaces it.
  const expiresAt = link?.expires_at ?? null
  useEffect(() => {
    if (!expiresAt) return undefined
    const timer = setTimeout(renew, Math.max(0, Date.parse(expiresAt) - Date.now()))
    return () => clearTimeout(timer)
  }, [expiresAt])

  // Back from the back-forward cache: the beacon revoked the old link when the page was hidden.
  useEffect(() => {
    const onShow = (event) => {
      if (event.persisted) renew()
    }
    window.addEventListener('pageshow', onShow)
    return () => window.removeEventListener('pageshow', onShow)
  }, [])

  // Leaving or reloading the page while the dialog is open: the beacon revokes the link.
  const token = link?.token ?? null
  useEffect(() => {
    if (!token) return undefined
    const onHide = () => {
      try {
        navigator.sendBeacon?.(`/api/phone/${encodeURIComponent(token)}/revoke`)
      } catch {
        // best effort: the link also expires on its own
      }
    }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [token])

  const qr = useMemo(() => (link ? qrPath(link.url) : null), [link])
  const arrived = baseline ? (materials ?? []).filter((m) => m.file_type === 'phone_batch' && !baseline.has(m.id)) : []

  return (
    <>
      {error ? (
        <ErrorLine>{errorText(t, error)}</ErrorLine>
      ) : (
        <div className={styles.tile} data-testid="qr-tile">
          {qr ? (
            <svg
              className={styles.code}
              viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`}
              role="img"
              aria-label={t('qr.title')}
              data-url={link.url}
              shapeRendering="crispEdges"
            >
              <path d={qr.d} fill="currentColor" />
            </svg>
          ) : (
            <div className={styles.placeholder} aria-hidden="true" />
          )}
        </div>
      )}
      <p className={styles.expiry}>{t('qr.expiry')}</p>
      <div className={styles.live} aria-live="polite">
        <p className={styles.waiting}>
          <span className={styles.pulse} aria-hidden="true" />
          {t('qr.waiting')}
        </p>
        {arrived.length > 0 && (
          <ul className={styles.arrived}>
            {arrived.map((material) => (
              <ArrivedRow key={material.id} material={material} />
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

function ArrivedRow({ material }) {
  const { t } = useTranslation()
  const state = fileState(material)
  return (
    <li className={styles.row}>
      <span className={styles.rowTile} aria-hidden="true">
        {TILE.phone_batch}
      </span>
      <span className={styles.rowName}>{material.file_name}</span>
      <span className={`${styles.status} ${styles[state]}`}>
        <span className={styles.dot} aria-hidden="true" />
        {t(`files.status.${state}`)}
      </span>
    </li>
  )
}
