import { useEffect, useState } from 'react'
import type { BackendState } from '../types'
import type { SvgState } from '../svgControl'
import type { RasterImageState } from '../rasterControl'
import type { RendererDefinition } from '../renderers/index'
import { getRenderersByInputType } from '../renderers/index'
import { showAlert, showErrorAlert } from '../components/AlertModal'
import { Card } from '../components/Card'
import { ToolsModal } from '../components/ToolsModal'
import { LoadingScreen } from '../screens/LoadingScreen'
import { PenCalibrationScreen } from '../screens/PenCalibrationScreen'
import { InputSelectScreen } from '../screens/InputSelectScreen'
import { SvgUploadScreen } from '../screens/SvgUploadScreen'
import { RasterUploadScreen } from '../screens/RasterUploadScreen'
import { ChooseRendererScreen } from '../screens/ChooseRendererScreen'
import { DrawingPreviewScreen } from '../screens/DrawingPreviewScreen'
import { UploadProgressScreen } from '../screens/UploadProgressScreen'
import { getPlusState, setMode, penUp, reloadWhenBack, errorMessage } from './api'
import type { PlusState, SetupStep } from './types'
import { Page } from './Page'
import { OverviewScreen } from './screens/OverviewScreen'
import { DistanceScreen } from './screens/DistanceScreen'
import { BeltsScreen } from './screens/BeltsScreen'
import { DrawingScreen } from './screens/DrawingScreen'

type View =
  | 'loading'
  | 'overview'
  | 'distance'
  | 'belts'
  | 'pen'
  | 'drawing'
  | 'restarting'
  // Choosing a drawing: upstream's screens, in the same order as upstream's App.tsx
  | 'InputSelect'
  | 'SvgSelect'
  | 'RasterSelect'
  | 'ChooseRenderer'
  | 'DrawingPreview'
  | 'UploadProgress'

