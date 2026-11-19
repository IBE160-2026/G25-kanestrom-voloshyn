import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { apiFetch } from '../api/client.js'
import ErrorLine from '../components/ErrorLine.jsx'
import { errorText } from '../i18n/errors.js'
import styles from './PhoneUpload.module.css'
import { countdownText } from './phoneCountdown.js'
import { IMAGE_DAILY_LIMIT, IMAGE_NOTICE_AT, MAX_BYTES } from './useProjectFiles.js'

// The phone upload page `/u/:token` (FR-21, AD-24; EXPERIENCE.md › Phone upload, State Patterns ›
// Phone link; DESIGN.md › Phone upload). Public: no sign-in, in the browser's language like the sign-in
// pages, a one-column mobile layout. It reads only what the link may read (GET /api/phone/{token}): the
// Project name, the images left today, whether the Project has a free slot, and when the link expires.
//
// - "Take photos" opens the camera, "Choose from gallery" the picker; photos join a strip of numbered
//   thumbnails, and × removes one at once (the rest renumber).
// - "Send {n} photos" has no maximum and is disabled at zero. It opens a batch, sends each photo in a
//   request of its own, then finalizes the batch into one Study Material. A photo the server refuses
//   (over 50 MB, past today's image limit, another type) is skipped, and the rest go through.
// - Before sending, advisory warnings: more photos than images left today, a full Project, a photo
//   over 50 MB (not sent), and the "{n} images left today" Limit notice at 10 or fewer. The server
//   re-checks everything.
// - The countdown reads "Link expires in {n} min", then "{m}:{ss}" in the last minute. Once the link
//   has expired or was revoked (the QR dialog closed), the expired notice shows and Send is disabled.
// - After sending: "Your photos are in {project}…" with "Send more" while the link is valid.
// - A send that fails part-way keeps its open batch and the photos already accepted: trying again sends
//   only the rest, then finalizes, so no photo uses a unit twice. Photos already on the server can't be
//   removed. When the link expires mid-send (not revoked), the accepted photos are still finalized: the
//   server allows that for 10 minutes after expiry.
// - The countdown runs on the server's clock (the `Date` header of the status answer), so a phone whose
//   clock is off still shows the right time. The status is read again every 30 s and when the page
//   becomes visible, so a link revoked meanwhile (the QR dialog closed) shows as expired.
// Nothing here uses an HTTPS-only browser API, so a LAN demo over plain HTTP works.

const TICK_MS = 1000
const RECHECK_MS = 30_000

let nextKey = 0

function phoneApi(token, rest = '', options = {}) {
  return apiFetch(`/api/phone/${encodeURIComponent(token)}${rest}`, { ...options, auth: false })
}

