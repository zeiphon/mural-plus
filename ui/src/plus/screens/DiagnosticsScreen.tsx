import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Toggle } from '../../components/Toggle'
import { showAlert } from '../../components/AlertModal'
import { getDiagnostics, getLog, servoAction, setLogDrawingMoves, delay, errorMessage } from '../api'
import type { Diagnostics, MotorDriver, ServoAction } from '../types'

const POLL_MS = 2000
const LOG_POLL_MS = 3000

/** Readouts, servo tests and the log, for troubleshooting. Works while drawing (tests are disabled then). */
export function DiagnosticsScreen() {
  const [diag, setDiag] = useState<Diagnostics | null>(null)
  const [lost, setLost] = useState(false)
  const [log, setLog] = useState<string | null>(null)
  const [autoLog, setAutoLog] = useState(true)
  const refreshRef = useRef<() => void>(() => {})

  useEffect(() => {
    let cancelled = false
    let wake: (() => void) | null = null
    async function load() {
      try {
        const d = await getDiagnostics()
        if (cancelled) return
        setDiag(d)
        setLost(false)
      } catch {
        if (!cancelled) setLost(true)
      }
    }
    // Refresh straight away after an action, instead of waiting for the next poll.
    refreshRef.current = () => wake?.()
    async function poll() {
      while (!cancelled) {
        if (!document.hidden) await load()
        await Promise.race([delay(POLL_MS), new Promise<void>((resolve) => (wake = resolve))])
      }
    }
    poll()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!autoLog) return
    let cancelled = false
    async function poll() {
      while (!cancelled) {
        if (!document.hidden) {
          try {
            const text = await getLog()
            if (!cancelled) setLog(text)
          } catch {
            // shown by the connection warning
          }
        }
        await delay(LOG_POLL_MS)
      }
    }
    poll()
    return () => {
      cancelled = true
    }
  }, [autoLog])

  async function act(action: ServoAction, value?: number) {
    try {
      await servoAction(action, value)
    } catch (err) {
      await showAlert(errorMessage(err))
    }
    refreshRef.current()
  }

  async function toggleLogMoves(on: boolean) {
    try {
      await setLogDrawingMoves(on)
    } catch (err) {
      await showAlert(errorMessage(err))
    }
    refreshRef.current()
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl sm:text-2xl font-semibold text-white text-center">Diagnostics</h1>
      {lost && <p className="text-sm text-yellow-400 text-center">Can't reach Mural, retrying…</p>}
      {!diag ? (
        <p className="text-sm text-gray-400 text-center">Loading…</p>
      ) : (
        <>
          <BrownoutWarning diag={diag} />
          <ServoSection diag={diag} onAction={act} />
          <SystemSection diag={diag} onLogMoves={toggleLogMoves} />
          <MotorsSection diag={diag} />
          <DriversSection diag={diag} />
          <StorageSection diag={diag} />
        </>
      )}
      <LogSection log={log} autoLog={autoLog} onAutoLog={setAutoLog} onRefresh={() => getLog().then(setLog).catch(() => {})} />
    </div>
  )
}

function BrownoutWarning({ diag }: { diag: Diagnostics }) {
  const history = diag.system.resetHistory
  const brownouts = history.filter((r) => r.brownout).length
  if (brownouts === 0) return null
  return (
    <div className="rounded-xl border border-red-800 bg-red-950/60 p-4 text-sm text-red-200">
      {history[0]?.brownout ? 'The last restart was a brownout: ' : `${brownouts} of the last ${history.length} restarts were brownouts: `}
      the supply voltage dropped too low. Check the power supply and its cable. The servo and both motors starting at
      once draw the most current.
    </div>
  )
}

