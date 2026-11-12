import styles from './ErrorLine.module.css'

// Error line (DESIGN.md › Sign-in and Settings): red text with a small red dot, above the buttons
// in the Auth panel. An alert, so assistive technology announces it (EXPERIENCE.md › Accessibility).
export default function ErrorLine({ children }) {
  return (
    <p role="alert" className={styles.line}>
      <span className={styles.dot} aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}
