import { DEVICE_ROUTES, type DemoRequest, type DemoResponse } from './device/device'

// Replaces window.fetch and window.XMLHttpRequest so the app's requests to
// Mural's routes (absolute paths such as /getState) go to the simulated
// device. Everything else, such as the worker's own files, goes to the network.

export interface DeviceLike {
  handle(req: DemoRequest): Promise<DemoResponse>
}

function deviceUrl(input: string): URL | null {
  const url = new URL(input, location.href)
  if (url.origin !== location.origin || !DEVICE_ROUTES.has(url.pathname)) return null
  return url
}

/** Turns a request body into form fields and an uploaded file, as the firmware sees them. */
async function readBody(body: unknown, path: string, params: Record<string, string>): Promise<DemoRequest['file']> {
  if (body == null) return undefined
  if (typeof body === 'string') {
    new URLSearchParams(body).forEach((v, k) => (params[k] = v))
    return undefined
  }
  if (body instanceof URLSearchParams) {
    body.forEach((v, k) => (params[k] = v))
    return undefined
  }
  if (body instanceof FormData) {
    let file: DemoRequest['file']
    for (const [key, value] of body.entries()) {
      if (typeof value === 'string') {
        params[key] = value
      } else {
        // Only the drawing is read; the device ignores update images
        const text = path === '/uploadCommands' ? await value.text() : null
        file = { field: key, name: (value as File).name ?? 'blob', size: value.size, text }
      }
    }
    return file
  }
  if (body instanceof Blob) {
    return { field: 'body', name: 'blob', size: body.size, text: null }
  }
  return undefined
}

async function toRequest(method: string, url: URL, body: unknown): Promise<DemoRequest> {
  const params: Record<string, string> = {}
  url.searchParams.forEach((v, k) => (params[k] = v))
  const file = await readBody(body, url.pathname, params)
  return { method: method.toUpperCase(), path: url.pathname, params, file }
}

export function installShim(device: DeviceLike) {
  const realFetch = window.fetch.bind(window)
  const RealXHR = window.XMLHttpRequest

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = deviceUrl(href)
    if (!url) return realFetch(input, init)
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    const req = await toRequest(method, url, init?.body)
    let res: DemoResponse
    try {
      res = await device.handle(req)
    } catch {
      throw new TypeError('Failed to fetch')
    }
    return new Response(res.body, { status: res.status, headers: { 'Content-Type': res.contentType } })
  }

  window.XMLHttpRequest = makeXhr(device, RealXHR) as unknown as typeof XMLHttpRequest
}

type Handler = ((this: unknown, ev: ProgressEvent) => unknown) | null

const XHR_EVENTS = ['loadstart', 'progress', 'load', 'error', 'abort', 'timeout', 'loadend', 'readystatechange'] as const

class Upload extends EventTarget {
  onloadstart: Handler = null
  onprogress: Handler = null
  onload: Handler = null
  onerror: Handler = null
  onabort: Handler = null
  ontimeout: Handler = null
  onloadend: Handler = null
}

function fire(target: EventTarget, type: string, init: ProgressEventInit = {}) {
  const event = new ProgressEvent(type, init)
  target.dispatchEvent(event)
  const handler = (target as unknown as Record<string, Handler>)[`on${type}`]
  if (typeof handler === 'function') handler.call(target, event)
}

