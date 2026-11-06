import { Injectable, computed, signal } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { HybridClock } from './model/clock';
import { StampedOp, mergeOp, visibleShapes } from './model/crdt';
import { Op, applyOps, diff } from './model/ops';
import { PALETTE, Shape, ShapeMap, newId } from './model/shapes';
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
  /** Every shape this client knows about, including deleted ones (tombstones) and their clocks. */
  private readonly _all = signal<ShapeMap>(new Map());
  private readonly clock = new HybridClock(newId());
  private readonly _undo = signal<HistoryEntry[]>([]);
  private readonly _redo = signal<HistoryEntry[]>([]);
  private gesture: { before: ShapeMap; touched: Set<string> } | null = null;
  private readonly _committed = new Subject<StampedOp[]>();

  /**
   * Every finished change, as the operations that make it: a new action, an undo or a redo.
   * Live updates during a gesture are not included, only the gesture's net result when it ends.
   * This is what gets saved to the server (and, later, sent to other users).
   */
  readonly committed: Observable<StampedOp[]> = this._committed.asObservable();

  /** Every known shape including tombstones, e.g. for caching the board offline. */
  readonly allShapes = computed(() => [...this._all().values()]);
  /** The shapes on the board (deleted ones excluded). */
  readonly shapes = computed(() => visibleShapes(this._all()));
  /** Shapes in drawing order, bottom first. Ties (possible after concurrent edits) go by id. */
  readonly ordered = computed(() =>
    [...this.shapes().values()].sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  );
  readonly selection = signal<ReadonlySet<string>>(new Set());
  readonly selectedShapes = computed(() => this.ordered().filter((s) => this.selection().has(s.id)));
  readonly tool = signal<Tool>('select');
  readonly color = signal<string>(PALETTE[0]);
  readonly viewport = signal<Viewport>({ x: 0, y: 0, zoom: 1 });
  readonly editingId = signal<string | null>(null);
  /** For viewers: shapes can be looked at but not changed. Remote changes still come in. */
  readonly readOnly = signal(false);
  readonly canUndo = computed(() => this._undo().length > 0);
  readonly canRedo = computed(() => this._redo().length > 0);

  /** Replaces the board's contents, e.g. after loading it. Clears undo history. */
  load(shapes: readonly Shape[]): void {
    this._all.set(new Map(shapes.map((s) => [s.id, s])));
    this.observeClocks(shapes);
    this._undo.set([]);
    this._redo.set([]);
    this.selection.set(new Set());
    this.gesture = null;
  }

  /**
   * Applies changes someone else made. They are not added to this user's undo history: undo only
   * reverts your own changes, as in most collaborative editors.
   */
  applyRemote(ops: readonly Op[]): void {
    const next = new Map(this._all());
    for (const op of ops) {
      if (op.ts) {
        this.clock.observe(op.ts);
        mergeOp(next, op as StampedOp);
      }
    }

    this._all.set(next);
    this.dropMissingFromSelection();
    const editing = this.editingId();
    if (editing && !this.shapes().has(editing)) {
      this.editingId.set(null);
    }
  }

  /**
   * Replaces the shapes with the server's copy (after reconnecting) and re-applies this user's changes
   * that haven't been saved yet, so they don't flicker away. Undo history is kept.
   */
  resync(serverShapes: readonly Shape[], unsaved: readonly StampedOp[]): void {
    const next = new Map(serverShapes.map((s) => [s.id, s]));
    for (const op of unsaved) {
      mergeOp(next, op); // harmless if the server already has it: merging is idempotent
    }

    this.observeClocks(serverShapes);
    this._all.set(next);
    this.dropMissingFromSelection();
  }

  /** z for a new shape, so it lands on top. */
  nextZ(): number {
    let max = 0;
    for (const shape of this.shapes().values()) {
      max = Math.max(max, shape.z);
    }

    return max + 1;
  }

  /** Applies operations as one undo step. */
  apply(ops: Op[]): void {
    if (ops.length === 0 || this.readOnly()) {
      return;
    }

    const before = this.shapes();
    const after = applyOps(before, ops);
    const ids = new Set(ops.map((op) => (op.type === 'add' ? op.shape.id : op.id)));
    this.record(diff(before, after, ids), diff(after, before, ids));
  }

  beginGesture(): void {
    if (this.readOnly()) {
      return;
    }

    this.gesture = { before: this.shapes(), touched: new Set() };
  }

  /** Applies operations live during a gesture, without creating undo steps. */
  applyLive(ops: Op[]): void {
    if (this.readOnly()) {
      return;
    }

    if (!this.gesture) {
      this.apply(ops);
      return;
    }

    for (const op of ops) {
      this.gesture.touched.add(op.type === 'add' ? op.shape.id : op.id);
    }

    // A preview only: no timestamps yet. The gesture's net result is stamped when it ends.
    this._all.set(applyOps(this._all(), ops));
  }

  /** Ends the gesture, recording everything it changed as one undo step. */
  endGesture(): void {
    if (!this.gesture) {
      return;
    }

    const { before, touched } = this.gesture;
    this.gesture = null;
    const after = this.shapes();
    this.record(diff(before, after, touched), diff(after, before, touched));
  }

  undo(): void {
    if (this.readOnly()) {
      return;
    }

    const entry = this._undo().at(-1);
    if (!entry) {
      return;
    }

    this._undo.update((stack) => stack.slice(0, -1));
    this._redo.update((stack) => [...stack, entry]);
    this.commit(entry.inverse);
  }

  redo(): void {
    if (this.readOnly()) {
      return;
    }

    const entry = this._redo().at(-1);
    if (!entry) {
      return;
    }

    this._redo.update((stack) => stack.slice(0, -1));
    this._undo.update((stack) => [...stack, entry]);
    this.commit(entry.forward);
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
    return this.shapes().get(id);
  }

  private record(forward: Op[], inverse: Op[]): void {
    if (forward.length === 0) {
      return;
    }

    this._undo.update((stack) => [...stack, { forward, inverse }].slice(-MAX_HISTORY));
    this._redo.set([]);
    this.commit(forward);
  }

  /**
   * Timestamps local operations, merges them into the board and announces them. Undo and redo come
   * through here too, so undoing is just a new, later change; it doesn't rewrite anyone's history.
   */
  private commit(ops: readonly Op[]): void {
    const stamped = ops.map((op) => stamp(op, this.clock.tick()));
    const next = new Map(this._all());
    for (const op of stamped) {
      mergeOp(next, op);
    }

    this._all.set(next);
    this.dropMissingFromSelection();
    this._committed.next(stamped);
  }

  private observeClocks(shapes: readonly Shape[]): void {
    for (const shape of shapes) {
      for (const ts of Object.values(shape.clock ?? {})) {
        this.clock.observe(ts);
      }
    }
  }

  private dropMissingFromSelection(): void {
    const shapes = this.shapes();
    const kept = [...this.selection()].filter((id) => shapes.has(id));
    if (kept.length !== this.selection().size) {
      this.selection.set(new Set(kept));
    }
  }
}

/** Gives an operation its timestamp, and drops merge bookkeeping that diff may have copied into it. */
function stamp(op: Op, ts: string): StampedOp {
  if (op.type === 'add') {
    const { clock: _clock, deleted: _deleted, ...shape } = op.shape;
    return { type: 'add', shape: shape as Shape, ts };
  }

  return { ...op, ts } as StampedOp;
}
