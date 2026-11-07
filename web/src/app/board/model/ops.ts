import { Shape, ShapeMap } from './shapes';

/**
 * Every change to a board is one of three operations. Undo/redo, and later real-time sync,
 * are built on these: an operation can be applied, inverted and sent over the network.
 */
export type Op =
  | { type: 'add'; shape: Shape; ts?: string }
  | { type: 'update'; id: string; patch: Partial<Omit<Shape, 'id' | 'kind'>>; ts?: string }
  | { type: 'delete'; id: string; ts?: string };

/**
 * Applies operations directly, without merge rules, and without mutating the input. Used for live
 * previews during a gesture and in tests; real changes go through the timestamped merge in crdt.ts.
 * Operations on missing shapes are ignored.
 */
export function applyOps(shapes: ShapeMap, ops: readonly Op[]): ShapeMap {
  if (ops.length === 0) {
    return shapes;
  }

  const next = new Map(shapes);
  for (const op of ops) {
    switch (op.type) {
      case 'add':
        next.set(op.shape.id, op.shape);
        break;
      case 'update': {
        const current = next.get(op.id);
        if (current) {
          next.set(op.id, { ...current, ...op.patch });
        }
        break;
      }
      case 'delete':
        next.delete(op.id);
        break;
    }
  }

  return next;
}

/**
 * Operations that turn `before` into `after` for the given shape ids, or an empty list if nothing
 * changed. Used to turn a whole gesture (e.g. a drag with hundreds of moves) into one undo step.
 */
export function diff(before: ShapeMap, after: ShapeMap, ids: Iterable<string>): Op[] {
  const ops: Op[] = [];
  for (const id of ids) {
    const was = before.get(id);
    const now = after.get(id);
    if (!was && now) {
      ops.push({ type: 'add', shape: now });
    } else if (was && !now) {
      ops.push({ type: 'delete', id });
    } else if (was && now) {
      const patch = changedFields(was, now);
      if (patch) {
        ops.push({ type: 'update', id, patch });
      }
    }
  }

  return ops;
}

function changedFields(was: Shape, now: Shape): Partial<Shape> | null {
  const patch: Record<string, unknown> = {};
  let changed = false;
  const keys = new Set([...Object.keys(was), ...Object.keys(now)]) as Set<keyof Shape>;
  for (const key of keys) {
    if (key === 'id' || key === 'kind' || key === 'clock' || key === 'deleted') {
      continue;
    }

    if (!sameValue(was[key], now[key])) {
      patch[key] = now[key];
      changed = true;
    }
  }

  return changed ? (patch as unknown as Partial<Shape>) : null;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }

  return a === b;
}
