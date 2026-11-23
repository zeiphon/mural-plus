import { drawingWidth } from './kinematics'

// A small drawing in the command-file format worker/src/toCommands.ts writes:
//   d<total distance>, h<height>, then "p0", "x y", "p1", ... moves, ending "p0".
// The total distance doesn't include the travel from home to the first point,
// the same as worker/src/measurer.ts. Used by the panel's "Skip setup".

type Pt = [number, number]

function circle(cx: number, cy: number, r: number, start: number): Pt[] {
  const n = Math.max(24, Math.round((2 * Math.PI * r) / 3))
  const pts: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const a = start + (i / n) * 2 * Math.PI
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return pts
}

/** A rosette of overlapping circles, sized for a hanger distance. */
export function sampleDrawing(topDistance: number): string {
  const width = drawingWidth(topDistance)
  const size = width * 0.7
  const cx = width / 2
  const cy = size / 2 + width * 0.05
  const height = Math.round(cy + size / 2 + width * 0.05)
  const r = size / 4
  const strokes: Pt[][] = [circle(cx, cy, r, 0)]
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * 2 * Math.PI
    strokes.push(circle(cx + r * Math.cos(a), cy + r * Math.sin(a), r, a + Math.PI))
  }
  strokes.push(circle(cx, cy, 2 * r, 0))

  const lines: string[] = []
  let total = 0
  let last: Pt | null = null
  const round = (v: number) => Math.round(v * 10) / 10
  for (const stroke of strokes) {
    stroke.forEach(([x, y], i) => {
      const p: Pt = [round(x), round(y)]
      if (last && (p[0] !== last[0] || p[1] !== last[1])) total += Math.hypot(p[0] - last[0], p[1] - last[1])
      if (i === 0) lines.push('p0', `${p[0]} ${p[1]}`, 'p1')
      else lines.push(`${p[0]} ${p[1]}`)
      last = p
    })
  }
  lines.push('p0')
  return [`d${total.toFixed(1)}`, `h${height}`, ...lines].join('\n')
}
