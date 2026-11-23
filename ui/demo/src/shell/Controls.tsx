import type { ReactNode } from 'react'
import type { Device } from '../device/device'
import { useTick } from './hooks'

// The demo's own controls: how fast time runs, shortcuts, and things going
// wrong on purpose, to see how the app copes.

const SPEEDS = [1, 10, 100, 1000]

interface Props {
  device: Device
  onReset: () => void
}

export function Controls({ device, onReset }: Props) {
  useTick(300)
  const plusIdle = device.mode === 'plus' && !device.offline() && device.statusName() === 'idle'

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm text-gray-400">Simulation speed</p>
        <div className="inline-flex rounded-lg bg-gray-800 p-1" role="group" aria-label="Simulation speed">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => device.setSpeed(s)}
              aria-pressed={device.speed === s}
              className={`px-3 py-1 rounded-md text-sm tabular-nums transition-colors ${
                device.speed === s ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-700'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500">A real drawing takes hours. The app's own timings stay real.</p>
      </div>

      <div className="space-y-2">
        <p className="text-sm text-gray-400">Shortcuts</p>
        <div className="flex flex-wrap gap-2">
          <Action
            onClick={() => device.quickSetup()}
            disabled={!plusIdle}
            title="Sets the distance, homes the belts, calibrates the pen and loads a sample drawing"
          >
            Skip setup
          </Action>
          <a
            href="./sample-drawing.svg"
            download="sample-drawing.svg"
            className="rounded-lg bg-gray-800 hover:bg-gray-700 px-3 py-1.5 text-sm text-gray-200 transition-colors"
          >
            Download a sample SVG
          </a>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm text-gray-400">Make something go wrong</p>
        <div className="flex flex-wrap gap-2">
          <Action
            onClick={() => (device.faults.failNextMove = !device.faults.failNextMove)}
            pressed={device.faults.failNextMove}
            title="The next drawing move is rejected, as when the kinematics can't reach a point"
          >
            {device.faults.failNextMove ? 'Next move will fail' : 'Fail the next move'}
          </Action>
          <Action
            onClick={() => (device.faults.overheat = !device.faults.overheat)}
            pressed={device.faults.overheat}
            title="The left driver reports an overtemperature warning (see Diagnostics)"
          >
            Overheat left driver
          </Action>
          <Action onClick={() => device.dropWifi(10000)} disabled={!!device.offline()}>
            Drop WiFi for 10 s
          </Action>
          <Action onClick={() => device.brownout()} disabled={!!device.offline()} title="Mural restarts and forgets the belt position">
            Brownout
          </Action>
        </div>
      </div>

      <div className="pt-1">
        <button onClick={onReset} className="text-sm text-gray-400 hover:text-gray-200 underline underline-offset-4">
          Reset the demo
        </button>
      </div>
    </div>
  )
}

function Action({
  children,
  onClick,
  disabled,
  pressed,
  title,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  pressed?: boolean
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={pressed}
      className={`rounded-lg px-3 py-1.5 text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        pressed ? 'bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/50' : 'bg-gray-800 enabled:hover:bg-gray-700 text-gray-200'
      }`}
    >
      {children}
    </button>
  )
}
