import { HOME_Y, MID_PULLEY_TO_WALL, SAFE_X_FRACTION, SAFE_Y_FRACTION } from './constants'

// A simplified version of src/movement.cpp's kinematics: the bot is a point
// hanging from two belts, with the pulleys standing off the wall. The firmware
// also models the bot tilting and the belts stretching (KinematicModel.md);
// the difference is a few millimetres, which doesn't matter for a demo.
//
// Image coordinates: millimetres from the top-left corner of the drawing area,
// which is what the drawing file and the firmware's X/Y use.
// Frame coordinates: millimetres from the left pin, y pointing down.

export interface Point {
  x: number
  y: number
}

export interface Belts {
  left: number
  right: number
}

/** The drawing area's width for a hanger distance (Movement::setTopDistance). */
export function drawingWidth(topDistance: number): number {
  return topDistance - 2 * SAFE_X_FRACTION * topDistance
}

/** Movement::getHomeCoordinates */
export function homePoint(topDistance: number): Point {
  if (topDistance <= 0) return { x: 0, y: 0 }
  return { x: drawingWidth(topDistance) / 2, y: HOME_Y }
}

export function imageToFrame(p: Point, topDistance: number): Point {
  return { x: p.x + SAFE_X_FRACTION * topDistance, y: p.y + SAFE_Y_FRACTION * topDistance }
}

export function frameToImage(p: Point, topDistance: number): Point {
  return { x: p.x - SAFE_X_FRACTION * topDistance, y: p.y - SAFE_Y_FRACTION * topDistance }
}

/** Belt lengths in mm, pin to pulley, for a pen position in image coordinates. */
export function beltLengths(p: Point, topDistance: number): Belts {
  const f = imageToFrame(p, topDistance)
  const leftFlat = Math.hypot(f.x, f.y)
  const rightFlat = Math.hypot(topDistance - f.x, f.y)
  return {
    left: Math.hypot(leftFlat, MID_PULLEY_TO_WALL),
    right: Math.hypot(rightFlat, MID_PULLEY_TO_WALL),
  }
}

/**
 * Where the bot hangs for given belt lengths, in frame coordinates, or null if
 * those belts can't reach (for example while the loops are on the homing screws).
 */
export function hangingPoint(belts: Belts, topDistance: number): Point | null {
  if (belts.left <= MID_PULLEY_TO_WALL || belts.right <= MID_PULLEY_TO_WALL) return null
  const l = Math.sqrt(belts.left ** 2 - MID_PULLEY_TO_WALL ** 2)
  const r = Math.sqrt(belts.right ** 2 - MID_PULLEY_TO_WALL ** 2)
  const d = topDistance
  if (l + r <= d || Math.abs(l - r) >= d) return null
  const x = (l * l - r * r + d * d) / (2 * d)
  const y2 = l * l - x * x
  if (y2 <= 1) return null
  return { x, y: Math.sqrt(y2) }
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}