function makeXhr(device: DeviceLike, RealXHR: typeof XMLHttpRequest) {
  return class DemoXHR extends EventTarget {
    static readonly UNSENT = 0
    static readonly OPENED = 1
    static readonly HEADERS_RECEIVED = 2
    static readonly LOADING = 3
    static readonly DONE = 4

    readyState = 0
    status = 0
    statusText = ''
    responseText = ''
    response: unknown = ''
    responseType: XMLHttpRequestResponseType = ''
    responseURL = ''
    timeout = 0
    withCredentials = false
    upload = new Upload()

    onloadstart: Handler = null
    onprogress: Handler = null
    onload: Handler = null
    onerror: Handler = null
    onabort: Handler = null
    ontimeout: Handler = null
    onloadend: Handler = null
    onreadystatechange: Handler = null

    private method = 'GET'
    private href = ''
    private headers: [string, string][] = []
    private contentType = ''
    private real: XMLHttpRequest | null = null
    private aborted = false

    open(method: string, url: string | URL) {
      this.method = method
      this.href = String(url)
      this.readyState = 1
    }

    setRequestHeader(name: string, value: string) {
      this.headers.push([name, value])
    }

    getResponseHeader(name: string) {
      if (this.real) return this.real.getResponseHeader(name)
      return name.toLowerCase() === 'content-type' && this.contentType ? this.contentType : null
    }

    getAllResponseHeaders() {
      if (this.real) return this.real.getAllResponseHeaders()
      return this.contentType ? `content-type: ${this.contentType}\r\n` : ''
    }

    overrideMimeType() {}

    abort() {
      this.aborted = true
      if (this.real) this.real.abort()
    }

    send(body?: Document | XMLHttpRequestBodyInit | null) {
      const url = deviceUrl(this.href)
      if (!url) {
        this.delegate(body)
        return
      }
      void this.simulate(url, body)
    }

    /** Not one of Mural's routes: a real request, with its events passed on. */
    private delegate(body?: Document | XMLHttpRequestBodyInit | null) {
      const real = new RealXHR()
      this.real = real
      real.responseType = this.responseType
      real.timeout = this.timeout
      real.withCredentials = this.withCredentials
      real.open(this.method, this.href)
      for (const [k, v] of this.headers) real.setRequestHeader(k, v)
      const sync = () => {
        this.readyState = real.readyState
        this.status = real.status
        this.statusText = real.statusText
        this.responseURL = real.responseURL
        if (real.responseType === '' || real.responseType === 'text') this.responseText = real.responseText
        this.response = real.response
      }
      for (const type of XHR_EVENTS) {
        real.addEventListener(type, (e) => {
          sync()
          const p = e as ProgressEvent
          fire(this, type, { lengthComputable: p.lengthComputable, loaded: p.loaded, total: p.total })
        })
      }
      for (const type of XHR_EVENTS.filter((t) => t !== 'readystatechange')) {
        real.upload.addEventListener(type, (e) => {
          const p = e as ProgressEvent
          fire(this.upload, type, { lengthComputable: p.lengthComputable, loaded: p.loaded, total: p.total })
        })
      }
      real.send(body)
    }

    private async simulate(url: URL, body: unknown) {
      const size = body instanceof FormData ? formSize(body) : typeof body === 'string' ? body.length : 0
      fire(this, 'loadstart', { loaded: 0, total: 0 })
      fire(this.upload, 'loadstart', { lengthComputable: true, loaded: 0, total: size })
      // Upload progress while the device takes its time with the request
      let sent = 0
      const ticker = setInterval(() => {
        sent = Math.min(size, sent + Math.max(1, size / 6))
        fire(this.upload, 'progress', { lengthComputable: true, loaded: sent, total: size })
      }, 80)
      let res: DemoResponse | null = null
      try {
        const req = await toRequest(this.method, url, body)
        res = await device.handle(req)
      } catch {
        res = null
      }
      clearInterval(ticker)
      if (this.aborted) {
        this.readyState = 4
        fire(this, 'abort')
        fire(this, 'loadend')
        return
      }
      if (!res) {
        this.readyState = 4
        this.status = 0
        fire(this, 'readystatechange')
        fire(this.upload, 'error')
        fire(this, 'error')
        fire(this, 'loadend')
        return
      }
      fire(this.upload, 'progress', { lengthComputable: true, loaded: size, total: size })
      fire(this.upload, 'load', { lengthComputable: true, loaded: size, total: size })
      fire(this.upload, 'loadend', { lengthComputable: true, loaded: size, total: size })
      this.status = res.status
      this.statusText = res.status === 200 ? 'OK' : ''
      this.contentType = res.contentType
      this.responseURL = url.href
      this.readyState = 2
      fire(this, 'readystatechange')
      this.readyState = 3
      fire(this, 'readystatechange')
      // Download progress, as a large drawing would come back in pieces
      const total = res.body.length
      for (const share of [0.33, 0.66, 1]) {
        fire(this, 'progress', { lengthComputable: true, loaded: Math.round(total * share), total })
      }
      this.responseText = res.body
      this.response = this.responseType === 'json' ? safeJson(res.body) : res.body
      this.readyState = 4
      fire(this, 'readystatechange')
      fire(this, 'load', { lengthComputable: true, loaded: total, total })
      fire(this, 'loadend', { lengthComputable: true, loaded: total, total })
    }
  }
}

function formSize(form: FormData): number {
  let size = 0
  for (const [, value] of form.entries()) size += typeof value === 'string' ? value.length : value.size
  return size
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
