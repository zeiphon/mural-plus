import { distance, type Point } from './kinematics'
import type { EventLog } from './log'
import { MovementError, type Movement } from './movement'
import type { Pen } from './pen'

// src/plus/plus_runner.cpp: draws the command file one line at a time. Pause
// and stop let the current ≤1 mm increment or pen move finish, then lift the pen.

export type Outcome = 'none' | 'finished' | 'stopped' | 'failed'

interface PenTask {
  kind: 'pen'
  up: boolean
}
interface MoveTask {
  kind: 'move'
  target: Point
  speed: number
}
type Task = PenTask | MoveTask

export interface RunnerHooks {
  /** Diagnostics setting: log every move */
  logMoves: () => boolean
  /** Demo fault: make the next move fail */
  takeInjectedFailure: () => string | null
  /** Ends upstream's classic run: restart the board */
  onFinishedSequence?: () => void
}

export class Runner {
  stopped = true
  speed = 650
  totalDistance = 0
  distanceSoFar = 0
  progressRaw = -1
  lastOutcome: Outcome = 'none'
  lastError = ''
  /** Index of the line being drawn, for the device panel */
  line = 0

  private lines: string[] = []
  private current: Task | null = null
  private finishing: Task[] = []
  private startPosition: Point = { x: 0, y: 0 }
  private targetPosition: Point = { x: 0, y: 0 }
  private pauseRequested = false
  private resumeRequested = false
  private stopRequested = false
  private paused = false
  private resuming = false
  private penWasDown = false
  private startMs = 0
  private pauseStartMs = 0
  private pausedTotalMs = 0
  private finishedElapsedMs = 0
  private movement: Movement
  private pen: Pen
  private log: EventLog
  private clock: () => number
  private hooks: RunnerHooks
  /** Classic mode: no pause, and the finishing sequence is "go home" only */
  private classic: boolean

  constructor(movement: Movement, pen: Pen, log: EventLog, clock: () => number, hooks: RunnerHooks, classic = false) {
    this.movement = movement
    this.pen = pen
    this.log = log
    this.clock = clock
    this.hooks = hooks
    this.classic = classic
  }

  get progress() {
    return this.progressRaw < 0 ? 0 : this.progressRaw
  }

  isRunning() {
    return !this.stopped
  }

  stateName(): 'idle' | 'drawing' | 'pausing' | 'paused' | 'resuming' | 'stopping' {
    if (this.stopped) return 'idle'
    if (this.stopRequested) return 'stopping'
    if (this.paused) return this.resumeRequested ? 'resuming' : 'paused'
    if (this.pauseRequested) return 'pausing'
    if (this.resuming) return 'resuming'
    return 'drawing'
  }

  elapsedMs() {
    if (this.stopped) return this.finishedElapsedMs
    const now = this.clock()
    const pausedNow = this.paused ? now - this.pauseStartMs : 0
    return now - this.startMs - this.pausedTotalMs - pausedNow
  }

  /** Throws with a readable message if the file can't be read. */
  start(file: string | null, speed: number) {
    if (!file) throw new Error('No drawing on the SD card')
    const lines = file.split('\n')
    const header = (i: number, letter: string) => {
      const line = (lines[i] ?? '').trim()
      if (line.length < 2 || line[0] !== letter) return null
      const n = parseFloat(line.slice(1))
      return Number.isFinite(n) ? n : null
    }
    const total = header(0, 'd')
    if (total === null || header(1, 'h') === null) {
      throw new Error('The drawing file is damaged, choose it again')
    }
    this.lines = lines
    this.line = 2
    this.totalDistance = total
    this.speed = speed
    this.distanceSoFar = 0
    this.progressRaw = -1
    this.startPosition = this.movement.coordinates()
    this.targetPosition = this.startPosition
    const home = this.movement.homeCoordinates()
    this.finishing = this.classic
      ? [{ kind: 'move', target: home, speed }]
      : [
          { kind: 'pen', up: true },
          { kind: 'move', target: home, speed },
        ]
    this.pauseRequested = this.resumeRequested = this.stopRequested = false
    this.paused = this.resuming = this.penWasDown = false
    this.pausedTotalMs = 0
    this.lastOutcome = 'none'
    this.lastError = ''
    this.log.print(`Total distance to travel: ${total.toFixed(1)} mm`)
    this.startMs = this.clock()
    this.stopped = false
    this.current = this.nextTask()
    if (this.current) {
      try {
        this.startTask(this.current)
      } catch (e) {
        this.fail(e instanceof Error ? e.message : String(e))
      }
    } else if (!this.stopped) {
      this.finishRun('finished')
    }
  }

  requestPause() {
    if (!this.stopped && !this.paused) {
      this.resumeRequested = false
      this.pauseRequested = true
    }
  }
  requestResume() {
    if (!this.stopped && (this.paused || this.pauseRequested)) this.resumeRequested = true
  }
  requestStop() {
    if (!this.stopped) this.stopRequested = true
  }

