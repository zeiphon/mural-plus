import { PEN_BOOT_HOLDOFF_MS, PEN_SETTLE_MS } from './constants'
import type { EventLog } from './log'

// src/plus/plus_pen.cpp: a ramped hobby servo with soft limits. Everything is
// what was commanded; a real servo gives no feedback.

export interface PenSettings {
  upAngle: number
  downAngle: number // -1 = not calibrated
  minAngle: number
  maxAngle: number
  speedDegPerSec: number
  releaseWhenUp: boolean
}

export const DEFAULT_PEN_SETTINGS: PenSettings = {
  upAngle: 80,
  downAngle: -1,
  minAngle: 20,
  maxAngle: 180,
  speedDegPerSec: 90,
  releaseWhenUp: false,
}

export type PenPosition = 'unknown' | 'up' | 'down' | 'other'

const clampTo = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export class Pen {
  settings: PenSettings
  current: number
  target: number
  position: PenPosition = 'up'
  busy = true
  attached = false
  positionKnown = false
  upBaseline = -1
  downBaseline = -1
  moveCount = 0
  lastMoveFrom = -1
  lastMoveTo = -1
  lastMoveMs = 0
  cycleRemaining = 0

  private pendingMove = true
  private ramping = false
  private settleUntil = 0
  private holdOffUntil: number
  private moveInProgress = false
  private moveFrom = -1
  private moveStart = 0
  private log: EventLog
  private save: (s: PenSettings) => void

  constructor(settings: PenSettings, now: number, log: EventLog, save: (s: PenSettings) => void) {
    this.settings = { ...settings }
    this.log = log
    this.save = save
    this.target = this.clamp(settings.upAngle)
    this.current = this.target
    this.holdOffUntil = now + PEN_BOOT_HOLDOFF_MS
    log.print(
      `Pen: up=${settings.upAngle} down=${settings.downAngle} limits=${settings.minAngle}..${settings.maxAngle} speed=${settings.speedDegPerSec} deg/s releaseWhenUp=${settings.releaseWhenUp ? 1 : 0}`,
    )
  }

  isCalibrated() {
    return this.settings.downAngle >= 0
  }
  isUp() {
    return this.position === 'up' && !this.busy
  }
  isDown() {
    return this.position === 'down'
  }
  /** -1 if lower angles are towards the wall (v2), else 1. */
  towardsWall() {
    return this.isCalibrated() && this.settings.downAngle > this.settings.upAngle ? 1 : -1
  }

  clamp(angle: number) {
    return clampTo(angle, this.settings.minAngle, this.settings.maxAngle)
  }

  private setTarget(angle: number, position: PenPosition) {
    const clamped = this.clamp(angle)
    if (clamped !== angle) {
      this.log.print(`Pen: ${angle} deg clamped to ${clamped} (limits ${this.settings.minAngle}..${this.settings.maxAngle})`)
    }
    this.target = clamped
    this.position = position
    this.busy = true
    this.pendingMove = true
  }

  moveTo(angle: number) {
    this.setTarget(angle, 'other')
  }
  up() {
    this.setTarget(this.settings.upAngle, 'up')
  }
  down() {
    if (!this.isCalibrated()) {
      this.log.print("Pen: down requested but the pen isn't calibrated, ignoring")
      return
    }
    this.setTarget(this.settings.downAngle, 'down')
  }

  /** PlusPen::adjust. Returns the new angle (unchanged at a limit; -1 for down when not calibrated). */
  adjust(which: 'up' | 'down', steps: number): number {
    const wall = this.towardsWall()
    if (which === 'down') {
      if (!this.isCalibrated()) return -1
      const base = this.settings.downAngle
      const up = this.settings.upAngle
      let next = this.clamp(base + wall * steps)
      if (wall < 0 && next >= up) next = base < up - 1 ? up - 1 : base
      if (wall > 0 && next <= up) next = base > up + 1 ? up + 1 : base
      if (next !== base) this.applyAngle('down', next)
      return next
    }
    const base = this.settings.upAngle
    let next = this.clamp(base - wall * steps)
    if (this.isCalibrated()) {
      const down = this.settings.downAngle
      if (wall < 0 && next <= down) next = base > down + 1 ? down + 1 : base
      if (wall > 0 && next >= down) next = base < down - 1 ? down - 1 : base
    }
    if (next !== base) this.applyAngle('up', next)
    return next
  }

  private applyAngle(which: 'up' | 'down', angle: number) {
    if (which === 'up') {
      if (this.upBaseline < 0) this.upBaseline = this.settings.upAngle
      this.log.print(`Pen: up angle ${this.settings.upAngle} -> ${angle} deg`)
      this.settings.upAngle = angle
      if (this.position === 'up') this.setTarget(angle, 'up')
    } else {
      if (this.downBaseline < 0) this.downBaseline = this.settings.downAngle
      this.log.print(`Pen: down angle ${this.settings.downAngle} -> ${angle} deg`)
      this.settings.downAngle = angle
      if (this.position === 'down') this.setTarget(angle, 'down')
    }
  }

  /** Saves adjustments made since the last save. Not while drawing. */
  saveAdjustments() {
    if (this.upBaseline >= 0 || this.downBaseline >= 0) {
      this.persist()
      this.log.print(`Pen: adjusted angles saved (up ${this.settings.upAngle}, down ${this.settings.downAngle} deg)`)
    }
  }

  private persist() {
    this.save({ ...this.settings })
    this.upBaseline = -1
    this.downBaseline = -1
  }

  setDownAngle(angle: number) {
    this.settings.downAngle = this.clamp(angle)
    if (this.settings.downAngle === this.settings.upAngle) {
      this.log.print(`Pen: warning, down angle ${this.settings.downAngle} is the same as the up angle`)
    }
    this.persist()
    this.log.print(`Pen: down angle calibrated to ${this.settings.downAngle} deg`)
  }

  clearCalibration() {
    this.settings.downAngle = -1
    this.persist()
    this.up()
    this.log.print('Pen: calibration reset')
  }

  applySettings(s: PenSettings) {
    const next = { ...s }
    next.minAngle = clampTo(next.minAngle, 0, 180)
    next.maxAngle = clampTo(next.maxAngle, next.minAngle, 180)
    next.speedDegPerSec = clampTo(next.speedDegPerSec, 5, 600)
    this.settings = next
    this.settings.upAngle = this.clamp(next.upAngle)
    if (this.settings.downAngle >= 0) this.settings.downAngle = this.clamp(next.downAngle)
    this.persist()
    this.log.print(
      `Pen settings saved: up=${this.settings.upAngle} down=${this.settings.downAngle} limits=${this.settings.minAngle}..${this.settings.maxAngle} speed=${this.settings.speedDegPerSec} releaseWhenUp=${this.settings.releaseWhenUp ? 1 : 0}`,
    )
    if (this.position === 'up') this.up()
    else if (this.position === 'down' && this.isCalibrated()) this.down()
    else if (this.target !== this.clamp(this.target)) this.moveTo(this.target)
  }

  release() {
    this.cycleRemaining = 0
    if (this.pendingMove) return // a newer move wins
    this.ramping = false
    this.busy = false
    this.moveInProgress = false
    this.position = 'other'
    if (this.attached) {
      this.attached = false
      this.log.print('Pen: servo released')
    }
  }

  startCycleTest(cycles: number) {
    this.log.print(`Pen: cycle test, ${cycles} times down and up`)
    this.up()
    this.cycleRemaining = cycles * 2
  }

  stopTest() {
    if (this.cycleRemaining > 0) {
      this.cycleRemaining = 0
      this.log.print('Pen: cycle test stopped')
      this.up()
    }
  }

  get pulseUs() {
    return this.attached ? Math.round(544 + (Math.round(this.current) / 180) * (2400 - 544)) : 0
  }

  /** Time until the next thing that changes on its own, for the simulation's steps. */
  timeToEvent(now: number): number {
    if (this.pendingMove) return !this.positionKnown && now < this.holdOffUntil ? this.holdOffUntil - now : 0
    if (this.ramping) return (Math.abs(this.target - this.current) / this.settings.speedDegPerSec) * 1000
    if (this.busy) return Math.max(0, this.settleUntil - now)
    if (this.cycleRemaining > 0) return 0
    return Infinity
  }

  /** PlusPen::update, after `dt` ms of ramping. `now` is the time at the end of the step. */
  update(now: number, dt: number) {
    if (this.pendingMove) {
      if (!this.positionKnown && now < this.holdOffUntil) return
      this.pendingMove = false
      this.busy = true
      if (!this.moveInProgress) {
        this.moveInProgress = true
        this.moveFrom = this.positionKnown ? Math.round(this.current) : -1
        this.moveStart = now
      }
      if (!this.positionKnown) {
        this.log.print(`Pen: first move after boot, going straight to ${this.target} deg`)
        this.current = this.target
        this.attached = true
        this.positionKnown = true
      }
      this.settleUntil = 0
      this.ramping = true
      dt = 0 // the ramp starts now
    }

    if (this.ramping) {
      this.attached = true
      const maxStep = (this.settings.speedDegPerSec * dt) / 1000
      const delta = this.target - this.current
      if (Math.abs(delta) <= maxStep + 1e-9) this.current = this.target
      else this.current += delta > 0 ? maxStep : -maxStep
      if (this.current === this.target) {
        this.ramping = false
        this.settleUntil = now + PEN_SETTLE_MS
      }
      return
    }

    if (this.busy && now >= this.settleUntil) {
      this.busy = false
      if (this.moveInProgress) {
        this.moveInProgress = false
        this.lastMoveFrom = this.moveFrom
        this.lastMoveTo = this.target
        this.lastMoveMs = now - this.moveStart
        this.moveCount++
      }
      if (this.settings.releaseWhenUp && this.position === 'up') this.attached = false
    }

    if (!this.busy && !this.pendingMove && this.cycleRemaining > 0) {
      if (!this.isCalibrated()) {
        this.cycleRemaining = 0
        return
      }
      this.cycleRemaining--
      if (this.position === 'down') this.up()
      else this.down()
      if (this.cycleRemaining === 0) this.log.print('Pen: cycle test finished')
    }
  }
}