export function PlusApp() {
  const [state, setState] = useState<PlusState | null>(null)
  const [view, setView] = useState<View>('loading')
  const [toolsOpen, setToolsOpen] = useState(false)

  // Drawing pipeline state, as in upstream's App.tsx
  const [svgState, setSvgState] = useState<SvgState | null>(null)
  const [rasterState, setRasterState] = useState<RasterImageState | null>(null)
  const [inputType, setInputType] = useState<'svg' | 'raster' | null>(null)
  const [selectedRenderer, setSelectedRenderer] = useState<RendererDefinition | null>(null)
  const [renderedCommands, setRenderedCommands] = useState<string | null>(null)

  useEffect(() => {
    getPlusState()
      .then((s) => {
        setState(s)
        setView(s.drawingActive ? 'drawing' : 'overview')
      })
      .catch(() => showErrorAlert('Failed to retrieve state'))
  }, [])

  async function refresh() {
    try {
      setState(await getPlusState())
    } catch {
      // keep the last state
    }
  }

  function showOverview(s?: BackendState) {
    if (s) setState(s as PlusState)
    setView('overview')
    refresh()
  }

  function handleBackToOverview() {
    if (view === 'pen') {
      // Don't leave the pen touching the wall
      penUp().catch(() => {})
    }
    showOverview()
  }

  function handleOpenStep(step: SetupStep) {
    setView(step === 'drawing' ? 'InputSelect' : step)
  }

  async function handleSwitchToClassic() {
    if (!confirm("Switch to classic Mural? Mural will restart, and you'll need to set it up again.")) return
    try {
      await setMode('classic')
      setView('restarting')
      await reloadWhenBack()
    } catch (err) {
      await showAlert(`Couldn't switch: ${errorMessage(err)}`)
    }
  }

  // Drawing pipeline handlers, ported from upstream's App.tsx
  function handleBackToInputSelect() {
    setSvgState(null)
    setRasterState(null)
    setSelectedRenderer(null)
    setInputType(null)
    setView('InputSelect')
  }

  function handleSvgPreview(s: SvgState) {
    setSvgState(s)
    setView('ChooseRenderer')
  }

  function handleRasterPreview(s: RasterImageState) {
    setRasterState(s)
    const rasterRenderers = getRenderersByInputType('raster')
    if (rasterRenderers.length === 1) {
      setSelectedRenderer(rasterRenderers[0])
      setView('DrawingPreview')
    } else {
      setView('ChooseRenderer')
    }
  }

  function handleBackFromDrawingPreview() {
    if (inputType === 'raster' && getRenderersByInputType('raster').length === 1) {
      setView('RasterSelect')
    } else {
      setView('ChooseRenderer')
    }
  }

  async function handleUploadError(message: string) {
    await showAlert(message)
    setView('DrawingPreview')
  }

  async function handleDrawingFinished(s: PlusState, message?: string) {
    setState(s)
    setView('overview')
    if (message) await showAlert(message)
  }

  if (!state || view === 'loading') {
    return (
      <Page>
        <LoadingScreen />
      </Page>
    )
  }

  let screen
  switch (view) {
    case 'overview':
      screen = (
        <OverviewScreen
          state={state}
          onOpen={handleOpenStep}
          onStarted={(s) => {
            setState(s)
            setView('drawing')
          }}
          onStateChange={setState}
        />
      )
      break
    case 'distance':
      screen = <DistanceScreen state={state} onDone={showOverview} />
      break
    case 'belts':
      screen = <BeltsScreen state={state} onDone={showOverview} />
      break
    case 'pen':
      screen = <PenCalibrationScreen onDone={showOverview} />
      break
    case 'drawing':
      screen = <DrawingScreen initialState={state} onFinished={handleDrawingFinished} />
      break
    case 'restarting':
      screen = (
        <Card title="Restarting…">
          <LoadingScreen />
        </Card>
      )
      break
    case 'InputSelect':
      screen = (
        <InputSelectScreen
          onSelectSvg={() => {
            setInputType('svg')
            setView('SvgSelect')
          }}
          onSelectRaster={() => {
            setInputType('raster')
            setView('RasterSelect')
          }}
        />
      )
      break
    case 'SvgSelect':
      screen = (
        <SvgUploadScreen
          state={state}
          initialState={svgState ?? undefined}
          onPreview={handleSvgPreview}
          onBack={handleBackToInputSelect}
        />
      )
      break
    case 'RasterSelect':
      screen = (
        <RasterUploadScreen
          state={state}
          initialState={rasterState ?? undefined}
          onPreview={handleRasterPreview}
          onBack={handleBackToInputSelect}
        />
      )
      break
    case 'ChooseRenderer':
      screen = (
        <ChooseRendererScreen
          renderers={getRenderersByInputType(inputType!)}
          onChoose={(r) => {
            setSelectedRenderer(r)
            setView('DrawingPreview')
          }}
          onBack={() => setView(inputType === 'raster' ? 'RasterSelect' : 'SvgSelect')}
        />
      )
      break
    case 'DrawingPreview':
      screen = (
        <DrawingPreviewScreen
          state={state}
          svgState={svgState ?? undefined}
          imageState={rasterState ?? undefined}
          renderer={selectedRenderer!}
          onAccept={(commands) => {
            setRenderedCommands(commands)
            setView('UploadProgress')
          }}
          onBack={handleBackFromDrawingPreview}
        />
      )
      break
    case 'UploadProgress':
      screen = (
        <UploadProgressScreen commands={renderedCommands!} onDone={showOverview} onError={handleUploadError} />
      )
      break
  }

  const settled = view !== 'drawing' && view !== 'UploadProgress' && view !== 'restarting'
  const footer = (
    <p className="mt-6 text-xs sm:text-sm text-gray-600">
      <a href="https://github.com/nikivanov/mural" className="hover:text-gray-400 transition-colors">
        Mural
      </a>{' '}
      Plus
      {settled && (
        <>
          {' · '}
          <button onClick={handleSwitchToClassic} className="hover:text-gray-400 transition-colors">
            Switch to classic
          </button>
        </>
      )}
    </p>
  )

  return (
    <Page footer={footer}>
      {settled && view !== 'overview' && (
        <button
          onClick={handleBackToOverview}
          className="fixed top-4 left-4 text-sm text-gray-400 hover:text-gray-200 transition-colors z-10"
        >
          ← Overview
        </button>
      )}
      {settled && (
        <button
          onClick={() => setToolsOpen(true)}
          className="fixed top-4 right-4 text-gray-400 hover:text-gray-200 transition-colors text-2xl leading-none z-10"
          aria-label="Open tools"
        >
          ⚙
        </button>
      )}
      {screen}
      {/* Only mounted while not drawing: closing it sends motor stops, which
          Mural rejects while drawing. */}
      {settled && (
        <ToolsModal
          isOpen={toolsOpen}
          onClose={() => {
            setToolsOpen(false)
            refresh()
          }}
        />
      )}
    </Page>
  )
}
