import { useEffect, useRef, useState } from 'react'
import type { Device } from '../device/device'
import { homePoint, imageToFrame, type Point } from '../device/kinematics'
import { SAFE_X_FRACTION, SAFE_Y_FRACTION } from '../device/constants'
import { useFrame } from './hooks'

// The wall: the pins, the drawing area, the drawing still to come (faint), the
// ink so far, and the bot hanging from its belts. Two canvases: the wall and
// the ink (redrawn only when needed, the ink added to as it's drawn), and the
// moving parts on top (every frame).

const BOT = { halfWidth: 58, top: -46, bottom: 26, pulleyX: 44.75, pulleyY: -20, pulleyR: 11 }

const COLORS = {
  wall: '#0b1018',
  pins: '#9ca3af',
  area: '#374151',
  plan: '#334155',
  ink: '#e5e7eb',
  belt: '#6b7280',
  beltActive: '#22d3ee',
  bot: '#1f2937',
  botEdge: '#4b5563',
  motor: '#111827',
  spoke: '#9ca3af',
  spokeActive: '#22d3ee',
  stalled: '#f87171',
  penUp: '#9ca3af',
  penDown: '#fbbf24',
  text: '#9ca3af',
  home: '#22d3ee',
}

interface View {
  d: number
  x0: number
  y0: number
  scale: number
  width: number
  height: number
}

/** Fits the wall into the width, and into at most `maxHeight` px, centred. */
function makeView(width: number, maxHeight: number, d: number, drawingHeight: number): View {
  const homeY = imageToFrame(homePoint(d), d).y
  const yMax = Math.max(0.85 * d, SAFE_Y_FRACTION * d + drawingHeight + 0.06 * d, homeY + 0.12 * d)
  const y0 = -0.06 * d
  const scale = Math.min(width / (1.08 * d), maxHeight / (yMax - y0))
  const x0 = d / 2 - width / scale / 2
  return { d, x0, y0, scale, width, height: Math.round((yMax - y0) * scale) }
}

/** How much bigger than life the bot is drawn, so it stays visible on a large wall. */
function botSize(v: View) {
  return v.scale * Math.max(1, 34 / (BOT.halfWidth * 2 * v.scale))
}

