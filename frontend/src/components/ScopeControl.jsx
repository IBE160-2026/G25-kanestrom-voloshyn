import { DropdownMenu } from 'radix-ui'
import { useTranslation } from 'react-i18next'
import styles from './ScopeControl.module.css'

// Scope control (Story 4.4, FR-16; DESIGN.md › Scope control; EXPERIENCE.md › Scope control): a segmented
// "All materials" / "One file ▾" in the Chat bar, named "Answer from". "One file" opens a list of the
// Ready files (Radix DropdownMenu: keyboard use and focus return); once one is chosen, its segment shows
// the file's name. The selected segment is `primary-subtle`. `scope` is `{all_materials: true}` or
// `{material_id}`; `onChange(scope)` saves a new one. A scoped file that is no longer among the Ready
// `files` shows as "All materials", which is what the server then answers from. The menu trigger carries
// the menu's own semantics; its label (the chosen file's name) says what is selected. Disabled while
// read-only or an answer streams.
export default function ScopeControl({ scope, files, disabled, onChange }) {
  const { t } = useTranslation()
  const chosen = scope?.material_id ? (files.find((file) => file.id === scope.material_id) ?? null) : null
  const chosenId = chosen?.id ?? null
  const all = chosen === null

  return (
    <div role="group" aria-label={t('chat.answerFrom')} className={styles.segments}>
      <button
        type="button"
        className={`${styles.segment} ${all ? styles.on : ''}`}
        aria-pressed={all}
        disabled={disabled}
        onClick={() => !all && onChange({ all_materials: true })}
      >
        {t('chat.allMaterials')}
      </button>
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger
          className={`${styles.segment} ${all ? '' : styles.on}`}
          data-selected={!all}
          disabled={disabled || files.length === 0}
        >
          <span className={styles.name}>{chosen?.file_name ?? t('chat.oneFile')}</span>
          <span className={styles.caret} aria-hidden="true">
            {'▾'}
          </span>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className={styles.menu} align="start" sideOffset={6}>
            <DropdownMenu.RadioGroup
              value={chosenId ?? ''}
              onValueChange={(id) => id !== chosenId && onChange({ material_id: id })}
            >
              {files.map((file) => (
                <DropdownMenu.RadioItem key={file.id} value={file.id} className={styles.item}>
                  {file.file_name}
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}
