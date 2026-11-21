import { useEffect, useRef, useState } from 'react'
import { Card } from '../../components/Card'
import { Button } from '../../components/Button'
import { Toggle } from '../../components/Toggle'
import { showAlert } from '../../components/AlertModal'
import { leftRetractDown, leftStop, rightRetractDown, rightStop } from '../../api'
import { extendToHome, getPlusState, delay, errorMessage } from '../api'
import type { PlusState } from '../types'

interface Props {
  state: PlusState
  onDone: (state: PlusState) => void
}

/** Upstream's Retract Belts and Extend Belts steps on one screen. */
export function BeltsScreen({ state, onDone }: Props) {
  const [leftOn, setLeftOn] = useState(false)
  const [rightOn, setRightOn] = useState(false)
  const [extending, setExtending] = useState(state.position.homing)
  const mounted = useRef(true)

  // Stop the motors if the screen is left while they run. Mural ignores this
  // while extending to home.
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      leftStop().catch(() => {})
      rightStop().catch(() => {})
    }
  }, [])

  // Opened while already extending (for example after reloading the page)
  useEffect(() => {
    if (state.position.homing) waitForHome()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleLeft(on: boolean) {
    setLeftOn(on)
    ;(on ? leftRetractDown() : leftStop()).catch(reportError)
  }

  function handleRight(on: boolean) {
    setRightOn(on)
    ;(on ? rightRetractDown() : rightStop()).catch(reportError)
  }

  async function handleExtend() {
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
