import { Card } from '../../components/Card'
import { Button } from '../../components/Button'
import type { PlusState } from '../types'

/** The wizard's Drawing step when Mural already has a drawing for this hanger distance. */
export function CurrentDrawingScreen(props: { state: PlusState; onUse: () => void; onChooseNew: () => void }) {
  const file = props.state.drawingFile
  return (
    <Card title="Drawing" subtitle="Mural already has a drawing on its SD card for this hanger distance.">
      <div className="rounded-xl bg-gray-800 border border-gray-700 px-4 py-4 space-y-1">
        <p className="text-base font-semibold text-white">Current drawing</p>
        <p className="text-sm text-gray-400">
          Made for a {file.topDistance} mm hanger distance. Mural keeps the drawing, not the picture it came from, so
          there's no preview.
        </p>
      </div>
      <Button onClick={props.onUse}>Use this drawing</Button>
      <Button variant="secondary" onClick={props.onChooseNew}>
        Choose a new drawing
      </Button>
    </Card>
  )
}
