import { useEffect, useRef } from 'react'

/**
 * Starts and stops one belt's motor, laid out on the side of Mural it's on. A
 * pulley with its belt leading up to that side's pin turns while it runs.
 * Tap to start, tap again to stop.
 */
export function MotorButton(props: {
  side: 'left' | 'right'
  running: boolean
  /** Retracting faster (the boost): the pulley turns faster */
  fast?: boolean
  onChange: (running: boolean) => void
}) {
  const { side, running } = props
  const name = side === 'left' ? 'Left belt' : 'Right belt'
  return (
    <button
      type="button"
      aria-pressed={running}
      aria-label={`Retract ${side} belt`}
      onClick={() => props.onChange(!running)}
      className={`flex flex-col items-center gap-2 rounded-xl border px-3 py-4 sm:py-5 text-center select-none transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 ${
        running
          ? 'border-cyan-500 bg-cyan-950/60 text-cyan-100'
          : 'border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-200'
      }`}
    >
      <Pulley side={side} turning={running ? 'in' : undefined} fast={running && props.fast} />
      <span className="font-medium text-sm sm:text-base">{name}</span>
      {/* Two short lines, so the button keeps its size whatever it says */}
      <span className="flex flex-col text-xs leading-snug">
        <span className={running ? 'text-cyan-300 font-medium' : 'text-gray-500'}>
          {running ? (props.fast ? 'Retracting fast…' : 'Retracting…') : 'Stopped'}
        </span>
        <span className={running ? 'text-cyan-100/80' : 'text-gray-400'}>{running ? 'Tap to stop' : 'Tap to retract'}</span>
      </span>
    </button>
  )
}

/**
 * One side's pulley, with the belt leaving it towards that side's pin. It turns
 * while `turning`: reeling the belt in, or letting it out.
 */
export function Pulley({
  side,
  turning,
  fast = false,
  className = 'w-14 h-10 sm:w-16 sm:h-12',
}: {
  side: 'left' | 'right'
  turning?: 'in' | 'out'
  fast?: boolean
  className?: string
}) {
  const rotor = useRef<SVGGElement>(null)

  // Speed up the turning animation in place, so it doesn't jump
  useEffect(() => {
    const rate = fast ? 3 : 1
    for (const a of rotor.current?.getAnimations?.() ?? []) {
      if (a.updatePlaybackRate) a.updatePlaybackRate(rate)
      else a.playbackRate = rate
    }
  }, [fast, turning])

  return (
    <svg viewBox="0 0 64 48" className={className} aria-hidden="true">
      <g transform={side === 'right' ? 'translate(64 0) scale(-1 1)' : undefined}>
        {/* The belt, leaving the top inner side of the pulley (the tangent point in
            KinematicModel.md, up and towards the middle) and running up to the pin */}
        <line
          x1="43.1"
          y1="26.9"
          x2="19"
          y2="3"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          className={turning ? 'opacity-90' : 'opacity-40'}
        />
        <circle cx="36" cy="34" r="10" fill="none" stroke="currentColor" strokeWidth="2.5" />
        <g
          ref={rotor}
          className={turning ? 'motion-safe:animate-spin' : ''}
          style={{
            transformBox: 'fill-box',
            transformOrigin: 'center',
            // Reeling in pulls the belt over the top of the pulley, towards the
            // middle: clockwise on the left (the right one is drawn mirrored, so
            // anticlockwise there). Letting it out turns the other way.
            animationDirection: turning === 'in' ? 'normal' : 'reverse',
            animationDuration: '1.4s',
          }}
        >
          {/* Keeps the group's box centred on the pulley, so it turns about its centre */}
          <circle cx="36" cy="34" r="7.5" fill="none" stroke="transparent" />
          {[0, 120, 240].map((a) => (
            <line
              key={a}
              x1="36"
              y1="34"
              x2={36 + 6.5 * Math.cos((a * Math.PI) / 180)}
              y2={34 + 6.5 * Math.sin((a * Math.PI) / 180)}
              stroke="currentColor"
              strokeWidth={a === 0 ? 3 : 2}
              strokeLinecap="round"
            />
          ))}
        </g>
        <circle cx="36" cy="34" r="2.2" fill="currentColor" />
      </g>
    </svg>
  )
}
