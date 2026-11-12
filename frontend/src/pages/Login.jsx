import styles from './Login.module.css'

// Placeholder Login screen (Story 1.1), composed per mockups/key-login.html: one centred column
// on the app background. Only the product wordmark is shown; the form and copy come with Stories 1.2-1.4.
export default function Login() {
  return (
    <main className={styles.page}>
      <h1 className={styles.wordmark}>Study Buddy</h1>
    </main>
  )
}