export function WallView({ device }: { device: Device }) {
  const wrap = useRef<HTMLDivElement>(null)
  const base = useRef<HTMLCanvasElement>(null)
  const top = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(600)
  const drawn = useRef({ key: '', epoch: -1, stroke: 0, point: 0 })
  const [caption, setCaption] = useState('')

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(Math.max(240, Math.floor(el.clientWidth))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useFrame(() => {
    const d = device.wallDistance
    const h = device.drawingHeight()
    const view = makeView(width, Math.max(260, Math.min(560, window.innerHeight * 0.55)), d, h)
    const dpr = window.devicePixelRatio || 1
    for (const c of [base.current, top.current]) {
      if (!c) return
      if (c.width !== Math.round(view.width * dpr) || c.height !== Math.round(view.height * dpr)) {
        c.width = Math.round(view.width * dpr)
        c.height = Math.round(view.height * dpr)
        c.style.height = `${view.height}px`
        drawn.current.key = ''
      }
    }
    const key = `${width}|${d}|${h}|${device.planVersion}|${device.movement.topDistance}`
    const bctx = base.current!.getContext('2d')!
    if (drawn.current.key !== key || drawn.current.epoch !== device.trailEpoch) {
      drawn.current = { key, epoch: device.trailEpoch, stroke: 0, point: 0 }
      bctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawWall(bctx, view, device, h)
    }
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawInk(bctx, view, device, drawn.current)

    const tctx = top.current!.getContext('2d')!
    tctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    tctx.clearRect(0, 0, view.width, view.height)
    const text = drawBot(tctx, view, device)
    if (text !== caption) setCaption(text)
  })

  return (
    <div ref={wrap} className="relative w-full">
      <canvas ref={base} className="block w-full rounded-xl" />
      <canvas ref={top} className="absolute inset-0 block w-full" />
      {caption && (
        <p className="absolute bottom-2 left-0 right-0 text-center text-xs text-gray-400 pointer-events-none">
          {caption}
        </p>
      )}
    </div>
  )
}

const sx = (v: View, x: number) => (x - v.x0) * v.scale
const sy = (v: View, y: number) => (y - v.y0) * v.scale

function frameOf(p: Point, d: number): Point {
  return { x: p.x + SAFE_X_FRACTION * d, y: p.y + SAFE_Y_FRACTION * d }
}

function drawWall(ctx: CanvasRenderingContext2D, v: View, device: Device, drawingHeight: number) {
  const d = v.d
  ctx.fillStyle = COLORS.wall
  ctx.fillRect(0, 0, v.width, v.height)

  // Pins and the distance between them
  const pinY = sy(v, 0)
  ctx.fillStyle = COLORS.pins
  for (const x of [0, d]) {
    ctx.beginPath()
    ctx.arc(sx(v, x), pinY, 4, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.strokeStyle = COLORS.area
  ctx.setLineDash([2, 4])
  ctx.beginPath()
  ctx.moveTo(sx(v, 0) + 8, pinY)
  ctx.lineTo(sx(v, d) - 8, pinY)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = COLORS.text
  ctx.font = '12px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(
    device.movement.topDistance > 0 ? `${d} mm between the pins` : 'Hanger distance not set yet',
    sx(v, d / 2),
    pinY - 8,
  )

  // The drawing area
  const ax = SAFE_X_FRACTION * d
  const ay = SAFE_Y_FRACTION * d
  const aw = d - 2 * ax
  const ah = drawingHeight > 0 ? drawingHeight : v.height / v.scale + v.y0 - ay - 0.04 * d
  ctx.strokeStyle = COLORS.area
  ctx.setLineDash([6, 6])
  ctx.strokeRect(sx(v, ax), sy(v, ay), aw * v.scale, ah * v.scale)
  ctx.setLineDash([])

  // Home
  if (device.movement.topDistance > 0) {
    const home = frameOf(homePoint(d), d)
    ctx.strokeStyle = COLORS.home
    ctx.lineWidth = 1.5
    const hx = sx(v, home.x)
    const hy = sy(v, home.y)
    ctx.beginPath()
    ctx.moveTo(hx - 6, hy)
    ctx.lineTo(hx + 6, hy)
    ctx.moveTo(hx, hy - 6)
    ctx.lineTo(hx, hy + 6)
    ctx.stroke()
    ctx.lineWidth = 1
    // Beside the bot, which hides the mark when it's at home
    ctx.fillStyle = COLORS.home
    ctx.textAlign = 'right'
    ctx.fillText('home', hx - BOT.halfWidth * botSize(v) - 6, hy + 4)
  }

  // The drawing still to come
  ctx.strokeStyle = COLORS.plan
  ctx.lineWidth = 1
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  for (const stroke of device.plan) {
    stroke.forEach((p, i) => {
      const f = frameOf(p, d)
      if (i === 0) ctx.moveTo(sx(v, f.x), sy(v, f.y))
      else ctx.lineTo(sx(v, f.x), sy(v, f.y))
    })
  }
  ctx.stroke()
}

/** Adds the ink drawn since the last frame. */
function drawInk(ctx: CanvasRenderingContext2D, v: View, device: Device, at: { stroke: number; point: number }) {
  const trail = device.trail
  const d = v.d
  ctx.strokeStyle = COLORS.ink
  ctx.lineWidth = Math.max(1, 1.5 * v.scale)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  while (at.stroke < trail.length) {
    const stroke = trail[at.stroke]
    const start = Math.max(1, at.point)
    if (stroke.length > start) {
      const p0 = frameOf(stroke[start - 1], d)
      ctx.moveTo(sx(v, p0.x), sy(v, p0.y))
      for (let i = start; i < stroke.length; i++) {
        const p = frameOf(stroke[i], d)
        ctx.lineTo(sx(v, p.x), sy(v, p.y))
      }
      at.point = stroke.length
    }
    if (at.stroke < trail.length - 1) {
      at.stroke++
      at.point = 0
    } else {
      break
    }
  }
  ctx.stroke()
}

/** Draws the belts and the bot. Returns a caption for what's going on, or ''. */
function drawBot(ctx: CanvasRenderingContext2D, v: View, device: Device): string {
  const d = v.d
  const m = device.movement
  const hanging = device.hanging()
  const offline = device.offline()
  const mm = botSize(v)

  let cx: number
  let cy: number
  let caption = ''
  if (hanging) {
    cx = sx(v, hanging.x)
    cy = sy(v, hanging.y)
  } else {
    cx = v.width / 2
    cy = v.height - 40 - BOT.bottom * mm
    caption = 'Not hanging from the pins: the belts are too short to reach'
  }
  if (offline === 'restarting') caption = 'Restarting…'

  const pulley = (sign: number) => ({ x: cx + sign * BOT.pulleyX * mm, y: cy + BOT.pulleyY * mm })
  const left = pulley(-1)
  const right = pulley(1)

  // Belts
  if (hanging) {
    ctx.lineWidth = 2
    for (const [pin, p, motor] of [
      [0, left, m.left],
      [d, right, m.right],
    ] as const) {
      ctx.strokeStyle = Math.abs(motor.speed) > 1 ? COLORS.beltActive : COLORS.belt
      ctx.beginPath()
      ctx.moveTo(sx(v, pin), sy(v, 0))
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
    }
  }

  // Body
  ctx.globalAlpha = hanging ? 1 : 0.6
  ctx.fillStyle = COLORS.bot
  ctx.strokeStyle = COLORS.botEdge
  ctx.lineWidth = 1
  roundRect(ctx, cx - BOT.halfWidth * mm, cy + BOT.top * mm, BOT.halfWidth * 2 * mm, (BOT.bottom - BOT.top) * mm, 6 * mm)
  ctx.fill()
  ctx.stroke()

  // Motors, turning with their belts
  const circumference = Math.PI * m.diameter
  for (const [p, motor, sign] of [
    [left, m.left, 1],
    [right, m.right, -1],
  ] as const) {
    const r = BOT.pulleyR * mm
    ctx.fillStyle = COLORS.motor
    ctx.strokeStyle = motor.stalled ? COLORS.stalled : COLORS.botEdge
    ctx.beginPath()
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    const angle = sign * ((motor.steps / (m.stepsPerMm * circumference)) * Math.PI * 2)
    const shake = motor.stalled ? (Math.random() - 0.5) * 0.4 : 0
    ctx.strokeStyle = motor.stalled ? COLORS.stalled : Math.abs(motor.speed) > 1 ? COLORS.spokeActive : COLORS.spoke
    ctx.lineWidth = 1.5
    ctx.beginPath()
    for (const a of [angle + shake, angle + shake + Math.PI]) {
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(p.x + Math.cos(a) * r * 0.8, p.y + Math.sin(a) * r * 0.8)
    }
    ctx.stroke()
  }

  // Pen
  const pen = device.pen
  const touching = pen.isDown() && !pen.busy
  ctx.beginPath()
  ctx.arc(cx, cy, Math.max(3, 4 * mm), 0, Math.PI * 2)
  if (touching) {
    ctx.fillStyle = COLORS.penDown
    ctx.fill()
  } else {
    ctx.strokeStyle = pen.busy ? COLORS.penDown : COLORS.penUp
    ctx.lineWidth = 1.5
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  return caption
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
