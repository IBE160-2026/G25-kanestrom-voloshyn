import { useState } from 'react'
import styles from './Avatar.module.css'

/** The first letter of the first name, upper-cased; empty when there is no name. */
function initials(firstName) {
  const first = Array.from(typeof firstName === 'string' ? firstName.trim() : '')[0]
  return first ? first.toLocaleUpperCase() : ''
}

// Avatar (DESIGN.md › Avatar): the Google profile photo when there is one (FR-19), otherwise a
// circle with the initials, also when the photo fails to load. Decorative: the name next to it, or
// the trigger's label, says who it is, so the image has an empty alt.
export default function Avatar({ firstName, pictureUrl = null }) {
  // The URL whose image failed; a new URL is tried again.
  const [failed, setFailed] = useState(null)
  const picture = typeof pictureUrl === 'string' && pictureUrl && failed !== pictureUrl ? pictureUrl : null
  return (
    <span className={styles.avatar} aria-hidden="true">
      {picture ? (
        <img
          className={styles.picture}
          src={picture}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(picture)}
        />
      ) : (
        initials(firstName)
      )}
    </span>
  )
}
