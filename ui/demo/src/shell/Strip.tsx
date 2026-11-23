import { useRef, useState } from 'react'
import type { Device } from '../device/device'
import { WallView } from './WallView'
import { MiniMotor, penState } from './Mechanics'
import { OFFLINE } from './Status'
import { useFrame, useTick } from './hooks'

// On phones the app and the simulated Mural are two tabs. This strip sits
// under the app so the simulated Mural stays in view: a small wall, the motors
// turning and the pen, so pressing a button in the app visibly does something.
// Tapping it opens the full panel. It can be folded down to one line.

const FOLDED_KEY = 'muralDemoStripFolded'

/** Whether the motors or the pen are moving, held on briefly so short moves still show. */
export function useActivity(device: Device): boolean {
  const [active, setActive] = useState(false)
  const until = useRef(0)
  useFrame(() => {
    const { left, right } = device.movement
    const now = performance.now()
    if (Math.abs(left.speed) > 1 || Math.abs(right.speed) > 1 || (device.pen.attached && device.pen.busy)) {
      until.current = now + 800
    }
    const next = now < until.current
    if (next !== active) setActive(next)
  })
  return active
}

function statusText(device: Device): { text: string; tone: string } {
  const offline = device.offline()
  if (offline) return { text: OFFLINE[offline], tone: 'text-amber-300' }
  const r = device.runner
  if (r.isRunning()) {
    const name = device.mode === 'classic' ? 'drawing' : r.stateName()
    return { text: `${name[0].toUpperCase()}${name.slice(1)} ${r.progress}%`, tone: 'text-cyan-300' }
  }
  if (device.mode === 'classic') return { text: 'Classic mode', tone: 'text-gray-300' }
  const status = device.statusName()
  if (status === 'idle') return { text: 'Idle', tone: 'text-gray-300' }
  return { text: `${status[0].toUpperCase()}${status.slice(1)}`, tone: 'text-cyan-300' }
}

function loadFolded() {
  try {
    return localStorage.getItem(FOLDED_KEY) === '1'
  } catch {
    return false
  }
}

export function Strip({ device, active, onOpen }: { device: Device; active: boolean; onOpen: () => void }) {
  useTick(250)
  const [folded, setFolded] = useState(loadFolded)
  const status = statusText(device)
  const pen = penState(device.pen)

  function fold(value: boolean) {
    setFolded(value)
    try {
      localStorage.setItem(FOLDED_KEY, value ? '1' : '0')
    } catch {
      // not remembered
    }
  }

  return (
    <div
      className={`flex items-stretch border-t bg-gray-900 transition-colors ${
        active ? 'border-cyan-500/60' : 'border-gray-800'
      }`}
    >
      {folded ? (
        <button
          onClick={onOpen}
          className="flex-1 min-w-0 flex items-center gap-2 px-4 py-2 text-left text-xs"
          aria-label="Show the simulated Mural"
        >
          <Dot active={active} />
          <span className="text-gray-400 shrink-0">Simulated Mural:</span>
          <span className={`truncate ${status.tone}`}>{status.text}</span>
          <Chevron className="ml-auto shrink-0" />
        </button>
      ) : (
        <button
          onClick={onOpen}
          className="flex-1 min-w-0 flex items-center gap-2 min-[360px]:gap-3 pl-3 pr-1 py-2 text-left"
          aria-label="Show the simulated Mural"
        >
          <span className="block w-[56px] min-[360px]:w-[68px] shrink-0">
            <WallView device={device} height={52} />
          </span>
          <span className="flex shrink-0 gap-1">
            <MiniMotor device={device} side="left" />
            <MiniMotor device={device} side="right" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="flex items-center gap-1.5 text-xs text-gray-400">
              <Dot active={active} />
              <span className="truncate">Simulated Mural</span>
              <Chevron className="-ml-0.5 shrink-0" />
            </span>
            <span className="block truncate text-[13px]">
              <span className={status.tone}>{status.text}</span>
              <span className="text-gray-500"> · pen </span>
              <span className={pen.tone}>{pen.text === 'On the wall' ? 'down' : pen.text.toLowerCase()}</span>
            </span>
          </span>
        </button>
      )}
      <button
        onClick={() => fold(!folded)}
        className="shrink-0 px-3 text-gray-500 hover:text-gray-300"
        aria-label={folded ? 'Make the strip bigger' : 'Make the strip smaller'}
        title={folded ? 'Bigger' : 'Smaller'}
      >
        <svg viewBox="0 0 20 20" className={`w-4 h-4 ${folded ? 'rotate-180' : ''}`} aria-hidden="true">
          <path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  )
}

/** Lit while the motors or the pen are moving. */
export function Dot({ active, className = '' }: { active: boolean; className?: string }) {
  return (
    <span
      className={`inline-block w-2 h-2 shrink-0 rounded-full transition-colors ${className} ${
        active ? 'bg-cyan-400 animate-pulse' : 'bg-gray-600'
      }`}
      aria-hidden="true"
    />
  )
}

function Chevron({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={`w-3.5 h-3.5 text-gray-500 ${className}`} aria-hidden="true">
      <path d="M8 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
