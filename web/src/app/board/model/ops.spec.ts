import { Op, applyOps, diff } from './ops';
import { Shape, ShapeMap } from './shapes';

const rect = (id: string, x = 0): Shape => ({ id, kind: 'rect', x, y: 0, w: 10, h: 10, color: '#fff', z: 1 });
const map = (...shapes: Shape[]): ShapeMap => new Map(shapes.map((s) => [s.id, s]));

describe('applyOps', () => {
  it('adds, updates and deletes without mutating the input', () => {
    const before = map(rect('a'), rect('b'));
    const after = applyOps(before, [
      { type: 'add', shape: rect('c') },
      { type: 'update', id: 'a', patch: { x: 50 } },
      { type: 'delete', id: 'b' },
    ]);

    expect([...after.keys()].sort()).toEqual(['a', 'c']);
    expect(after.get('a')!.x).toBe(50);
    expect(before.get('a')!.x).toBe(0);
    expect(before.has('b')).toBeTrue();
  });

  it('ignores updates to missing shapes', () => {
    const after = applyOps(map(), [{ type: 'update', id: 'ghost', patch: { x: 1 } }]);

    expect(after.size).toBe(0);
  });
});

describe('diff', () => {
  it('describes adds, deletes and only the changed fields', () => {
    const before = map(rect('a'), rect('b'));
    const after = map({ ...rect('a'), x: 7 }, rect('c'));

    const ops = diff(before, after, ['a', 'b', 'c']);

    expect(ops).toContain({ type: 'update', id: 'a', patch: { x: 7 } } as Op);
    expect(ops).toContain({ type: 'delete', id: 'b' } as Op);
    expect(ops).toContain({ type: 'add', shape: rect('c') } as Op);
  });

  it('is empty when nothing changed, including equal point arrays', () => {
    const path: Shape = { ...rect('p'), kind: 'path', points: [0, 0, 5, 5] };

    expect(diff(map(path), map({ ...path, points: [0, 0, 5, 5] }), ['p'])).toEqual([]);
  });

  it('diff in reverse undoes the change', () => {
    const before = map(rect('a'), rect('b'));
    const after = applyOps(before, [
      { type: 'update', id: 'a', patch: { x: 99, color: '#000' } },
      { type: 'delete', id: 'b' },
    ]);

    const undo = diff(after, before, ['a', 'b']);

    expect(applyOps(after, undo)).toEqual(before);
  });
});
