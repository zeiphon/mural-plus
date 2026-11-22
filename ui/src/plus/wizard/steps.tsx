import { Button } from '../../components/Button'
import type { PlusState } from '../types'

// The basic UI's step-by-step setup (BASIC_UI_PLAN.md). The steps reuse the
// advanced UI's screens; PlusApp does the navigating.

export type WizardStep = 'distance' | 'belts' | 'pen' | 'drawing' | 'start'

export const WIZARD_STEPS: { id: WizardStep; title: string }[] = [
  { id: 'distance', title: 'Distance' },
  { id: 'belts', title: 'Belts' },
  { id: 'pen', title: 'Pen' },
  { id: 'drawing', title: 'Drawing' },
  { id: 'start', title: 'Start' },
]

export function stepDone(step: WizardStep, state: PlusState): boolean {
  switch (step) {
    case 'distance':
      return state.ready.distance
    case 'belts':
      return state.ready.position
    case 'pen':
      return state.ready.pen
    case 'drawing':
      return state.ready.drawing
    case 'start':
      return false
  }
}

/** Where the wizard opens: the first step that isn't done, or Start. */
export function firstUnfinishedStep(state: PlusState): WizardStep {
  return WIZARD_STEPS.find((s) => s.id !== 'start' && !stepDone(s.id, state))?.id ?? 'start'
}

export function nextStep(step: WizardStep): WizardStep | null {
  const i = WIZARD_STEPS.findIndex((s) => s.id === step)
  return WIZARD_STEPS[i + 1]?.id ?? null
}

export function previousStep(step: WizardStep): WizardStep | null {
  const i = WIZARD_STEPS.findIndex((s) => s.id === step)
  return i > 0 ? WIZARD_STEPS[i - 1].id : null
}

/** Done steps get a tick. Any step up to the first unfinished one can be opened. */
export function StepBar(props: {
  state: PlusState
  current: WizardStep
  /** Nothing can be opened, for example during an upload */
  locked?: boolean
  onSelect: (step: WizardStep) => void
}) {
  const reachable = WIZARD_STEPS.findIndex((s) => s.id === firstUnfinishedStep(props.state))
  return (
    <nav aria-label="Setup steps">
      <ol className="grid grid-cols-5 gap-1">
        {WIZARD_STEPS.map((step, i) => {
          const done = stepDone(step.id, props.state)
          const current = step.id === props.current
          return (
            <li key={step.id}>
              <button
                onClick={() => props.onSelect(step.id)}
                disabled={i > reachable || current || props.locked}
                aria-current={current ? 'step' : undefined}
                className="group w-full flex flex-col items-center gap-1 rounded-lg py-1 disabled:cursor-default"
              >
                <span
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                    done ? 'bg-emerald-600 text-white' : current ? 'bg-cyan-600 text-white' : 'bg-gray-800 text-gray-400'
                  } ${current ? 'ring-2 ring-cyan-400 ring-offset-2 ring-offset-gray-950' : ''} ${
                    i > reachable ? 'opacity-40' : 'group-enabled:group-hover:ring-2 group-enabled:group-hover:ring-gray-500'
                  }`}
                >
                  {done ? '✓' : i + 1}
                </span>
                <span
                  className={`text-xs ${current ? 'text-white font-medium' : i > reachable ? 'text-gray-600' : 'text-gray-400'}`}
                >
                  {step.title}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/** Back and Next under a step's screen. Either can be left out. */
export function WizardNav(props: { onBack?: () => void; onNext?: () => void; nextEnabled?: boolean; nextHint?: string }) {
  return (
    <div className="space-y-2">
      <div className="flex gap-3">
        {props.onBack && (
          <Button variant="secondary" onClick={props.onBack}>
            ← Back
          </Button>
        )}
        {props.onNext && (
          <Button variant="secondary" onClick={props.onNext} disabled={!props.nextEnabled}>
            Next →
          </Button>
        )}
      </div>
      {props.onNext && !props.nextEnabled && props.nextHint && (
        <p className="text-center text-xs text-gray-500">{props.nextHint}</p>
      )}
    </div>
  )
}
