import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../../src/index.css'
import { Device } from '../device/device'
import { Shell } from './Shell'

// The simulated Mural lives here, outside the iframe, so it keeps running when
// the app reloads, as a real Mural does when the browser reloads. It's created
// before the iframe exists, so the app always finds it.
const device = new Device()
device.start()
window.muralDemoDevice = device

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Shell device={device} />
  </StrictMode>,
)