function ServoSection({ diag, onAction }: { diag: Diagnostics; onAction: (action: ServoAction, value?: number) => void }) {
  const s = diag.servo
  const disabled = diag.system.drawing
  const calibrated = s.downAngle >= 0
  const [angle, setAngle] = useState(String(s.targetAngle))
  const [cycles, setCycles] = useState('10')

  return (
    <Section title="Servo and pen">
      <p className="text-xs text-gray-500">
        A hobby servo gives no feedback, so these are the angles Mural sent, not where the horn really is. If the horn
        isn't where it should be, or it buzzes while holding, it's probably straining or binding.
      </p>
      <Rows>
        <Row label="Position">
          {s.position}
          {s.moving ? ', moving' : ''}
          {s.cycleRemaining > 0 ? ` (cycle test, ${s.cycleRemaining} moves left)` : ''}
        </Row>
        <Row label="Commanded angle">
          {s.positionKnown ? `${s.commandedAngle}°` : 'none yet'}
          {s.targetAngle !== s.commandedAngle ? `, heading for ${s.targetAngle}°` : ''}
        </Row>
        <Row label="Pulse">{s.attached ? `${s.pulseUs} µs on pin ${s.pin}` : `none (released) on pin ${s.pin}`}</Row>
        <Row label="Up / down angles">
          {s.upAngle}° / {calibrated ? `${s.downAngle}°` : 'not calibrated'}
        </Row>
        <Row label="Limits">
          {s.minAngle}° to {s.maxAngle}°
        </Row>
        <Row label="Speed">{s.speedDegPerSec}°/s</Row>
        <Row label="Release when up">{s.releaseWhenUp ? 'yes' : 'no'}</Row>
        <Row label="Moves since boot">{s.moveCount}</Row>
        <Row label="Last move">
          {s.moveCount === 0
            ? 'none'
            : `${s.lastMoveFrom < 0 ? 'boot' : `${s.lastMoveFrom}°`} → ${s.lastMoveTo}° in ${s.lastMoveMs} ms`}
        </Row>
      </Rows>

      {disabled && <p className="text-xs text-yellow-400">The servo tests are off while drawing.</p>}
      <div className="flex flex-wrap gap-2">
        <SmallButton onClick={() => onAction('up')} disabled={disabled}>
          Pen up
        </SmallButton>
        <SmallButton onClick={() => onAction('down')} disabled={disabled || !calibrated}>
          Pen down
        </SmallButton>
        <SmallButton onClick={() => onAction('nudge', -1)} disabled={disabled}>
          −1°
        </SmallButton>
        <SmallButton onClick={() => onAction('nudge', 1)} disabled={disabled}>
          +1°
        </SmallButton>
        <SmallButton onClick={() => onAction('release')} disabled={disabled}>
          Release (go limp)
        </SmallButton>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-gray-300">Move to</span>
        <NumberInput value={angle} onChange={setAngle} />
        <span className="text-sm text-gray-300">°</span>
        <SmallButton onClick={() => onAction('angle', Number(angle))} disabled={disabled || angle.trim() === ''}>
          Go
        </SmallButton>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-gray-300">Down and up</span>
        <NumberInput value={cycles} onChange={setCycles} />
        <span className="text-sm text-gray-300">times</span>
        {s.cycleRemaining > 0 ? (
          <SmallButton onClick={() => onAction('stop')}>Stop</SmallButton>
        ) : (
          <SmallButton onClick={() => onAction('cycle', Number(cycles))} disabled={disabled || !calibrated}>
            Start
          </SmallButton>
        )}
      </div>
      <p className="text-xs text-gray-500">
        "Move to" stays within the limits. Release stops the pulses so the horn can be turned by hand; the next move takes
        hold again. The cycle test lowers and lifts the pen repeatedly, to check for binding or brownouts.
      </p>
    </Section>
  )
}

function SystemSection({ diag, onLogMoves }: { diag: Diagnostics; onLogMoves: (on: boolean) => void }) {
  const sys = diag.system
  return (
    <Section title="System">
      <Rows>
        <Row label="Firmware">{sys.firmware}</Row>
        <Row label="Built">{sys.built}</Row>
        <Row label="Up for">{formatUptime(sys.uptimeMs)}</Row>
        <Row label="Boots">{sys.bootCount}</Row>
        <Row label="Recent restarts">
          {sys.resetHistory.length === 0 ? (
            'none recorded'
          ) : (
            <ol className="space-y-0.5">
              {sys.resetHistory.map((r, i) => (
                <li key={i} className={r.brownout ? 'text-red-300' : undefined}>
                  {i === 0 ? 'This boot: ' : ''}
                  {r.reason}
                </li>
              ))}
            </ol>
          )}
        </Row>
        <Row label="Status">
          {sys.status}
          {sys.drawing ? `, ${sys.progress}%` : ''}
        </Row>
        <Row label="Memory">
          {formatBytes(sys.freeHeap)} free (lowest {formatBytes(sys.minFreeHeap)}, largest block{' '}
          {formatBytes(sys.maxAllocHeap)})
        </Row>
        <Row label="CPU">{sys.cpuMHz} MHz</Row>
        <Row label="Network">
          {sys.hotspot ? `Hotspot, ${sys.ip}` : `${sys.ip}${sys.wifiRssi !== undefined ? `, ${formatRssi(sys.wifiRssi)}` : ''}`}
        </Row>
      </Rows>
      <div className="space-y-1">
        <Toggle label="Log every drawing move" checked={sys.logDrawingMoves} onChange={onLogMoves} />
        <p className="text-xs text-gray-500">
          Adds a line to the log below for each move and pen lift of a drawing. Useful for finding where a drawing went
          wrong, but it soon pushes older lines out of the log.
        </p>
      </div>
    </Section>
  )
}

