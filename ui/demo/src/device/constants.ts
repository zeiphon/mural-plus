// Firmware constants the simulated device copies. Where each one comes from:

// src/movement.h
export const STEPS_PER_ROTATION = 200 * 8
export const PRINT_SPEED = 650
export const MOVE_SPEED = 2000
export const DEFAULT_DIAMETER = 10.14926
export const MID_PULLEY_TO_WALL = 41
export const HOMED_OFFSET_MM = 40
export const HOME_Y = 350
export const SAFE_X_FRACTION = 0.2
export const SAFE_Y_FRACTION = 0.25

// src/tasks/interpolatingmovementtask.h
export const INCREMENT_MM = 1

// src/plus/controller.cpp
export const PEN_CAL_STEP_MM = 100
export const HOME_TOLERANCE_MM = 0.5
export const DEFAULT_SPEED = 650
export const MIN_SPEED = 300
export const MAX_SPEED = MOVE_SPEED
export const BOOST_LEASE_MS = 600

// src/plus/plus_pen.h
export const PEN_SETTLE_MS = 200
export const PEN_BOOT_HOLDOFF_MS = 2000
export const SERVO_PIN = 21

// src/plus/version.h
export const PRODUCT = 'mural-plus'

// The firmware version the demo shows: the release it was built for.
export const FIRMWARE_VERSION: string = __MURAL_VERSION__
export const BUILT: string = __MURAL_BUILT__

/** Steps per mm of belt for a pulley diameter. */
export function stepsPerMm(diameter: number): number {
  return STEPS_PER_ROTATION / (Math.PI * diameter)
}
