import { TestBed } from '@angular/core/testing';
import { BoardState } from './board-state';
import { Shape } from './model/shapes';

const rect = (id: string, x = 0): Shape => ({ id, kind: 'rect', x, y: 0, w: 10, h: 10, color: '#fff', z: 1 });

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
});
