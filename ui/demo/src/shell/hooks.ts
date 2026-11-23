import { useEffect, useReducer, useRef, useState } from 'react'

/** Re-renders every `ms` milliseconds, for readouts that follow the device. */
export function useTick(ms: number) {
  const [, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const id = setInterval(bump, ms)
    return () => clearInterval(id)
  }, [ms])
}

/** Calls `draw` on every animation frame, for the moving parts (drawn straight to the DOM or a canvas). */
export function useFrame(draw: () => void) {
  const ref = useRef(draw)
  ref.current = draw
  useEffect(() => {
    let id = 0
    const loop = () => {
      ref.current()
      id = requestAnimationFrame(loop)
    }
    id = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(id)
  }, [])
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : m > 0 ? `${m}m ${String(sec).padStart(2, '0')}s` : `${sec}s`
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Whether a media query matches, following changes. */
export function useMedia(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const list = window.matchMedia(query)
    const update = () => setMatches(list.matches)
    update()
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [query])
  return matches
}
