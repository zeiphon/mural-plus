import type { PlusState } from './types'

// Plus-only routes. Routes shared with upstream (motor jog, servo, upload, ...)
// are used through upstream's ../api.ts.

async function request<T>(method: 'GET' | 'POST', url: string, body: Record<string, string> = {}): Promise<T> {
  const res = await fetch(
    url,
    method === 'POST'
      ? {
          method,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(body).toString(),
        }
      : undefined,
  )
  const text = await res.text()
  if (!res.ok) throw new Error(text || `${url} failed: ${res.status}`)
  try {
    return JSON.parse(text) as T
  } catch {
    return text as unknown as T
  }
}

export type Mode = 'plus' | 'classic'

/** The mode the firmware is running, or null if Mural can't be reached or has no plus firmware. */
export async function getMode(): Promise<Mode | null> {
  try {
    const r = await request<{ mode?: string }>('GET', '/plus/mode')
    return r.mode === 'plus' || r.mode === 'classic' ? r.mode : null
  } catch {
    return null
  }
}

/** Saves the mode and restarts Mural. */
export const setMode = (mode: Mode): Promise<string> => request('POST', '/plus/mode', { mode })

export const getPlusState = (): Promise<PlusState> => request('GET', '/getState')

export const setTopDistance = (distance: number): Promise<PlusState> =>
  request('POST', '/setTopDistance', { distance: String(distance) })

/** Starts extending the belts to home. Resolves to the expected move time in seconds. */
export const extendToHome = (): Promise<number> => request('POST', '/extendToHome')

/**
 * Retracting belts run faster for a moment after each call with `on`, so keep
 * calling it while the boost is wanted. `false` ends it straight away.
 */
export const retractBoost = (on: boolean): Promise<string> =>
  request('POST', '/retractBoost', { on: on ? '1' : '0' })

export const run = (speed: number): Promise<PlusState> => request('POST', '/run', { speed: String(speed) })
export const pauseDrawing = (): Promise<PlusState> => request('POST', '/pauseDrawing')
export const resumeDrawing = (): Promise<PlusState> => request('POST', '/resumeDrawing')
export const stopDrawing = (): Promise<PlusState> => request('POST', '/stopDrawing')

/** Moves back to the home position, lifting the pen first. */
export const goHome = (): Promise<PlusState> => request('POST', '/goHome')

/** Lifts the pen to its up angle (ramped). */
export const penUp = (): Promise<string> => request('POST', '/penUp')
export const penDown = (): Promise<string> => request('POST', '/penDown')
/** Forgets the pen calibration (for when the pen has been taken out) and lifts the pen. */
export const resetPen = (): Promise<PlusState> => request('POST', '/resetPen')

/** Steps per second for the rest of the drawing. */
export const setDrawingSpeed = (speed: number): Promise<PlusState> =>
  request('POST', '/setDrawingSpeed', { speed: String(speed) })

/**
 * Nudges the pen's up or down angle, also while drawing. Positive steps make the
 * down angle firmer and move the up angle further from the wall.
 */
export const adjustPen = (which: 'up' | 'down', steps: number): Promise<PlusState> =>
  request('POST', '/adjustPen', { which, steps: String(steps) })

export interface PenSettingsUpdate {
  up?: number
  down?: number
  min?: number
  max?: number
  speed?: number
  releaseWhenUp?: boolean
}

export function setPenSettings(update: PenSettingsUpdate): Promise<PlusState> {
  const body: Record<string, string> = {}
  for (const [key, value] of Object.entries(update)) {
    if (value !== undefined) body[key] = typeof value === 'boolean' ? (value ? '1' : '0') : String(value)
  }
  return request('POST', '/penSettings', body)
}

export const setWebWhileDrawing = (enabled: boolean): Promise<PlusState> =>
  request('POST', '/settings', { webWhileDrawing: enabled ? '1' : '0' })

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Waits until Mural answers again after a restart, then reloads the page. */
export async function reloadWhenBack(): Promise<void> {
  await delay(3000)
  while (!(await getMode())) {
    await delay(1500)
  }
  location.reload()
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
