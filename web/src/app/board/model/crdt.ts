import { Shape, ShapeMap } from './shapes';

/**
 * Fields merged independently. Each has its own timestamp in `shape.clock`, so two people changing
 * different fields of the same shape (one moves it, the other recolours it) both keep their change.
 * `deleted` is merged the same way, which is what makes delete and undo-delete work across users.
 */
export const MERGED_FIELDS = ['kind', 'x', 'y', 'w', 'h', 'color', 'z', 'text', 'points', 'deleted'] as const;
type MergedField = (typeof MERGED_FIELDS)[number];

/** A timestamped change, as produced by `BoardState` and sent to the server and other users. */
export type StampedOp =
  | { type: 'add'; shape: Shape; ts: string }
  | { type: 'update'; id: string; patch: Partial<Shape>; ts: string }
  | { type: 'delete'; id: string; ts: string };

/**
 * Merges one change into a board using last-writer-wins per field (an LWW-map CRDT).
 * The result doesn't depend on the order changes arrive in, and applying a change twice is harmless.
 * Changes for a shape not seen yet create a hidden placeholder that later changes fill in.
 */
export function mergeOp(shapes: Map<string, Shape>, op: StampedOp): void {
  const id = op.type === 'add' ? op.shape.id : op.id;
  const current = shapes.get(id) ?? placeholder(id);
  const next: Shape = { ...current, clock: { ...current.clock } };

  switch (op.type) {
    case 'add':
      for (const field of MERGED_FIELDS) {
        mergeField(next, field, field === 'deleted' ? false : op.shape[field], op.ts);
      }
      break;
    case 'update':
      for (const field of MERGED_FIELDS) {
        if (field !== 'kind' && field !== 'deleted' && field in op.patch) {
          mergeField(next, field, op.patch[field], op.ts);
        }
      }
      break;
    case 'delete':
      mergeField(next, 'deleted', true, op.ts);
      break;
  }

  shapes.set(id, next);
}

/** Shapes that should be drawn: not deleted, and not placeholders still waiting for their add. */
export function visibleShapes(all: ShapeMap): ShapeMap {
  const visible = new Map<string, Shape>();
  for (const [id, shape] of all) {
    if (isVisible(shape)) {
      visible.set(id, shape);
    }
  }

  return visible;
}

export function isVisible(shape: Shape): boolean {
  return !shape.deleted && (shape.kind as string) !== '';
}

function mergeField(shape: Shape, field: MergedField, value: unknown, ts: string): void {
  const clock = shape.clock!;
  const current = clock[field];
  if (current === undefined || ts > current) {
    (shape as unknown as Record<string, unknown>)[field] = value;
    clock[field] = ts;
  }
}

function placeholder(id: string): Shape {
  return { id, kind: '' as Shape['kind'], x: 0, y: 0, w: 0, h: 0, color: '#000000', z: 0, clock: {} };
}
