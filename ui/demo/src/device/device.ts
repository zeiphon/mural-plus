import type { BackendState, Phase } from '../../../src/types'
import type { Diagnostics, MotorDriver, OtaStatus, PlusState } from '../../../src/plus/types'
import {
  BOOST_LEASE_MS,
  BUILT,
  DEFAULT_SPEED,
  FIRMWARE_VERSION,
  HOME_TOLERANCE_MM,
  MAX_SPEED,
  MIN_SPEED,
  MOVE_SPEED,
  PEN_CAL_STEP_MM,
  PRINT_SPEED,
  PRODUCT,
  SAFE_X_FRACTION,
  SAFE_Y_FRACTION,
  SERVO_PIN,
} from './constants'
import { distance, frameToImage, hangingPoint, type Point } from './kinematics'
import { EventLog } from './log'
import { Movement, MovementError } from './movement'
import { Pen, type PenSettings } from './pen'
import * as persist from './persist'
import { Runner } from './runner'
import { sampleDrawing } from './sample'

// The simulated Mural. It answers the same routes as the firmware (src/plus/,
// and src/main.cpp in classic mode), with the same rules, and runs its own
// clock so belts, motors and the pen move as they would on a real one.

export interface DemoRequest {
  method: string
  path: string
  /** Query string and form fields together, as AsyncWebServerRequest::arg sees them */
  params: Record<string, string>
  /** An uploaded file part */
  file?: { field: string; name: string; size: number; text: string | null }
}

export interface DemoResponse {
  status: number
  contentType: string
  body: string
}

export class DeviceUnreachable extends Error {}

export type OfflineReason = 'restarting' | 'wifi' | 'drawing' | null

export interface RequestRecord {
  id: number
  at: number
  method: string
  path: string
  params: Record<string, string>
  fileSize?: number
  /** HTTP status, or 0 if Mural didn't answer */
  status: number
  body: string
  contentType: string
  ms: number
  poll: boolean
}

export interface Faults {
  overheat: boolean
  failNextMove: boolean
}

/** The routes the firmware serves. Anything else goes to the network as usual. */
export const DEVICE_ROUTES = new Set([
  '/getState',
  '/setTopDistance',
  '/setPulleyDiameter',
  '/command',
  '/extendToHome',
  '/setServo',
  '/setPenDistance',
  '/estepsCalibration',
  '/run',
  '/resume',
  '/doneWithPhase',
  '/downloadCommands',
  '/uploadCommands',
  '/goHome',
  '/penUp',
  '/penDown',
  '/resetPen',
  '/pauseDrawing',
  '/resumeDrawing',
  '/stopDrawing',
  '/setDrawingSpeed',
  '/adjustPen',
  '/penSettings',
  '/retractBoost',
  '/settings',
  '/plus/mode',
  '/diagnostics',
  '/log',
  '/servo',
  '/ota/status',
  '/ota/dismiss',
  '/ota/ui',
  '/ota/firmware',
  '/ota/installUi',
  '/recovery',
])

const POLLS = new Set(['/getState', '/diagnostics', '/log'])

/** The hanger distance the panel draws before one is set */
export const NOMINAL_DISTANCE = 1500

const SD_TOTAL = 31_914_983_424
const SD_BASE_USED = 3_276_800
const UI_TOTAL = 1_441_792
const UI_USED = 811_008
const NOT_IN_DEMO = "Updates aren't available in the demo"

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const realNow = () => performance.now()
const truthy = (v: string | undefined) => v === '1' || v === 'true'
const toInt = (v: string | undefined) => {
  const n = parseInt(v ?? '', 10)
  return Number.isFinite(n) ? n : 0
}

const text = (status: number, body: string): DemoResponse => ({ status, contentType: 'text/plain', body })
const json = (value: unknown): DemoResponse => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(value),
})

export class Device {
  // Clock: simulated milliseconds since boot, sped up by `speed`
  now = 0
  speed = 1
  saved: persist.Saved
  log: EventLog
  movement!: Movement
  pen!: Pen
  runner!: Runner
  faults: Faults = { overheat: false, failNextMove: false }

  // The drawing on the SD card
  drawing: string | null

  // Plus controller state (src/plus/controller.h)
  positionKnown = false
  homing = false
  positionedMove = false
  goHomePending = false
  pendingStartSpeed = 0
  startError = ''
  leftDir = 0
  rightDir = 0
  leftBoosted = false
  rightBoosted = false
  private boostUntil = 0 // real time
  private wasDrawing = false
  serverStopped = false

  // Classic mode (src/phases/)
  phase: Phase = 'SetTopDistance'

  // Network
  private offlineUntil = 0 // real time
  private offlineKind: OfflineReason = null
  private restartAt = 0 // real time: when it goes off, 0 = none
  private bootAt = 0 // real time: when it comes back, 0 = it's on
  private restartReason = ''
  private restartKeepsLog = true

  // Upload in progress
  private upload: string | null = null

  // What the panel draws: the pen's trail and the drawing's planned strokes, in image coordinates
  trail: Point[][] = []
  trailEpoch = 0
  private strokeOpen = false
  plan: Point[][] = []
  planVersion = 0
  private planHeight = 0

  private requestId = 0
  private requestListeners = new Set<(r: RequestRecord) => void>()
  private timer: ReturnType<typeof setInterval> | null = null
  private lastTick = realNow()
  private bootedAt = Date.now()

  constructor() {
    this.saved = persist.load()
    this.drawing = persist.loadDrawing()
    this.log = new EventLog(() => this.now)
    this.boot('Power on', false)
  }

  // ---------------------------------------------------------------------------
  // Lifecycle