function MotorsSection({ diag }: { diag: Diagnostics }) {
  const m = diag.motors
  return (
    <Section title="Motors and position">
      <Rows>
        <Row label="Motors">{m.moving ? 'moving' : 'stopped'}</Row>
        <Row label="Hanger distance">{m.topDistance > 0 ? `${m.topDistance} mm` : 'not set'}</Row>
        <Row label="Pulley diameter">{m.pulleyDiameter.toFixed(3)} mm</Row>
        <Row label="Belt position">{m.homing ? 'extending to home…' : m.positionKnown ? 'known' : 'unknown, extend to home'}</Row>
        {m.x !== undefined && m.y !== undefined && (
          <Row label="Pen position">
            x {m.x.toFixed(1)}, y {m.y.toFixed(1)} mm
          </Row>
        )}
        <Row label="Moving by hand">
          left {manualName(m.leftManual)}, right {manualName(m.rightManual)}
          {m.boosting ? ' (faster)' : ''}
        </Row>
      </Rows>
    </Section>
  )
}

function DriversSection({ diag }: { diag: Diagnostics }) {
  const [left, right] = diag.drivers
  if (!left || !right) return null
  const rows: { label: string; value: (d: MotorDriver) => ReactNode; always?: boolean }[] = [
    { label: 'Problems', value: (d) => <DriverProblems driver={d} />, always: true },
    { label: 'Outputs', value: (d) => (d.enabled ? 'enabled' : 'disabled') },
    { label: 'Current', value: (d) => `${d.currentMa} mA now, ${d.setCurrentMa} mA set` },
    { label: 'Temperature', value: (d) => (d.tempAbove ? `over ${d.tempAbove} °C` : 'under 120 °C') },
    { label: 'Mode', value: (d) => `${d.stealthChop ? 'StealthChop' : 'SpreadCycle'}${d.standstill ? ', standing still' : ''}` },
    { label: 'Microsteps', value: (d) => d.microsteps },
    {
      label: 'Steps',
      value: (d) => `${d.steps}${d.stepsToGo ? `, ${d.stepsToGo} to go at ${Math.round(Math.abs(d.stepSpeed))}/s` : ''}`,
      always: true,
    },
  ]
  return (
    <Section title="Motor drivers">
      <p className="text-xs text-gray-500">
        Read from the TMC2209 drivers. "Open load" can show up at standstill or high speed without anything being wrong;
        it matters if it stays on while the motor turns slowly.
      </p>
      <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_minmax(0,3fr)] gap-x-4 gap-y-1.5 text-sm">
        <dt />
        <dd className="text-gray-400 font-medium">{left.name}</dd>
        <dd className="text-gray-400 font-medium">{right.name}</dd>
        {rows.map((row) => (
          <DriverRow key={row.label} label={row.label} left={left} right={right} value={row.value} always={row.always} />
        ))}
      </dl>
    </Section>
  )
}

function DriverRow(props: {
  label: string
  left: MotorDriver
  right: MotorDriver
  value: (d: MotorDriver) => ReactNode
  /** Also shown for a driver that didn't answer */
  always?: boolean
}) {
  const cell = (d: MotorDriver) => (d.responding || props.always ? props.value(d) : '–')
  return (
    <>
      <dt className="text-gray-500">{props.label}</dt>
      <dd className="text-gray-200 break-words">{cell(props.left)}</dd>
      <dd className="text-gray-200 break-words">{cell(props.right)}</dd>
    </>
  )
}

function DriverProblems({ driver: d }: { driver: MotorDriver }) {
  if (!d.responding) {
    return <span className="text-red-300">Not answering. Check the driver board and the motor power.</span>
  }
  const problems: string[] = []
  if (d.overtemp) problems.push('Overheated, shut down')
  else if (d.overtempWarning) problems.push('Overheating warning')
  if (d.shortToGroundA || d.shortToGroundB) problems.push(`Short to ground (coil ${coils(d.shortToGroundA, d.shortToGroundB)})`)
  if (d.shortToSupplyA || d.shortToSupplyB) problems.push(`Short to supply (coil ${coils(d.shortToSupplyA, d.shortToSupplyB)})`)
  if (d.driverError) problems.push('Driver error (shut down)')
  if (d.restarted) problems.push('Restarted since boot, so its settings were lost: check the motor power supply')
  if (d.chargePumpUndervoltage) problems.push('Charge pump undervoltage')
  if (d.microsteps !== d.expectedMicrosteps) problems.push(`${d.microsteps} microsteps instead of ${d.expectedMicrosteps}`)
  if (d.crcError) problems.push('Garbled reply (UART)')
  const openLoad = d.openLoadA || d.openLoadB
  if (problems.length === 0 && !openLoad) return <span className="text-emerald-400">none</span>
  return (
    <ul className="space-y-0.5">
      {problems.map((p) => (
        <li key={p} className="text-red-300">
          {p}
        </li>
      ))}
      {openLoad && <li className="text-yellow-300">Open load (coil {coils(d.openLoadA, d.openLoadB)})</li>}
    </ul>
  )
}

