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
  settings: { webWhileDrawing: boolean; logDrawingMoves: boolean }
  /** topDistance: the hanger distance the drawing was made for, -1 = none */
  drawingFile: { exists: boolean; topDistance: number; compatible: boolean }
  ready: { distance: boolean; position: boolean; pen: boolean; drawing: boolean; all: boolean }
}

export type SetupStep = 'distance' | 'drawing' | 'belts' | 'pen'

/** GET /diagnostics (src/plus/diagnostics.cpp). Servo values are commanded, not measured. */
export interface Diagnostics {
  system: {
    firmware: string
    built: string
    uptimeMs: number
    bootCount: number
    /** Newest first */
    resetHistory: { reason: string; brownout: boolean }[]
    freeHeap: number
    minFreeHeap: number
    maxAllocHeap: number
    cpuMHz: number
    hotspot: boolean
    ip: string
    wifiRssi?: number
    status: string
    drawing: boolean
    progress: number
    logDrawingMoves: boolean
  }
  servo: {
    pin: number
    attached: boolean
    positionKnown: boolean
    position: 'up' | 'down' | 'other' | 'unknown'
    commandedAngle: number
    targetAngle: number
    pulseUs: number
    moving: boolean
    moveCount: number
    lastMoveFrom: number
    lastMoveTo: number
    lastMoveMs: number
    cycleRemaining: number
    upAngle: number
    downAngle: number
    minAngle: number
    maxAngle: number
    speedDegPerSec: number
    releaseWhenUp: boolean
  }
  motors: {
    moving: boolean
    topDistance: number
    pulleyDiameter: number
    positionKnown: boolean
    homing: boolean
    x?: number
    y?: number
    /** -1 retracting, 1 extending, 0 stopped */
    leftManual: number
    rightManual: number
    boosting: boolean
  }
  drivers: MotorDriver[]
  storage: {
    uiTotalBytes: number
    uiUsedBytes: number
    sdTotalBytes: number
    sdUsedBytes: number
    drawingExists: boolean
    drawingBytes: number
    drawingTopDistance: number
    drawingReady: boolean
  }
}

/** A TMC2209's status. Only the step fields are there if it didn't answer. */
export interface MotorDriver {
  name: string
  steps: number
  stepsToGo: number
  stepSpeed: number
  responding: boolean
  crcError?: boolean
  enabled?: boolean
  overtempWarning?: boolean
  overtemp?: boolean
  shortToGroundA?: boolean
  shortToGroundB?: boolean
  shortToSupplyA?: boolean
  shortToSupplyB?: boolean
  openLoadA?: boolean
  openLoadB?: boolean
  /** The highest temperature threshold passed, °C, or 0 for below 120 °C */
  tempAbove?: number
  setCurrentMa?: number
  currentMa?: number
  stealthChop?: boolean
  standstill?: boolean
  /** Restarted since Mural booted (and lost its settings), e.g. after a motor supply dip */
  restarted?: boolean
  driverError?: boolean
  chargePumpUndervoltage?: boolean
  microsteps?: number
  expectedMicrosteps?: number
}

export type ServoAction = 'up' | 'down' | 'angle' | 'nudge' | 'release' | 'cycle' | 'stop'
