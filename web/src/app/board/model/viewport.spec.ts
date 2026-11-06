import { MAX_ZOOM, MIN_ZOOM, screenToWorld, worldToScreen, zoomAt } from './viewport';

describe('viewport', () => {
  const v = { x: 100, y: -40, zoom: 2 };

  it('converts between screen and world coordinates', () => {
    const world = { x: 12, y: 34 };

    expect(screenToWorld(v, worldToScreen(v, world))).toEqual(world);
    expect(worldToScreen(v, { x: 0, y: 0 })).toEqual({ x: 100, y: -40 });
  });

  it('keeps the point under the cursor fixed while zooming', () => {
    const cursor = { x: 300, y: 200 };
    const before = screenToWorld(v, cursor);

    const zoomed = zoomAt(v, cursor, 1.5);

    expect(zoomed.zoom).toBe(3);
    const after = screenToWorld(zoomed, cursor);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('clamps zoom', () => {
    expect(zoomAt(v, { x: 0, y: 0 }, 1000).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(v, { x: 0, y: 0 }, 0.0001).zoom).toBe(MIN_ZOOM);
  });
});
