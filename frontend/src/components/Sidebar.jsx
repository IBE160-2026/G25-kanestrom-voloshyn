import { DropdownMenu } from 'radix-ui'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import ProjectName from './ProjectName.jsx'
import styles from './Sidebar.module.css'

// Sidebar and Sidebar strip (DESIGN.md › Sidebar, Sidebar strip; EXPERIENCE.md › Sidebar). Lists the
// active Projects newest first, each opening its home; "+ New project" creates one (FR-4). Each row
// has a "···" menu with Rename (inline, Enter saves, Esc cancels; FR-5); Archive and Delete arrive
// with Epic 7. "Hide projects" collapses it to the strip with "Show projects" and a "New project"
// icon button. The collapse state is the AppShell's.
export default function Sidebar({ projects, currentId, collapsed, onToggle, onCreate, creating, onRenamed }) {
  const { t } = useTranslation()
  const [renamingId, setRenamingId] = useState(null)
  // Set when the menu closes for Rename, so the menu doesn't take focus back from the field.
  const renameChosen = useRef(false)
  // The row whose rename just closed: its "···" trigger takes focus back once it renders.
  const refocusId = useRef(null)

  if (collapsed) {
    return (
      <aside className={styles.strip}>
        <button
          type="button"
          className={styles.stripButton}
          aria-label={t('projects.show')}
          aria-expanded="false"
          onClick={onToggle}
        >
          <Chevron direction="right" />
          <span className={styles.tip} aria-hidden="true">
            {t('projects.show')}
          </span>
        </button>
        <button
          type="button"
          className={`${styles.stripButton} ${styles.stripNew}`}
          aria-label={t('projects.newShort')}
          aria-busy={creating}
          onClick={onCreate}
        >
          <Plus />
          <span className={styles.tip} aria-hidden="true">
            {t('projects.newShort')}
          </span>
        </button>
      </aside>
    )
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.top}>
        <span className={styles.wordmark}>{t('login.wordmark')}</span>
        <button
          type="button"
          className={styles.collapse}
          aria-label={t('projects.hide')}
          aria-expanded="true"
          onClick={onToggle}
        >
          <Chevron direction="left" />
        </button>
      </div>
      <nav className={styles.nav}>
        <ul className={styles.list}>
          {projects.map((project) => {
            const open = project.id === currentId
            const name = project.name ?? t('projects.placeholder')
            return (
              <li key={project.id} className={`${styles.item} ${open ? styles.open : ''}`}>
                {renamingId === project.id ? (
                  <ProjectName
                    project={project}
                    variant="sidebar"
                    editing
                    onEditingChange={(next) => {
                      if (next) return
                      refocusId.current = project.id
                      setRenamingId(null)
                    }}
                    onRenamed={onRenamed}
                  />
                ) : (
                  <>
                    <Link
                      to={`/projects/${project.id}`}
                      className={styles.link}
                      aria-current={open ? 'page' : undefined}
                    >
                      {name}
                    </Link>
                    <DropdownMenu.Root modal={false}>
                      <DropdownMenu.Trigger
                        ref={(element) => {
                          if (element && refocusId.current === project.id) {
                            refocusId.current = null
                            element.focus()
                          }
                        }}
                        className={styles.more}
                        aria-label={t('projects.more', { name })}
                      >
                        <Dots />
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content
                          className={styles.menu}
                          align="start"
                          sideOffset={4}
                          onCloseAutoFocus={(event) => {
                            if (renameChosen.current) event.preventDefault()
                            renameChosen.current = false
                          }}
                        >
                          <DropdownMenu.Item
                            className={styles.menuItem}
                            onSelect={() => {
                              renameChosen.current = true
                              setRenamingId(project.id)
                            }}
                          >
                            {t('projects.rename')}
                          </DropdownMenu.Item>
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      </nav>
      <div className={styles.bottom}>
        <button type="button" className={styles.newProject} aria-busy={creating} onClick={onCreate}>
          {t('projects.new')}
        </button>
        <p className={styles.credit}>{t('footer.credit')}</p>
      </div>
    </aside>
  )
}

function Chevron({ direction }) {
  const d = direction === 'left' ? 'M6 1L2 5l4 4' : 'M2 1l4 4-4 4'
  return (
    <svg className={styles.icon} viewBox="0 0 8 10" aria-hidden="true" focusable="false">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function Plus() {
  return (
    <svg className={styles.icon} viewBox="0 0 10 10" aria-hidden="true" focusable="false">
      <path d="M5 1v8M1 5h8" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function Dots() {
  return (
    <svg className={styles.icon} viewBox="0 0 14 4" aria-hidden="true" focusable="false">
      <circle cx="2" cy="2" r="1.3" fill="currentColor" />
      <circle cx="7" cy="2" r="1.3" fill="currentColor" />
      <circle cx="12" cy="2" r="1.3" fill="currentColor" />
    </svg>
  )
}
