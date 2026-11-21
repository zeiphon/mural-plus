import { useEffect, useState } from 'react'
import App from '../App'
import { LoadingScreen } from '../screens/LoadingScreen'
import { showAlert } from '../components/AlertModal'
import { getMode, setMode, reloadWhenBack, errorMessage, type Mode } from './api'
import { PlusApp } from './PlusApp'
import { Page } from './Page'

/** Runs the plus UI or upstream's classic UI, depending on the firmware's mode. */
export default function Root() {
  const [mode, setModeState] = useState<Mode | 'unknown' | 'loading'>('loading')

  useEffect(() => {
    getMode().then((m) => setModeState(m ?? 'unknown'))
  }, [])

  if (mode === 'loading') {
    return (
      <Page>
        <LoadingScreen />
      </Page>
    )
  }
  if (mode === 'plus') {
    return <PlusApp />
  }
  // Classic mode, or no plus firmware (including the dev server's mock mode)
  return (
    <>
      <App />
      {mode === 'classic' && <SwitchToPlus />}
    </>
  )
}

function SwitchToPlus() {
  const [switching, setSwitching] = useState(false)

  async function handleClick() {
    if (!confirm('Switch to Mural Plus? Mural will restart.')) return
    setSwitching(true)
    try {
      await setMode('plus')
      await reloadWhenBack()
    } catch (err) {
      setSwitching(false)
      await showAlert(`Couldn't switch: ${errorMessage(err)}`)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={switching}
      className="fixed bottom-3 right-3 text-xs sm:text-sm text-gray-600 hover:text-gray-400 transition-colors"
    >
      {switching ? 'Restarting…' : 'Switch to Mural Plus'}
    </button>
  )
}
