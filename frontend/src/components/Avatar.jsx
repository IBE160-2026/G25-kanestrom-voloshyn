import styles from './Avatar.module.css'

/** The first letter of the first name, upper-cased; empty when there is no name. */
function initials(firstName) {
  const first = Array.from(typeof firstName === 'string' ? firstName.trim() : '')[0]
  return first ? first.toLocaleUpperCase() : ''
}

// Avatar (DESIGN.md › Avatar): a circle with the initials for email Accounts. The Google photo
// arrives with Story 1.6. Decorative: the name next to it, or the trigger's label, says who it is.
export default function Avatar({ firstName }) {
  return (
    <span className={styles.avatar} aria-hidden="true">
      {initials(firstName)}
    </span>
  )
}
