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

export const run = (speed: number): Promise<PlusState> => request('POST', '/run', { speed: String(speed) })
export const pauseDrawing = (): Promise<PlusState> => request('POST', '/pauseDrawing')
export const resumeDrawing = (): Promise<PlusState> => request('POST', '/resumeDrawing')
export const stopDrawing = (): Promise<PlusState> => request('POST', '/stopDrawing')

/** Moves back to the home position, lifting the pen first. */
export const goHome = (): Promise<PlusState> => request('POST', '/goHome')

/** Lifts the pen to its up angle (ramped). */
export const penUp = (): Promise<string> => request('POST', '/penUp')

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
