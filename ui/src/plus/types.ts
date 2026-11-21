import type { BackendState } from '../types'

/** /getState in plus mode: upstream's BackendState plus the plus fields (src/plus/controller.cpp). */
export interface PlusState extends BackendState {
  mode: 'plus'
  status: 'idle' | 'moving' | 'homing' | 'drawing'
  drawingActive: boolean
  /** Why the last drawing failed to start, or '' */
  lastError: string
  position: { known: boolean; homing: boolean }
  pen: { calibrated: boolean; down: number }
  /** topDistance: the hanger distance the drawing was made for, -1 = none */
  drawingFile: { exists: boolean; topDistance: number; compatible: boolean }
  ready: { distance: boolean; position: boolean; pen: boolean; drawing: boolean; all: boolean }
}

export type SetupStep = 'distance' | 'drawing' | 'belts' | 'pen'