  start() {
    if (this.timer) return
    this.lastTick = realNow()
    this.timer = setInterval(() => this.tick(), 16)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  get mode() {
    return this.saved.mode
  }

  private boot(reason: string, keepLog: boolean) {
    const s = this.saved
    s.bootCount++
    s.resetHistory = [reason, ...s.resetHistory].slice(0, 8)
    this.now = 0
    this.bootedAt = Date.now()
    this.log.begin(reason, keepLog)
    this.log.print(`Firmware ${FIRMWARE_VERSION} (built ${BUILT})`)

    const belts = s.belts ?? { left: 250, right: 250 } // first power-on: not hanging yet
    this.movement = new Movement(s.pulleyDiameter, belts)
    this.positionKnown = this.homing = this.positionedMove = this.goHomePending = false
    this.pendingStartSpeed = 0
    this.startError = ''
    this.leftDir = this.rightDir = 0
    this.leftBoosted = this.rightBoosted = false
    this.wasDrawing = false
    this.serverStopped = false
    this.upload = null
    this.strokeOpen = false

    const hooks = {
      logMoves: () => this.saved.logDrawingMoves,
      takeInjectedFailure: () => {
        if (!this.faults.failNextMove) return null
        this.faults.failNextMove = false
        return 'Invalid y'
      },
    }

    if (s.mode === 'classic') {
      this.log.print('Classic mode (upstream phases)')
      // Upstream's Pen: up is 90°, no soft limits, no saved settings
      const classicPen: PenSettings = { ...s.pen, upAngle: 90, downAngle: -1, minAngle: 0, maxAngle: 180, speedDegPerSec: 90 }
      this.pen = new Pen(classicPen, this.now, this.log, () => {})
      this.runner = new Runner(this.movement, this.pen, this.log, () => this.now, {
        ...hooks,
        onFinishedSequence: () => this.restart('Software restart', true),
      }, true)
      this.phase = 'SetTopDistance'
    } else {
      this.log.print('Mural Plus mode')
      this.log.print(`Boot #${s.bootCount}, reset reason: ${reason}`)
      if (reason.startsWith('Brownout')) {
        this.log.print("WARNING: the last restart was a brownout. Check the power supply and the servo's current draw.")
      }
      this.pen = new Pen(s.pen, this.now, this.log, (p) => {
        this.saved.pen = p
        this.persistNow()
      })
      this.runner = new Runner(this.movement, this.pen, this.log, () => this.now, hooks)
      if (s.topDistance > 0) this.movement.setTopDistance(s.topDistance)
      if (this.drawing !== null && s.drawingTopDistance > 0 && s.drawingSize === this.drawing.length) {
        this.log.print(`Drawing on the SD card is for a ${s.drawingTopDistance} mm hanger distance`)
      } else if (s.drawingTopDistance > 0) {
        this.log.print('Drawing on the SD card has changed or gone, choose it again')
        s.drawingTopDistance = -1
      }
    }
    this.updatePlan()
    this.log.print('Server started')
    this.persistNow()
  }

  /** Restart Mural: it stops answering for a few seconds, then boots again. */
  restart(reason: string, keepLog: boolean, delayMs = 500) {
    this.restartAt = realNow() + delayMs
    this.restartReason = reason
    this.restartKeepsLog = keepLog
  }

  /** The demo's Reset: a new Mural, as from the box. */
  factoryReset() {
    persist.clearAll()
    this.saved = persist.defaults()
    this.drawing = null
    this.faults = { overheat: false, failNextMove: false }
    this.offlineUntil = 0
    this.restartAt = 0
    this.bootAt = 0
    this.trail = []
    this.trailEpoch++
    this.log.clear()
    this.boot('Power on', false)
  }

  /** The supply dips (often the servo's fault): Mural restarts at once and forgets where it is. */
  brownout() {
    this.log.print('Supply voltage dropped')
    this.restart('Brownout (supply voltage dropped)', true, 0)
  }

  /** Lose WiFi for a while. */
  dropWifi(ms: number) {
    this.offlineUntil = realNow() + ms
    this.offlineKind = 'wifi'
    this.log.print('WiFi disconnected')
  }

  /** The panel's "Skip setup": distance, belts, pen and a drawing, as if done by hand. */
  quickSetup() {
    if (this.mode !== 'plus' || this.isDrawing() || this.movement.isMoving()) return false
    const d = this.saved.topDistance > 0 ? this.saved.topDistance : NOMINAL_DISTANCE
    this.movement.setTopDistance(d)
    this.saved.topDistance = d
    this.movement.stopAll()
    this.movement.extendToHome()
    this.positionKnown = false
    this.homing = true
    this.positionedMove = true
    if (!this.pen.isCalibrated()) this.pen.setDownAngle(40)
    this.pen.up()
    this.storeDrawing(sampleDrawing(d), d)
    this.log.print('Demo: set up with a sample drawing')
    this.persistNow()
    return true
  }

  setSpeed(speed: number) {
    this.speed = speed
  }

  /** Whether Mural answers requests right now, and if not, why. */
  offline(): OfflineReason {
    const t = realNow()
    if (this.bootAt) return 'restarting'
    if (t < this.offlineUntil) return this.offlineKind
    if (this.serverStopped) return 'drawing'
    if (this.mode === 'classic' && this.runner.isRunning()) return 'drawing'
    return null
  }

  private tick() {
    const t = realNow()
    const dt = Math.min(250, t - this.lastTick)
    this.lastTick = t
    if (this.bootAt) {
      // Off: nothing moves until it has booted
      if (t >= this.bootAt) {
        this.bootAt = 0
        this.boot(this.restartReason, this.restartKeepsLog)
      }
      return
    }
    if (this.restartAt && t >= this.restartAt) {
      this.restartAt = 0
      this.movement.stopAll()
      this.saved.belts = { left: this.movement.left.belt, right: this.movement.right.belt }
      this.bootAt = t + 3000
      return
    }
    this.advance(dt * this.speed)
  }

  // ---------------------------------------------------------------------------
  // Simulation

  private advance(total: number) {
    let left = total
    let guard = 0
    while (left > 1e-6 && guard++ < 50000) {
      const active = this.movement.isMoving() || this.pen.busy || this.runner.isRunning() || this.pen.cycleRemaining > 0
      const dt = Math.min(left, active ? 50 : left, this.movement.timeToEvent(), this.pen.timeToEvent(this.now))
      this.movement.advance(dt)
      this.now += dt
      this.pen.update(this.now, dt)
      this.recordTrail()
      this.loop()
      left -= dt
    }
    if (guard >= 50000) this.now += left
  }

  private loop() {
    if (this.mode === 'classic') {
      if (this.phase === 'ExtendToHome' && this.movement.startedHoming && !this.movement.isMoving()) {
        this.setPhase('PenCalibration')
      }
      this.runner.run()
      return
    }
    this.runner.run()
    this.controllerLoop()
  }

  /** Controller::loop */
  private controllerLoop() {
    this.updateManualBelts()

    if (this.positionedMove && !this.movement.isMoving()) {
      this.positionedMove = false
      if (this.homing) {
        this.homing = false
        this.positionKnown = true
        this.log.print('At home position, belt position known')
      }
    }

    if (this.pendingStartSpeed > 0 || this.goHomePending) {
      if (!this.pen.isUp()) {
        if (!this.pen.busy) this.pen.up()
        return
      }
      if (this.goHomePending) {
        this.goHomePending = false
        try {
          const home = this.movement.homeCoordinates()
          this.movement.beginLinearTravel(home.x, home.y, MOVE_SPEED)
          this.positionedMove = true
          this.log.print('Returning home')
        } catch (e) {
          this.positionKnown = false
          this.log.print(`Return home failed: ${(e as Error).message}`)
        }
      }
      const speed = this.pendingStartSpeed
      if (speed > 0) {
        try {
          this.trail = []
          this.trailEpoch++
          this.runner.start(this.drawing, speed)
          this.log.print(`Drawing started at speed ${speed}`)
          if (this.runner.isRunning() && !this.saved.webWhileDrawing) {
            this.log.print('Stopping the web server while drawing (Settings)')
            this.serverStopped = true
          }
        } catch (e) {
          this.startError = (e as Error).message
          this.log.print(`Failed to start drawing: ${this.startError}`)
        }
        this.pendingStartSpeed = 0
      }
    }

    const drawing = this.runner.isRunning()
    if (this.wasDrawing && !drawing) {
      if (this.runner.lastOutcome === 'failed') this.positionKnown = false
      if (this.serverStopped) {
        this.serverStopped = false
        this.log.print('Web server started again')
      }
    }
    this.wasDrawing = drawing
    if (!drawing) this.pen.saveAdjustments()
  }

  /** Controller::updateManualBelts */
  private updateManualBelts() {
    if (this.isDrawing() || this.positionedMove || this.goHomePending) {
      this.leftDir = this.rightDir = 0
      this.leftBoosted = this.rightBoosted = false
      return
    }
    const boost = realNow() < this.boostUntil
    for (const left of [true, false]) {
      const dir = left ? this.leftDir : this.rightDir
      const boosted = boost && dir < 0
      const was = left ? this.leftBoosted : this.rightBoosted
      const motor = left ? this.movement.left : this.movement.right
      const speed = boosted ? MOVE_SPEED : PRINT_SPEED
      if (boosted !== was) {
        this.log.print(`${left ? 'Left' : 'Right'} belt: retracting ${boosted ? 'faster' : 'at normal speed'}`)
      }
      if (left) this.leftBoosted = boosted
      else this.rightBoosted = boosted
      if (motor.manual !== dir || motor.manualSpeed !== (dir === 0 ? 0 : speed)) this.movement.manual(left, dir, speed)
    }
  }

  private recordTrail() {
    const touching = this.runner.isRunning() && this.pen.isDown() && !this.pen.busy
    if (!touching) {
      this.strokeOpen = false
      return
    }
    const p = this.penPoint()
    if (!p) return
    if (!this.strokeOpen) {
      this.trail.push([p])
      this.strokeOpen = true
      return
    }
    const stroke = this.trail[this.trail.length - 1]
    if (distance(stroke[stroke.length - 1], p) >= 0.4) stroke.push(p)
  }

  /** The distance between the pins as the panel draws it */
  get wallDistance() {
    return this.movement.topDistance > 0 ? this.movement.topDistance : NOMINAL_DISTANCE
  }

  /** Where the bot really hangs, in frame coordinates, or null if it isn't hanging. */
  hanging(): Point | null {
    return hangingPoint({ left: this.movement.left.belt, right: this.movement.right.belt }, this.wallDistance)
  }

  /** The pen's real position in image coordinates, or null. */
  penPoint(): Point | null {
    const f = this.hanging()
    return f ? frameToImage(f, this.wallDistance) : null
  }

  private updatePlan() {
    this.plan = parsePlan(this.drawing)
    const h = /^h([0-9.]+)/m.exec(this.drawing?.slice(0, 64) ?? '')
    this.planHeight = h ? parseFloat(h[1]) : 0
    this.planVersion++
  }

  /** The drawing's height in mm (its h header), or 0 if there's none. */
  drawingHeight() {
    return this.planHeight
  }

  private persistNow() {
    this.saved.belts = { left: this.movement.left.belt, right: this.movement.right.belt }
    persist.save(this.saved)
  }

  private storeDrawing(text: string, topDistance: number) {
    this.drawing = text
    this.saved.drawingTopDistance = this.mode === 'plus' ? topDistance : -1
    this.saved.drawingSize = text.length
    persist.saveDrawing(text)
    this.updatePlan()
  }

  // ---------------------------------------------------------------------------
  // Requests

  onRequest(listener: (r: RequestRecord) => void): () => void {
    this.requestListeners.add(listener)
    return () => this.requestListeners.delete(listener)
  }

  /** Answers a request like the firmware's web server. Rejects if Mural can't be reached. */
  async handle(req: DemoRequest): Promise<DemoResponse> {
    const started = realNow()
    const at = Date.now()
    const latency = 25 + Math.random() * 40
    const uploadTime = req.file ? Math.min(1500, req.file.size / 250) : 0 // ~250 KB/s to the SD card
    await sleep(latency / 2 + uploadTime)
    const finish = (res: DemoResponse | null) => {
      this.requestListeners.forEach((l) =>
        l({
          id: ++this.requestId,
          at,
          method: req.method,
          path: req.path,
          params: req.params,
          fileSize: req.file?.size,
          status: res ? res.status : 0,
          body: res ? res.body : '',
          contentType: res ? res.contentType : '',
          ms: Math.round(realNow() - started),
          poll: req.method === 'GET' && POLLS.has(req.path),
        }),
      )
    }
    if (this.offline()) {
      await sleep(400)
      finish(null)
      throw new DeviceUnreachable(`Mural isn't answering (${this.offline()})`)
    }
    let res: DemoResponse
    try {
      res = this.mode === 'classic' ? this.routeClassic(req) : this.routePlus(req)
    } catch (e) {
      res = text(500, (e as Error).message)
    }
    await sleep(latency / 2)
    finish(res)
    return res
  }

  private routeShared(req: DemoRequest): DemoResponse | null {
    const { method, path, params } = req
    if (path === '/plus/mode') {
      if (method === 'GET') return json({ mode: this.mode })
      const mode = params.mode
      if (mode !== 'plus' && mode !== 'classic') return text(400, 'mode must be plus or classic')
      if (this.isDrawing()) return text(409, 'Not available while drawing')
      if (this.mode === 'plus' && mode === 'classic') this.saved.drawingTopDistance = -1
      this.saved.mode = mode
      this.persistNow()
      this.log.print(`Switching to ${mode} mode, restarting`)
      this.restart('Software restart', true)
      return text(200, 'Restarting')
    }
    if (path === '/ota/status' && method === 'GET') return json(this.otaStatus())
    if (path === '/ota/dismiss') return text(200, 'OK')
    if (path.startsWith('/ota/')) return text(409, NOT_IN_DEMO)
    if (path === '/recovery') return { status: 200, contentType: 'text/html', body: `<p>${NOT_IN_DEMO}</p>` }
    return null
  }

  private otaStatus(): OtaStatus {
    const busy =
      this.mode === 'plus'
        ? this.isDrawing()
          ? 'Not available while drawing'
          : this.statusName() !== 'idle'
            ? 'Mural is moving, try again when it has stopped'
            : NOT_IN_DEMO
        : NOT_IN_DEMO
    return {
      product: PRODUCT,
      firmware: FIRMWARE_VERSION,
      ui: FIRMWARE_VERSION,
      uiMissing: false,
      slot: 'app0',
      nextSlot: 'app1',
      firmwareSlotBytes: 1_966_080,
      uiPartitionBytes: UI_TOTAL,
      busy,
    }
  }

  // ---------------------------------------------------------------------------
  // Plus mode (src/plus/controller.cpp, diagnostics.cpp)

  isDrawing() {
    return this.runner.isRunning() || this.pendingStartSpeed > 0
  }

  statusName(): PlusState['status'] {
    if (this.runner.isRunning()) return this.runner.stateName()
    if (this.pendingStartSpeed > 0) return 'starting'
    if (this.homing) return 'homing'
    if (this.goHomePending || this.positionedMove || this.movement.isMoving()) return 'moving'
    return 'idle'
  }

  drawingReady() {
    const d = this.saved.drawingTopDistance
    return this.drawing !== null && d > 0 && d === this.movement.topDistance
  }

  atHome() {
    if (!this.positionKnown || this.movement.isMoving()) return false
    try {
      return distance(this.movement.coordinates(), this.movement.homeCoordinates()) < HOME_TOLERANCE_MM
    } catch {
      return false
    }
  }

  private freeKb() {
    return Math.floor((SD_TOTAL - SD_BASE_USED) / 1024)
  }

  state(): PlusState {
    const m = this.movement
    const topDistance = m.topDistance
    const distanceSet = topDistance > 0
    const home = m.homeCoordinates()
    const pen = this.pen
    const drawingOk = this.drawingReady()
    const r = this.runner
    return {
      phase: 'SvgSelect',
      moving: m.isMoving(),
      startedHoming: m.startedHoming,
      topDistance,
      pulleyDiameter: m.diameter,
      safeWidth: distanceSet ? m.width : -1,
      safeXFraction: SAFE_X_FRACTION,
      safeYFraction: SAFE_Y_FRACTION,
      homeX: home.x,
      homeY: home.y,
      freeKb: this.freeKb(),
      mode: 'plus',
      status: this.statusName(),
      drawingActive: this.isDrawing(),
      drawing: {
        state: this.pendingStartSpeed > 0 ? 'starting' : r.stateName(),
        progress: r.progress,
        distanceDone: r.distanceSoFar,
        totalDistance: r.totalDistance,
        elapsedMs: Math.round(r.elapsedMs()),
        speed: this.pendingStartSpeed > 0 ? this.pendingStartSpeed : r.speed,
        lastOutcome: r.lastOutcome,
        error: r.lastError,
        startError: this.startError,
      },
      position: { known: this.positionKnown, homing: this.homing, atHome: this.atHome() },
      pen: {
        calibrated: pen.isCalibrated(),
        down: pen.settings.downAngle,
        up: pen.settings.upAngle,
        downBaseline: pen.downBaseline,
        upBaseline: pen.upBaseline,
        min: pen.settings.minAngle,
        max: pen.settings.maxAngle,
        speed: pen.settings.speedDegPerSec,
        releaseWhenUp: pen.settings.releaseWhenUp,
        isDown: pen.isDown(),
        moving: pen.busy,
      },
      settings: { webWhileDrawing: this.saved.webWhileDrawing, logDrawingMoves: this.saved.logDrawingMoves },
      drawingFile: { exists: this.drawing !== null, topDistance: this.saved.drawingTopDistance, compatible: drawingOk },
      ready: {
        distance: distanceSet,
        position: this.positionKnown,
        pen: pen.isCalibrated(),
        drawing: drawingOk,
        all: distanceSet && this.positionKnown && pen.isCalibrated() && drawingOk,
      },
    }
  }

  private rejectIfDrawing(): DemoResponse | null {
    return this.isDrawing() ? text(409, 'Not available while drawing') : null
  }

  private rejectIfBusy(): DemoResponse | null {
    const r = this.rejectIfDrawing()
    if (r) return r
    if (this.goHomePending || this.positionedMove || this.movement.isMoving()) {
      return text(409, 'Mural is moving, try again when it has stopped')
    }
    return null
  }

  private routePlus(req: DemoRequest): DemoResponse {
    const shared = this.routeShared(req)
    if (shared) return shared
    const { method, path, params } = req
    const m = this.movement
    const pen = this.pen
    const post = method === 'POST'
    const ok = () => text(200, 'OK')
    const state = () => json(this.state())

    if (method === 'GET') {
      switch (path) {
        case '/getState':
          return state()
        case '/downloadCommands':
          return this.rejectIfDrawing() ?? (this.drawing === null ? text(404, 'No drawing uploaded') : text(200, this.drawing))
        case '/diagnostics':
          return json(this.diagnostics())
        case '/log':
          return text(200, this.log.dump())
      }
      return text(404, 'Not found')
    }
    if (!post) return text(404, 'Not found')

    switch (path) {
      case '/setTopDistance': {
        const busy = this.rejectIfBusy()
        if (busy) return busy
        const d = toInt(params.distance)
        if (d <= 0) return text(400, 'Distance must be a positive number of millimeters')
        if (d !== m.topDistance && this.positionKnown) {
          this.positionKnown = false
          this.log.print('Hanger distance changed, belt position no longer known')
        }
        m.setTopDistance(d)
        this.saved.topDistance = d
        this.persistNow()
        return state()
      }
      case '/setPulleyDiameter': {
        const busy = this.rejectIfBusy()
        if (busy) return busy
        const d = parseFloat(params.diameter ?? '')
        if (!(d > 0)) return text(400, 'Diameter must be a positive number of millimeters')
        if (d !== m.diameter && this.positionKnown) {
          this.positionKnown = false
          this.log.print('Pulley diameter changed, belt position no longer known')
        }
        m.setPulleyDiameter(d)
        this.saved.pulleyDiameter = d
        this.persistNow()
        return ok()
      }
      case '/command': {
        const busy = this.rejectIfDrawing()
        if (busy) return busy
        const command = params.command ?? ''
        if (command === 'raise' || command === 'lower') return this.calibrationMove(command === 'raise')
        if (this.goHomePending || this.positionedMove) return text(409, 'Wait for the current move to finish')
        const dirs: Record<string, [boolean, number]> = {
          'l-ret': [true, -1],
          'l-ext': [true, 1],
          'l-0': [true, 0],
          'r-ret': [false, -1],
          'r-ext': [false, 1],
          'r-0': [false, 0],
        }
        const d = dirs[command]
        if (!d) return text(400, 'Unsupported command')
        if (d[1] !== 0 && this.positionKnown) {
          this.positionKnown = false
          this.log.print('Belts moved by hand, belt position no longer known')
        }
        if (d[0]) this.leftDir = d[1]
        else this.rightDir = d[1]
        this.updateManualBelts()
        return ok()
      }
      case '/extendToHome': {
        const busy = this.rejectIfBusy()
        if (busy) return busy
        if (m.topDistance <= 0) return text(400, 'Set the hanger distance first')
        this.leftDir = this.rightDir = 0
        const seconds = m.extendToHome() + 1
        this.positionKnown = false
        this.homing = true
        this.positionedMove = true
        this.log.print('Extending to home')
        return text(200, String(seconds))
      }
      case '/goHome': {
        const busy = this.rejectIfBusy()
        if (busy) return busy
        if (!this.positionKnown) return text(400, 'Belt position unknown, extend the belts to home instead')
        this.goHomePending = true
        return state()
      }
      case '/setServo': {
        const busy = this.rejectIfDrawing()
        if (busy) return busy
        if (params.angle === undefined) return text(400, 'Missing angle')
        pen.moveTo(toInt(params.angle))
        return ok()
      }
      case '/penUp': {
        const busy = this.rejectIfDrawing()
        if (busy) return busy
        pen.up()
        return ok()
      }
      case '/setPenDistance': {
        const busy = this.rejectIfDrawing()
        if (busy) return busy
        if (params.angle === undefined) return text(400, 'Missing angle')
        pen.setDownAngle(toInt(params.angle))
        pen.up()
        return state()
      }
      case '/resetPen': {
        const busy = this.rejectIfDrawing()
        if (busy) return busy
        pen.clearCalibration()
        return state()
      }
      case '/retractBoost': {
        const busy = this.rejectIfDrawing()
        if (busy) return busy
        this.boostUntil = realNow() + (params.on === '0' ? 0 : BOOST_LEASE_MS)
        this.updateManualBelts()
        return ok()
      }
      case '/estepsCalibration': {
        const busy = this.rejectIfBusy()
        if (busy) return busy
        const mm = toInt(params.distance)
        if (mm <= 0) return text(400, 'Distance must be a positive number of millimeters')
        if (this.positionKnown) {
          this.positionKnown = false
          this.log.print('E-steps calibration move, belt position no longer known')
        }
        this.log.print(`Extending ${mm} mm`)
        m.extendBelts(mm)
        return ok()
      }
      case '/uploadCommands':
        return this.handleUpload(req, true)
      case '/run': {
        const busy = this.rejectIfBusy()
        if (busy) return busy
        if (!this.positionKnown) return text(400, 'Belt position unknown, extend the belts to home first')
        if (!pen.isCalibrated()) return text(400, 'Calibrate the pen first')
        if (!this.drawingReady()) return text(400, 'Choose a drawing for this hanger distance first')
        const speed = params.speed !== undefined ? toInt(params.speed) : DEFAULT_SPEED
        pen.stopTest()
        this.startError = ''
        this.pendingStartSpeed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, speed))
        return state()
      }
      case '/pauseDrawing':
      case '/resumeDrawing':
      case '/stopDrawing': {
        if (!this.runner.isRunning()) return text(400, 'Not drawing')
        if (path === '/pauseDrawing') {
          this.log.print('Pause requested')
          this.runner.requestPause()
        } else if (path === '/resumeDrawing') {
          this.log.print('Resume requested')
          this.runner.requestResume()
        } else {
          this.log.print('Stop requested')
          this.runner.requestStop()
        }
        return state()
      }
      case '/setDrawingSpeed': {
        if (!this.runner.isRunning()) return text(400, 'Not drawing')
        const speed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, toInt(params.speed)))
        this.runner.speed = speed
        this.log.print(`Drawing speed set to ${speed}`)
        return state()
      }
      case '/adjustPen': {
        const which = params.which
        const steps = toInt(params.steps)
        if ((which !== 'up' && which !== 'down') || steps === 0 || steps < -10 || steps > 10) {
          return text(400, 'which must be up or down, steps between -10 and 10')
        }
        if (which === 'down' && !pen.isCalibrated()) return text(400, 'Calibrate the pen first')
        const before = which === 'down' ? pen.settings.downAngle : pen.settings.upAngle
        const after = pen.adjust(which, steps)
        if (after === before) return text(409, 'That angle is already at its limit')
        return state()
      }
      case '/penSettings': {
        const busy = this.rejectIfDrawing()
        if (busy) return busy
        const s: PenSettings = { ...pen.settings }
        if (params.up !== undefined) s.upAngle = toInt(params.up)
        if (params.down !== undefined) s.downAngle = toInt(params.down)
        if (params.min !== undefined) s.minAngle = toInt(params.min)
        if (params.max !== undefined) s.maxAngle = toInt(params.max)
        if (params.speed !== undefined) s.speedDegPerSec = toInt(params.speed)
        if (params.releaseWhenUp !== undefined) s.releaseWhenUp = truthy(params.releaseWhenUp)
        if (s.downAngle >= 0 && s.downAngle === s.upAngle) return text(400, "The up and down angles can't be the same")
        pen.applySettings(s)
        return state()
      }
      case '/penDown': {
        const busy = this.rejectIfDrawing()
        if (busy) return busy
        if (!pen.isCalibrated()) return text(400, 'Calibrate the pen first')
        pen.down()
        return ok()
      }
      case '/settings': {
        const busy = this.rejectIfDrawing()
        if (busy) return busy
        if (params.webWhileDrawing !== undefined) {
          this.saved.webWhileDrawing = truthy(params.webWhileDrawing)
          this.log.print(`Web UI while drawing ${this.saved.webWhileDrawing ? 'on' : 'off'}`)
        }
        if (params.logDrawingMoves !== undefined) {
          this.saved.logDrawingMoves = truthy(params.logDrawingMoves)
          this.log.print(`Logging drawing moves ${this.saved.logDrawingMoves ? 'on' : 'off'}`)
        }
        this.persistNow()
        return state()
      }
      case '/servo':
        return this.servoAction(params)
    }
    return text(404, 'Not found')
  }

  /** Controller::calibrationMove: up or down 100 mm while calibrating the pen. */
  private calibrationMove(raise: boolean): DemoResponse {
    const m = this.movement
    if (this.goHomePending || this.positionedMove || m.isMoving()) return text(200, '0')
    if (!this.positionKnown) return text(409, 'Belt position unknown, extend the belts to home first')
    try {
      const here = m.coordinates()
      const y = here.y + (raise ? -PEN_CAL_STEP_MM : PEN_CAL_STEP_MM)
      if (y < 0) return text(200, '0')
      this.log.print(`Pen calibration move to ${here.x.toFixed(1)}, ${y.toFixed(1)}`)
      const seconds = m.beginLinearTravel(here.x, y, PRINT_SPEED)
      this.positionedMove = true
      return text(200, String(Math.ceil(seconds) + 1))
    } catch (e) {
      this.positionKnown = false
      this.log.print(`Pen calibration move failed: ${(e as Error).message}`)
      return text(500, `Move failed: ${(e as Error).message}`)
    }
  }

  /** Controller::handleUpload: the drawing arrives in chunks, identified by byte offset. */
  private handleUpload(req: DemoRequest, plus: boolean): DemoResponse {
    if (plus) {
      if (this.isDrawing()) return text(409, 'Not available while drawing')
      if (this.movement.topDistance <= 0) return text(400, 'Set the hanger distance first')
    }
    const offset = toInt(req.params.offset)
    const last = req.params.final === 'true'
    const chunk = req.file?.text ?? ''
    if (offset === 0) {
      if (plus) {
        this.saved.drawingTopDistance = -1
        this.persistNow()
      }
      this.drawing = null
      persist.saveDrawing(null)
      this.updatePlan()
      const total = req.params.totalBytes !== undefined ? toInt(req.params.totalBytes) : chunk.length
      this.log.print(`Upload size: ${total} bytes, ${SD_TOTAL - SD_BASE_USED} bytes free`)
      this.upload = ''
      this.log.print('Upload started')
    } else if (this.upload === null || offset > this.upload.length) {
      return text(409, 'Upload out of order, restart upload')
    }
    this.upload = this.upload.slice(0, offset) + chunk
    if (last) {
      const d = this.movement.topDistance
      this.storeDrawing(this.upload, d)
      this.upload = null
      this.persistNow()
      this.log.print('Upload finished')
      if (!plus) this.setPhase('RetractBelts')
    }
    return plus ? json(this.state()) : json(this.classicState())
  }

  /** Diagnostics::handleServo */
  private servoAction(params: Record<string, string>): DemoResponse {
    const busy = this.rejectIfDrawing()
    if (busy) return busy
    const pen = this.pen
    const action = params.action
    const hasValue = params.value !== undefined
    const value = toInt(params.value)
    switch (action) {
      case 'up':
        pen.stopTest()
        pen.up()
        break
      case 'down':
        if (!pen.isCalibrated()) return text(400, 'Calibrate the pen first')
        pen.stopTest()
        pen.down()
        break
      case 'angle':
        if (!hasValue) return text(400, 'Missing value')
        pen.stopTest()
        pen.moveTo(value)
        break
      case 'nudge':
        pen.stopTest()
        pen.moveTo(pen.target + value)
        break
      case 'release':
        pen.release()
        break
      case 'cycle':
        if (!pen.isCalibrated()) return text(400, 'Calibrate the pen first')
        pen.startCycleTest(Math.max(1, Math.min(100, hasValue ? value : 5)))
        break
      case 'stop':
        pen.stopTest()
        break
      default:
        return text(400, 'action must be up, down, angle, nudge, release, cycle or stop')
    }
    this.log.print(`Diagnostics: servo ${action}${hasValue ? ` ${value}` : ''}`)
    return text(200, 'OK')
  }

  diagnostics(): Diagnostics {
    const m = this.movement
    const pen = this.pen
    const t = this.now
    const wobble = (period: number, size: number) => Math.round(Math.sin(t / period) * size)
    let coords: { x?: number; y?: number } = {}
    if (this.positionKnown) {
      try {
        coords = m.coordinates()
      } catch {
        coords = {}
      }
    }
    return {
      system: {
        firmware: FIRMWARE_VERSION,
        built: BUILT,
        uptimeMs: Math.round(t),
        bootCount: this.saved.bootCount,
        resetHistory: this.saved.resetHistory.map((reason) => ({ reason, brownout: reason.startsWith('Brownout') })),
        freeHeap: 182_340 + wobble(7000, 2400),
        minFreeHeap: 151_212,
        maxAllocHeap: 110_580,
        cpuMHz: 240,
        hotspot: false,
        ip: '192.168.1.42',
        wifiRssi: -58 + wobble(11000, 4),
        status: this.statusName(),
        drawing: this.isDrawing(),
        progress: this.runner.progress,
        logDrawingMoves: this.saved.logDrawingMoves,
      },
      servo: {
        pin: SERVO_PIN,
        attached: pen.attached,
        positionKnown: pen.positionKnown,
        position: pen.positionKnown ? pen.position : 'unknown',
        commandedAngle: Math.round(pen.current),
        targetAngle: pen.target,
        pulseUs: pen.pulseUs,
        moving: pen.busy,
        moveCount: pen.moveCount,
        lastMoveFrom: pen.lastMoveFrom,
        lastMoveTo: pen.lastMoveTo,
        lastMoveMs: Math.round(pen.lastMoveMs),
        cycleRemaining: pen.cycleRemaining,
        upAngle: pen.settings.upAngle,
        downAngle: pen.settings.downAngle,
        minAngle: pen.settings.minAngle,
        maxAngle: pen.settings.maxAngle,
        speedDegPerSec: pen.settings.speedDegPerSec,
        releaseWhenUp: pen.settings.releaseWhenUp,
      },
      motors: {
        moving: m.isMoving(),
        topDistance: m.topDistance,
        pulleyDiameter: m.diameter,
        positionKnown: this.positionKnown,
        homing: this.homing,
        ...coords,
        leftManual: this.leftDir,
        rightManual: this.rightDir,
        boosting: this.leftBoosted || this.rightBoosted,
      },
      drivers: [this.driver('Left', true), this.driver('Right', false)],
      storage: {
        uiTotalBytes: UI_TOTAL,
        uiUsedBytes: UI_USED,
        sdTotalBytes: SD_TOTAL,
        sdUsedBytes: SD_BASE_USED + (this.drawing?.length ?? 0),
        drawingExists: this.drawing !== null,
        drawingBytes: this.drawing?.length ?? 0,
        drawingTopDistance: this.saved.drawingTopDistance,
        drawingReady: this.drawingReady(),
      },
    }
  }

  private driver(name: string, left: boolean): MotorDriver {
    const motor = left ? this.movement.left : this.movement.right
    const hot = left && this.faults.overheat
    const still = Math.abs(motor.speed) < 1
    return {
      name,
      steps: Math.round(motor.steps),
      stepsToGo: motor.stepsToGo,
      stepSpeed: Math.round(motor.speed),
      responding: true,
      crcError: false,
      enabled: true,
      overtempWarning: hot,
      overtemp: false,
      shortToGroundA: false,
      shortToGroundB: false,
      shortToSupplyA: false,
      shortToSupplyB: false,
      openLoadA: false,
      openLoadB: false,
      tempAbove: hot ? 120 : 0,
      setCurrentMa: 707,
      currentMa: still ? 354 : 707,
      stealthChop: true,
      standstill: still,
      restarted: false,
      driverError: false,
      chargePumpUndervoltage: false,
      microsteps: 8,
      expectedMicrosteps: 8,
    }
  }

  // ---------------------------------------------------------------------------
  // Classic mode (upstream's phases, src/phases/)

  private setPhase(phase: Phase) {
    this.phase = phase
  }

  classicState(): BackendState {
    const m = this.movement
    const home = m.homeCoordinates()
    return {
      phase: this.phase,
      moving: m.isMoving(),
      startedHoming: m.startedHoming,
      topDistance: m.topDistance,
      pulleyDiameter: m.diameter,
      safeWidth: m.topDistance !== -1 ? m.width : -1,
      safeXFraction: SAFE_X_FRACTION,
      safeYFraction: SAFE_Y_FRACTION,
      homeX: home.x,
      homeY: home.y,
      freeKb: this.freeKb(),
    }
  }

  private routeClassic(req: DemoRequest): DemoResponse {
    const shared = this.routeShared(req)
    if (shared) return shared
    const { method, path, params } = req
    const m = this.movement
    const phase = this.phase
    const notSupported = () => text(400, 'Not supported')
    const state = () => json(this.classicState())

    if (method === 'GET') {
      if (path === '/getState') return state()
      if (path === '/downloadCommands') return this.drawing === null ? text(404, 'Not found') : text(200, this.drawing)
      return text(404, 'Not found')
    }

    // Retract belts and set distance take manual belt moves (CommandHandlingPhase)
    const handlesBelts = phase === 'RetractBelts' || phase === 'SetTopDistance'
    switch (path) {
      case '/command': {
        const command = params.command ?? ''
        if (phase === 'PenCalibration') {
          if (command !== 'raise' && command !== 'lower') return text(400, 'Unsupported command')
          if (m.isMoving()) return text(200, '0')
          try {
            const here = m.coordinates()
            const y = here.y + (command === 'raise' ? -PEN_CAL_STEP_MM : PEN_CAL_STEP_MM)
            if (y < 0) return text(200, '0')
            return text(200, String(Math.ceil(m.beginLinearTravel(here.x, y, PRINT_SPEED)) + 1))
          } catch {
            return text(500, 'Movement error')
          }
        }
        if (!handlesBelts) return notSupported()
        const dirs: Record<string, [boolean, number]> = {
          'l-ret': [true, -1],
          'l-ext': [true, 1],
          'l-0': [true, 0],
          'r-ret': [false, -1],
          'r-ext': [false, 1],
          'r-0': [false, 0],
        }
        const d = dirs[command]
        if (!d) return text(400, 'Unsupported command')
        m.manual(d[0], d[1])
        return text(200, 'OK')
      }
      case '/setTopDistance':
        if (phase !== 'SetTopDistance') return notSupported()
        m.setTopDistance(toInt(params.distance))
        this.setPhase('SvgSelect')
        return state()
      case '/setPulleyDiameter':
        if (phase !== 'SetTopDistance') return notSupported()
        m.setPulleyDiameter(parseFloat(params.diameter ?? '') || m.diameter)
        return text(200, 'OK')
      case '/estepsCalibration':
        if (phase !== 'SetTopDistance') return notSupported()
        m.extendBelts(toInt(params.distance))
        return text(200, 'OK')
      case '/setServo':
        if (phase !== 'SetTopDistance' && phase !== 'PenCalibration') return notSupported()
        this.pen.moveTo(toInt(params.angle))
        return text(200, 'OK')
      case '/extendToHome':
        if (phase !== 'ExtendToHome') return notSupported()
        return text(200, String(m.extendToHome() + 1))
      case '/setPenDistance':
        if (phase !== 'PenCalibration') return notSupported()
        this.pen.setDownAngle(toInt(params.angle))
        this.pen.up()
        this.setPhase('BeginDrawing')
        return state()
      case '/doneWithPhase':
        if (phase === 'RetractBelts') this.setPhase('ExtendToHome')
        else if (phase === 'BeginDrawing') this.setPhase('SetTopDistance')
        else return notSupported()
        return state()
      case '/uploadCommands':
        if (phase !== 'SvgSelect') return notSupported()
        return this.handleUpload(req, false)
      case '/run': {
        if (phase !== 'BeginDrawing') return notSupported()
        const speed = Math.max(300, Math.min(3000, params.speed !== undefined ? toInt(params.speed) : 650))
        this.trail = []
        this.trailEpoch++
        try {
          this.runner.start(this.drawing, speed)
        } catch (e) {
          return text(500, (e as Error).message)
        }
        // Upstream stops the web server while drawing and restarts the board at the end
        this.log.print('Web server stopped while drawing')
        return text(200, 'OK')
      }
      case '/resume':
        return notSupported()
    }
    return text(404, 'Not found')
  }
}

/** The pen-down strokes of a drawing file, in image coordinates. */
function parsePlan(file: string | null): Point[][] {
  if (!file) return []
  const strokes: Point[][] = []
  let down = false
  let last: Point | null = null
  let stroke: Point[] | null = null
  for (const raw of file.split('\n')) {
    const line = raw.trim()
    if (line === 'p1') {
      down = true
      stroke = last ? [last] : []
      strokes.push(stroke)
      continue
    }
    if (line === 'p0') {
      down = false
      stroke = null
      continue
    }
    const space = line.indexOf(' ')
    if (space <= 0) continue
    const p = { x: parseFloat(line.slice(0, space)), y: parseFloat(line.slice(space + 1)) }
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    if (down && stroke) stroke.push(p)
    last = p
  }
  return strokes.filter((s) => s.length > 1)
}

export { MovementError }
