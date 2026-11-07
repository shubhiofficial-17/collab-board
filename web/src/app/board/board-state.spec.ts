import { TestBed } from '@angular/core/testing';
import { BoardState } from './board-state';
import { StampedOp } from './model/crdt';
import { Shape } from './model/shapes';

const rect = (id: string, x = 0): Shape => ({ id, kind: 'rect', x, y: 0, w: 10, h: 10, color: '#fff', z: 1 });

const EARLIER = '0000000000001:0000:remote';
const LATER = '9000000000000:0000:remote';

describe('BoardState', () => {
  let state: BoardState;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [BoardState] });
    state = TestBed.inject(BoardState);
  });

  it('undoes and redoes an applied change', () => {
    state.apply([{ type: 'add', shape: rect('a') }]);
    expect(state.shapes().has('a')).toBeTrue();

    state.undo();
    expect(state.shapes().has('a')).toBeFalse();
    expect(state.canRedo()).toBeTrue();

    state.redo();
    expect(state.shapes().has('a')).toBeTrue();
  });

  it('records a whole gesture as one undo step', () => {
    state.apply([{ type: 'add', shape: rect('a') }]);

    state.beginGesture();
    for (let x = 1; x <= 50; x++) {
      state.applyLive([{ type: 'update', id: 'a', patch: { x } }]);
    }
    state.endGesture();

    expect(state.shape('a')!.x).toBe(50);
    state.undo();
    expect(state.shape('a')!.x).toBe(0);
    state.undo();
    expect(state.shapes().size).toBe(0);
  });

  it('records nothing for a gesture that ends where it started', () => {
    state.apply([{ type: 'add', shape: rect('a') }]);

    state.beginGesture();
    state.applyLive([{ type: 'update', id: 'a', patch: { x: 30 } }]);
    state.applyLive([{ type: 'update', id: 'a', patch: { x: 0 } }]);
    state.endGesture();

    state.undo();
    expect(state.shapes().size).toBe(0); // the only step left was the add
  });

  it('clears redo after a new change', () => {
    state.apply([{ type: 'add', shape: rect('a') }]);
    state.undo();

    state.apply([{ type: 'add', shape: rect('b') }]);

    expect(state.canRedo()).toBeFalse();
  });

  it('deletes the selection and drops undone shapes from it', () => {
    state.apply([{ type: 'add', shape: rect('a') }, { type: 'add', shape: rect('b') }]);
    state.select(['a']);

    state.deleteSelection();
    expect([...state.shapes().keys()]).toEqual(['b']);
    expect(state.selection().size).toBe(0);

    state.undo();
    state.select(['a']);
    state.undo(); // removes both shapes again
    expect(state.selection().size).toBe(0);
  });

  it('orders shapes by z and brings the selection to the front', () => {
    state.apply([{ type: 'add', shape: { ...rect('a'), z: 1 } }, { type: 'add', shape: { ...rect('b'), z: 2 } }]);
    state.select(['a']);

    state.bringToFront();

    expect(state.ordered().map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('applies remote changes without adding them to undo', () => {
    state.apply([{ type: 'add', shape: rect('a') }]);
    state.select(['a']);
    state.editingId.set('a');

    state.applyRemote([
      { type: 'add', shape: rect('b'), ts: LATER },
      { type: 'delete', id: 'a', ts: LATER },
    ]);

    expect([...state.shapes().keys()]).toEqual(['b']);
    expect(state.selection().size).toBe(0);
    expect(state.editingId()).toBeNull();
    state.undo(); // undoes only my own add of 'a' (already gone), leaving b
    expect(state.shapes().has('b')).toBeTrue();
  });

  it('resyncs to the server copy and keeps unsaved local edits on top', () => {
    state.apply([{ type: 'add', shape: rect('mine') }]);

    state.resync([rect('theirs')], [{ type: 'add', shape: rect('mine'), ts: LATER }]);

    expect([...state.shapes().keys()].sort()).toEqual(['mine', 'theirs']);
    expect(state.canUndo()).toBeTrue();
  });

  it('timestamps every committed change, later each time', () => {
    const sent: StampedOp[] = [];
    state.committed.subscribe((ops) => sent.push(...ops));

    state.apply([{ type: 'add', shape: rect('a') }]);
    state.apply([{ type: 'update', id: 'a', patch: { x: 5 } }]);
    state.undo();

    expect(sent.length).toBe(3);
    expect(sent[0].ts < sent[1].ts && sent[1].ts < sent[2].ts).toBeTrue();
  });

  it('ignores a remote change older than the local value', () => {
    state.apply([{ type: 'add', shape: rect('a') }]);
    state.apply([{ type: 'update', id: 'a', patch: { color: '#111111' } }]);

    state.applyRemote([{ type: 'update', id: 'a', patch: { color: '#222222' }, ts: EARLIER }]);

    expect(state.shape('a')!.color).toBe('#111111');
  });

  it('keeps a remote change to another field of the same shape', () => {
    state.apply([{ type: 'add', shape: rect('a') }]);
    state.apply([{ type: 'update', id: 'a', patch: { color: '#111111' } }]);

    state.applyRemote([{ type: 'update', id: 'a', patch: { x: 40 }, ts: EARLIER }]);

    // x was last written by the local add, which is newer than EARLIER, so x stays.
    expect(state.shape('a')!.x).toBe(rect('a').x);
    state.applyRemote([{ type: 'update', id: 'a', patch: { x: 40 }, ts: LATER }]);
    expect(state.shape('a')!.x).toBe(40);
    expect(state.shape('a')!.color).toBe('#111111');
  });

  it('makes local edits win over remote ones it has already seen', () => {
    state.applyRemote([{ type: 'add', shape: rect('a'), ts: LATER }]);

    state.apply([{ type: 'update', id: 'a', patch: { x: 7 } }]);

    expect(state.shape('a')!.x).toBe(7);
  });

  it('ignores local changes when read-only, but still takes remote ones', () => {
    state.readOnly.set(true);

    state.apply([{ type: 'add', shape: rect('a') }]);
    state.applyRemote([{ type: 'add', shape: rect('b'), ts: LATER }]);

    expect([...state.shapes().keys()]).toEqual(['b']);
    expect(state.canUndo()).toBeFalse();
  });
});
