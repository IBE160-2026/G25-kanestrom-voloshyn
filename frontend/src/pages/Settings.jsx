import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOutletContext } from 'react-router'
import { SIGNED_OUT_CODES, apiFetch } from '../api/client.js'
import Avatar from '../components/Avatar.jsx'
import DeleteProjectDialog from '../components/DeleteProjectDialog.jsx'
import ErrorLine from '../components/ErrorLine.jsx'
import { useChooseLanguage, useLogOut } from '../components/accountActions.js'
import { errorText } from '../i18n/errors.js'
import { LANGUAGES } from '../i18n/index.js'
import ChangePassword from './ChangePassword.jsx'
import styles from './Settings.module.css'

const NAME_MAX_LENGTH = 100 // the server cuts there too

/** Trimmed and cut to 100 code points, so a surrogate pair is never split (as the server cuts). */
function cleanName(raw) {
  return Array.from(raw.trim()).slice(0, NAME_MAX_LENGTH).join('').trim()
}

// Settings (FR-27, FR-29, Story 7.3a; DESIGN.md › Settings section; EXPERIENCE.md › IA › Settings): one
// page inside the app shell, reached from the Account menu, with three stacked section cards: Account
// (with Change password), Language, and Your data. The profile and the Projects come from the shell;
// a failed profile load shows the shell's error line, and the Account card waits for the profile.
export default function Settings() {
  const { me, setMe, projects, deleteProject } = useOutletContext()
  return (
    <div className={styles.page}>
      {me && <AccountSection me={me} setMe={setMe} />}
      <LanguageSection />
      <DataSection projects={projects} deleteProject={deleteProject} />
    </div>
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
// with an email identity.
function AccountSection({ me, setMe }) {
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
          {/* One line per sign-in method: an Account with both shows both. */}
          {methods.includes('email') && <p className={styles.via}>{t('settings.account.viaEmail')}</p>}
          {google && <p className={styles.via}>{t('settings.account.viaGoogle')}</p>}
        </div>
        <button type="button" className={styles.ghost} onClick={logOut}>
          {t('settings.account.logOut')}
        </button>
      </div>
      {methods.includes('email') && <ChangePassword />}
    </Section>
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
// moves to Deleted projects. "Delete my account and all my files" comes with Story 7.4.
function DataSection({ projects, deleteProject }) {
  const { t } = useTranslation()
  const [deleting, setDeleting] = useState(null) // { project, trigger }
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
    </Section>
  )
}
