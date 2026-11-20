import { Dialog } from 'radix-ui'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'
import { SIGNED_OUT_CODES, apiFetch } from '../api/client.js'
import { isGoogleEnabled, linkGoogle } from '../auth/index.js'
import Avatar from '../components/Avatar.jsx'
import DeleteProjectDialog from '../components/DeleteProjectDialog.jsx'
import ErrorLine from '../components/ErrorLine.jsx'
import DeleteAccountDialog from '../components/DeleteAccountDialog.jsx'
import { useChooseLanguage, useDeleteAccount, useLogOut } from '../components/accountActions.js'
import { errorText } from '../i18n/errors.js'
import { LANGUAGES } from '../i18n/index.js'
import ChangePassword from './ChangePassword.jsx'
import styles from './Settings.module.css'

const NAME_MAX_LENGTH = 100 // the server cuts there too

/** Trimmed and cut to 100 code points, so a surrogate pair is never split (as the server cuts). */
function cleanName(raw) {
  return Array.from(raw.trim()).slice(0, NAME_MAX_LENGTH).join('').trim()
}

// Settings (FR-27, FR-29, Story 7.3a; DESIGN.md › Settings section; EXPERIENCE.md › IA › Settings): an
// overlay over the page the student is on, opened from the Account menu (changed from a page at
// /settings at Cristoffer's request on 2026-11-20). A click outside, Esc, or Close shuts it, and the
// page behind is just as it was; focus goes back to the Account menu trigger (`returnFocus`). Esc in
// an edited name field reverts the edit and leaves Settings open. It holds three stacked section
// cards: Account (with Change password), Language, and Your data. The profile and the Projects come
// from the shell; a failed profile load (`loadError`) shows an error line here, since the page behind
// is hidden, and the Account card waits for the profile. The delete dialogs open on top of it.
// `linkError` is the error a return from Link Google account brought (Story 7.3b), shown in the Account card.
export default function Settings({
  open,
  onClose,
  me,
  setMe,
  projects,
  deleteProject,
  loadError = null,
  linkError = null,
  returnFocus = null,
}) {
  const { t } = useTranslation()
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.scrim} />
        <Dialog.Content
          className={styles.dialog}
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => {
            const field = event.target
            if (field instanceof HTMLInputElement && field.dataset.saved !== undefined && field.value !== field.dataset.saved) {
              event.preventDefault()
            }
          }}
          onCloseAutoFocus={(event) => {
            const target = returnFocus?.current
            if (target instanceof HTMLElement && target.isConnected) {
              event.preventDefault()
              target.focus()
            }
          }}
        >
          <div className={styles.header}>
            <Dialog.Title asChild>
              <h1 className={styles.title}>{t('settings.title')}</h1>
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className={styles.close} aria-label={t('settings.close')}>
                <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                  <path d="M2 2l8 8M10 2l-8 8" fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </button>
            </Dialog.Close>
          </div>
          <div className={styles.page}>
            {!me && loadError && <ErrorLine>{errorText(t, loadError)}</ErrorLine>}
            {me && <AccountSection me={me} setMe={setMe} linkError={linkError} />}
            <LanguageSection />
            <DataSection projects={projects} deleteProject={deleteProject} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** A section card: heading, muted lead line, then its rows. `headingRef` makes the heading focusable. */
function Section({ heading, lead, headingRef = null, children }) {
  const id = useId()
  return (
    <section className={styles.section} aria-labelledby={id}>
      <h2 id={id} ref={headingRef} tabIndex={headingRef ? -1 : undefined} className={styles.heading}>
        {heading}
      </h2>
      <p className={styles.lead}>{lead}</p>
      {children}
    </section>
  )
}