  private nextTask(): Task | null {
    while (this.line < this.lines.length) {
      const line = this.lines[this.line++].trim()
      if (line.length === 0) continue
      const logMoves = this.hooks.logMoves()
      if (line === 'p1') {
        if (logMoves) this.log.print('Pen down')
        return { kind: 'pen', up: false }
      }
      if (line === 'p0') {
        if (logMoves) this.log.print('Pen up')
        return { kind: 'pen', up: true }
      }
      const space = line.indexOf(' ')
      const first = line[0]
      if (space > 0 && (/[0-9]/.test(first) || first === '-' || first === '.')) {
        const x = parseFloat(line.slice(0, space))
        const y = parseFloat(line.slice(space + 1))
        this.targetPosition = { x, y }
        if (logMoves) this.log.print(`Move to ${x.toFixed(1)}, ${y.toFixed(1)}`)
        return { kind: 'move', target: this.targetPosition, speed: this.speed }
      }
      this.fail(`Unknown line in the drawing file: ${line.slice(0, 40)}`)
      return null
    }
    return this.finishing.shift() ?? null
  }

  private startTask(task: Task) {
    if (task.kind === 'pen') {
      if (task.up) this.pen.up()
      else this.pen.down()
      return
    }
    this.increment(task)
  }

  private increment(task: MoveTask) {
    const failure = this.hooks.takeInjectedFailure()
    if (failure) {
      // As the firmware does: the coordinates are set before they're checked
      this.movement.x = task.target.x
      this.movement.y = task.target.y
      throw new MovementError(failure)
    }
    const next = this.movement.nextIncrement(task.target)
    this.movement.beginLinearTravel(next.x, next.y, task.speed)
  }

  private taskDone(task: Task): boolean {
    if (task.kind === 'pen') return !this.pen.busy
    if (this.movement.isMoving()) return false
    const here = this.movement.coordinates()
    if (here.x === task.target.x && here.y === task.target.y) return true
    this.increment(task)
    return false
  }

  private fail(message: string) {
    this.lastError = message
    this.log.print(`Drawing failed: ${message}`)
    this.finishRun('failed')
  }

  private finishRun(outcome: Outcome) {
    this.finishedElapsedMs = this.elapsedMs()
    this.current = null
    this.finishing = []
    this.pauseRequested = this.resumeRequested = this.stopRequested = false
    this.paused = this.resuming = false
    this.lastOutcome = outcome
    this.stopped = true
    const s = Math.floor(this.finishedElapsedMs / 1000)
    this.log.print(`Drawing ${outcome} at ${this.progress}% after ${Math.floor(s / 60)}m ${s % 60}s`)
  }

  /** PlusRunner::run, once per simulation step. */
  run() {
    if (this.stopped) return

    if (!this.classic && (this.pauseRequested || this.stopRequested)) {
      if (!this.paused) {
        if (this.movement.isMoving() || this.pen.busy) return
        this.paused = true
        this.pauseRequested = true
        this.pauseStartMs = this.clock()
        this.penWasDown = this.pen.isDown()
        if (this.penWasDown) this.pen.up()
        this.log.print(`Drawing paused at ${this.progress}%${this.penWasDown ? ' (pen lifted)' : ''}`)
      }
      if (this.stopRequested) {
        if (!this.pen.busy) this.finishRun('stopped')
        return
      }
      if (!this.resumeRequested) return
      this.pausedTotalMs += this.clock() - this.pauseStartMs
      this.paused = false
      this.pauseRequested = false
      this.resumeRequested = false
      if (this.penWasDown) {
        this.pen.down()
        this.resuming = true
      }
      this.log.print('Drawing resumed')
      return
    }

    if (this.resuming) {
      if (this.pen.busy) return
      this.resuming = false
    }

    try {
      this.advance()
    } catch (e) {
      this.fail(e instanceof Error ? e.message : String(e))
    }
  }

  private advance() {
    const task = this.current
    if (!task || !this.taskDone(task)) return
    if (task.kind === 'move') {
      this.distanceSoFar += distance(this.startPosition, this.targetPosition)
      this.startPosition = this.targetPosition
      let progress = this.totalDistance > 0 ? Math.floor((this.distanceSoFar / this.totalDistance) * 100) : 100
      if (progress > 100) progress = 100
      if (progress !== this.progressRaw) {
        this.progressRaw = progress
        this.log.print(`Progress: ${progress}%`)
      }
    }
    this.current = null
    const wasLast = this.line >= this.lines.length && this.finishing.length === 0
    const next = this.nextTask()
    if (this.stopped) return
    this.current = next
    if (next) {
      this.startTask(next)
    } else {
      this.finishRun('finished')
      if (wasLast) this.hooks.onFinishedSequence?.()
    }
  }
}
