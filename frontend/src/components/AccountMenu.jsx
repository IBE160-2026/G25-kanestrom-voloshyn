import { DropdownMenu } from 'radix-ui'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { LANGUAGES } from '../i18n/index.js'
import { useChooseLanguage, useLogOut } from './accountActions.js'
import Avatar from './Avatar.jsx'
import styles from './AccountMenu.module.css'

// Account menu (DESIGN.md › Account menu, EXPERIENCE.md › Component Patterns): top right on every
// signed-in page. Radix DropdownMenu gives keyboard use and focus return (AD-28). It holds Settings
// (Story 7.3a), the Language switch (saved to the Account, FR-29), and an immediate Log out (FR-2),
// in that order (EXPERIENCE.md › Account menu). `me` may be null when the profile didn't load: no name, empty avatar.
// `onSaveError(error | null)` reports the latest language save, shown outside the menu.
export default function AccountMenu({ me, onSaveError }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const firstName = me?.first_name ?? ''
  const active = i18n.resolvedLanguage
  // The interface switches at once; a failed save keeps the switch and says so.
  const chooseLanguage = useChooseLanguage(onSaveError)
  const logOut = useLogOut()

  return (
    // Not modal: a modal menu hides the rest of the page from assistive technology, which would
    // silence the save-failure alert in the top bar while the menu is open.
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger className={styles.trigger} aria-label={firstName ? undefined : t('account.menu')}>
        <Avatar firstName={firstName} pictureUrl={me?.picture_url} />
        {firstName && <span className={styles.welcome}>{t('account.welcome', { firstName })}</span>}
        <svg className={styles.chevron} viewBox="0 0 10 6" aria-hidden="true" focusable="false">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={styles.menu} align="end" sideOffset={8}>
          <DropdownMenu.Item className={styles.item} onSelect={() => navigate('/settings')}>
            {t('account.settings')}
          </DropdownMenu.Item>
          <div className={styles.languageRow}>
            <DropdownMenu.Label className={styles.label}>{t('account.language')}</DropdownMenu.Label>
            <DropdownMenu.RadioGroup
              className={styles.switch}
              aria-label={t('account.language')}
              value={active}
              onValueChange={chooseLanguage}
            >
              {LANGUAGES.map((lng) => (
                <DropdownMenu.RadioItem
                  key={lng}
                  value={lng}
                  lang={lng}
                  className={styles.segment}
                  // Keep the menu open, so the switch is seen to take effect.
                  onSelect={(event) => event.preventDefault()}
                >
                  {t(`language.name.${lng}`)}
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </div>
          <DropdownMenu.Separator className={styles.divider} />
          <DropdownMenu.Item className={`${styles.item} ${styles.logOut}`} onSelect={logOut}>
            {t('account.logOut')}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
