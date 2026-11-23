import { useEffect, useRef, useState } from 'react'
import type { Device, RequestRecord } from '../device/device'
import { useTick } from './hooks'

// What the app asks the device, and the device's own log (its /log route).

const KEEP = 300

export function Logs({ device }: { device: Device }) {
  const [tab, setTab] = useState<'requests' | 'log'>('requests')
  const records = useRequests(device)
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 rounded-lg bg-gray-800 p-1 w-fit" role="tablist">
        {(
          [
            ['requests', 'Requests'],
            ['log', 'Mural’s log'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`px-3 py-1 rounded-md text-sm transition-colors ${
              tab === id ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'requests' ? <RequestList records={records} /> : <DeviceLog device={device} />}
    </div>
  )
}

function useRequests(device: Device): RequestRecord[] {
  const [records, setRecords] = useState<RequestRecord[]>([])
  useEffect(
    () =>
      device.onRequest((r) => {
        setRecords((list) => [r, ...list].slice(0, KEEP))
      }),
    [device],
  )
  return records
}

function RequestList({ records }: { records: RequestRecord[] }) {
  const [hidePolls, setHidePolls] = useState(true)
  const [open, setOpen] = useState<number | null>(null)
  const shown = hidePolls ? records.filter((r) => !r.poll) : records
  const hidden = records.length - shown.length

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm text-gray-400 select-none">
        <input
          type="checkbox"
          checked={hidePolls}
          onChange={(e) => setHidePolls(e.target.checked)}
          className="accent-cyan-500"
        />
        Hide status polling{hidePolls && hidden > 0 ? ` (${hidden} hidden)` : ''}
      </label>
      {shown.length === 0 ? (
        <p className="text-sm text-gray-500 py-4">Nothing yet. Requests from the app show up here.</p>
      ) : (
        <ul className="divide-y divide-gray-800 rounded-xl border border-gray-800 max-h-96 overflow-y-auto">
          {shown.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => setOpen(open === r.id ? null : r.id)}
                aria-expanded={open === r.id}
                className="w-full text-left px-3 py-2 hover:bg-gray-800/60 transition-colors"
              >
                <div className="flex items-center gap-2 text-sm min-w-0">
                  <span className="text-xs text-gray-500 tabular-nums shrink-0">{clock(r.at)}</span>
                  <span className={`text-xs font-mono shrink-0 ${r.method === 'GET' ? 'text-gray-400' : 'text-cyan-300'}`}>
                    {r.method}
                  </span>
                  <span className="font-mono text-gray-100 truncate">
                    {r.path}
                    <span className="text-gray-500">{summary(r)}</span>
                  </span>
                  <span className="ml-auto flex items-center gap-2 shrink-0">
                    <StatusChip status={r.status} />
                    <span className="text-xs text-gray-500 tabular-nums w-12 text-right">{r.ms} ms</span>
                  </span>
                </div>
              </button>
              {open === r.id && <Details record={r} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Details({ record: r }: { record: RequestRecord }) {
  const params = Object.keys(r.params).length ? JSON.stringify(r.params, null, 2) : null
  return (
    <div className="px-3 pb-3 space-y-2 text-xs">
      {params && <Block title="Sent">{params}</Block>}
      {r.fileSize !== undefined && <p className="text-gray-400">Uploaded file part: {r.fileSize} bytes</p>}
      <Block title={r.status ? `Reply (${r.contentType})` : 'No reply'}>
        {r.status ? pretty(r.body) : "Mural didn't answer: it was restarting, offline, or not serving the web UI."}
      </Block>
    </div>
  )
}

function Block({ title, children }: { title: string; children: string }) {
  return (
    <div>
      <p className="text-gray-500 mb-1">{title}</p>
      <pre className="whitespace-pre-wrap break-all rounded-lg bg-gray-950 border border-gray-800 p-2 text-gray-300 max-h-64 overflow-auto">
        {children}
      </pre>
    </div>
  )
}

function StatusChip({ status }: { status: number }) {
  const tone =
    status === 0
      ? 'bg-red-500/15 text-red-300'
      : status < 300
        ? 'bg-green-500/15 text-green-300'
        : status < 500
          ? 'bg-amber-500/15 text-amber-300'
          : 'bg-red-500/15 text-red-300'
  return <span className={`rounded px-1.5 py-0.5 text-xs tabular-nums ${tone}`}>{status === 0 ? 'no reply' : status}</span>
}

function summary(r: RequestRecord): string {
  const parts = Object.entries(r.params).map(([k, v]) => `${k}=${v.length > 16 ? `${v.slice(0, 16)}…` : v}`)
  return parts.length ? ` ${parts.join(' ')}` : ''
}

function clock(at: number): string {
  const d = new Date(at)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
}

function pretty(body: string): string {
  const cut = body.length > 6000 ? `${body.slice(0, 6000)}\n… (${body.length - 6000} more characters)` : body
  if (cut.startsWith('{') || cut.startsWith('[')) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2).slice(0, 6000)
    } catch {
      return cut
    }
  }
  return cut
}

function DeviceLog({ device }: { device: Device }) {
  useTick(500)
  const box = useRef<HTMLPreElement>(null)
  const stick = useRef(true)
  const text = device.log.dump()

  useEffect(() => {
    const el = box.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [text])

  return (
    <pre
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
      }}
      className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-gray-800 bg-gray-950 p-3 text-xs text-gray-300 font-mono"
    >
      {text || 'Empty'}
    </pre>
  )
}