export default function PhoneUpload() {
  const { t } = useTranslation()
  const { token } = useParams()
  const [link, setLink] = useState(null) // the four fields from GET /api/phone/{token}
  const [loadError, setLoadError] = useState(null)
  const [revoked, setRevoked] = useState(false) // the server said link_expired
  const [photos, setPhotos] = useState([]) // [{ key, file, url, accepted }]
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [problems, setProblems] = useState([]) // messages for refused photos or a failed send
  const [now, setNow] = useState(() => Date.now())
  const [offset, setOffset] = useState(0) // the server's clock minus this one, in ms
  const batch = useRef(null) // the open batch's id, kept across a failed send
  const camera = useRef(null)
  const gallery = useRef(null)
  const urls = useRef(new Set())

  // Sets state only once the server answers. `quiet` (a re-check) shows only a revoked link.
  const fetchStatus = useCallback(
    (quiet = false) =>
      phoneApi(token, '', {
        onResponse: (response) => {
          const server = Date.parse(response.headers?.get?.('date') ?? '')
          if (!Number.isNaN(server)) setOffset(server - Date.now())
        },
      }).then(
        (status) => setLink(status),
        (error) => {
          if (error?.code === 'link_expired') setRevoked(true)
          else if (!quiet) setLoadError(error)
        },
      ),
    [token],
  )

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  // A link revoked while the page sits idle: re-check every 30 s and when the page shows again.
  useEffect(() => {
    if (revoked) return undefined
    const timer = setInterval(() => fetchStatus(true), RECHECK_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchStatus(true)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [fetchStatus, revoked])

  function load() {
    setLoadError(null)
    fetchStatus()
  }

  // The countdown, once a second.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [])

  // Object URLs for the thumbnails are freed when the page goes.
  useEffect(() => {
    const live = urls.current
    return () => {
      for (const url of live) URL.revokeObjectURL(url)
    }
  }, [])

  const msLeft = link ? Date.parse(link.expires_at) - (now + offset) : null
  const expired = revoked || (msLeft !== null && msLeft <= 0)
  const projectName = link?.project_name || t('projects.placeholder')

  function add(fileList) {
    const chosen = Array.from(fileList ?? [])
    if (chosen.length === 0) return
    const added = chosen.map((file) => {
      let url = null
      try {
        url = URL.createObjectURL(file)
        urls.current.add(url)
      } catch {
        // no preview (an old browser): the numbered tile still shows
      }
      return { key: `photo-${(nextKey += 1)}`, file, url }
    })
    setPhotos((list) => [...list, ...added])
    setProblems([])
  }

  function remove(key) {
    setPhotos((list) => {
      const gone = list.find((p) => p.key === key)
      if (gone?.url) {
        URL.revokeObjectURL(gone.url)
        urls.current.delete(gone.url)
      }
      return list.filter((p) => p.key !== key)
    })
  }

  function pick(input) {
    input.current?.click()
  }

  /** Past the link's expiry on the server's clock (as opposed to revoked). */
  function pastExpiry() {
    return link !== null && Date.parse(link.expires_at) <= Date.now() + offset
  }

  function markAccepted(key) {
    setPhotos((list) => list.map((p) => (p.key === key ? { ...p, accepted: true } : p)))
  }

  async function send() {
    if (sending || expired || photos.length === 0) return
    setSending(true)
    setProblems([])
    const refused = []
    try {
      if (batch.current === null) {
        const { batch_id: batchId } = await phoneApi(token, '/batches', { method: 'POST' })
        batch.current = batchId
      }
      const batchId = batch.current
      let accepted = photos.filter((p) => p.accepted).length
      for (const photo of photos) {
        if (photo.accepted) continue // already in the open batch, from an earlier try
        // Over 50 MB: the server would refuse it, so it isn't sent (EXPERIENCE.md › Phone link).
        if (photo.file.size > MAX_BYTES) {
          refused.push(t('phone.tooLarge'))
          continue
        }
        const form = new FormData()
        form.append('file', photo.file)
        try {
          await phoneApi(token, `/batches/${batchId}/photos`, { method: 'POST', body: form })
          accepted += 1
          markAccepted(photo.key)
        } catch (error) {
          if (error?.code !== 'link_expired') {
            refused.push(errorText(t, error))
            continue
          }
          // Expired (not revoked) with photos already in: finalize them, which is still allowed.
          if (accepted > 0 && pastExpiry()) break
          throw error
        }
      }
      if (accepted === 0) {
        setProblems(unique(refused))
        return
      }
      try {
        await phoneApi(token, `/batches/${batchId}/finalize`, { method: 'POST' })
      } catch (error) {
        // `conflict`: an earlier try finalized it, but its answer was lost.
        if (error?.code !== 'conflict') throw error
      }
      batch.current = null
      for (const photo of photos) if (photo.url) URL.revokeObjectURL(photo.url)
      setPhotos([])
      setSent(true)
      setProblems(unique(refused))
    } catch (error) {
      if (error?.code === 'link_expired') setRevoked(true)
      else if (error?.code === 'material_limit_reached') setProblems([t('phone.projectFull')])
      else setProblems([errorText(t, error)])
    } finally {
      setSending(false)
    }
  }

  function sendMore() {
    setSent(false)
    setProblems([])
    load()
  }

  // Advisory warnings before sending (the server re-checks every limit).
  const sendable = photos.filter((p) => p.file.size <= MAX_BYTES).length
  const oversized = photos.length - sendable
  const imagesLeft = link?.images_left_today ?? null
  const unsent = photos.filter((p) => !p.accepted && p.file.size <= MAX_BYTES).length
  const overLimit = imagesLeft !== null && unsent > imagesLeft ? unsent - imagesLeft : 0
  const countdown = link && !expired ? countdownText(t, msLeft) : null

  return (
    <main className={styles.screen}>
      <p className={styles.wordmark}>{t('login.wordmark')}</p>
      {loadError && !link && (
        <div className={styles.block}>
          <ErrorLine>{errorText(t, loadError)}</ErrorLine>
          <button type="button" className={styles.action} onClick={load}>
            {t('inlineError.retry')}
          </button>
        </div>
      )}
      {expired && !sent && (
        <div className={styles.expired} role="status">
          <p className={styles.expiredTitle}>{t('phone.expiredTitle')}</p>
          <p className={styles.expiredBody}>{t('phone.expiredBody')}</p>
        </div>
      )}
      {link && sent && (
        <div className={styles.sent} role="status">
          <p className={styles.sentText}>{t('phone.sent', { project: projectName })}</p>
          {problems.length > 0 && <Problems items={problems} />}
          {!expired && (
            <button type="button" className={styles.action} onClick={sendMore}>
              {t('phone.sendMore')}
            </button>
          )}
        </div>
      )}
      {link && !sent && (
        <div className={`${styles.body} ${expired ? styles.inactive : ''}`}>
          <h1 className={styles.project}>{t('phone.header', { project: projectName })}</h1>
          <input
            ref={camera}
            type="file"
            accept="image/*"
            capture="environment"
            className={styles.picker}
            tabIndex={-1}
            aria-hidden="true"
            data-testid="phone-camera"
            disabled={expired}
            onChange={(event) => {
              add(event.target.files)
              event.target.value = ''
            }}
          />
          <input
            ref={gallery}
            type="file"
            accept="image/*"
            multiple
            className={styles.picker}
            tabIndex={-1}
            aria-hidden="true"
            data-testid="phone-gallery"
            disabled={expired}
            onChange={(event) => {
              add(event.target.files)
              event.target.value = ''
            }}
          />
          <button type="button" className={styles.action} onClick={() => pick(camera)} disabled={expired || sending}>
            {t('phone.take')}
          </button>
          <button type="button" className={styles.action} onClick={() => pick(gallery)} disabled={expired || sending}>
            {t('phone.gallery')}
          </button>
          {photos.length > 0 && (
            <ol className={styles.strip}>
              {photos.map((photo, index) => (
                <li key={photo.key} className={`${styles.thumb} ${photo.file.size > MAX_BYTES ? styles.tooLarge : ''}`}>
                  {photo.url && <img className={styles.image} src={photo.url} alt="" />}
                  <span className={styles.pageNumber}>{index + 1}</span>
                  {!expired && !photo.accepted && (
                    <button
                      type="button"
                      className={styles.remove}
                      aria-label={`${t('files.remove.item')} ${index + 1}`}
                      onClick={() => remove(photo.key)}
                      disabled={sending}
                    >
                      <span className={styles.x} aria-hidden="true">
                        <svg viewBox="0 0 10 10" focusable="false">
                          <path d="M2 2 8 8M8 2 2 8" fill="none" stroke="currentColor" strokeWidth="1.3" />
                        </svg>
                      </span>
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
          {!expired && (
            <div className={styles.warnings}>
              {imagesLeft !== null && imagesLeft <= IMAGE_NOTICE_AT && (
                <p className={`${styles.limit} ${imagesLeft === 0 ? styles.limitOut : ''}`} role="status">
                  <span className={styles.limitDot} aria-hidden="true" />
                  {t('files.limit.images', { count: imagesLeft })}
                </p>
              )}
              {overLimit > 0 && (
                <p className={styles.warning}>
                  {imagesLeft === 0
                    ? t('errors.quota_exceeded', { limit: IMAGE_DAILY_LIMIT })
                    : `${t('phone.overLimitAllowed', { count: imagesLeft })} ${t('phone.overLimitDropped', { count: overLimit })}`}
                </p>
              )}
              {link.slot_available === false && <p className={styles.warning}>{t('phone.projectFull')}</p>}
              {oversized > 0 && <p className={styles.warning}>{t('phone.tooLarge')}</p>}
              {problems.length > 0 && <Problems items={problems} />}
            </div>
          )}
          <div className={styles.grow} />
          <button
            type="button"
            className={styles.send}
            onClick={send}
            disabled={expired || sending || photos.length === 0}
            aria-busy={sending}
          >
            {photos.length === 0 ? t('phone.sendNone') : t('phone.send', { count: photos.length })}
          </button>
          {countdown && <p className={styles.countdown}>{countdown}</p>}
        </div>
      )}
      <footer className={styles.credit}>{t('footer.credit')}</footer>
    </main>
  )
}

function unique(list) {
  return [...new Set(list)]
}

function Problems({ items }) {
  return (
    <div className={styles.problems} role="alert">
      {items.map((text) => (
        <p key={text} className={styles.problem}>
          {text}
        </p>
      ))}
    </div>
  )
}
