import { normalizePath, pathData, rectFromPoints } from './geometry';

describe('geometry', () => {
  it('builds the same rectangle whichever way you drag', () => {
    const expected = { x: 10, y: 20, w: 30, h: 40 };

    expect(rectFromPoints({ x: 10, y: 20 }, { x: 40, y: 60 })).toEqual(expected);
    expect(rectFromPoints({ x: 40, y: 60 }, { x: 10, y: 20 })).toEqual(expected);
    expect(rectFromPoints({ x: 40, y: 20 }, { x: 10, y: 60 })).toEqual(expected);
  });

  it('moves a stroke origin to its top-left corner', () => {
    // Drawn from (100, 100) going up-left, then right.
    const result = normalizePath({ x: 100, y: 100 }, [0, 0, -10, -20, 30, -5]);

    expect(result).toEqual({ x: 90, y: 80, w: 40, h: 20, points: [10, 20, 0, 0, 40, 15] });
  });

  it('writes SVG path data', () => {
    expect(pathData([0, 0, 10, 5, 20, 0])).toBe('M0 0 L10 5 L20 0');
    expect(pathData([])).toBe('');
  });
});
