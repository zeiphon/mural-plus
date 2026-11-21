import { useState } from 'react'
import { Card } from '../../components/Card'
import { Button } from '../../components/Button'
import { showAlert } from '../../components/AlertModal'
import { setTopDistance, errorMessage } from '../api'
import type { PlusState } from '../types'

interface Props {
  state: PlusState
  onDone: (state: PlusState) => void
}

export function DistanceScreen({ state, onDone }: Props) {
  const [distance, setDistance] = useState(state.ready.distance ? String(state.topDistance) : '')
  const [busy, setBusy] = useState(false)

  const value = parseInt(distance)
  const changed = value > 0 && value !== state.topDistance
  const redo = [
    changed && state.ready.position ? 'extend the belts to home' : null,
    changed && state.ready.drawing ? 'choose the drawing' : null,
  ].filter(Boolean)

  async function handleSet() {
    if (isNaN(value) || value <= 0) {
      await showAlert('Please enter a valid distance in millimeters')
      return
    }
    setBusy(true)
    try {
      onDone(await setTopDistance(value))
    } catch (err) {
      setBusy(false)
      await showAlert(`Failed to set distance: ${errorMessage(err)}`)
    }
  }

  return (
    <Card
      title="Distance Between Hangers"
      subtitle="Distance between the two nails on which you are hanging Mural, in millimeters"
    >
      <input
        type="number"
        value={distance}
        onChange={(e) => setDistance(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleSet()}
        placeholder="e.g. 1500"
        className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-cyan-500 placeholder:text-gray-600"
      />
      {redo.length > 0 && (
        <p className="text-sm text-yellow-400">Changing the distance means you'll need to {redo.join(' and ')} again.</p>
      )}
      <Button onClick={handleSet} disabled={busy || !distance}>
        {busy ? 'Setting…' : 'Set distance'}
      </Button>
    </Card>
  )
}
