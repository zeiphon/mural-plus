import { useEffect, useRef, useState } from 'react'
import { leftExtendDown, leftRetractDown, leftStop, rightExtendDown, rightRetractDown, rightStop } from '../../api'
import { showAlert } from '../../components/AlertModal'
import { errorMessage } from '../api'

type Side = 'left' | 'right'
type Dir = -1 | 0 | 1

const COMMANDS: Record<Side, Record<Dir, () => Promise<void>>> = {
  left: { [-1]: leftRetractDown, 0: leftStop, 1: leftExtendDown },
  right: { [-1]: rightRetractDown, 0: rightStop, 1: rightExtendDown },
}

const CHOICES: { dir: Dir; label: string }[] = [
  { dir: -1, label: '◀ Retract' },
  { dir: 0, label: 'Stop' },
  { dir: 1, label: 'Extend ▶' },
]

/**
 * Runs each belt motor until Stop, like the motor sliders in upstream's Tools
 * modal. Both motors stop when this goes away or the page loses focus.
 */
export function MotorControls({ disabled, onChange }: { disabled?: boolean; onChange?: () => void }) {
  const [dirs, setDirs] = useState<Record<Side, Dir>>({ left: 0, right: 0 })
  // Only send stops if this started something: Mural rejects them while drawing.
  const used = useRef(false)
  const running = dirs.left !== 0 || dirs.right !== 0

  async function handleSet(side: Side, dir: Dir) {
    const previous = dirs[side]
    if (dir === previous) return
    if (dir !== 0) used.current = true
    setDirs((d) => ({ ...d, [side]: dir }))
    try {
      await COMMANDS[side][dir]()
    } catch (err) {
      setDirs((d) => ({ ...d, [side]: previous }))
      await showAlert(errorMessage(err))
    }
    onChange?.()
  }

  useEffect(
    () => () => {
      if (!used.current) return
      leftStop().catch(() => {})
      rightStop().catch(() => {})
    },
    [],
  )

  // Nothing should keep running unwatched, for example after the phone locks.
  useEffect(() => {
    if (!running) return
    const stopAll = () => {
      setDirs({ left: 0, right: 0 })
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
  }, [running])

  return (
    <div className="space-y-3">
      {(['left', 'right'] as const).map((side) => (
        <div key={side} className="space-y-1.5">
          <p className="text-sm text-gray-200">{side === 'left' ? 'Left motor' : 'Right motor'}</p>
          <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-gray-700" role="group">
            {CHOICES.map(({ dir, label }) => {
              const active = dirs[side] === dir
              return (
                <button
                  key={dir}
                  onClick={() => handleSet(side, dir)}
                  disabled={disabled}
                  aria-pressed={active}
                  className={`px-2 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    dir !== 1 ? 'border-r border-gray-700' : ''
                  } ${
                    active && dir !== 0
                      ? 'bg-cyan-600 text-white'
                      : 'bg-gray-800 text-gray-300 enabled:hover:bg-gray-700'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
