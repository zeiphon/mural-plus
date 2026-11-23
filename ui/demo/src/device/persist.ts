import { DEFAULT_DIAMETER } from './constants'
import { DEFAULT_PEN_SETTINGS, type PenSettings } from './pen'

// What a real Mural keeps across a restart: its NVS settings (src/plus/persist.cpp,
// the mode, the pulley diameter) and the drawing on the SD card. The demo keeps
// them in sessionStorage, so reloading the page is like restarting Mural, and
// switching modes works even when the app is opened on its own.

export interface Saved {
  mode: 'plus' | 'classic'
  bootCount: number
  /** Newest first */
  resetHistory: string[]
  topDistance: number
  pulleyDiameter: number
  pen: PenSettings
  webWhileDrawing: boolean
  logDrawingMoves: boolean
  /** The hanger distance the drawing was made for, -1 = none (plus only) */
  drawingTopDistance: number
  drawingSize: number
  /** The physical belts, so a reload doesn't move the bot */
  belts: { left: number; right: number } | null
}

const KEY = 'muralDemoDevice'
const DRAWING_KEY = 'muralDemoDrawing'

export const defaults = (): Saved => ({
  mode: 'plus',
  bootCount: 0,
  resetHistory: [],
  topDistance: -1,
  pulleyDiameter: DEFAULT_DIAMETER,
  pen: { ...DEFAULT_PEN_SETTINGS },
  webWhileDrawing: true,
  logDrawingMoves: false,
  drawingTopDistance: -1,
  drawingSize: 0,
  belts: null,
})

export function load(): Saved {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (raw) return { ...defaults(), ...JSON.parse(raw) }
  } catch {
    // start fresh
  }
  return defaults()
}

export function save(s: Saved) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // not kept
  }
}

/** The drawing on the "SD card". Large drawings may not fit in sessionStorage; then they're lost on reload. */
export function loadDrawing(): string | null {
  try {
    return sessionStorage.getItem(DRAWING_KEY)
  } catch {
    return null
  }
}

export function saveDrawing(text: string | null) {
  try {
    if (text === null) sessionStorage.removeItem(DRAWING_KEY)
    else sessionStorage.setItem(DRAWING_KEY, text)
  } catch {
    try {
      sessionStorage.removeItem(DRAWING_KEY)
    } catch {
      // nothing to do
    }
  }
}

export function clearAll() {
  try {
    sessionStorage.removeItem(KEY)
    sessionStorage.removeItem(DRAWING_KEY)
  } catch {
    // nothing to do
  }
}