// Account: the large Avatar, the name, the email, the sign-in method, and Log out. An Account with a
// Google identity shows its name read-only (it follows Google; the server refuses a change with
// name_from_google); an email Account edits it in place. Change password is offered to every Account
// with an email identity. An email Account without Google (Story 7.3b) also gets "Link Google account"
// once verified, or, until then, the muted "Verify your email first" with "Resend verification email".
function AccountSection({ me, setMe, linkError }) {
  const { t } = useTranslation()
  const logOut = useLogOut()
  const methods = Array.isArray(me.sign_in_methods) ? me.sign_in_methods : ['email']
  const google = methods.includes('google')
  return (
    <Section heading={t('settings.account.heading')} lead={t(google ? 'settings.account.leadGoogle' : 'settings.account.leadEmail')}>
      <div className={styles.who}>
        <Avatar firstName={me.first_name} pictureUrl={me.picture_url} size="lg" />
        <div className={styles.whoText}>
          {google ? <p className={styles.name}>{me.first_name}</p> : <NameField me={me} setMe={setMe} />}
          {me.email && <p className={styles.email}>{me.email}</p>}
          {/* An email Account whose address is confirmed says so (Cristoffer, 2026-11-20); until then the
              "Verify your email first" row below stands instead. */}
          {me.email && methods.includes('email') && me.email_verified && (
            <p className={styles.verified}>
              <svg className={styles.verifiedIcon} viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                <path d="M2.5 6.5l2.5 2.5 4.5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t('settings.account.verified')}
            </p>
          )}
          {/* One line per sign-in method: an Account with both shows both. */}
          {/* One line for the sign-in methods: Email, Google, or both (Cristoffer, 2026-11-20). */}
          <p className={styles.via}>
            {t(google ? (methods.includes('email') ? 'settings.account.viaBoth' : 'settings.account.viaGoogle') : 'settings.account.viaEmail')}
          </p>
        </div>
        <button type="button" className={styles.ghost} onClick={logOut}>
          {t('settings.account.logOut')}
        </button>
      </div>
      {methods.includes('email') && <ChangePassword />}
      {methods.includes('email') && !google && (me.email_verified ? <LinkGoogle /> : <ResendVerification setMe={setMe} />)}
      {linkError && (
        <div className={styles.row}>
          <ErrorLine>{errorText(t, linkError)}</ErrorLine>
        </div>
      )}
    </Section>
  )
}

// Link Google account (FR-19, FR-27): supabase-js `linkIdentity` sends the browser to Google and back to
// /auth/callback, which lands on this same page with Settings open. Shown only when Google sign-in is
// configured, as on Login. A link that can't start shows an error line.
function LinkGoogle() {
  const { t } = useTranslation()
  const { pathname, search, hash } = useLocation()
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null) // { attempt }
  const attempt = useRef(0)

  useEffect(() => {
    let live = true
    isGoogleEnabled().then((on) => live && setEnabled(on === true))
    return () => {
      live = false
    }
  }, [])

  // Back from Google's consent page restores this page from the bfcache: usable again.
  useEffect(() => {
    const onPageShow = (event) => {
      if (event.persisted) setBusy(false)
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])

  if (!enabled) return null

  async function onClick() {
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await linkGoogle(`${pathname}${search}${hash}`)
    // On success the browser is leaving for Google: stay busy.
    if (result?.error) {
      setBusy(false)
      attempt.current += 1
      setError({ attempt: attempt.current })
    }
  }

  return (
    <div className={styles.row}>
      <button type="button" className={styles.ghost} disabled={busy} aria-busy={busy} onClick={onClick}>
        {t('settings.account.linkGoogle')}
      </button>
      {error && (
        <div className={styles.afterSwitch}>
          <ErrorLine key={error.attempt}>{t('errors.generic')}</ErrorLine>
        </div>
      )}
    </div>
  )
}

