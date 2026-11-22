// Per-browser preferences. Storage can be missing or throw (private windows,
// blocked site data), so every access falls back to the default.

export type UiChoice = 'basic' | 'advanced'

const UI_KEY = 'muralUi'
const SPEED_KEY = 'muralSpeed' // shared with the Overview's speed slider
export const DEFAULT_SPEED = 650

/** Basic (the step-by-step wizard) unless this browser chose advanced. */
export function loadUiChoice(): UiChoice {
  try {
    return localStorage.getItem(UI_KEY) === 'advanced' ? 'advanced' : 'basic'
  } catch {
    return 'basic'
  }
}

export function saveUiChoice(choice: UiChoice) {
  try {
    localStorage.setItem(UI_KEY, choice)
  } catch {
    // not remembered
  }
}

export function loadSpeed(): number {
  try {
    const speed = parseInt(localStorage.getItem(SPEED_KEY) ?? '', 10)
    return Number.isFinite(speed) ? speed : DEFAULT_SPEED
  } catch {
    return DEFAULT_SPEED
  }
}

export function saveSpeed(speed: number) {
  try {
    localStorage.setItem(SPEED_KEY, String(speed))
  } catch {
    // not remembered
  }
}
