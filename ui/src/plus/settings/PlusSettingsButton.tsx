import { useEffect, useState } from 'react'
import { Button } from '../../components/Button'
import { getMode } from '../api'
import { PlusSettingsModal } from './PlusSettingsModal'

/**
 * The entry point to plus's settings inside upstream's Tools modal
 * (ui/src/components/ToolsModal.tsx). Renders nothing in classic mode.
 */
export function PlusSettingsButton() {
  const [isPlus, setIsPlus] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    getMode().then((m) => setIsPlus(m === 'plus'))
  }, [])

  if (!isPlus) return null

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Pen and drawing settings
      </Button>
      <PlusSettingsModal isOpen={open} onClose={() => setOpen(false)} />
    </>
  )
}