// Until the email is verified (FR-1, EXPERIENCE.md › State Patterns › Account): "Verify your email first"
// (muted, not an error) in place of the link, and "Resend verification email" (POST /api/me/verification),
// which sends a new 24-hour link and invalidates older ones. Not rate-limited; one request at a time.
function ResendVerification({ setMe }) {
  const { t } = useTranslation()
  const id = useId()
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState(null) // { apiError, attempt }
  const attempt = useRef(0)
  const inFlight = useRef(false)

  async function onClick() {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setSent(false)
    setError(null)
    try {
      await apiFetch('/api/me/verification', { method: 'POST' })
      setSent(true)
    } catch (err) {
      if (SIGNED_OUT_CODES.has(err?.code)) return
      // Verified meanwhile (another tab, the emailed link): the row becomes Link Google account.
      if (err?.code === 'already_verified') {
        setMe((current) => (current ? { ...current, email_verified: true } : current))
        return
      }
      attempt.current += 1
      setError({ apiError: err, attempt: attempt.current })
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <div className={styles.row}>
      {/* Mounted empty, so the confirmation is announced when it arrives. */}
      <p role="status" className={styles.status}>
        {sent && t('settings.account.resent')}
      </p>
      <div className={styles.accountRow}>
        <p id={`${id}-verify`} className={styles.muted}>
          {t('settings.account.verifyFirst')}
        </p>
        <button
          type="button"
          className={styles.ghostSmall}
          aria-describedby={`${id}-verify`}
          disabled={busy}
          aria-busy={busy}
          onClick={onClick}
        >
          {t('settings.account.resend')}
        </button>
      </div>
      {error && (
        <div className={styles.afterSwitch}>
          <ErrorLine key={error.attempt}>{errorText(t, error.apiError)}</ErrorLine>
        </div>
      )}
    </div>
  )
}

// The first name as a Text input: saved on Enter or blur, trimmed (PATCH /api/me {first_name}), and shown
// at once in the Top bar greeting. Blank reverts with no request; Esc reverts; a failed save keeps the
// value and shows an error line. One save at a time: an Enter, blur, or Esc during a save is saved after
// it when the value then differs from the saved name, and a reply never overwrites what was typed or
// reverted meanwhile.
function NameField({ me, setMe }) {
  const { t } = useTranslation()
  const id = useId()
  const [value, setValue] = useState(me.first_name ?? '')
  const [error, setError] = useState(null) // { apiError, attempt }
  const attempt = useRef(0)
  const saved = useRef(me.first_name ?? '') // the name the server has
  const latest = useRef(value) // the input's value, read when a save ends
  const inFlight = useRef(false)
  const pending = useRef(false)

  function update(next) {
    latest.current = next
    setValue(next)
  }

  async function save() {
    if (inFlight.current) {
      pending.current = true
      return
    }
    const name = cleanName(latest.current)
    if (!name) {
      update(saved.current)
      setError(null)
      return
    }
    if (name === saved.current) {
      if (latest.current !== name) update(name)
      return
    }
    inFlight.current = true
    try {
      const profile = await apiFetch('/api/me', { method: 'PATCH', body: { first_name: name } })
      const firstName = profile?.first_name ?? name
      saved.current = firstName
      setMe((current) => (current ? { ...current, first_name: firstName } : current))
      // Only when untouched meanwhile: an edit or Esc during the save wins.
      if (cleanName(latest.current) === name) update(firstName)
      setError(null)
    } catch (err) {
      if (SIGNED_OUT_CODES.has(err?.code)) return
      attempt.current += 1
      setError({ apiError: err, attempt: attempt.current })
    } finally {
      inFlight.current = false
      if (pending.current) {
        pending.current = false
        save()
      }
    }
  }

  return (
    <div className={styles.nameField}>
      <label htmlFor={`${id}-name`} className={styles.srOnly}>
        {t('settings.account.firstName')}
      </label>
      <input
        id={`${id}-name`}
        className={`${styles.input} ${styles.nameInput}`}
        type="text"
        autoComplete="given-name"
        // Esc reverts an edit here instead of closing Settings (see the overlay's onEscapeKeyDown).
        data-saved={me.first_name ?? ''}
        value={value}
        onChange={(event) => update(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            save()
          } else if (event.key === 'Escape') {
            update(saved.current)
            setError(null)
            // During a save, the revert is saved after it (when the saved name then differs).
            if (inFlight.current) pending.current = true
          }
        }}
      />
      {error && <ErrorLine key={error.attempt}>{errorText(t, error.apiError)}</ErrorLine>}
    </div>
  )
}

