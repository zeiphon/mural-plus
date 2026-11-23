import { useEffect, useRef, useState } from 'react'
import { Card } from '../../components/Card'
import { Button } from '../../components/Button'
import { showAlert } from '../../components/AlertModal'
import { leftRetractDown, leftStop, rightRetractDown, rightStop } from '../../api'
import { extendToHome, getDiagnostics, getPlusState, retractBoost, delay, errorMessage } from '../api'
import type { Diagnostics, PlusState } from '../types'
import { Help } from '../components/Help'
import { MotorButton, Pulley } from '../components/MotorButton'

interface Props {
  state: PlusState
  onDone: (state: PlusState) => void
}

// Mural keeps the boost on for 600 ms after each request, so a lost release
// (phone locked, WiFi dropped) can't leave the belts retracting fast.
const BOOST_REPEAT_MS = 200

/** Upstream's Retract Belts and Extend Belts steps on one screen. */
export function BeltsScreen({ state, onDone }: Props) {
  const [leftOn, setLeftOn] = useState(false)
  const [rightOn, setRightOn] = useState(false)
  const [extending, setExtending] = useState(state.position.homing)
  const [boosting, setBoosting] = useState(false)
  const mounted = useRef(true)
  const boostTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const boostInFlight = useRef<Promise<unknown> | null>(null)

  // Stop the motors if the screen is left while they run. Mural ignores this
  // while extending to home.
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      stopBoost()
      leftStop().catch(() => {})
      rightStop().catch(() => {})
    }
  }, [])

  // Opened while already extending (for example after reloading the page)
  useEffect(() => {
    if (state.position.homing) waitForHome()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Retracting ends with the motors stalling against the stops, so nothing here
  // should keep running unwatched: stop both belts (and the boost) if the page
  // loses focus or is hidden, for example when the phone locks.
  useEffect(() => {
    if (!leftOn && !rightOn) return
    const onVisibility = () => {
      if (document.hidden) stopRetracting()
    }
    window.addEventListener('blur', stopRetracting)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', stopRetracting)
      document.removeEventListener('visibilitychange', onVisibility)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftOn, rightOn])

  // Nothing left to speed up
  useEffect(() => {
    if (!leftOn && !rightOn) stopBoost()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftOn, rightOn])

  function sendBoost() {
    if (boostInFlight.current) return
    boostInFlight.current = retractBoost(true)
      .catch(() => {})
      .finally(() => {
        boostInFlight.current = null
      })
  }

  function startBoost() {
    if (boostTimer.current || !(leftOn || rightOn)) return
    setBoosting(true)
    sendBoost()
    boostTimer.current = setInterval(sendBoost, BOOST_REPEAT_MS)
  }

  function stopBoost() {
    if (!boostTimer.current) return
    clearInterval(boostTimer.current)
    boostTimer.current = null
    setBoosting(false)
    // After any request still on its way, so that one can't renew the boost
    ;(boostInFlight.current ?? Promise.resolve()).then(() => retractBoost(false)).catch(() => {})
  }

  /** Stops both belts and the boost. */
  function stopRetracting() {
    stopBoost()
    setLeftOn(false)
    setRightOn(false)
    leftStop().catch(() => {})
    rightStop().catch(() => {})
  }

  function handleLeft(on: boolean) {
    setLeftOn(on)
    ;(on ? leftRetractDown() : leftStop()).catch(reportError)
  }

  function handleRight(on: boolean) {
    setRightOn(on)
    ;(on ? rightRetractDown() : rightStop()).catch(reportError)
  }

  async function handleExtend() {
    stopBoost()
    setLeftOn(false)
    setRightOn(false)
    setExtending(true)
    try {
      await leftStop()
      await rightStop()
      await extendToHome()
    } catch (err) {
      setExtending(false)
      await reportError(err)
      return
    }
    await waitForHome()
  }

  async function waitForHome() {
    while (mounted.current) {
      await delay(1500)
      try {
        const s = await getPlusState()
        if (mounted.current && !s.position.homing) {
          onDone(s)
          return
        }
      } catch {
        // keep waiting
      }
    }
  }

  return (
    <Card
      title="Belts"
      subtitle="Hook the belt loops onto the homing screws, retract each belt until its motor stalls, then extend to home. Don't let them stall too long."
    >
      {extending ? (
        <Extending />
      ) : (
        <>
          {state.ready.position && (
            <p className="flex gap-2 rounded-lg border border-emerald-800/60 bg-emerald-950/50 px-3 py-2 text-xs sm:text-sm text-emerald-200">
              <span aria-hidden="true">✓</span>
              <span>Belt position already known. Only redo this if the belts slipped or were moved.</span>
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <MotorButton side="left" running={leftOn} fast={boosting} onChange={handleLeft} />
            <MotorButton side="right" running={rightOn} fast={boosting} onChange={handleRight} />
          </div>
          <div className="space-y-1">
            <Button variant="danger" onClick={stopRetracting} disabled={!leftOn && !rightOn}>
              Stop
            </Button>
          </div>
          <div className="space-y-1">
            <button
              type="button"
              disabled={!leftOn && !rightOn}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.currentTarget.setPointerCapture(e.pointerId)
                startBoost()
              }}
              onPointerUp={stopBoost}
              onPointerCancel={stopBoost}
              onLostPointerCapture={stopBoost}
              onKeyDown={(e) => {
                if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
                  e.preventDefault()
                  startBoost()
                }
              }}
              onKeyUp={(e) => {
                if (e.key === ' ' || e.key === 'Enter') stopBoost()
              }}
              onBlur={stopBoost}
              onContextMenu={(e) => e.preventDefault()}
              style={{ WebkitTouchCallout: 'none' }}
              className={`w-full rounded-xl px-5 py-3 sm:py-4 font-medium text-sm sm:text-base select-none touch-none transition-colors focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed ${
                boosting ? 'bg-cyan-600 text-white' : 'bg-gray-700 enabled:hover:bg-gray-600 text-gray-200'
              }`}
            >
              {boosting ? 'Retracting faster…' : 'Hold to retract faster'}
            </button>
            <Help label="Let go before the loops reach the screws">
              <p>For long retractions. Letting go early means the motors stall at the normal speed.</p>
            </Help>
          </div>
          <div className="space-y-1 border-t border-gray-800 pt-5 sm:pt-6">
            <Button onClick={handleExtend}>Belts are retracted, extend to home</Button>
            <p className="text-xs text-gray-500 text-center">
              Keep the belts clear while they extend. If a motor skips, drawings come out inaccurate.
            </p>
          </div>
        </>
      )}
    </Card>
  )
}