function coils(a?: boolean, b?: boolean): string {
  return a && b ? 'A and B' : a ? 'A' : 'B'
}

function StorageSection({ diag }: { diag: Diagnostics }) {
  const st = diag.storage
  return (
    <Section title="Storage">
      <Rows>
        <Row label="Web page (flash)">
          {formatBytes(st.uiUsedBytes)} of {formatBytes(st.uiTotalBytes)}
        </Row>
        <Row label="SD card">
          {st.sdTotalBytes > 0 ? `${formatBytes(st.sdUsedBytes)} of ${formatBytes(st.sdTotalBytes)}` : 'not found'}
        </Row>
        <Row label="Drawing">
          {!st.drawingExists
            ? 'none'
            : `${formatBytes(st.drawingBytes)}, ${
                st.drawingTopDistance > 0 ? `for a ${st.drawingTopDistance} mm hanger distance` : 'not chosen in plus'
              }${st.drawingReady ? ', ready' : ''}`}
        </Row>
      </Rows>
    </Section>
  )
}

function LogSection(props: { log: string | null; autoLog: boolean; onAutoLog: (on: boolean) => void; onRefresh: () => void }) {
  const preRef = useRef<HTMLPreElement>(null)
  const followRef = useRef(true)

  // Keep showing the newest lines, unless the log has been scrolled up.
  useEffect(() => {
    const pre = preRef.current
    if (pre && followRef.current) pre.scrollTop = pre.scrollHeight
  }, [props.log])

  function handleScroll() {
    const pre = preRef.current
    if (pre) followRef.current = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 24
  }

  function handleCopy() {
    if (props.log && copyText(props.log)) {
      showAlert('Log copied.')
    } else {
      showAlert("Couldn't copy the log. Use Download instead.")
    }
  }

  function handleDownload() {
    if (!props.log) return
    const url = URL.createObjectURL(new Blob([props.log], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `mural-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Section title="Log">
      <p className="text-xs text-gray-500">
        Mural Plus's own messages. They survive a crash or restart, but not a power cut. Times are seconds since that
        boot.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[10rem]">
          <Toggle label="Auto-refresh" checked={props.autoLog} onChange={props.onAutoLog} />
        </div>
        {!props.autoLog && <SmallButton onClick={props.onRefresh}>Refresh</SmallButton>}
        <SmallButton onClick={handleCopy} disabled={!props.log}>
          Copy
        </SmallButton>
        <SmallButton onClick={handleDownload} disabled={!props.log}>
          Download
        </SmallButton>
      </div>
      <pre
        ref={preRef}
        onScroll={handleScroll}
        className="max-h-96 overflow-y-auto rounded-lg bg-gray-950 border border-gray-800 p-3 text-xs text-gray-300 font-mono whitespace-pre-wrap break-all"
      >
        {props.log === null ? 'Loading…' : props.log || '(empty)'}
      </pre>
    </Section>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bg-gray-900 border border-gray-800 rounded-2xl p-5 sm:p-6 space-y-4">
      <h2 className="text-base sm:text-lg font-semibold text-white">{title}</h2>
      {children}
    </section>
  )
}

function Rows({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-4 gap-y-1.5 text-sm">{children}</dl>
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-200 break-words">{children}</dd>
    </>
  )
}

function SmallButton(props: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      className="rounded-lg px-3 py-2 text-sm font-medium transition-colors bg-gray-700 enabled:hover:bg-gray-600 text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {props.children}
    </button>
  )
}

function NumberInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <input
      type="number"
      inputMode="numeric"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-20 rounded-lg bg-gray-800 border border-gray-700 px-2 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-cyan-500"
    />
  )
}

/** Mural is served over plain http, where navigator.clipboard isn't available. */
function copyText(text: string): boolean {
  const area = document.createElement('textarea')
  area.value = text
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  area.remove()
  return ok
}

function manualName(dir: number): string {
  return dir < 0 ? 'retracting' : dir > 0 ? 'extending' : 'stopped'
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

function formatRssi(rssi: number): string {
  const quality = rssi >= -60 ? 'good' : rssi >= -70 ? 'fair' : 'weak'
  return `WiFi ${rssi} dBm (${quality})`
}
