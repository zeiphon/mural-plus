import { useCallback, useState } from 'react'
import { Button } from '../../components/Button'
import { useBackButton } from '../backButton'
import type { UiChoice } from '../storage'
import { PlusSettings } from './PlusSettings'
import { FirmwareUpdate } from './FirmwareSettings'

interface Props {
  isOpen: boolean
  /** A drawing is running (updates aren't allowed then) */
  drawing: boolean
  ui: UiChoice
  onUiChange: (choice: UiChoice) => void
  onClose: () => void
}

/** Plus mode's settings (the ⚙), in a scrollable modal. Plus doesn't use upstream's Tools modal. */
export function PlusSettingsModal({ isOpen, ...props }: Props) {
  if (!isOpen) return null
  // Mounted afresh each time, so it opens on the main page
  return <SettingsDialog {...props} />
}

function SettingsDialog({ drawing, ui, onUiChange, onClose }: Omit<Props, 'isOpen'>) {
  const [page, setPage] = useState<'main' | 'update'>('main')
  const [installing, setInstalling] = useState(false)
  const handleInstallingChange = useCallback((on: boolean) => setInstalling(on), [])

  // Closing or leaving the update page mid-install would abandon it.
  function handleBack() {
    if (installing) return
    if (page === 'update') setPage('main')
    else onClose()
  }

  function handleClose() {
    if (!installing) onClose()
  }

  useBackButton(handleBack)

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4 sm:p-6"
      onClick={(e) => e.target === e.currentTarget && handleClose()}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-sm sm:max-w-md lg:max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex flex-none items-center gap-3 border-b border-gray-800 px-6 sm:px-8 py-4">
          {page === 'update' && (
            <button
              onClick={handleBack}
              disabled={installing}
              className="text-gray-400 hover:text-gray-200 transition-colors text-lg leading-none disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Back to settings"
            >
              ←
            </button>
          )}
          <h2 className="flex-1 text-base sm:text-lg font-semibold text-white">
            {page === 'update' ? 'Firmware update' : 'Settings'}
          </h2>
          <button
            onClick={handleClose}
            disabled={installing}
            className="text-gray-400 hover:text-gray-200 transition-colors text-xl leading-none disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto px-6 sm:px-8 py-5 space-y-5">
          {page === 'update' ? (
            <>
              <FirmwareUpdate drawing={drawing} onInstallingChange={handleInstallingChange} />
              <Button onClick={handleBack} variant="secondary" disabled={installing}>
                Back to settings
              </Button>
              {installing && (
                <p className="text-xs text-yellow-400 text-center">Keep this page open until the update has finished.</p>
              )}
            </>
          ) : (
            <>
              <PlusSettings ui={ui} onUiChange={onUiChange} onOpenUpdate={() => setPage('update')} />
              <Button onClick={onClose} variant="primary">
                Close
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
