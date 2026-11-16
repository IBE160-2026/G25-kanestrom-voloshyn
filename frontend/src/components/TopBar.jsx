import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorText } from '../i18n/errors.js'
import AccountMenu from './AccountMenu.jsx'
import ErrorLine from './ErrorLine.jsx'
import styles from './TopBar.module.css'

// Top bar of the signed-in pages (DESIGN.md › Top bar): the `title` slot left (the Project name with
// its inline rename, Story 2.1), the Account menu right, hairline below. The menu shows once the profile request has settled,
// even if it failed (then without a name), so Language and Log out are always reachable.
// A failed language save shows here, outside the menu, so it survives the menu closing.
export default function TopBar({ me, ready, title = null }) {
  const { t } = useTranslation()
  const [saveError, setSaveError] = useState(null) // { apiError, attempt }
  const attempt = useRef(0)

  function onSaveError(apiError) {
    if (!apiError) return setSaveError(null)
    attempt.current += 1
    setSaveError({ apiError, attempt: attempt.current })
  }

  return (
    <header className={styles.bar}>
      <div className={styles.title}>{title}</div>
      {saveError && (
        <div className={styles.alert}>
          <ErrorLine key={saveError.attempt}>{errorText(t, saveError.apiError)}</ErrorLine>
        </div>
      )}
      {ready && <AccountMenu me={me} onSaveError={onSaveError} />}
    </header>
  )
}
