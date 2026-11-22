import { useEffect, useState } from 'react'
import { Card } from '../../components/Card'
import { Button } from '../../components/Button'
import { showAlert } from '../../components/AlertModal'
import { getPlusState, run, goHome, resetPen, errorMessage } from '../api'
import type { PlusState, SetupStep } from '../types'
import { DEFAULT_SPEED, useSpeed } from '../storage'

interface Props {
  state: PlusState
  onOpen: (step: SetupStep) => void
  onStarted: (state: PlusState) => void
  onStateChange: (state: PlusState) => void
  /** Opens the settings, where the speed is changed */
  onOpenSettings: () => void
}

/** The setup steps, which can be done in any order, and the start button. */
export function OverviewScreen({ state, onOpen, onStarted, onStateChange, onOpenSettings }: Props) {
  const [speed] = useSpeed()
  const [starting, setStarting] = useState(false)
  const busy = state.status !== 'idle'

  // While Mural is moving, keep refreshing until it stops.
  useEffect(() => {
    if (!busy) return
    const id = setInterval(() => {
      getPlusState().then(onStateChange).catch(() => {})
    }, 2000)
    return () => clearInterval(id)
  }, [busy, onStateChange])

  async function handleGoHome() {
    try {
      onStateChange(await goHome())
    } catch (err) {
      await showAlert(`Couldn't return home: ${errorMessage(err)}`)
    }
  }

  async function handleResetPen() {
    try {
      onStateChange(await resetPen())
    } catch (err) {
      await showAlert(`Couldn't reset the pen: ${errorMessage(err)}`)
    }
  }

  async function handleStart() {
    setStarting(true)
    try {
      onStarted(await run(speed))
    } catch (err) {
      setStarting(false)
      await showAlert(`Couldn't start drawing: ${errorMessage(err)}`)
    }
  }

  const steps: {
    id: SetupStep
    title: string
    done: boolean
    detail: string
    enabled: boolean
    reset?: { label: string; onClick: () => void }
  }[] = [
    {
      id: 'distance',
      title: 'Hanger distance',
      done: state.ready.distance,
      detail: state.ready.distance ? `${state.topDistance} mm between the nails` : 'Distance between the nails Mural hangs from',
      enabled: true,
    },
    {
      id: 'belts',
      title: 'Belts',
      done: state.ready.position,
      detail: state.position.homing
        ? 'Extending to home…'
        : state.ready.position
          ? 'Belt position known'
          : state.ready.distance
            ? 'Retract the belts, then extend them to home'
            : 'Set the hanger distance first',
      enabled: state.ready.distance,
    },
    {
      id: 'pen',
      title: 'Pen',
      done: state.ready.pen,
      detail: state.ready.pen
        ? `Calibrated: down ${state.pen.down}°, up ${state.pen.up}°`
        : 'Calibrate with Mural hanging at home',
      enabled: true,
      // The calibration is kept across restarts, but it no longer fits once the pen has been taken out.
      reset: state.ready.pen ? { label: 'Forget the pen calibration and lift the pen', onClick: handleResetPen } : undefined,
    },
    {
      id: 'drawing',
      title: 'Drawing',
      done: state.ready.drawing,
      detail: drawingDetail(state),
      enabled: state.ready.distance,
    },
  ]

  return (
    <Card title="Mural" subtitle="Do these steps in any order, and redo any of them at any time.">
      <div className="space-y-3">
        {steps.map((step, i) => (
          <div key={step.id} className="flex gap-2">
            <button
              onClick={() => onOpen(step.id)}
              disabled={!step.enabled || busy}
              className="flex-1 min-w-0 flex items-center gap-4 rounded-xl px-4 py-4 bg-gray-800 border border-gray-700 text-left transition-all enabled:hover:bg-gray-700 enabled:hover:border-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span
                className={`flex-none w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                  step.done ? 'bg-emerald-600 text-white' : 'bg-gray-700 text-gray-300'
                }`}
              >
                {step.done ? '✓' : i + 1}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-base font-semibold text-white">{step.title}</span>
                <span className="block text-sm text-gray-400">{step.detail}</span>
              </span>
              <span className="flex-none text-xl text-gray-500" aria-hidden>
                ›
              </span>
            </button>
            {step.reset && (
              <button
                onClick={step.reset.onClick}
                disabled={busy || starting}
                title={step.reset.label}
                aria-label={step.reset.label}
                className="flex-none rounded-xl px-3 bg-gray-800 border border-gray-700 text-sm text-gray-300 transition-all enabled:hover:bg-gray-700 enabled:hover:border-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Reset
              </button>
            )}
          </div>
        ))}
      </div>

      {busy && (
        <div className="flex items-center justify-center gap-3 text-sm text-gray-400">
          <div className="w-4 h-4 border-2 border-gray-700 border-t-cyan-500 rounded-full animate-spin" />
          {state.status === 'homing' ? 'Extending to home…' : state.status === 'starting' ? 'Starting…' : 'Moving…'}
        </div>
      )}

      {!busy && state.ready.position && !state.position.atHome && (
        <div className="flex items-center gap-3">
          <p className="flex-1 text-sm text-gray-400">Mural isn't at its home position.</p>
          <Button variant="secondary" fullWidth={false} onClick={handleGoHome}>
            Return home
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-gray-400">
          Speed <span className="font-mono text-gray-200">{speed} steps/s</span>
          {speed !== DEFAULT_SPEED && <span className="text-yellow-400"> (experimental)</span>}
        </span>
        <button onClick={onOpenSettings} className="text-cyan-400 hover:text-cyan-300 transition-colors">
          Change in ⚙
        </button>
      </div>
      <Button onClick={handleStart} disabled={!state.ready.all || busy || starting}>
        {starting ? 'Starting…' : 'Start drawing'}
      </Button>
      {!state.ready.all && <p className="text-center text-xs text-gray-500">Finish the steps above to start drawing.</p>}
    </Card>
  )
}

function drawingDetail(state: PlusState): string {
  const file = state.drawingFile
  if (file.compatible) return 'Ready to draw'
  if (!state.ready.distance) return 'Set the hanger distance first'
  if (file.exists && file.topDistance > 0) return `Made for a ${file.topDistance} mm hanger distance, choose it again`
  return 'Choose an SVG or an image'
}
