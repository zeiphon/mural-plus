import { Button } from '../../components/Button'
import { PlusSettings } from './PlusSettings'

interface Props {
  isOpen: boolean
  onClose: () => void
}

/** Plus mode's settings (the ⚙), in a scrollable modal. Plus doesn't use upstream's Tools modal. */
export function PlusSettingsModal({ isOpen, onClose }: Props) {
  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4 sm:p-6"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-sm sm:max-w-md lg:max-w-lg max-h-[90vh] overflow-y-auto p-6 sm:p-8 space-y-5 sm:space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base sm:text-lg font-semibold text-white">Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 transition-colors text-xl leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <PlusSettings />
        <Button onClick={onClose} variant="primary">
          Close
        </Button>
      </div>
    </div>
  )
}
