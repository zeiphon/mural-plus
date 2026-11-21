import { useEffect, useState } from 'react'
import { Card } from '../../components/Card'
import { Button } from '../../components/Button'
import { ProgressBar } from '../../components/ProgressBar'
import { showAlert } from '../../components/AlertModal'
import { getPlusState, pauseDrawing, resumeDrawing, stopDrawing, delay, errorMessage } from '../api'
import type { DrawingState, PlusState } from '../types'

interface Props {
  initialState: PlusState
  /** Called when the drawing is no longer running, with a message to show if there is one. */
  onFinished: (state: PlusState, message?: string) => void
}

const LABELS: Record<DrawingState, string> = {
  idle: 'Finished',
  starting: 'Starting…',
  drawing: 'Drawing',
  pausing: 'Pausing…',
  paused: 'Paused',
  resuming: 'Resuming…',
  stopping: 'Stopping…',
}

export function DrawingScreen({ initialState, onFinished }: Props) {
  const [state, setState] = useState(initialState)
  const [lost, setLost] = useState(false)
  const [acting, setActing] = useState(false)

  useEffect(() => {
    let cancelled = false
    let wasLost = false
    async function poll() {
      while (!cancelled) {
        await delay(2000)
        try {
          const s = await getPlusState()
          if (cancelled) return
          setLost(false)
          if (!s.drawingActive) {
            onFinished(s, finishMessage(s, wasLost))
            return
          }
          setState(s)
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

  async function act(action: () => Promise<PlusState>, name: string) {
    setActing(true)
    try {
      setState(await action())
    } catch (err) {
      await showAlert(`${name} failed: ${errorMessage(err)}`)
    }
    setActing(false)
  }

  function handleStop() {
    if (!confirm("Stop the drawing? It can't be resumed afterwards.")) return
    act(stopDrawing, 'Stop')
  }

  const d = state.drawing
  const transitional = d.state === 'starting' || d.state === 'pausing' || d.state === 'resuming' || d.state === 'stopping'
  let stats = `${formatMm(d.distanceDone)} of ${formatMm(d.totalDistance)} · ${formatDuration(d.elapsedMs)}`
  if (d.distanceDone > 0 && d.totalDistance > d.distanceDone && d.elapsedMs > 30000) {
    const remainingMs = (d.elapsedMs * (d.totalDistance - d.distanceDone)) / d.distanceDone
    stats += ` · about ${formatDuration(remainingMs)} left`
  }

  return (
    <Card title="Drawing">
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <span
            className={`text-sm font-medium ${
              d.state === 'paused' || d.state === 'pausing' ? 'text-yellow-400' : d.state === 'stopping' ? 'text-red-400' : 'text-cyan-400'
            }`}
          >
            {LABELS[d.state]}
            {d.state === 'paused' && ', pen lifted'}
          </span>
          <span className="text-2xl font-semibold text-white">{d.progress}%</span>
        </div>
        <ProgressBar value={d.progress} animated={d.state === 'drawing'} />
        <p className="text-sm text-gray-400">{stats}</p>
        {lost && <p className="text-sm text-yellow-400">Can't reach Mural, retrying… (it may have restarted)</p>}
      </div>

      <div className="flex gap-3">
        {d.state === 'paused' || d.state === 'resuming' ? (
          <Button onClick={() => act(resumeDrawing, 'Resume')} disabled={acting || transitional}>
            Resume
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => act(pauseDrawing, 'Pause')} disabled={acting || transitional}>
            Pause
          </Button>
        )}
        <Button variant="danger" onClick={handleStop} disabled={acting || d.state === 'stopping' || d.state === 'starting'}>
          Stop
        </Button>
      </div>
      <p className="text-xs text-gray-500">
        Pausing lifts the pen after the current short move. Resuming puts it back down and carries on from the same
        spot.
      </p>
    </Card>
  )
}

function finishMessage(s: PlusState, wasLost: boolean): string | undefined {
  const d = s.drawing
  if (d.startError) return `The drawing couldn't start: ${d.startError}`
  switch (d.lastOutcome) {
    case 'finished':
      return `Drawing finished in ${formatDuration(d.elapsedMs)}.`
    case 'stopped':
      return `Drawing stopped at ${d.progress}%.`
    case 'failed':
      return `The drawing stopped because of an error: ${d.error}`
    default:
      return wasLost
        ? 'Mural restarted during the drawing, so the drawing was lost. If this happens again, check the power supply.'
        : undefined
  }
}

function formatMm(mm: number): string {
  return mm >= 1000 ? `${(mm / 1000).toFixed(1)} m` : `${Math.round(mm)} mm`
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}
