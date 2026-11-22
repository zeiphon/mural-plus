import { delay, getOtaStatus, uploadOtaPart, UploadError } from './api'
import type { OtaStatus } from './types'

// Update files, as written by scripts/package_release.py:
//   "MURALUPD" (8 bytes), header length (uint32, little-endian), JSON header,
//   then the parts. Part offsets count from the end of the header.
// The browser splits the file and uploads each part on its own, so the
// firmware never has to parse it.

const MAGIC = 'MURALUPD'

export interface UpdatePart {
  name: 'ui' | 'firmware'
  offset: number
  size: number
  sha256: string
}

export interface UpdateHeader {
  format: number
  product: string
  version: string
  parts: UpdatePart[]
}

export interface UpdateFile {
  header: UpdateHeader
  ui: Blob
  firmware: Blob
  uiPart: UpdatePart
  firmwarePart: UpdatePart
}

/** Reads and checks an update file against the running firmware. Throws with a readable message. */
export async function readUpdateFile(file: File, status: OtaStatus): Promise<UpdateFile> {
  const head = await file.slice(0, 12).arrayBuffer()
  if (head.byteLength < 12 || new TextDecoder().decode(head.slice(0, 8)) !== MAGIC) {
    throw new Error("That isn't a Mural update file. Choose the file ending in -update.bin.")
  }
  const headerLength = new DataView(head).getUint32(8, true)
  let header: UpdateHeader
  try {
    header = JSON.parse(new TextDecoder().decode(await file.slice(12, 12 + headerLength).arrayBuffer()))
  } catch {
    throw new Error('The update file is damaged.')
  }
  if (header.format !== 1) {
    throw new Error('This update file needs a newer firmware to install it. Install it over USB instead.')
  }
  if (header.product !== status.product) {
    throw new Error(`This update is for ${header.product}, but this Mural runs ${status.product}.`)
  }
  const base = 12 + headerLength
  const part = (name: UpdatePart['name']) => {
    const p = header.parts.find((x) => x.name === name)
    if (!p || base + p.offset + p.size > file.size) throw new Error('The update file is incomplete.')
    return p
  }
  const uiPart = part('ui')
  const firmwarePart = part('firmware')
  if (uiPart.size !== status.uiPartitionBytes) {
    throw new Error("This update's web UI doesn't fit this board's flash layout. Install it over USB instead.")
  }
  if (firmwarePart.size > status.firmwareSlotBytes) {
    throw new Error("This update's firmware is too big for this board's flash layout. Install it over USB instead.")
  }
  const slice = (p: UpdatePart) => file.slice(base + p.offset, base + p.offset + p.size)
  return { header, ui: slice(uiPart), firmware: slice(firmwarePart), uiPart, firmwarePart }
}

export type InstallStep = 'ui' | 'firmware' | 'restarting'

const UI_PIECE_BYTES = 32 * 1024
const UI_PIECE_RETRIES = 3

/**
 * Sends the web UI image in pieces, like the drawing upload. Now and then the
 * SD card refuses a write, so a piece that fails with a server or network
 * error is sent again.
 */
async function uploadUi(blob: Blob, part: UpdatePart, onProgress: (pct: number) => void) {
  for (let offset = 0; offset < part.size; offset += UI_PIECE_BYTES) {
    const end = Math.min(offset + UI_PIECE_BYTES, part.size)
    const params = new URLSearchParams({ offset: String(offset), total: String(part.size), sha256: part.sha256 })
    for (let attempt = 0; ; attempt++) {
      try {
        await uploadOtaPart(`/ota/ui?${params}`, blob.slice(offset, end), (pct) =>
          onProgress(Math.round(((offset + ((end - offset) * pct) / 100) / part.size) * 100)),
        )
        break
      } catch (err) {
        const retryable = err instanceof UploadError && (err.status === 0 || err.status >= 500)
        if (!retryable || attempt >= UI_PIECE_RETRIES) throw err
        await delay(500 * (attempt + 1))
      }
    }
  }
}

/**
 * Uploads the web UI, then the firmware. Mural restarts to install them, and
 * this waits until it answers again (up to about three minutes).
 */
export async function installUpdate(update: UpdateFile, onProgress: (step: InstallStep, pct: number) => void) {
  const { uiPart, firmwarePart, header } = update
  await uploadUi(update.ui, uiPart, (pct) => onProgress('ui', pct))
  const params = new URLSearchParams({
    size: String(firmwarePart.size),
    sha256: firmwarePart.sha256,
    uiSha256: uiPart.sha256,
    version: header.version,
  })
  await uploadOtaPart(`/ota/firmware?${params}`, update.firmware, (pct) => onProgress('firmware', pct))
  onProgress('restarting', 0)
  await delay(8000) // restarting, then backing up and writing the web UI
  const deadline = Date.now() + 3 * 60 * 1000
  while (Date.now() < deadline) {
    try {
      return await getOtaStatus()
    } catch {
      await delay(2000)
    }
  }
  throw new Error("Mural hasn't come back after the update. Check its screen, then reload this page.")
}

/** A sentence about the last update's outcome, for an alert. */
export function describeResult(result: NonNullable<OtaStatus['result']>): string {
  const reason = result.reason ? ` ${result.reason}.` : ''
  switch (result.kind) {
    case 'updated':
      return `Mural was updated from ${result.from} to ${result.to}.`
    case 'rolled-back':
      return `The update to ${result.to} didn't work, so Mural went back to ${result.from}.${reason}`
    case 'ui-installed':
      return `The web UI ${result.to} was installed.`
    case 'ui-failed':
      return `Installing the web UI failed.${reason}`
  }
}
