import { useRef } from 'react'
import type { Device } from '../device/device'
import type { Motor } from '../device/movement'
import { useFrame } from './hooks'

// The two stepper motors and the pen servo, close up. They're updated straight
// from the device every frame, without re-rendering.

export function Mechanics({ device }: { device: Device }) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-4">
      <MotorDial device={device} side="left" />
      <ServoGauge device={device} />
      <MotorDial device={device} side="right" />
    </div>
  )
}

function motorState(motor: Motor, boosted: boolean): { label: string; tone: string } {
  if (motor.stalled) return { label: 'Stalled at the screw', tone: 'text-red-400' }
  if (Math.abs(motor.speed) < 1) return { label: 'Stopped', tone: 'text-gray-500' }
  const dir = motor.speed < 0 ? 'Retracting' : 'Extending'
  return { label: boosted ? `${dir} fast` : dir, tone: 'text-cyan-300' }
}

function MotorDial({ device, side }: { device: Device; side: 'left' | 'right' }) {
  const rotor = useRef<SVGGElement>(null)
  const ring = useRef<SVGCircleElement>(null)
  const label = useRef<HTMLParagraphElement>(null)
  const detail = useRef<HTMLParagraphElement>(null)

  useFrame(() => {
    const m = device.movement
    const motor = side === 'left' ? m.left : m.right
    const sign = side === 'left' ? 1 : -1
    const degrees = sign * (motor.steps / 1600) * 360 + (motor.stalled ? (Math.random() - 0.5) * 10 : 0)
    rotor.current?.setAttribute('transform', `rotate(${degrees.toFixed(1)} 50 50)`)
    const active = Math.abs(motor.speed) > 1
    ring.current?.setAttribute('stroke', motor.stalled ? '#f87171' : active ? '#22d3ee' : '#374151')
    const boosted = side === 'left' ? device.leftBoosted : device.rightBoosted
    const { label: text, tone } = motorState(motor, boosted)
    if (label.current && label.current.textContent !== text) {
      label.current.textContent = text
      label.current.className = `text-xs font-medium ${tone}`
    }
    if (detail.current) {
      detail.current.textContent = `${Math.round(motor.belt)} mm belt · ${Math.round(Math.abs(motor.speed))} steps/s`
    }
  })

  return (
    <div className="flex flex-col items-center text-center gap-1">
      <svg viewBox="0 0 100 100" className="w-20 h-20 sm:w-24 sm:h-24" aria-hidden="true">
        <circle cx="50" cy="50" r="44" fill="#111827" stroke="#374151" strokeWidth="4" ref={ring} />
        <circle cx="50" cy="50" r="34" fill="#1f2937" />
        <g ref={rotor}>
          {[0, 60, 120, 180, 240, 300].map((a) => (
            <line
              key={a}
              x1="50"
              y1="50"
              x2={50 + 30 * Math.cos((a * Math.PI) / 180)}
              y2={50 + 30 * Math.sin((a * Math.PI) / 180)}
              stroke={a === 0 ? '#e5e7eb' : '#4b5563'}
              strokeWidth={a === 0 ? 4 : 2}
              strokeLinecap="round"
            />
          ))}
          <circle cx="50" cy="50" r="7" fill="#9ca3af" />
        </g>
      </svg>
      <p className="text-sm text-gray-200">{side === 'left' ? 'Left motor' : 'Right motor'}</p>
      <p ref={label} className="text-xs font-medium text-gray-500">
        Stopped
      </p>
      <p ref={detail} className="text-[11px] text-gray-500 tabular-nums" />
    </div>
  )
}

/** A point on the gauge for a servo angle: 0° on the right, 180° on the left. */
function gaugePoint(angle: number, r: number) {
  const a = (angle * Math.PI) / 180
  return { x: 60 + r * Math.cos(a), y: 62 - r * Math.sin(a) }
}

function arcPath(from: number, to: number, r: number) {
  const a = gaugePoint(from, r)
  const b = gaugePoint(to, r)
  return `M ${a.x} ${a.y} A ${r} ${r} 0 0 1 ${b.x} ${b.y}`
}