interface BeltProgress {
  /** Belt lengths in mm: now, and at the home position */
  length: number
  target: number
}

/** Each belt's length and target while extending, from the motors' step counts. */
function beltProgress(d: Diagnostics): { left: BeltProgress; right: BeltProgress; secondsLeft: number } | null {
  const left = d.drivers.find((m) => m.name === 'Left')
  const right = d.drivers.find((m) => m.name === 'Right')
  if (!left || !right) return null
  // Movement::setOrigin counts steps from the belt's zero length, so the step
  // count is the belt's length, and the move ends at steps + stepsToGo.
  const stepsPerRotation = (left.expectedMicrosteps ?? 8) * 200
  const mmPerStep = (Math.PI * d.motors.pulleyDiameter) / stepsPerRotation
  const belt = (m: typeof left): BeltProgress => ({
    length: Math.abs(m.steps) * mmPerStep,
    target: Math.abs(m.steps + m.stepsToGo) * mmPerStep,
  })
  const secondsLeft = Math.max(
    ...[left, right].map((m) => (m.stepsToGo !== 0 && m.stepSpeed !== 0 ? Math.abs(m.stepsToGo / m.stepSpeed) : 0)),
  )
  return { left: belt(left), right: belt(right), secondsLeft }
}

function formatSecondsLeft(s: number) {
  if (s < 1) return 'almost there'
  if (s < 60) return `about ${Math.ceil(s)} s left`
  return `about ${Math.ceil(s / 60)} min left`
}

/** While the belts extend to home: both pulleys letting their belts out, and how far they've got. */
function Extending() {
  const [progress, setProgress] = useState<ReturnType<typeof beltProgress>>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      while (alive) {
        try {
          const d = await getDiagnostics()
          if (alive) setProgress(beltProgress(d))
        } catch {
          // keep the last reading
        }
        await delay(1000)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {(['left', 'right'] as const).map((side) => {
          const belt = progress?.[side]
          const done = belt ? belt.target - belt.length < 1 : false
          const fraction = belt && belt.target > 0 ? Math.min(1, belt.length / belt.target) : 0
          return (
            <div
              key={side}
              className="flex flex-col items-center gap-2 rounded-xl border border-cyan-500/60 bg-cyan-950/40 px-3 py-4 sm:py-5 text-center text-cyan-100"
            >
              <Pulley side={side} turning={done ? undefined : 'out'} />
              <span className="font-medium text-sm sm:text-base">{side === 'left' ? 'Left belt' : 'Right belt'}</span>
              <span className="text-xs text-cyan-300 tabular-nums">
                {belt ? `${Math.round(belt.length)} of ${Math.round(belt.target)} mm` : 'Extending…'}
              </span>
              <div className="w-full h-1.5 rounded-full bg-gray-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-cyan-500 transition-[width] duration-1000 ease-linear"
                  style={{ width: `${fraction * 100}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
      <p className="text-sm text-gray-400 text-center">
        Extending to the home position
        {progress && progress.secondsLeft > 0 ? `, ${formatSecondsLeft(progress.secondsLeft)}` : '…'}
      </p>
    </div>
  )
}

async function reportError(err: unknown) {
  await showAlert(errorMessage(err))
}
