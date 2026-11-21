import { useEffect, useState } from 'react'
import { Card } from '../../components/Card'
import { getPlusState, delay } from '../api'
import type { PlusState } from '../types'

interface Props {
  /** Called when the drawing is no longer running, with a message to show if there is one. */
  onFinished: (state: PlusState, message?: string) => void
}

// Until the plus runner arrives (M2), Mural restarts when a drawing ends, so
// losing contact and then finding it idle means the drawing finished.
export function DrawingScreen({ onFinished }: Props) {
  const [lost, setLost] = useState(false)

  useEffect(() => {
    let cancelled = false
    let wasLost = false
    async function poll() {
      while (!cancelled) {
        await delay(3000)
        try {
          const s = await getPlusState()
          if (cancelled) return
          setLost(false)
          if (!s.drawingActive) {
            const message = s.lastError
              ? `The drawing couldn't start: ${s.lastError}`
              : wasLost
                ? 'The drawing has finished. Mural restarts after a drawing, so set it up again before the next one.'
                : undefined
            onFinished(s, message)
            return
          }
        } catch {
          wasLost = true
          if (!cancelled) setLost(true)
        }
      }
    }
    poll()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Card title="Drawing">
      <div className="flex flex-col items-center gap-4 py-4">
        <div className="w-10 h-10 border-4 border-gray-700 border-t-cyan-500 rounded-full animate-spin" />
        <p className="text-center text-sm text-gray-400 leading-relaxed">
          {lost
            ? "Can't reach Mural. It restarts when a drawing finishes, so this is expected at the end. Waiting for it to come back…"
            : 'Mural is drawing. This page updates when the drawing finishes.'}
        </p>
      </div>
    </Card>
  )
}
