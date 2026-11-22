import { useEffect, useRef } from 'react'

// The browser's back button goes back within the page: it closes the topmost
// open layer (a modal, or a screen that has a back button of its own) instead
// of leaving Mural.
//
// While any layer is open, one extra history entry sits on top of the page's
// own. Pressing back pops it and runs the topmost layer's handler. If a layer
// is still open afterwards (the handler only went back a step, or refused, for
// example during an update), the entry goes back on. When the last layer
// closes by other means, the entry is popped silently.

interface Layer {
  onBack: () => void
}

const layers: Layer[] = []
// Left over from before a reload, it's reused rather than stacking another.
let guarded = history.state?.muralBack === true
let ignorePops = 0
let syncQueued = false

function sync() {
  syncQueued = false
  if (layers.length > 0 && !guarded) {
    history.pushState({ muralBack: true }, '')
    guarded = true
  } else if (layers.length === 0 && guarded) {
    guarded = false
    ignorePops++
    history.back()
  }
}

// Coalesces changes made in one go, such as React's StrictMode remounting effects.
function queueSync() {
  if (syncQueued) return
  syncQueued = true
  queueMicrotask(sync)
}

window.addEventListener('popstate', () => {
  if (ignorePops > 0) {
    ignorePops--
    return
  }
  if (!guarded) {
    // Forward onto an entry of ours: reuse it, as after a reload
    guarded = history.state?.muralBack === true
    return
  }
  guarded = false
  layers[layers.length - 1]?.onBack()
  // After React has rendered whatever the handler changed
  setTimeout(sync, 0)
})

/**
 * Makes the browser's back button call `onBack` while it's non-null. Layers
 * opened later sit on top. Pass a handler that does nothing to block going back.
 */
export function useBackButton(onBack: (() => void) | null) {
  const handler = useRef(onBack)
  handler.current = onBack
  const active = onBack !== null

  useEffect(() => {
    if (!active) return
    const layer: Layer = { onBack: () => handler.current?.() }
    layers.push(layer)
    queueSync()
    return () => {
      layers.splice(layers.indexOf(layer), 1)
      queueSync()
    }
  }, [active])
}
