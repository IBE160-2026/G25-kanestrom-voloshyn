import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n/index.js' // initialise the language before the first render (AD-26)
import './styles/global.css'
import App from './App.jsx'
import { applyInitialTheme } from './theme/index.js'

// The theme and accent before the first paint: the cached Account choice on a signed-in page, the
// Default theme elsewhere (Settings › Appearance).
applyInitialTheme()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
