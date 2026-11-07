import { StampedOp, mergeOp, visibleShapes } from './crdt';
import { Shape } from './shapes';

const rect = (id: string, x = 0): Shape => ({ id, kind: 'rect', x, y: 0, w: 10, h: 10, color: '#000000', z: 1 });
const ts = (n: number, client = 'a') => `${String(n).padStart(13, '0')}:0000:${client}`;

function merge(ops: StampedOp[]): Map<string, Shape> {
  const shapes = new Map<string, Shape>();
  ops.forEach((op) => mergeOp(shapes, op));
  return shapes;
}

/** Visible shapes without clocks, sorted, for comparing boards. */
function snapshot(shapes: Map<string, Shape>): string {
  return JSON.stringify(
    [...visibleShapes(shapes).values()]
      .map(({ clock: _clock, ...rest }) => rest)
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
  );
}

describe('mergeOp', () => {
  it('keeps the newest value of each field', () => {
    const shapes = merge([
      { type: 'add', shape: rect('a'), ts: ts(1) },
      { type: 'update', id: 'a', patch: { x: 5 }, ts: ts(3) },
      { type: 'update', id: 'a', patch: { x: 9, color: '#ffffff' }, ts: ts(2) },
    ]);

    expect(shapes.get('a')!.x).toBe(5);
    expect(shapes.get('a')!.color).toBe('#ffffff');
  });

  it('keeps a deleted shape as a hidden tombstone', () => {
    const shapes = merge([
      { type: 'add', shape: rect('a'), ts: ts(1) },
      { type: 'delete', id: 'a', ts: ts(2) },
    ]);

    expect(shapes.get('a')!.deleted).toBeTrue();
    expect(visibleShapes(shapes).size).toBe(0);
  });

  it('lets a later add bring a deleted shape back (undo of a delete)', () => {
    const shapes = merge([
      { type: 'add', shape: rect('a'), ts: ts(1) },
      { type: 'delete', id: 'a', ts: ts(2) },
      { type: 'add', shape: rect('a'), ts: ts(3) },
    ]);

    expect(visibleShapes(shapes).has('a')).toBeTrue();
  });

  it('does not let an older add undo a newer delete', () => {
    const shapes = merge([
      { type: 'delete', id: 'a', ts: ts(2) },
      { type: 'add', shape: rect('a'), ts: ts(1) },
    ]);

    expect(visibleShapes(shapes).has('a')).toBeFalse();
  });

  it('hides updates that arrive before their add, then shows them once it arrives', () => {
    const shapes = merge([{ type: 'update', id: 'a', patch: { x: 7 }, ts: ts(2) }]);
    expect(visibleShapes(shapes).size).toBe(0);

    mergeOp(shapes, { type: 'add', shape: rect('a'), ts: ts(1) });

    expect(visibleShapes(shapes).get('a')!.x).toBe(7);
  });

  it('is idempotent', () => {
    const op: StampedOp = { type: 'update', id: 'a', patch: { x: 1 }, ts: ts(2) };
    const once = merge([{ type: 'add', shape: rect('a'), ts: ts(1) }, op]);
    const twice = merge([{ type: 'add', shape: rect('a'), ts: ts(1) }, op, op]);

    expect(snapshot(twice)).toBe(snapshot(once));
  });

  it('converges whatever order changes arrive in', () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };

    for (let round = 0; round < 50; round++) {
      const ops: StampedOp[] = [];
      for (let i = 0; i < 40; i++) {
        const id = `s${Math.floor(random() * 4)}`;
        const client = ['a', 'b', 'c'][Math.floor(random() * 3)];
        const stamp = ts(Math.floor(random() * 20), client) + i; // unique, roughly interleaved
        const roll = random();
        if (roll < 0.3) {
          ops.push({ type: 'add', shape: rect(id, Math.floor(random() * 100)), ts: stamp });
        } else if (roll < 0.8) {
          ops.push({ type: 'update', id, patch: { x: Math.floor(random() * 100), color: random() < 0.5 ? '#ff0000' : '#00ff00' }, ts: stamp });
        } else {
          ops.push({ type: 'delete', id, ts: stamp });
        }
      }

      const expected = snapshot(merge(ops));
      for (let shuffle = 0; shuffle < 5; shuffle++) {
        const shuffled = [...ops].sort(() => random() - 0.5);
        expect(snapshot(merge(shuffled))).toBe(expected);
      }
    }
  });
});
