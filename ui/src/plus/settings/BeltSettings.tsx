import { useState } from 'react'
import { estepsCalibration, setPulleyDiameter } from '../../api'
import { showAlert } from '../../components/AlertModal'
import { errorMessage } from '../api'
import type { PlusState } from '../types'
import { Help } from '../components/Help'
import { MotorControls } from '../components/MotorControls'
import { NumberField, SmallButton } from '../components/Controls'

/** Upstream's Tools modal controls: the motor jog, pulley diameter and e-steps calibration. Not while drawing. */
export function BeltSettings({ state, onChange }: { state: PlusState; onChange: () => void }) {
  return (
    <>
      <div className="space-y-2">
        <MotorControls onChange={onChange} />
        <Help label="About moving the belts by hand">
          <p>Each motor runs until you press Stop. A retracting belt ends with the motor stalling against the stops.</p>
          <p>
            Moving a belt by hand means Mural no longer knows the belt position, so extend to home again before drawing.
            The motors stop when you close this, leave the page or lock the phone.
          </p>
        </Help>
      </div>
      <PulleyForm
        key={state.pulleyDiameter} // back to the saved value after a save
        saved={state.pulleyDiameter}
        onSaved={onChange}
      />
      <EstepsForm onDone={onChange} />
    </>
  )
}

function PulleyForm({ saved, onSaved }: { saved: number | undefined; onSaved: () => void }) {
  const [value, setValue] = useState(saved === undefined ? '' : String(saved))
  const parsed = Number(value)
  const changed = value.trim() !== '' && parsed !== saved

  async function handleSave() {
    if (!Number.isFinite(parsed) || parsed <= 0) {
      await showAlert('Please enter a diameter in millimeters')
      return
    }
    try {
      await setPulleyDiameter(parsed)
    } catch (err) {
      await showAlert(errorMessage(err))
    }
    onSaved()
  }

  return (
    <div className="space-y-2">
      <NumberField label="Pulley diameter (mm)" value={value} onChange={setValue} step="any" placeholder="e.g. 10.14926" />
      {changed && (
        <SmallButton onClick={handleSave} primary>
          Save pulley diameter
        </SmallButton>
      )}
    </div>
  )
}

function EstepsForm({ onDone }: { onDone: () => void }) {
  const [distance, setDistance] = useState('1000')

  async function handleExtend() {
    const mm = Number(distance)
    if (!Number.isFinite(mm) || mm <= 0) {
      await showAlert('Please enter a valid distance in millimeters')
      return
    }
    try {
      await estepsCalibration(mm)
    } catch (err) {
      await showAlert(errorMessage(err))
    }
    onDone()
  }

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <NumberField label="E-steps calibration distance (mm)" value={distance} onChange={setDistance} placeholder="e.g. 1000" />
        </div>
        <SmallButton onClick={handleExtend}>Extend</SmallButton>
      </div>
      <Help label="How to calibrate the pulley diameter">
        <p>
          Extend lets out both belts by this distance. Measure how far they really moved, then set the pulley diameter
          to: current diameter × measured ÷ requested.
        </p>
        <p>Extending and saving a new diameter both make Mural forget the belt position, so extend to home afterwards.</p>
      </Help>
    </div>
  )
}
