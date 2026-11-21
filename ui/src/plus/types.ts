import type { BackendState } from '../types'

export type DrawingState = 'idle' | 'starting' | 'drawing' | 'pausing' | 'paused' | 'resuming' | 'stopping'

/** /getState in plus mode: upstream's BackendState plus the plus fields (src/plus/controller.cpp). */
export interface PlusState extends BackendState {
  mode: 'plus'
  status: DrawingState | 'homing' | 'moving'
  /** True from the start request until the drawing finishes, stops or fails */
  drawingActive: boolean
  drawing: {
    state: DrawingState
    progress: number
    distanceDone: number
    totalDistance: number
    elapsedMs: number
    /** Steps per second */
    speed: number
    /** Outcome of the last drawing since Mural started */
    lastOutcome: 'none' | 'finished' | 'stopped' | 'failed'
    /** Why the last drawing failed, or '' */
    error: string
    /** Why the last start request failed, or '' */
    startError: string
  }
  position: { known: boolean; homing: boolean; atHome: boolean }
  pen: {
    calibrated: boolean
    /** Raw servo angles; on v2, lower = towards the wall. down is -1 until calibrated. */
    down: number
    up: number
    /** The angles before this drawing's adjustments, or -1 if not adjusted */
    downBaseline: number
    upBaseline: number
    /** Soft limits */
    min: number
    max: number
    /** Servo speed, degrees per second */
    speed: number
    releaseWhenUp: boolean
    isDown: boolean
    moving: boolean
  }
  settings: { webWhileDrawing: boolean }
  /** topDistance: the hanger distance the drawing was made for, -1 = none */
  drawingFile: { exists: boolean; topDistance: number; compatible: boolean }
  ready: { distance: boolean; position: boolean; pen: boolean; drawing: boolean; all: boolean }
}

export type SetupStep = 'distance' | 'drawing' | 'belts' | 'pen'
