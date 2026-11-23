import { Device } from './device/device'

// The app finds the simulated Mural in the shell page around it (same origin,
// so it calls it directly). Opened on its own, it starts its own.

declare global {
  interface Window {
    muralDemoDevice?: Device
  }
}

export function hostedDevice(): Device | null {
  try {
    if (window.parent !== window && window.parent.muralDemoDevice) return window.parent.muralDemoDevice
  } catch {
    // a different origin: not our shell
  }
  return null
}

export function connectDevice(): { device: Device; hosted: boolean } {
  const parent = hostedDevice()
  if (parent) return { device: parent, hosted: true }
  if (!window.muralDemoDevice) {
    const device = new Device()
    device.start()
    window.muralDemoDevice = device
  }
  return { device: window.muralDemoDevice, hosted: false }
}
