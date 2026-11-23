import { useEffect, useState } from 'react'
import type { BackendState } from '../types'
import type { SvgState } from '../svgControl'
import type { RasterImageState } from '../rasterControl'
import type { RendererDefinition } from '../renderers/index'
import { getRenderersByInputType } from '../renderers/index'
import { showAlert, showErrorAlert } from '../components/AlertModal'
import { Card } from '../components/Card'
import { LoadingScreen } from '../screens/LoadingScreen'
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
import { PenScreen } from './screens/PenScreen'
import { DiagnosticsScreen } from './screens/DiagnosticsScreen'
import { PlusSettingsModal } from './settings/PlusSettingsModal'
import { useBackButton } from './backButton'
import { loadUiChoice, saveUiChoice, type UiChoice } from './storage'
import {
  StepBar,
  WizardNav,
  firstUnfinishedStep,
  nextStep,
  previousStep,
  stepDone,
  type WizardStep,
} from './wizard/steps'
import { CurrentDrawingScreen } from './wizard/CurrentDrawingScreen'
import { StartScreen } from './wizard/StartScreen'

type View =
  | 'loading'
  | 'overview'
  | 'distance'
  | 'belts'
  | 'pen'
  | 'drawing'
  | 'diagnostics'
  | 'restarting'
  // Choosing a drawing: upstream's screens, in the same order as upstream's App.tsx
  | 'InputSelect'
  | 'SvgSelect'
  | 'RasterSelect'
  | 'ChooseRenderer'
  | 'DrawingPreview'
  | 'UploadProgress'
  // Basic UI only
  | 'currentDrawing'
  | 'start'

/** The wizard step a view belongs to (in the basic UI), or null outside the wizard. */
function wizardStepOf(view: View): WizardStep | null {
  switch (view) {
    case 'distance':
    case 'belts':
    case 'pen':
    case 'start':
      return view
    case 'currentDrawing':
    case 'InputSelect':
    case 'SvgSelect':
    case 'RasterSelect':
    case 'ChooseRenderer':
    case 'DrawingPreview':
    case 'UploadProgress':
      return 'drawing'
    default:
      return null
  }
}

/** The screen a wizard step opens on. */
function stepView(step: WizardStep, state: PlusState): View {
  if (step === 'drawing') return state.drawingFile?.compatible ? 'currentDrawing' : 'InputSelect'
  return step
}

/** The views that show the wizard's Back and Next; the other drawing screens have their own Back. */
const WIZARD_NAV_VIEWS: View[] = ['distance', 'belts', 'pen', 'currentDrawing', 'InputSelect', 'start']

const NEXT_HINTS: Partial<Record<WizardStep, string>> = {
  distance: 'Set the hanger distance to continue.',
  belts: 'Extend the belts to home to continue.',
  pen: 'Calibrate the pen to continue.',
  drawing: 'Choose a drawing to continue.',
}

