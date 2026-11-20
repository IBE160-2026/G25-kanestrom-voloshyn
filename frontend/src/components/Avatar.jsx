import { useState } from 'react'
import styles from './Avatar.module.css'

/** The first letter of the first name, upper-cased; empty when there is no name. */
function initials(firstName) {
  const first = Array.from(typeof firstName === 'string' ? firstName.trim() : '')[0]
  return first ? first.toLocaleUpperCase() : ''
}

// Avatar (DESIGN.md › Avatar): the Google profile photo for an Account with Google linked
// (`pictureUrl` from /api/me, linked and never stored, FR-27), otherwise the initials. A photo that
// fails to load falls back to the initials. Decorative: the name next to it, or the trigger's
// label, says who it is. `size`: 'sm' in the Account menu, 'lg' in Settings (avatar.size-settings).
export default function Avatar({ firstName, pictureUrl = null, size = 'sm' }) {
  const [failedUrl, setFailedUrl] = useState(null)
  const photo = typeof pictureUrl === 'string' && pictureUrl && pictureUrl !== failedUrl ? pictureUrl : null
  return (
    <span className={size === 'lg' ? `${styles.avatar} ${styles.large}` : styles.avatar} aria-hidden="true">
      {photo ? (
        <img
          className={styles.photo}
          src={photo}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(photo)}
        />
      ) : (
        initials(firstName)
      )}
    </span>
  )
}
