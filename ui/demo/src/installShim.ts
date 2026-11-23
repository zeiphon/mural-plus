import { connectDevice } from './bridge'
import { installShim } from './shim'

// Imported first by app.tsx, so the shim is in place before any of the app's
// modules run.
const { device, hosted } = connectDevice()
installShim(device)

export const standalone = !hosted