function ServoGauge({ device }: { device: Device }) {
  const arm = useRef<SVGLineElement>(null)
  const limits = useRef<SVGPathElement>(null)
  const upMark = useRef<SVGLineElement>(null)
  const downMark = useRef<SVGLineElement>(null)
  const label = useRef<HTMLParagraphElement>(null)
  const detail = useRef<HTMLParagraphElement>(null)

  useFrame(() => {
    const pen = device.pen
    const s = pen.settings
    const tip = gaugePoint(pen.current, 40)
    arm.current?.setAttribute('x2', tip.x.toFixed(2))
    arm.current?.setAttribute('y2', tip.y.toFixed(2))
    arm.current?.setAttribute('stroke', pen.attached ? (pen.isDown() && !pen.busy ? '#fbbf24' : '#e5e7eb') : '#6b7280')
    // The limits arc runs from max (left) to min (right)
    limits.current?.setAttribute('d', arcPath(s.maxAngle, s.minAngle, 48))
    const mark = (el: SVGLineElement | null, angle: number) => {
      if (!el) return
      if (angle < 0) {
        el.setAttribute('visibility', 'hidden')
        return
      }
      const a = gaugePoint(angle, 42)
      const b = gaugePoint(angle, 54)
      el.setAttribute('visibility', 'visible')
      el.setAttribute('x1', a.x.toFixed(2))
      el.setAttribute('y1', a.y.toFixed(2))
      el.setAttribute('x2', b.x.toFixed(2))
      el.setAttribute('y2', b.y.toFixed(2))
    }
    mark(upMark.current, s.upAngle)
    mark(downMark.current, s.downAngle)

    let text: string
    let tone = 'text-gray-500'
    if (!pen.attached) text = pen.positionKnown ? 'Released' : 'Waiting for boot'
    else if (pen.busy) {
      text = pen.position === 'down' ? 'Lowering' : pen.position === 'up' ? 'Lifting' : 'Moving'
      tone = 'text-cyan-300'
    } else if (pen.position === 'down') {
      text = 'On the wall'
      tone = 'text-amber-300'
    } else if (pen.position === 'up') text = 'Up'
    else text = 'Held'
    if (label.current && label.current.textContent !== text) {
      label.current.textContent = text
      label.current.className = `text-xs font-medium ${tone}`
    }
    if (detail.current) {
      detail.current.textContent = `${Math.round(pen.current)}° · up ${s.upAngle}° · down ${s.downAngle < 0 ? '–' : `${s.downAngle}°`}`
    }
  })

  return (
    <div className="flex flex-col items-center text-center gap-1">
      <svg viewBox="0 0 120 72" className="w-28 h-20 sm:w-32 sm:h-24" aria-hidden="true">
        <path d={arcPath(180, 0, 48)} fill="none" stroke="#1f2937" strokeWidth="8" strokeLinecap="round" />
        <path ref={limits} fill="none" stroke="#374151" strokeWidth="8" strokeLinecap="round" />
        <line ref={upMark} stroke="#22d3ee" strokeWidth="3" strokeLinecap="round" />
        <line ref={downMark} stroke="#fbbf24" strokeWidth="3" strokeLinecap="round" />
        <line ref={arm} x1="60" y1="62" x2="60" y2="22" stroke="#e5e7eb" strokeWidth="4" strokeLinecap="round" />
        <circle cx="60" cy="62" r="6" fill="#9ca3af" />
        <text x="112" y="70" fontSize="8" fill="#6b7280" textAnchor="end">
          0°
        </text>
        <text x="8" y="70" fontSize="8" fill="#6b7280">
          180°
        </text>
      </svg>
      <p className="text-sm text-gray-200">Pen servo</p>
      <p ref={label} className="text-xs font-medium text-gray-500">
        Up
      </p>
      <p ref={detail} className="text-[11px] text-gray-500 tabular-nums" />
    </div>
  )
}
