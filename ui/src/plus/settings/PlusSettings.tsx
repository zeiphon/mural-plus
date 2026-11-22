import { useEffect, useState, type ReactNode } from 'react'
import { Toggle } from '../../components/Toggle'
import { showAlert } from '../../components/AlertModal'
import {
  getPlusState,
  adjustPen,
  setPenSettings,
  setDrawingSpeed,
  setWebWhileDrawing,
  penUp,
  penDown,
  errorMessage,
  type PenSettingsUpdate,
} from '../api'
import type { PlusState } from '../types'
import { FirmwareSettings } from './FirmwareSettings'

const SPEED_STEP = 50 // steps/s, same step as the speed slider

/** Pen and drawing settings. The pen angles and drawing speed can be changed while drawing. */
export function PlusSettings() {
  const [state, setState] = useState<PlusState | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () =>
      getPlusState()
        .then((s) => !cancelled && setState(s))
        .catch(() => {})
    load()
    const id = setInterval(load, 2000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  async function update(action: () => Promise<PlusState>) {
    try {
      setState(await action())
    } catch (err) {
      await showAlert(errorMessage(err))
    }
  }

  if (!state) {
    return <p className="text-sm text-gray-500">Loading…</p>
  }

  const { pen } = state
  const drawing = state.drawingActive
  // Same rule as the firmware: towards the wall is whichever way the down angle lies.
  const towardsWall = pen.calibrated && pen.down > pen.up ? 1 : -1

  return (
    <div className="space-y-6">
      <Section title="Pen">
        <AngleRow
          label="Down angle"
          hint="How firmly the pen presses on the wall"
          angle={pen.calibrated ? pen.down : null}
          change={changeText(pen.down, pen.downBaseline, towardsWall, 'firmer', 'lighter')}
          less="Lighter"
          more="Firmer"
          onAdjust={(steps) => update(() => adjustPen('down', steps))}
          disabledText={pen.calibrated ? undefined : 'Calibrate the pen first'}
        />
        <AngleRow
          label="Up angle"
          hint="How far the pen lifts off the wall"
          angle={pen.up}
          change={changeText(pen.up, pen.upBaseline, -towardsWall, 'further', 'closer')}
          less="Closer"
          more="Further"
          onAdjust={(steps) => update(() => adjustPen('up', steps))}
        />
        <p className="text-xs text-gray-500">
          {drawing
            ? 'Changes apply straight away and are saved when the drawing ends.'
            : 'Changes apply straight away and are saved.'}
        </p>

        {!drawing && (
          <>
            <div className="flex gap-2">
              <SmallButton onClick={() => penUp().catch(reportError)}>Test pen up</SmallButton>
              <SmallButton onClick={() => penDown().catch(reportError)} disabled={!pen.calibrated}>
                Test pen down
              </SmallButton>
            </div>
            <ServoForm
              key={`${pen.speed}/${pen.min}/${pen.max}`} // back to the saved values after a save
              state={state}
              onSave={(u) => update(() => setPenSettings(u))}
            />
            <Toggle
              label="Stop holding the servo while the pen is up"
              checked={pen.releaseWhenUp}
              onChange={(on) => update(() => setPenSettings({ releaseWhenUp: on }))}
            />
          </>
        )}
      </Section>

      <Section title="Drawing">
        {drawing ? (
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-gray-200">Speed</p>
              <p className="text-xs text-gray-500">For the rest of this drawing</p>
            </div>
            <div className="flex items-center gap-2">
              <SmallButton onClick={() => update(() => setDrawingSpeed(state.drawing.speed - SPEED_STEP))}>−</SmallButton>
              <span className="w-24 text-center font-mono text-sm text-gray-200">{state.drawing.speed} steps/s</span>
              <SmallButton onClick={() => update(() => setDrawingSpeed(state.drawing.speed + SPEED_STEP))}>+</SmallButton>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <Toggle
              label="Keep this page working while drawing"
              checked={state.settings.webWhileDrawing}
              onChange={(on) => update(() => setWebWhileDrawing(on))}
            />
            <p className="text-xs text-gray-500">
              If it's off, Mural stops its web server during a drawing, like upstream Mural, and the page reconnects when
              the drawing ends.
            </p>
          </div>
        )}
      </Section>

      <Section title="Firmware">
        <FirmwareSettings drawing={drawing} />
      </Section>
    </div>
  )
}

/** "3° firmer than at the start of this drawing", or null if unchanged. */
function changeText(angle: number, baseline: number, positiveSign: number, more: string, less: string): string | null {
  if (baseline < 0 || baseline === angle) return null
  const diff = (angle - baseline) * positiveSign
  return `${Math.abs(diff)}° ${diff > 0 ? more : less} than at the start of this drawing`
}

/** Servo speed and soft limits, saved together. */
function ServoForm({ state, onSave }: { state: PlusState; onSave: (update: PenSettingsUpdate) => void }) {
  const [speed, setSpeed] = useState(String(state.pen.speed))
  const [min, setMin] = useState(String(state.pen.min))
  const [max, setMax] = useState(String(state.pen.max))
  const changed =
    Number(speed) !== state.pen.speed || Number(min) !== state.pen.min || Number(max) !== state.pen.max

  function handleSave() {
    const values = { speed: Number(speed), min: Number(min), max: Number(max) }
    if (Object.values(values).some((v) => !Number.isFinite(v))) {
      showAlert('Please enter numbers only')
      return
    }
    onSave(values)
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <NumberField label="Speed °/s" value={speed} onChange={setSpeed} />
        <NumberField label="Min angle" value={min} onChange={setMin} />
        <NumberField label="Max angle" value={max} onChange={setMax} />
      </div>
      <p className="text-xs text-gray-500">
        The servo never moves outside the min and max angles, so it can't push against the end of its travel.
      </p>
      {changed && (
        <SmallButton onClick={handleSave} primary>
          Save servo settings
        </SmallButton>
      )}
    </div>
  )
}

function AngleRow(props: {
  label: string
  hint: string
  angle: number | null
  change: string | null
  less: string
  more: string
  onAdjust: (steps: number) => void
  disabledText?: string
}) {
  const disabled = props.disabledText !== undefined
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-gray-200">
            {props.label} <span className="font-mono text-gray-400">{props.angle === null ? '—' : `${props.angle}°`}</span>
          </p>
          <p className="text-xs text-gray-500">{props.disabledText ?? props.hint}</p>
        </div>
        <div className="flex flex-none gap-2">
          <SmallButton onClick={() => props.onAdjust(-1)} disabled={disabled}>
            {props.less}
          </SmallButton>
          <SmallButton onClick={() => props.onAdjust(1)} disabled={disabled}>
            {props.more}
          </SmallButton>
        </div>
      </div>
      {props.change && <p className="text-xs text-cyan-400">{props.change}</p>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-4">
      <h3 className="text-xs sm:text-sm text-gray-400 uppercase tracking-wide">{title}</h3>
      {children}
    </div>
  )
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="space-y-1">
      <span className="block text-xs text-gray-500">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
      />
    </label>
  )
}

function SmallButton(props: { onClick: () => void; disabled?: boolean; primary?: boolean; children: ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        props.primary
          ? 'bg-cyan-600 enabled:hover:bg-cyan-500 text-white'
          : 'bg-gray-700 enabled:hover:bg-gray-600 text-gray-200'
      }`}
    >
      {props.children}
    </button>
  )
}

async function reportError(err: unknown) {
  await showAlert(errorMessage(err))
}