export function PlusApp() {
  const [state, setState] = useState<PlusState | null>(null)
  const [view, setView] = useState<View>('loading')
  const [ui, setUi] = useState<UiChoice>(loadUiChoice)
  const basic = ui === 'basic'
  const [plusSettingsOpen, setPlusSettingsOpen] = useState(false)
  // Where the Diagnostics page goes back to
  const [returnView, setReturnView] = useState<View>('overview')

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
        setView(s.drawingActive ? 'drawing' : homeView(s, ui))
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

  /** Where "home" is: the Overview in advanced, the first unfinished step in basic. */
  function homeView(s: PlusState, choice: UiChoice = ui): View {
    return choice === 'basic' ? stepView(firstUnfinishedStep(s), s) : 'overview'
  }

  function go(next: View) {
    // Don't leave the pen touching the wall
    if (view === 'pen' && next !== 'pen') penUp().catch(() => {})
    setView(next)
  }

  /** A setup step's screen finished its job: back to the Overview, or on to the wizard's next step. */
  function handleStepDone(s?: BackendState) {
    const latest = (s as PlusState | undefined) ?? state
    if (s) setState(s as PlusState)
    const step = basic ? wizardStepOf(view) : null
    const after = step && nextStep(step)
    go(after && latest ? stepView(after, latest) : 'overview')
    refresh()
  }

  function handleOpenDiagnostics() {
    if (view === 'pen') penUp().catch(() => {})
    setReturnView(view)
    setView('diagnostics')
  }

  function handleBackToOverview() {
    if (view === 'diagnostics') {
      // Back to where it was opened from. A drawing moves on by itself if it has finished.
      setView(returnView)
      refresh()
      return
    }
    go('overview')
    refresh()
  }

  function handleUiChange(choice: UiChoice) {
    if (choice === ui) return
    setUi(choice)
    saveUiChoice(choice)
    if (!state) return
    // Stay on the same screen, unless it only exists in the other UI.
    const fix = (v: View): View =>
      choice === 'basic'
        ? v === 'overview'
          ? homeView(state, choice)
          : v
        : v === 'start' || v === 'currentDrawing'
          ? 'overview'
          : v
    setView(fix(view))
    setReturnView(fix(returnView))
  }

  // The wizard (basic UI)
  const wizardStep = basic ? wizardStepOf(view) : null
  const showWizardNav = wizardStep !== null && WIZARD_NAV_VIEWS.includes(view)

  function wizardBack() {
    if (!state || !wizardStep) return
    if (view === 'InputSelect' && state.drawingFile.compatible) {
      go('currentDrawing')
      return
    }
    const previous = previousStep(wizardStep)
    if (previous) go(stepView(previous, state))
  }

  async function wizardNext() {
    if (!state || !wizardStep) return
    const after = nextStep(wizardStep)
    if (!after) return
    // The step may have been undone since the last refresh, for example by retracting a belt.
    let latest = state
    try {
      latest = await getPlusState()
      setState(latest)
    } catch {
      // go by what's known
    }
    if (stepDone(wizardStep, latest)) go(stepView(after, latest))
  }

  // Keep the step bar and Next up to date while on a step. Not on the drawing
  // pipeline's own screens, which do their own work.
  useEffect(() => {
    if (!showWizardNav) return
    const id = setInterval(refresh, 3000)
    return () => clearInterval(id)
  }, [showWizardNav])

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

  function handleBackFromChooseRenderer() {
    setView(inputType === 'raster' ? 'RasterSelect' : 'SvgSelect')
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
    setView(basic ? 'start' : 'overview')
    if (message) await showAlert(message)
  }

  // The browser's back button does what the screen's own back button does.
  // During an upload it does nothing, rather than leave the page and abandon
  // the upload. Elsewhere (the overview, a drawing, a restart) it leaves the page as usual.
  function backAction(): (() => void) | null {
    if (showWizardNav) return view === 'distance' ? null : wizardBack
    switch (view) {
      case 'distance':
      case 'belts':
      case 'pen':
      case 'diagnostics':
      case 'InputSelect':
        return handleBackToOverview
      case 'SvgSelect':
      case 'RasterSelect':
        return handleBackToInputSelect
      case 'ChooseRenderer':
        return handleBackFromChooseRenderer
      case 'DrawingPreview':
        return handleBackFromDrawingPreview
      case 'UploadProgress':
        return () => {}
      default:
        return null
    }
  }
  useBackButton(backAction())

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
          onOpenSettings={() => setPlusSettingsOpen(true)}
        />
      )
      break
    case 'distance':
      screen = <DistanceScreen state={state} onDone={handleStepDone} />
      break
    case 'belts':
      screen = <BeltsScreen state={state} onDone={handleStepDone} />
      break
    case 'pen':
      screen = <PenScreen state={state} onDone={handleStepDone} />
      break
    case 'drawing':
      screen = <DrawingScreen initialState={state} onFinished={handleDrawingFinished} />
      break
    case 'diagnostics':
      screen = <DiagnosticsScreen onSwitchToClassic={handleSwitchToClassic} />
      break
    case 'currentDrawing':
      screen = <CurrentDrawingScreen state={state} onUse={() => go('start')} onChooseNew={() => go('InputSelect')} />
      break
    case 'start':
      screen = (
        <StartScreen
          state={state}
          onStarted={(s) => {
            setState(s)
            setView('drawing')
          }}
          onStateChange={setState}
          onOpenStep={(step) => go(stepView(step, state))}
        />
      )
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
          onBack={handleBackFromChooseRenderer}
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
        <UploadProgressScreen commands={renderedCommands!} onDone={handleStepDone} onError={handleUploadError} />
      )
      break
  }

  // While drawing (including Diagnostics opened from the drawing), the settings
  // only show what can change during a drawing.
  const duringDrawing = view === 'drawing' || (view === 'diagnostics' && returnView === 'drawing')
  const settled = !duringDrawing && view !== 'UploadProgress' && view !== 'restarting'
  const footer = (
    <p className="mt-6 text-xs sm:text-sm text-gray-600">
      <a href="https://github.com/nikivanov/mural" className="hover:text-gray-400 transition-colors">
        Mural
      </a>{' '}
      Plus
      {(settled || view === 'drawing') && view !== 'diagnostics' && (
        <>
          {' · '}
          <button onClick={handleOpenDiagnostics} className="hover:text-gray-400 transition-colors">
            Diagnostics
          </button>
        </>
      )}
      {settled && view !== 'diagnostics' && (
        <>
          {' · '}
          <button
            onClick={() => handleUiChange(basic ? 'advanced' : 'basic')}
            className="hover:text-gray-400 transition-colors"
          >
            {basic ? 'Advanced view' : 'Basic view'}
          </button>
        </>
      )}
    </p>
  )

  const showBack = view === 'diagnostics' || (!basic && settled && view !== 'overview')
  const showGear = settled || duringDrawing
  const corners = (showBack || showGear) && (
    <>
      {showBack && (
        <button
          onClick={handleBackToOverview}
          className="absolute top-4 left-4 text-sm text-gray-400 hover:text-gray-200 transition-colors z-10"
        >
          {view === 'diagnostics' ? '← Back' : '← Overview'}
        </button>
      )}
      {showGear && (
        <button
          onClick={() => setPlusSettingsOpen(true)}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-200 transition-colors text-2xl leading-none z-10"
          aria-label="Open settings"
        >
          ⚙
        </button>
      )}
    </>
  )

  return (
    <Page
      footer={footer}
      corners={corners || undefined}
      top={
        wizardStep && (
          <StepBar
            state={state}
            current={wizardStep}
            locked={view === 'UploadProgress'}
            onSelect={(step) => go(stepView(step, state))}
          />
        )
      }
    >
      {wizardStep ? (
        <div className="space-y-4 sm:space-y-6">
          {screen}
          {showWizardNav && (
            <WizardNav
              onBack={view === 'distance' ? undefined : wizardBack}
              onNext={view === 'currentDrawing' || view === 'start' ? undefined : wizardNext}
              nextEnabled={stepDone(wizardStep, state)}
              nextHint={NEXT_HINTS[wizardStep]}
            />
          )}
        </div>
      ) : (
        screen
      )}
      <PlusSettingsModal
        isOpen={plusSettingsOpen}
        drawing={duringDrawing}
        ui={ui}
        onUiChange={handleUiChange}
        onClose={() => {
          setPlusSettingsOpen(false)
          refresh() // moving the belts or changing the pulley diameter forgets the belt position
        }}
      />
    </Page>
  )
}
