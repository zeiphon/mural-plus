import { useEffect, useState } from 'react'
import { ProgressBar } from '../../components/ProgressBar'
import { showAlert } from '../../components/AlertModal'
import { errorMessage, getOtaStatus } from '../api'
import { installUpdate, readUpdateFile, type InstallStep, type UpdateFile } from '../update'
import type { OtaStatus } from '../types'
import { Help } from '../components/Help'

const STEP_LABELS: Record<InstallStep, string> = {
  ui: 'Uploading the web UI',
  firmware: 'Uploading the firmware',
  restarting: 'Restarting and installing. This can take a minute…',
}

/** The installed version, and installing an update file (src/plus/ota.cpp). */
export function FirmwareSettings({ drawing }: { drawing: boolean }) {
  const [status, setStatus] = useState<OtaStatus | null>(null)
  const [update, setUpdate] = useState<UpdateFile | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ step: InstallStep; pct: number } | null>(null)

  useEffect(() => {
    getOtaStatus()
      .then(setStatus)
      .catch(() => {})
  }, [])

  if (!status) {
    return <p className="text-sm text-gray-500">Loading…</p>
  }

  const installing = progress !== null
  const blocked = drawing ? 'Not available while drawing' : status.busy

  async function handleFile(file: File | undefined) {
    setUpdate(null)
    setFileError(null)
    if (!file || !status) return
    try {
      setUpdate(await readUpdateFile(file, status))
    } catch (err) {
      setFileError(errorMessage(err))
    }
  }

  async function handleInstall() {
    if (!update || !status) return
    const { version } = update.header
    if (!confirm(`Install ${version}? Mural will restart. Don't turn it off until the page reloads.`)) return
    setProgress({ step: 'ui', pct: 0 })
    try {
      await installUpdate(update, (step, pct) => setProgress({ step, pct }))
      location.reload() // the new web UI, which shows how the update went
    } catch (err) {
      setProgress(null)
      await showAlert(`The update didn't install: ${errorMessage(err)}`)
      getOtaStatus()
        .then(setStatus)
        .catch(() => {})
    }
  }

  const sameVersion = update && update.header.version === status.firmware

  return (
    <div className="space-y-3">
      <div className="text-sm text-gray-200">
        Version <span className="font-mono text-gray-400">{status.firmware}</span>
        <p className="text-xs text-gray-500">Firmware slot {status.slot}</p>
        {status.ui && status.ui !== status.firmware && (
          <p className="text-xs text-yellow-400">
            The web UI is version {status.ui}, which doesn't match the firmware. Install an update to fix it.
          </p>
        )}
      </div>

      {installing ? (
        <ProgressBar
          label={STEP_LABELS[progress.step]}
          value={progress.step === 'restarting' ? 100 : progress.pct}
          animated={progress.step === 'restarting'}
        />
      ) : (
        <>
          <label className="block space-y-1">
            <span className="block text-xs text-gray-500">Update file (ends in -update.bin)</span>
            <input
              type="file"
              accept=".bin"
              disabled={!!blocked}
              onChange={(e) => handleFile(e.target.files?.[0])}
              className="block w-full text-sm text-gray-300 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-700 file:px-3 file:py-2 file:text-sm file:text-gray-200 disabled:opacity-40"
            />
          </label>
          {fileError && <p className="text-xs text-red-400">{fileError}</p>}
          {update && (
            <div className="space-y-2">
              <p className="text-sm text-gray-200">
                Update to <span className="font-mono">{update.header.version}</span>
              </p>
              {sameVersion && <p className="text-xs text-gray-500">This version is already installed. Installing it again is fine.</p>}
              <button
                onClick={handleInstall}
                disabled={!!blocked}
                className="rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-cyan-600 enabled:hover:bg-cyan-500 text-white"
              >
                Install update
              </button>
            </div>
          )}
          {blocked && <p className="text-xs text-gray-500">{blocked}</p>}
          <Help label="What an update keeps">
            <p>Settings and the drawing are kept. If the new version doesn't start properly, Mural goes back to this one.</p>
          </Help>
        </>
      )}
    </div>
  )
}