// Language: English / Norsk, the same switch and save as the Account menu (FR-29). Native radio
// buttons, so the arrow keys move between the two segments.
function LanguageSection() {
  const { t, i18n } = useTranslation()
  const [saveError, setSaveError] = useState(null) // { apiError, attempt }
  const attempt = useRef(0)
  const chooseLanguage = useChooseLanguage((apiError) => {
    if (!apiError) return setSaveError(null)
    attempt.current += 1
    setSaveError({ apiError, attempt: attempt.current })
  })
  const active = i18n.resolvedLanguage
  const name = useId()
  return (
    <Section heading={t('settings.language.heading')} lead={t('settings.language.lead')}>
      <div role="radiogroup" aria-label={t('settings.language.heading')} className={styles.switch}>
        {LANGUAGES.map((lng) => (
          <label key={lng} className={styles.segment} data-checked={active === lng} lang={lng}>
            <input
              type="radio"
              className={styles.radio}
              name={name}
              value={lng}
              checked={active === lng}
              onChange={() => chooseLanguage(lng)}
            />
            {t(`language.name.${lng}`)}
          </label>
        ))}
      </div>
      {saveError && (
        <div className={styles.afterSwitch}>
          <ErrorLine key={saveError.attempt}>{errorText(t, saveError.apiError)}</ErrorLine>
        </div>
      )}
    </Section>
  )
}

// Your data: "Delete a project" lists the active and archived Projects, each with Delete, which opens
// the same Confirm dialog (delete project) as the Sidebar (FR-24); it shows once the Projects have loaded
// and there is one to delete. A deleted Project leaves the list and
// moves to Deleted projects. "Delete my account and all my files" opens the Confirm dialog (delete
// account) (FR-28, Story 7.4); after the deletion the student lands on Login.
function DataSection({ projects, deleteProject }) {
  const { t } = useTranslation()
  const [deleting, setDeleting] = useState(null) // { project, trigger }
  const [deletingAccount, setDeletingAccount] = useState(false)
  const deleteAccount = useDeleteAccount()
  const heading = useRef(null)
  const title = useRef(null)
  const id = useId()
  const listed = (projects ?? []).filter((p) => !p.deleted_at)
  return (
    <Section heading={t('settings.data.heading')} lead={t('settings.data.lead')} headingRef={heading}>
      {/* Hidden while the Projects load and when there are none to delete. */}
      {listed.length > 0 && (
        <h3 ref={title} tabIndex={-1} className={styles.rowTitle}>
          {t('settings.data.deleteProject')}
        </h3>
      )}
      {listed.length > 0 && (
        <ul className={styles.projectList} aria-label={t('settings.data.deleteProject')}>
          {listed.map((project) => (
            <li key={project.id} className={styles.projectRow}>
              <span id={`${id}-${project.id}`} className={styles.projectName}>
                {project.name ?? t('projects.placeholder')}
              </span>
              <button
                type="button"
                className={styles.ghostSmall}
                aria-describedby={`${id}-${project.id}`}
                onClick={(event) => setDeleting({ project, trigger: event.currentTarget })}
              >
                {t('settings.data.delete')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <DeleteProjectDialog
        project={deleting?.project ?? null}
        returnFocus={deleting?.trigger ?? null}
        onDelete={(project) => deleteProject(project.id)}
        onClose={() => setDeleting(null)}
        // The row left the list: focus its sub-section title, or the section heading when none are left.
        onFocusLost={() => (title.current ?? heading.current)?.focus()}
      />
      <div className={listed.length > 0 ? `${styles.row} ${styles.accountRow}` : styles.accountRow}>
        <h3 id={`${id}-account`} className={styles.rowTitle}>
          {t('settings.data.deleteAccount')}
        </h3>
        <button
          type="button"
          className={styles.ghostSmall}
          aria-describedby={`${id}-account`}
          onClick={() => setDeletingAccount(true)}
        >
          {t('settings.data.deleteAccountButton')}
        </button>
      </div>
      <DeleteAccountDialog open={deletingAccount} onDelete={deleteAccount} onClose={() => setDeletingAccount(false)} />
    </Section>
  )
}
