// Interface language (FR-29, AD-26). Every interface string lives in en.json / nb.json and is read
// through react-i18next. Before sign-in the language is: a saved choice, else the browser, else English.
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './en.json'
import nb from './nb.json'

export const LANGUAGES = ['en', 'nb']
export const STORAGE_KEY = 'studybuddy.language'
const FALLBACK = 'en'

function readSaved() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    return LANGUAGES.includes(saved) ? saved : null
  } catch {
    return null // storage blocked (private mode, policy): fall through to the browser
  }
}

function fromBrowser() {
  const nav = typeof navigator === 'undefined' ? null : navigator
  const list = nav?.languages?.length ? nav.languages : [nav?.language].filter(Boolean)
  for (const tag of list) {
    const base = String(tag).toLowerCase().split('-')[0]
    if (base === 'nb' || base === 'nn' || base === 'no') return 'nb'
    if (base === 'en') return 'en'
  }
  return null
}

/** Saved choice, then navigator.languages (nb/nn/no -> nb, en* -> en), then English. */
export function detectLanguage() {
  return readSaved() ?? fromBrowser() ?? FALLBACK
}

/** Switch the interface language and remember it; blocked storage only loses persistence. */
export function setLanguage(lng) {
  const next = LANGUAGES.includes(lng) ? lng : FALLBACK
  try {
    window.localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // storage blocked: the switch still holds for this session
  }
  return i18n.changeLanguage(next)
}

// <html lang> follows the active language (registered before init, so the first language counts too).
i18n.on('languageChanged', (lng) => {
  if (typeof document !== 'undefined') document.documentElement.lang = lng
})

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, nb: { translation: nb } },
  lng: detectLanguage(),
  fallbackLng: FALLBACK,
  supportedLngs: LANGUAGES,
  initAsync: false,
  interpolation: { escapeValue: false }, // React already escapes
})

export default i18n
