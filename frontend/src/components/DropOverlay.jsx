import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import styles from './DropOverlay.module.css'

// The full-screen drop overlay (Cristoffer, 2026-11-20): while files are dragged over the window, the
// page is dimmed and blurred behind a highlighted frame, with "Drop files here" and the accepted types
// in the middle. A drop anywhere uploads to the open Project. `handlers` come from useWindowFileDrop.
export default function DropOverlay({ handlers }) {
  const { t } = useTranslation()
  return createPortal(
    <div className={styles.overlay} data-testid="drop-overlay" {...handlers}>
      <div className={styles.frame} />
      <div className={styles.center}>
        <svg className={styles.icon} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
          <path
            d="M14 6h14l10 10v24a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path d="M28 6v10h10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <path d="M25 36V22M19 28l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className={styles.heading}>{t('files.dropOverlay')}</p>
        <p className={styles.types}>{t('files.types')}</p>
      </div>
    </div>,
    document.body,
  )
}
