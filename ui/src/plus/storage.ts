import { useSyncExternalStore } from 'react'

// Per-browser preferences. Storage can be missing or throw (private windows,
// blocked site data), so every access falls back to the default.

export type UiChoice = 'basic' | 'advanced'

const UI_KEY = 'muralUi'
const SPEED_KEY = 'muralSpeed' // the same key as upstream's speed slider
export const DEFAULT_SPEED = 650
export const MIN_SPEED = 300
export const MAX_SPEED = 2000
export const SPEED_STEP = 50

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

function clampSpeed(speed: number): number {
  return Math.max(MIN_SPEED, Math.min(MAX_SPEED, Math.round(speed)))
}

function loadSpeed(): number {
  try {
    const speed = parseInt(localStorage.getItem(SPEED_KEY) ?? '', 10)
    return Number.isFinite(speed) ? clampSpeed(speed) : DEFAULT_SPEED
  } catch {
    return DEFAULT_SPEED
  }
}

// The drawing speed for the next drawing, shared by every screen that shows it.
let speed = loadSpeed()
const speedListeners = new Set<() => void>()

function setSpeed(value: number) {
  speed = clampSpeed(value)
  try {
    localStorage.setItem(SPEED_KEY, String(speed))
  } catch {
    // not remembered
  }
  speedListeners.forEach((listener) => listener())
}

function subscribeSpeed(listener: () => void) {
  speedListeners.add(listener)
  return () => {
    speedListeners.delete(listener)
  }
}

/** The speed for the next drawing (steps/s), and a setter that keeps it in range. */
export function useSpeed(): [number, (speed: number) => void] {
  return [useSyncExternalStore(subscribeSpeed, () => speed), setSpeed]
}
