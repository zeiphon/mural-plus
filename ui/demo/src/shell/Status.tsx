import type { ReactNode } from 'react'
import type { Device } from '../device/device'
import { formatBytes, formatDuration, useTick } from './hooks'

// What the simulated Mural knows about itself, in words.

const OFFLINE: Record<string, string> = {
  restarting: 'Restarting…',
  wifi: 'WiFi lost',
  drawing: 'Web server off while drawing',
}

export function Status({ device }: { device: Device }) {
  useTick(250)
  const offline = device.offline()
  const rows: [string, ReactNode][] = []

  rows.push([
    'Network',
    offline ? <span className="text-amber-300">{OFFLINE[offline]}</span> : <span className="text-green-400">Answering</span>,
  ])
  rows.push(['Uptime', formatDuration(device.now)])

  if (device.mode === 'classic') {
    rows.push(['Mode', 'Classic (upstream)'])
    rows.push(['Phase', device.phase])
    const d = device.movement.topDistance
    rows.push(['Hanger distance', d > 0 ? `${d} mm` : 'Not set'])
    rows.push(['Drawing on SD', device.drawing ? formatBytes(device.drawing.length) : 'None'])
    if (device.runner.isRunning() || device.runner.lastOutcome !== 'none') rows.push(['Drawing', <Progress device={device} />])
    return <Rows rows={rows} />
  }

  const s = device.state()
  rows.push(['Mode', 'Mural Plus'])
  rows.push(['Status', <span className="capitalize">{s.status}</span>])
  rows.push(['Hanger distance', s.ready.distance ? `${s.topDistance} mm` : <Missing>Not set</Missing>])
  rows.push([
    'Belt position',
    s.position.homing ? (
      'Homing…'
    ) : s.position.known ? (
      s.position.atHome ? 'Known, at home' : 'Known'
    ) : (
      <Missing>Unknown</Missing>
    ),
  ])
  rows.push(['Pen', s.pen.calibrated ? `Calibrated, down at ${s.pen.down}°` : <Missing>Not calibrated</Missing>])
  rows.push([
    'Drawing on SD',
    s.drawingFile.exists ? (
      <>
        {formatBytes(device.drawing?.length ?? 0)}
        {s.drawingFile.compatible ? (
          ', ready'
        ) : (
          <Missing>
            {s.drawingFile.topDistance > 0 ? `, made for ${s.drawingFile.topDistance} mm` : ', choose it again'}
          </Missing>
        )}
      </>
    ) : (
      <Missing>None</Missing>
    ),
  ])
  if (s.drawingActive || s.drawing.lastOutcome !== 'none') rows.push(['Drawing', <Progress device={device} />])
  return <Rows rows={rows} />
}

function Missing({ children }: { children: ReactNode }) {
  return <span className="text-gray-500">{children}</span>
}

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-gray-500">{k}</dt>
          <dd className="text-gray-200 min-w-0">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Progress({ device }: { device: Device }) {
  const r = device.runner
  const running = r.isRunning()
  const outcome: Record<string, string> = { finished: 'Finished', stopped: 'Stopped', failed: 'Failed', none: '' }
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-400 tabular-nums">
        <span>{running ? <span className="capitalize">{r.stateName()}</span> : outcome[r.lastOutcome]}</span>
        <span>
          {r.progress}% · {formatDuration(r.elapsedMs())}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
        <div
          className={`h-full ${r.lastOutcome === 'failed' && !running ? 'bg-red-400' : 'bg-cyan-500'}`}
          style={{ width: `${r.progress}%` }}
        />
      </div>
      {!running && r.lastError && <p className="text-xs text-red-400">{r.lastError}</p>}
    </div>
  )
}
