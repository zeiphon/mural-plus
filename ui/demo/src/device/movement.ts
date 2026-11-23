import { HOMED_OFFSET_MM, INCREMENT_MM, MOVE_SPEED, PRINT_SPEED, stepsPerMm } from './constants'
import { beltLengths, distance, drawingWidth, homePoint, type Belts, type Point } from './kinematics'

// src/movement.cpp. Two things are tracked separately:
// - the physical belts (how long each one really is), which the device panel draws;
// - the firmware's idea of the pen position (X/Y), which it only knows after homing.
// They agree unless the belts are moved by hand.

export class MovementError extends Error {}

export interface Motor {
  /** Belt length, pin to pulley, mm */
  belt: number
  /** The stepper's step count (AccelStepper::currentPosition) */
  steps: number
  /** Steps per second right now; negative while retracting */
  speed: number
  /** Retracting against the homing screw: the motor turns no further */
  stalled: boolean
  /** Manual move: -1 retracting, 1 extending, 0 stopped */
  manual: number
  manualSpeed: number
  /** Where a positioned move is taking the step count */
  stepsToGo: number
}

interface Move {
  from: Belts
  to: Belts
  duration: number // ms
  elapsed: number
}

const newMotor = (belt: number): Motor => ({
  belt,
  steps: 0,
  speed: 0,
  stalled: false,
  manual: 0,
  manualSpeed: 0,
  stepsToGo: 0,
})

export class Movement {
  topDistance = -1
  diameter: number
  homed = false
  startedHoming = false
  /** The firmware's X/Y, -1 until a move sets them */
  x = -1
  y = -1
  left: Motor
  right: Motor
  private move: Move | null = null

  constructor(diameter: number, belts: Belts) {
    this.diameter = diameter
    this.left = newMotor(belts.left)
    this.right = newMotor(belts.right)
  }

  get width() {
    return drawingWidth(this.topDistance)
  }

  get stepsPerMm() {
    return stepsPerMm(this.diameter)
  }

  isMoving() {
    return this.move !== null || this.left.manual !== 0 || this.right.manual !== 0
  }

  setTopDistance(distance: number) {
    this.topDistance = distance
  }

  setPulleyDiameter(diameter: number) {
    this.diameter = diameter
  }

  homeCoordinates(): Point {
    return homePoint(this.topDistance)
  }

  /** Movement::getCoordinates */
  coordinates(): Point {
    if (this.x === -1 || this.y === -1 || this.isMoving()) throw new MovementError('not ready')
    return { x: this.x, y: this.y }
  }

  /** Movement::beginLinearTravel. Returns the move time in seconds. */
  beginLinearTravel(x: number, y: number, speed: number): number {
    this.x = x
    this.y = y
    if (this.topDistance === -1 || !this.homed) throw new MovementError('not ready')
    if (x < 0 || x - 1 > this.width) throw new MovementError('Invalid x')
    if (y < 0) throw new MovementError('Invalid y')
    const target = beltLengths({ x, y }, this.topDistance)
    return this.startMove(target, speed)
  }

  /** Movement::extendToHome: the belts are now at the homing screws, then extend to home. */
  extendToHome(): number {
    // setOrigin. The firmware assumes the belts were retracted; the demo makes it so.
    const spm = this.stepsPerMm
    for (const m of [this.left, this.right]) {
      m.belt = HOMED_OFFSET_MM
      m.steps = Math.trunc(HOMED_OFFSET_MM * spm)
      m.stalled = false
      m.manual = 0
    }
    this.homed = true
    this.startedHoming = true
    const home = this.homeCoordinates()
    return Math.ceil(this.beginLinearTravel(home.x, home.y, MOVE_SPEED))
  }

  /** Movement::extendBelts, for e-steps calibration: both belts by the same length. */
  extendBelts(mm: number) {
    this.startMove({ left: this.left.belt + mm, right: this.right.belt + mm }, MOVE_SPEED)
  }

  /** Manual belt moves: dir -1 retracts, 1 extends, 0 stops. */
  manual(left: boolean, dir: number, speed = PRINT_SPEED) {
    const m = left ? this.left : this.right
    m.manual = dir
    m.manualSpeed = dir === 0 ? 0 : speed
    if (dir >= 0) m.stalled = false
  }

  private startMove(target: Belts, speed: number): number {
    const spm = this.stepsPerMm
    const dl = Math.abs(target.left - this.left.belt) * spm
    const dr = Math.abs(target.right - this.right.belt) * spm
    const seconds = Math.max(dl, dr) / speed
    this.left.manual = this.right.manual = 0
    this.move = {
      from: { left: this.left.belt, right: this.right.belt },
      to: target,
      duration: seconds * 1000,
      elapsed: 0,
    }
    this.left.stepsToGo = Math.round((target.left - this.left.belt) * spm)
    this.right.stepsToGo = Math.round((target.right - this.right.belt) * spm)
    return seconds
  }

  /** Time until the current move ends, or a retracting belt reaches its screw. */
  timeToEvent(): number {
    if (this.move) return Math.max(0, this.move.duration - this.move.elapsed)
    let t = Infinity
    const spm = this.stepsPerMm
    for (const m of [this.left, this.right]) {
      if (m.manual < 0 && !m.stalled) t = Math.min(t, (Math.max(0, m.belt - HOMED_OFFSET_MM) * spm * 1000) / m.manualSpeed)
    }
    return t
  }

  /** Runs the motors for dt ms. */
  advance(dt: number) {
    const spm = this.stepsPerMm
    if (this.move) {
      const mv = this.move
      mv.elapsed += dt
      const t = mv.duration <= 0 ? 1 : Math.min(1, mv.elapsed / mv.duration)
      for (const [m, from, to] of [
        [this.left, mv.from.left, mv.to.left],
        [this.right, mv.from.right, mv.to.right],
      ] as const) {
        const before = m.belt
        m.belt = from + (to - from) * t
        m.steps += (m.belt - before) * spm
        m.speed = dt > 0 ? ((m.belt - before) * spm * 1000) / dt : m.speed
        m.stepsToGo = Math.round((to - m.belt) * spm)
      }
      if (t >= 1 - 1e-9) {
        this.move = null
        this.left.speed = this.right.speed = 0
        this.left.stepsToGo = this.right.stepsToGo = 0
      }
      return
    }
    for (const m of [this.left, this.right]) {
      if (m.manual === 0) {
        m.speed = 0
        continue
      }
      const stepsMoved = (m.manual * m.manualSpeed * dt) / 1000
      m.steps += stepsMoved
      m.speed = m.manual * m.manualSpeed
      if (m.manual < 0) {
        const next = m.belt + stepsMoved / spm
        if (next <= HOMED_OFFSET_MM + 1e-6) {
          m.belt = HOMED_OFFSET_MM
          m.stalled = true // the loop is at the screw; the motor skips
        } else {
          m.belt = next
        }
      } else {
        m.belt = Math.min(6000, m.belt + stepsMoved / spm)
      }
    }
  }

  /** The firmware's ≤1 mm increments towards a target (InterpolatingMovementTask). */
  nextIncrement(target: Point): Point {
    const here = this.coordinates()
    const d = distance(here, target)
    if (d <= INCREMENT_MM) return target
    return {
      x: here.x + (INCREMENT_MM / d) * (target.x - here.x),
      y: here.y + (INCREMENT_MM / d) * (target.y - here.y),
    }
  }

  stopAll() {
    this.move = null
    for (const m of [this.left, this.right]) {
      m.manual = 0
      m.speed = 0
      m.stepsToGo = 0
    }
  }
}
