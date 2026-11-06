import { Point } from './viewport';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The rectangle between two drag points, whichever direction the drag went. */
export function rectFromPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

/**
 * Normalises a freehand stroke: moves its origin to the stroke's top-left corner so all points are
 * non-negative, and returns the new origin, size and points.
 */
export function normalizePath(origin: Point, points: readonly number[]): Rect & { points: number[] } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    minX = Math.min(minX, points[i]);
    minY = Math.min(minY, points[i + 1]);
    maxX = Math.max(maxX, points[i]);
    maxY = Math.max(maxY, points[i + 1]);
  }

  if (points.length === 0) {
    return { x: origin.x, y: origin.y, w: 0, h: 0, points: [] };
  }

  const shifted = points.map((v, i) => (i % 2 === 0 ? v - minX : v - minY));
  return { x: origin.x + minX, y: origin.y + minY, w: maxX - minX, h: maxY - minY, points: shifted };
}

/** SVG path data for a list of x, y pairs. */
export function pathData(points: readonly number[]): string {
  if (points.length < 2) {
    return '';
  }

  let d = `M${points[0]} ${points[1]}`;
  for (let i = 2; i < points.length; i += 2) {
    d += ` L${points[i]} ${points[i + 1]}`;
  }

  return d;
}
