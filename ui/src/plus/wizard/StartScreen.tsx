import { useEffect, useState } from 'react'
import { Card } from '../../components/Card'
import { Button } from '../../components/Button'
import { Slider } from '../../components/Slider'
import { showAlert } from '../../components/AlertModal'
import { run, goHome, errorMessage } from '../api'
import type { PlusState } from '../types'
import { DEFAULT_SPEED, loadSpeed, saveSpeed } from '../storage'
import { stepDone, WIZARD_STEPS, type WizardStep } from './steps'

interface Props {
  state: PlusState
  onStarted: (state: PlusState) => void
  onStateChange: (state: PlusState) => void
  onOpenStep: (step: WizardStep) => void
}

/** The wizard's last step: a summary of the setup, and Begin drawing. */
export function StartScreen({ state, onStarted, onStateChange, onOpenStep }: Props) {
  const [speed, setSpeed] = useState(loadSpeed)
  const [starting, setStarting] = useState(false)
  const busy = state.status !== 'idle'

  useEffect(() => saveSpeed(speed), [speed])

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

  const outcome = outcomeText(state)

  return (
    <Card title="Ready to draw">
      {outcome && <p className={`text-sm text-center ${outcome.className}`}>{outcome.text}</p>}

      <ul className="space-y-2">
        {WIZARD_STEPS.filter((s) => s.id !== 'start').map((step) => {
          const done = stepDone(step.id, state)
          return (
            <li key={step.id}>
              <button
                onClick={() => onOpenStep(step.id)}
                disabled={busy || starting}
                className="w-full flex items-center gap-3 rounded-xl px-4 py-3 bg-gray-800 border border-gray-700 text-left transition-all enabled:hover:bg-gray-700 enabled:hover:border-cyan-500 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <span
                  className={`flex-none w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${
                    done ? 'bg-emerald-600 text-white' : 'bg-yellow-600 text-white'
                  }`}
                >
                  {done ? '✓' : '!'}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-white">{step.title}</span>
                  <span className="block text-xs text-gray-400">{summary(step.id, state)}</span>
                </span>
                <span className="flex-none text-gray-500" aria-hidden>
                  ›
                </span>
              </button>
            </li>
          )
        })}
      </ul>

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

      <details className="group rounded-xl border border-gray-800 px-4 py-3">
        <summary className="cursor-pointer select-none list-none text-sm text-gray-400 hover:text-gray-200 [&::-webkit-details-marker]:hidden">
          <span className="inline-block transition-transform group-open:rotate-90 mr-2" aria-hidden>
            ›
          </span>
          More options{speed !== DEFAULT_SPEED && ` (speed ${speed} steps/s)`}
        </summary>
        <div className="mt-3 space-y-2">
          <Slider label="Speed (steps/s)" min={300} max={2000} step={50} value={speed} onChange={setSpeed} />
          <p className="text-xs text-yellow-400">⚠ Speed control is experimental. Use {DEFAULT_SPEED} for best results.</p>
          {speed !== DEFAULT_SPEED && (
            <button onClick={() => setSpeed(DEFAULT_SPEED)} className="text-xs text-cyan-400 hover:text-cyan-300">
              Back to {DEFAULT_SPEED}
            </button>
          )}
        </div>
      </details>

      <Button onClick={handleStart} disabled={!state.ready.all || busy || starting}>
        {starting ? 'Starting…' : 'Begin drawing'}
      </Button>
      {!state.ready.all && <p className="text-center text-xs text-gray-500">Finish the steps marked ! first.</p>}
    </Card>
  )
}

function summary(step: WizardStep, state: PlusState): string {
  switch (step) {
    case 'distance':
      return state.ready.distance ? `${state.topDistance} mm between the nails` : 'Not set'
    case 'belts':
      return state.position.homing ? 'Extending to home…' : state.ready.position ? 'At a known position' : 'Extend to home first'
    case 'pen':
      return state.ready.pen ? `Calibrated, down at ${state.pen.down}°` : 'Not calibrated'
    case 'drawing':
      return state.ready.drawing ? 'On the SD card, ready' : 'Choose a drawing'
    default:
      return ''
  }
}

function outcomeText(state: PlusState): { text: string; className: string } | null {
  const d = state.drawing
  switch (d.lastOutcome) {
    case 'finished':
      return { text: 'The last drawing finished. Draw it again, or go back a step.', className: 'text-emerald-400' }
    case 'stopped':
      return { text: 'The last drawing was stopped.', className: 'text-yellow-400' }
    case 'failed':
      return { text: `The last drawing failed${d.error ? `: ${d.error}` : '.'}`, className: 'text-red-400' }
    default:
      return null
  }
}
