import { useEffect, useState } from 'react'
import { Card } from '../../components/Card'
import { Button } from '../../components/Button'
import { Slider } from '../../components/Slider'
import { showAlert } from '../../components/AlertModal'
import { getPlusState, run, goHome, errorMessage } from '../api'
import type { PlusState, SetupStep } from '../types'

interface Props {
  state: PlusState
  onOpen: (step: SetupStep) => void
  onStarted: (state: PlusState) => void
  onStateChange: (state: PlusState) => void
}

/** The setup steps, which can be done in any order, and the start button. */
export function OverviewScreen({ state, onOpen, onStarted, onStateChange }: Props) {
  const [speed, setSpeed] = useState<number>(() => parseInt(localStorage.getItem('muralSpeed') ?? '650', 10))
  const [starting, setStarting] = useState(false)
  const busy = state.status !== 'idle'

  useEffect(() => {
    localStorage.setItem('muralSpeed', String(speed))
  }, [speed])

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

  async function handleStart() {
    setStarting(true)
    try {
      onStarted(await run(speed))
    } catch (err) {
      setStarting(false)
      await showAlert(`Couldn't start drawing: ${errorMessage(err)}`)
    }
  }

  const steps: { id: SetupStep; title: string; done: boolean; detail: string; enabled: boolean }[] = [
    {
      id: 'distance',
      title: 'Hanger distance',
      done: state.ready.distance,
      detail: state.ready.distance ? `${state.topDistance} mm between the nails` : 'Distance between the nails Mural hangs from',
      enabled: true,
    },
    {
      id: 'drawing',
      title: 'Drawing',
      done: state.ready.drawing,
      detail: drawingDetail(state),
      enabled: state.ready.distance,
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
      detail: state.ready.pen ? `Calibrated, down angle ${state.pen.down}°` : 'Calibrate with Mural hanging at home',
      enabled: true,
    },
  ]

  return (
    <Card title="Mural" subtitle="Do these steps in any order, and redo any of them at any time.">
      <div className="space-y-3">
        {steps.map((step, i) => (
          <button
            key={step.id}
            onClick={() => onOpen(step.id)}
            disabled={!step.enabled || busy}
            className="w-full flex items-center gap-4 rounded-xl px-4 py-4 bg-gray-800 border border-gray-700 text-left transition-all enabled:hover:bg-gray-700 enabled:hover:border-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed"
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

      <div className="space-y-2">
        <Slider label="Speed (steps/s)" min={300} max={2000} step={50} value={speed} onChange={setSpeed} />
        <p className="text-xs text-yellow-400">⚠ Speed control is experimental. Use 650 for best results.</p>
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
