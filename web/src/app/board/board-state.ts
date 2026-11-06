import { Injectable, computed, signal } from '@angular/core';
import { Op, applyOps, diff } from './model/ops';
import { PALETTE, Shape, ShapeMap } from './model/shapes';
import { Viewport } from './model/viewport';

export type Tool = 'select' | 'hand' | 'rect' | 'ellipse' | 'sticky' | 'pen';

interface HistoryEntry {
  forward: Op[];
  inverse: Op[];
}

const MAX_HISTORY = 200;

/**
 * All state of one open board, as signals. Provided per board page, so each board gets its own.
 *
 * Changes go through operations (see ops.ts). A user action such as dragging a shape is a
 * "gesture": it may change shapes hundreds of times while the pointer moves, but is recorded
 * as a single undo step when it ends.
 */
@Injectable()
export class BoardState {
  private readonly _shapes = signal<ShapeMap>(new Map());
  private readonly _undo = signal<HistoryEntry[]>([]);
  private readonly _redo = signal<HistoryEntry[]>([]);
  private gesture: { before: ShapeMap; touched: Set<string> } | null = null;

  readonly shapes = this._shapes.asReadonly();
  /** Shapes in drawing order, bottom first. */
  readonly ordered = computed(() => [...this._shapes().values()].sort((a, b) => a.z - b.z));
  readonly selection = signal<ReadonlySet<string>>(new Set());
  readonly selectedShapes = computed(() => this.ordered().filter((s) => this.selection().has(s.id)));
  readonly tool = signal<Tool>('select');
  readonly color = signal<string>(PALETTE[0]);
  readonly viewport = signal<Viewport>({ x: 0, y: 0, zoom: 1 });
  readonly editingId = signal<string | null>(null);
  readonly canUndo = computed(() => this._undo().length > 0);
  readonly canRedo = computed(() => this._redo().length > 0);

  /** z for a new shape, so it lands on top. */
  nextZ(): number {
    let max = 0;
    for (const shape of this._shapes().values()) {
      max = Math.max(max, shape.z);
    }

    return max + 1;
  }

  /** Applies operations as one undo step. */
  apply(ops: Op[]): void {
    if (ops.length === 0) {
      return;
    }

    const before = this._shapes();
    const after = applyOps(before, ops);
    const ids = new Set(ops.map((op) => (op.type === 'add' ? op.shape.id : op.id)));
    this.record(diff(before, after, ids), diff(after, before, ids));
    this._shapes.set(after);
  }

  beginGesture(): void {
    this.gesture = { before: this._shapes(), touched: new Set() };
  }

  /** Applies operations live during a gesture, without creating undo steps. */
  applyLive(ops: Op[]): void {
    if (!this.gesture) {
      this.apply(ops);
      return;
    }

    for (const op of ops) {
      this.gesture.touched.add(op.type === 'add' ? op.shape.id : op.id);
    }

    this._shapes.set(applyOps(this._shapes(), ops));
  }

  /** Ends the gesture, recording everything it changed as one undo step. */
  endGesture(): void {
    if (!this.gesture) {
      return;
    }

    const { before, touched } = this.gesture;
    this.gesture = null;
    const after = this._shapes();
    this.record(diff(before, after, touched), diff(after, before, touched));
  }

  undo(): void {
    const entry = this._undo().at(-1);
    if (!entry) {
      return;
    }

    this._undo.update((stack) => stack.slice(0, -1));
    this._redo.update((stack) => [...stack, entry]);
    this._shapes.set(applyOps(this._shapes(), entry.inverse));
    this.dropMissingFromSelection();
  }

  redo(): void {
    const entry = this._redo().at(-1);
    if (!entry) {
      return;
    }

    this._redo.update((stack) => stack.slice(0, -1));
    this._undo.update((stack) => [...stack, entry]);
    this._shapes.set(applyOps(this._shapes(), entry.forward));
    this.dropMissingFromSelection();
  }

  select(ids: Iterable<string>): void {
    this.selection.set(new Set(ids));
  }

  deleteSelection(): void {
    const ids = [...this.selection()];
    this.apply(ids.map((id) => ({ type: 'delete', id }) as Op));
    this.selection.set(new Set());
  }

  /** Recolours the selection (one undo step). */
  recolorSelection(color: string): void {
    this.apply(this.selectedShapes().map((s) => ({ type: 'update', id: s.id, patch: { color } }) as Op));
  }

  bringToFront(): void {
    let z = this.nextZ();
    this.apply(this.selectedShapes().map((s) => ({ type: 'update', id: s.id, patch: { z: z++ } }) as Op));
  }

  shape(id: string): Shape | undefined {
    return this._shapes().get(id);
  }

  private record(forward: Op[], inverse: Op[]): void {
    if (forward.length === 0) {
      return;
    }

    this._undo.update((stack) => [...stack, { forward, inverse }].slice(-MAX_HISTORY));
    this._redo.set([]);
  }

  private dropMissingFromSelection(): void {
    const shapes = this._shapes();
    const kept = [...this.selection()].filter((id) => shapes.has(id));
    if (kept.length !== this.selection().size) {
      this.selection.set(new Set(kept));
    }
  }
}
