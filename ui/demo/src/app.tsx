import { standalone } from './installShim'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import Root from '../../src/plus/Root'

// The real Mural UI, the same as ui/src/main.tsx, talking to the simulated
// device through the shim.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)

// Opened on its own (on a phone, or by direct link): say it's a demo, and
// where the device panel is.
if (standalone) {
  const badge = document.createElement('a')
  badge.href = './'
  badge.target = '_top'
  badge.textContent = 'Demo · show the device'
  badge.className =
    'fixed bottom-3 left-3 z-40 rounded-full bg-cyan-900/80 px-3 py-1 text-xs text-cyan-100 hover:bg-cyan-800 transition-colors'
  document.body.appendChild(badge)
}
