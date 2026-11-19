import { DropdownMenu, Tooltip } from 'radix-ui'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { daysLeft } from './daysLeft.js'
import DeleteProjectDialog from './DeleteProjectDialog.jsx'
import { initials } from './initials.js'
import ProjectName from './ProjectName.jsx'
import styles from './Sidebar.module.css'

// Sidebar and Sidebar strip (DESIGN.md › Sidebar, Sidebar strip; EXPERIENCE.md › Sidebar). Lists the
// active Projects newest first, each opening its home; "+ New project" creates one (FR-4). Each row
// has a "···" menu with Rename (inline, Enter saves, Esc cancels; FR-5) and Archive (immediate, no
// confirmation; FR-23, Story 7.1). Below the list, "Archived ({n})" lists the archived Projects,
// collapsed by default (not saved) and absent at 0; each opens read-only, and its "···" menu has
// Restore. Active and archived rows' menus also have "Delete project", which opens the Confirm
// dialog (delete project) (FR-24, Story 7.2a). Below "Archived", "Deleted projects ({n})" lists the
// deleted Projects the same way, each muted with "Deleted · {n} days left"; its menu has Restore only
// (Delete forever is Story 7.2b). "Hide projects" collapses it to the strip with "Show projects" and a
// "New project" icon button; the strip shows active Projects only. The collapse state is the AppShell's.
export default function Sidebar({
  projects,
  archivedProjects = [],
  deletedProjects = [],
  currentId,
  collapsed,
  onToggle,
  onCreate,
  creating,
  onRenamed,
  onArchive,
  onRestore,
  onDelete,
  focusProjectId = null,
  onFocused,
}) {
  const { t } = useTranslation()
  const [renamingId, setRenamingId] = useState(null)
  const [archivedOpen, setArchivedOpen] = useState(false)
  // The group disappears with its last row; it comes back collapsed.
  if (archivedOpen && archivedProjects.length === 0) setArchivedOpen(false)
  const [deletedOpen, setDeletedOpen] = useState(false)
  if (deletedOpen && deletedProjects.length === 0) setDeletedOpen(false)
  // The delete dialog's { project, trigger }: the "···" trigger focus goes back to on Cancel.
  const [deleting, setDeleting] = useState(null)
  const triggers = useRef({})
  const list = useRef(null)
  const newProject = useRef(null)

  // After a restore (Undo, the archived row's menu, or the banner) the control used unmounts: focus
  // moves to the restored Project's link in the active list. Collapsed, focus is left alone.
  useEffect(() => {
    if (!focusProjectId) return
    if (!collapsed) {
      const link = [...(list.current?.querySelectorAll('a') ?? [])].find(
        (a) => a.getAttribute('href') === `/projects/${focusProjectId}`,
      )
      if (!link) return
      link.focus()
    }
    onFocused?.()
  }, [focusProjectId, collapsed, onFocused, projects])
  // Set when the menu closes for Rename, so the menu doesn't take focus back from the field.
  const renameChosen = useRef(false)
  // The row whose rename just closed: its "···" trigger takes focus back once it renders.
  const refocusId = useRef(null)

  // The archived row leaves the list, taking the focused "···" trigger with it: focus goes back to
  // the Projects list (mock key-delete-project.html), or to "+ New project" when no Project is left.
  async function archive(id) {
    await onArchive?.(id)
    const focused = document.activeElement
    if (!focused || focused === document.body) focusList()
  }

  function focusList() {
    const target = list.current?.querySelector('a') ?? newProject.current
    target?.focus()
  }

  // Keeps each row's "···" trigger, so the delete dialog can give focus back to it.
  const keepTrigger = (id) => (element) => {
    if (element) triggers.current[id] = element
    else delete triggers.current[id]
  }

  const deleteItem = (project) => (
    <DropdownMenu.Item
      className={styles.menuItem}
      onSelect={() => setDeleting({ project, trigger: triggers.current[project.id] ?? null })}
    >
      {t('projects.delete')}
    </DropdownMenu.Item>
  )

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
          onClick={() => onCreate({ revealSidebar: true })}
        >
          <Plus />
          <span className={styles.tip} aria-hidden="true">
            {t('projects.newShort')}
          </span>
        </button>
        {/* The active Projects as initials squares, newest first; each opens its home. The full
            name is the link's accessible name and shows in a tooltip (Cristoffer, 2026-11-17). */}
        <nav className={styles.stripNav}>
          <Tooltip.Provider delayDuration={200}>
            <ul className={styles.stripList}>
              {projects.map((project) => {
                const open = project.id === currentId
                const name = project.name ?? t('projects.placeholder')
                return (
                  <li key={project.id}>
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <Link
                          to={`/projects/${project.id}`}
                          className={`${styles.monogram} ${open ? styles.monogramOpen : ''}`}
                          aria-label={name}
                          aria-current={open ? 'page' : undefined}
                        >
                          <span aria-hidden="true">{initials(name)}</span>
                        </Link>
                      </Tooltip.Trigger>
                      <Tooltip.Portal>
                        <Tooltip.Content side="right" sideOffset={8} className={styles.tipPanel}>
                          {name}
                        </Tooltip.Content>
                      </Tooltip.Portal>
                    </Tooltip.Root>
                  </li>
                )
              })}
            </ul>
          </Tooltip.Provider>
        </nav>
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
        <ul ref={list} className={styles.list}>
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
                          keepTrigger(project.id)(element)
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
                          <DropdownMenu.Item className={styles.menuItem} onSelect={() => archive(project.id)}>
                            {t('projects.archive')}
                          </DropdownMenu.Item>
                          {deleteItem(project)}
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
        {archivedProjects.length > 0 && (
          <div className={styles.group}>
            <button
              type="button"
              className={styles.groupToggle}
              aria-expanded={archivedOpen}
              onClick={() => setArchivedOpen((open) => !open)}
            >
              <Chevron direction={archivedOpen ? 'down' : 'right'} />
              {t('projects.archivedGroup', { count: archivedProjects.length })}
            </button>
            {archivedOpen && (
              <ul className={`${styles.list} ${styles.groupList}`} data-testid="archived-projects">
                {archivedProjects.map((project) => {
                  const open = project.id === currentId
                  const name = project.name ?? t('projects.placeholder')
                  return (
                    <li key={project.id} className={`${styles.item} ${styles.archived} ${open ? styles.open : ''}`}>
                      <Link
                        to={`/projects/${project.id}`}
                        className={styles.link}
                        aria-current={open ? 'page' : undefined}
                      >
                        {name}
                      </Link>
                      <DropdownMenu.Root modal={false}>
                        <DropdownMenu.Trigger
                          ref={keepTrigger(project.id)}
                          className={styles.more}
                          aria-label={t('projects.more', { name })}
                        >
                          <Dots />
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content className={styles.menu} align="start" sideOffset={4}>
                            <DropdownMenu.Item className={styles.menuItem} onSelect={() => onRestore?.(project.id)}>
                              {t('projects.restore')}
                            </DropdownMenu.Item>
                            {deleteItem(project)}
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Root>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
        {deletedProjects.length > 0 && (
          <div className={styles.group}>
            <button
              type="button"
              className={styles.groupToggle}
              aria-expanded={deletedOpen}
              onClick={() => setDeletedOpen((open) => !open)}
            >
              <Chevron direction={deletedOpen ? 'down' : 'right'} />
              {t('projects.deletedGroup', { count: deletedProjects.length })}
            </button>
            {deletedOpen && (
              <ul className={`${styles.list} ${styles.groupList}`} data-testid="deleted-projects">
                {deletedProjects.map((project) => {
                  const open = project.id === currentId
                  const name = project.name ?? t('projects.placeholder')
                  return (
                    <li key={project.id} className={`${styles.item} ${styles.archived} ${open ? styles.open : ''}`}>
                      <Link
                        to={`/projects/${project.id}`}
                        className={`${styles.link} ${styles.deletedLink}`}
                        aria-current={open ? 'page' : undefined}
                      >
                        <span className={styles.deletedName}>{name}</span>
                        <span className={styles.daysLeft}>{t('projects.daysLeft', { count: daysLeft(project) })}</span>
                      </Link>
                      <DropdownMenu.Root modal={false}>
                        <DropdownMenu.Trigger className={styles.more} aria-label={t('projects.more', { name })}>
                          <Dots />
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content className={styles.menu} align="start" sideOffset={4}>
                            <DropdownMenu.Item className={styles.menuItem} onSelect={() => onRestore?.(project.id)}>
                              {t('projects.restore')}
                            </DropdownMenu.Item>
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Root>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
        <button ref={newProject} type="button" className={styles.newProject} aria-busy={creating} onClick={onCreate}>
          {t('projects.new')}
        </button>
        <p className={styles.credit}>{t('footer.credit')}</p>
      </div>
      <DeleteProjectDialog
        project={deleting?.project ?? null}
        returnFocus={deleting?.trigger ?? null}
        onDelete={(project) => onDelete(project.id)}
        onClose={() => setDeleting(null)}
        onFocusLost={focusList}
      />
    </aside>
  )
}

function Chevron({ direction }) {
  if (direction === 'down') {
    return (
      <svg className={styles.icon} viewBox="0 0 10 8" aria-hidden="true" focusable="false">
        <path d="M1 2l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    )
  }
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
