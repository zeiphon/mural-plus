import { useEffect, useRef, useState } from 'react'
import { setServo, setPenDistance, raiseBot, lowerBot } from '../../api'
import type { BackendState } from '../../types'
import { Card } from '../../components/Card'
import { Button } from '../../components/Button'
import { showAlert } from '../../components/AlertModal'
import { delay, errorMessage } from '../api'
import type { PlusState } from '../types'

interface Props {
  state: PlusState
  onDone: (state: BackendState) => void
}

const THROTTLE_MS = 150

// Plus's version of upstream's PenCalibrationScreen. The slider runs from the
// up angle (0, pen retracted) towards the wall, as far as the soft limit on that
// side, rather than upstream's fixed 0-70°. It starts from the saved down angle.
export function PenScreen({ state, onDone }: Props) {
  const { pen } = state
  // Same rule as the firmware: towards the wall is whichever way the down angle lies (lower on v2).
  const towardsWall = pen.calibrated && pen.down > pen.up ? 1 : -1
  const wallLimit = towardsWall < 0 ? pen.min : pen.max
  const range = Math.max(0, Math.abs(pen.up - wallLimit))

  const toAngle = (p: number) => pen.up + towardsWall * p
  const toPosition = (angle: number) => Math.max(0, Math.min(range, (angle - pen.up) * towardsWall))

  const [position, setPosition] = useState(() => (pen.calibrated ? toPosition(pen.down) : 0))
  const [busy, setBusy] = useState(false)
  const [moving, setMoving] = useState(false)
  const lastSentRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Move to the starting position (the servo ramps there)
  useEffect(() => {
    setServo(toAngle(position)).catch(() => {})
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function send(p: number) {
    const angle = toAngle(p)
    const now = Date.now()
    if (timerRef.current) clearTimeout(timerRef.current)
    if (now - lastSentRef.current >= THROTTLE_MS) {
      lastSentRef.current = now
      setServo(angle).catch(() => {})
    } else {
      timerRef.current = setTimeout(() => {
        lastSentRef.current = Date.now()
        setServo(angle).catch(() => {})
      }, THROTTLE_MS)
    }
  }

  function handleChange(p: number) {
    const clamped = Math.max(0, Math.min(range, p))
    setPosition(clamped)
    send(clamped)
  }

  async function handleMove(direction: 'raise' | 'lower') {
    setMoving(true)
    try {
      const seconds = await (direction === 'raise' ? raiseBot() : lowerBot())
      await delay(seconds * 1000)
    } catch (err) {
      await showAlert(errorMessage(err))
    }
    setMoving(false)
  }

  async function handleConfirm() {
    if (position === 0) {
      await showAlert("The pen is at its up angle. Move it towards the wall until it's touching.")
      return
    }
    setBusy(true)
    try {
      onDone(await setPenDistance(toAngle(position)))
    } catch (err) {
      setBusy(false)
      await showAlert(`Couldn't save the pen calibration: ${errorMessage(err)}`)
    }
  }

  return (
    <Card
      title="Pen Calibration"
      subtitle="Insert the pen so it's close to, but not touching, the wall and secure it with a bolt. Then move the pen until it just touches the wall."
    >
      {range === 0 ? (
        <p className="text-sm text-yellow-400">
          The up angle is already at the servo limit on the wall side, so the pen can't move towards the wall. Change the
          up angle or the limits in the pen settings (⚙).
        </p>
      ) : (
        <>
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <label htmlFor="penPosition" className="text-xs sm:text-sm 2xl:text-base text-gray-400 uppercase tracking-wide">
                Down angle
              </label>
              <span className="text-xs sm:text-sm 2xl:text-base text-gray-300 font-mono">{toAngle(position)}°</span>
            </div>
            <input
              id="penPosition"
              type="range"
              min={0}
              max={range}
              step={1}
              value={position}
              onChange={(e) => handleChange(Number(e.target.value))}
              className="w-full h-2 sm:h-3 2xl:h-4 rounded-full cursor-pointer accent-cyan-500"
            />
          </div>
          <div className="flex justify-between text-xs text-gray-500">
            <span>Pen up</span>
            <span>Towards the wall →</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[-5, -1, 1, 5].map((step) => (
              <Button key={step} variant="secondary" onClick={() => handleChange(position + step)}>
                {step > 0 ? `+${step}°` : `${step}°`}
              </Button>
            ))}
          </div>
        </>
      )}

      <div className="space-y-2">
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => handleMove('raise')} disabled={moving || !state.ready.position}>
            Raise Mural
          </Button>
          <Button variant="secondary" onClick={() => handleMove('lower')} disabled={moving || !state.ready.position}>
            Lower Mural
          </Button>
        </div>
        <p className="text-xs text-gray-500">
          {state.ready.position
            ? 'Moves Mural 10 cm up or down, to check the pen touches the wall at different heights.'
            : 'Extend the belts to home to move Mural up and down here.'}
        </p>
      </div>

      <Button onClick={handleConfirm} disabled={busy || range === 0}>
        {busy ? 'Saving…' : 'Pen is touching the wall'}
      </Button>
    </Card>
  )
}
