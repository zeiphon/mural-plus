import { useEffect, useRef, useState } from 'react'
import { Card } from '../../components/Card'
import { Button } from '../../components/Button'
import { Toggle } from '../../components/Toggle'
import { showAlert } from '../../components/AlertModal'
import { leftRetractDown, leftStop, rightRetractDown, rightStop } from '../../api'
import { extendToHome, getPlusState, retractBoost, delay, errorMessage } from '../api'
import type { PlusState } from '../types'
import { Help } from '../components/Help'

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
    const stopAll = () => {
      stopBoost()
      setLeftOn(false)
      setRightOn(false)
      leftStop().catch(() => {})
      rightStop().catch(() => {})
    }
    const onVisibility = () => {
      if (document.hidden) stopAll()
    }
    window.addEventListener('blur', stopAll)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', stopAll)
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
      subtitle="Place the belt loops on the homing screws and retract the belts until the motors stall. Don't let the motors stall for too long. Then extend the belts to their home position."
    >
      {extending ? (
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="w-10 h-10 border-4 border-gray-700 border-t-cyan-500 rounded-full animate-spin" />
          <p className="text-sm text-gray-400">Extending to home position…</p>
        </div>
      ) : (
        <>
          {state.ready.position && (
            <p className="text-sm text-gray-400">
              The belt position is already known. Only redo this if the belts have slipped or been moved.
            </p>
          )}
          <div className="space-y-4">
            <Toggle label="Retract left belt" checked={leftOn} onChange={handleLeft} />
            <Toggle label="Retract right belt" checked={rightOn} onChange={handleRight} />
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
              <p>The belts stop if you leave this page or lock the phone.</p>
            </Help>
          </div>
          <p className="text-xs text-gray-500">
            Make sure the belts are unobstructed and the motors don't skip while extending, or the drawing accuracy may
            be affected.
          </p>
          <Button onClick={handleExtend}>Belts are retracted, extend to home</Button>
        </>
      )}
    </Card>
  )
}

async function reportError(err: unknown) {
  await showAlert(errorMessage(err))
}
