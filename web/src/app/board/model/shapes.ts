/** What can be drawn on a board. */
export type ShapeKind = 'rect' | 'ellipse' | 'sticky' | 'path';

/**
 * One item on the board, in world coordinates (independent of pan and zoom).
 * Every kind has a bounding box (x, y, w, h). Sticky notes add text; freehand paths add
 * points stored relative to (x, y), so moving a path only changes x and y.
 */
export interface Shape {
  id: string;
  kind: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  /** Stacking order: higher is drawn on top. */
  z: number;
  text?: string;
  /** Path only: flat list of x, y pairs relative to (x, y). */
  points?: number[];
}

export type ShapeMap = ReadonlyMap<string, Shape>;

export const PALETTE = ['#fde68a', '#bfdbfe', '#bbf7d0', '#fecaca', '#e9d5ff', '#1f2328'] as const;

export const STICKY_SIZE = { w: 180, h: 140 } as const;

/** Short random id. Uses getRandomValues, which (unlike randomUUID) also works on plain-HTTP origins. */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
