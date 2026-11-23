import { useRef, useState, type ReactNode } from 'react'
import type { Device } from '../device/device'
import { FIRMWARE_VERSION } from '../device/constants'
import { WallView } from './WallView'
import { Mechanics } from './Mechanics'
import { Status } from './Status'
import { Controls } from './Controls'
import { Logs } from './Logs'
import { Dot, Strip, useActivity } from './Strip'
import { useMedia } from './hooks'

// The demo page: Mural's web UI (app.html, in an iframe, as on a phone) and a
// panel showing what the simulated Mural is doing. On narrow screens they're
// two tabs, with a strip under the app showing the simulated Mural at a
// glance. The iframe stays mounted either way, so switching never reloads it.

const SOURCE_URL = 'https://github.com/zeiphon/mural-plus'

// The app's saved preferences (ui/src/plus/storage.ts and upstream's screens)
const APP_KEYS = ['muralUi', 'muralSpeed', 'muralPenWidthMm']

export function Shell({ device }: { device: Device }) {
  const [tab, setTab] = useState<'app' | 'device'>('app')
  const frame = useRef<HTMLIFrameElement>(null)
  const wide = useMedia('(min-width: 1024px)')
  const active = useActivity(device)

  function reset() {
    if (!confirm('Reset the demo? The simulated Mural starts again as new, and the page forgets your choices.')) return
    device.factoryReset()
    try {
      for (const key of Object.keys(localStorage)) {
        if (APP_KEYS.includes(key) || key.startsWith('muralParams_')) localStorage.removeItem(key)
      }
    } catch {
      // nothing saved
    }
    frame.current?.contentWindow?.location.reload()
  }

  return (
    <div className="flex flex-col h-dvh lg:h-auto lg:min-h-screen bg-gray-950 text-gray-100">
      <header className="flex items-center gap-4 border-b border-gray-800 px-4 py-3 lg:px-6">
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg font-semibold">
            Mural Plus demo <span className="text-xs font-normal text-gray-500">{FIRMWARE_VERSION}</span>
          </h1>
          <p className="text-xs sm:text-sm text-gray-400 truncate">
            Mural's real web page, talking to a simulated Mural. Nothing here moves a real one.
          </p>
        </div>
        <nav className="ml-auto flex shrink-0 gap-4 text-sm text-gray-400">
          <a href="../" className="hover:text-gray-200 transition-colors">
            Installer
          </a>
          <a href={SOURCE_URL} className="hover:text-gray-200 transition-colors">
            Source
          </a>
        </nav>
      </header>

      <div className="lg:hidden flex gap-1 border-b border-gray-800 px-4 py-2" role="tablist">
        {(
          [
            ['app', 'Mural’s web page'],
            [
              'device',
              <>
                <span className="hidden min-[360px]:inline">The simulated Mural</span>
                <span className="min-[360px]:hidden">Simulated Mural</span>
              </>,
            ],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 min-[360px]:px-3 py-1.5 text-sm transition-colors ${
              tab === id ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {label}
            {id === 'device' && tab === 'app' && <Dot active={active} />}
          </button>
        ))}
      </div>

      <main className="flex-1 min-h-0 flex flex-col lg:flex-row lg:items-start lg:gap-6 lg:p-6">
        <section
          className={`${tab === 'app' ? 'flex' : 'hidden'} lg:flex flex-col flex-1 min-h-0 lg:flex-none lg:w-[400px] lg:sticky lg:top-6 lg:h-[calc(100vh-7.5rem)] lg:max-h-[900px]`}
        >
          <div className="flex-1 min-h-0 overflow-hidden lg:rounded-[2rem] lg:border-[6px] lg:border-gray-800 bg-gray-950">
            <iframe ref={frame} src="./app.html" title="Mural's web page" className="block w-full h-full" />
          </div>
          {!wide && <Strip device={device} active={active} onOpen={() => setTab('device')} />}
          <p className="hidden lg:block mt-2 text-center text-xs text-gray-500">
            Mural's own web page, as it looks on a phone
          </p>
        </section>

        <section
          className={`${tab === 'device' ? 'block' : 'hidden'} lg:block flex-1 min-w-0 min-h-0 overflow-y-auto lg:overflow-visible p-4 lg:p-0 space-y-4`}
        >
          <Card title="On the wall">
            <div className="space-y-4">
              <WallView device={device} />
              <Mechanics device={device} />
            </div>
          </Card>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card title="Mural">
              <Status device={device} />
            </Card>
            <Card title="Demo controls">
              <Controls device={device} onReset={reset} />
            </Card>
          </div>
          <Card title="Between the app and Mural">
            <Logs device={device} />
          </Card>
        </section>
      </main>
    </div>
  )
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4 sm:p-5">
      <h2 className="mb-3 text-sm font-semibold text-gray-300">{title}</h2>
      {children}
    </section>
  )
}
