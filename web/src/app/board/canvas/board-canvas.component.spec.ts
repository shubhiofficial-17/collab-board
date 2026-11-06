import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BoardState } from '../board-state';
import { BoardCanvasComponent } from './board-canvas.component';

describe('BoardCanvasComponent', () => {
  let fixture: ComponentFixture<BoardCanvasComponent>;
  let state: BoardState;
  let svg: SVGSVGElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [BoardCanvasComponent], providers: [BoardState] });
    fixture = TestBed.createComponent(BoardCanvasComponent);
    state = TestBed.inject(BoardState);
    fixture.nativeElement.style.cssText = 'display:block;width:800px;height:600px';
    fixture.detectChanges();
    svg = fixture.nativeElement.querySelector('svg');
  });

  function pointer(type: string, x: number, y: number, target: Element = svg, init: PointerEventInit = {}) {
    const rect = svg.getBoundingClientRect();
    target.dispatchEvent(
      new PointerEvent(type, { clientX: rect.left + x, clientY: rect.top + y, bubbles: true, button: 0, pointerId: 1, ...init }),
    );
    fixture.detectChanges();
  }

  it('draws a rectangle by dragging, then selects it', () => {
    state.tool.set('rect');

    pointer('pointerdown', 100, 100);
    pointer('pointermove', 160, 140);
    pointer('pointerup', 160, 140);

    const [shape] = state.ordered();
    expect(shape).toEqual(jasmine.objectContaining({ kind: 'rect', x: 100, y: 100, w: 60, h: 40 }));
    expect(state.tool()).toBe('select');
    expect(state.selection().has(shape.id)).toBeTrue();
    expect(svg.querySelector(`[data-id="${shape.id}"]`)).not.toBeNull();
  });

  it('drops a default-sized shape on a plain click', () => {
    state.tool.set('ellipse');

    pointer('pointerdown', 50, 50);
    pointer('pointerup', 50, 50);

    expect(state.ordered()[0]).toEqual(jasmine.objectContaining({ kind: 'ellipse', w: 160, h: 100 }));
  });

  it('moves a shape by dragging it, as one undo step', () => {
    state.apply([{ type: 'add', shape: { id: 'a', kind: 'rect', x: 0, y: 0, w: 100, h: 100, color: '#fff', z: 1 } }]);
    fixture.detectChanges();
    const shapeEl = svg.querySelector('[data-id="a"]')!;

    pointer('pointerdown', 50, 50, shapeEl);
    pointer('pointermove', 70, 80, shapeEl);
    pointer('pointermove', 90, 110, shapeEl);
    pointer('pointerup', 90, 110, shapeEl);

    expect(state.shape('a')).toEqual(jasmine.objectContaining({ x: 40, y: 60 }));
    state.undo();
    expect(state.shape('a')).toEqual(jasmine.objectContaining({ x: 0, y: 0 }));
  });

  it('draws a freehand stroke', () => {
    state.tool.set('pen');

    pointer('pointerdown', 10, 10);
    pointer('pointermove', 30, 20);
    pointer('pointermove', 50, 40);
    pointer('pointerup', 50, 40);

    const [stroke] = state.ordered();
    expect(stroke).toEqual(jasmine.objectContaining({ kind: 'path', x: 10, y: 10, w: 40, h: 30, points: [0, 0, 20, 10, 40, 30] }));
  });

  it('pans with the hand tool and zooms with ctrl+wheel', () => {
    state.tool.set('hand');
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 130, 90);
    pointer('pointerup', 130, 90);
    expect(state.viewport()).toEqual({ x: 30, y: -10, zoom: 1 });

    svg.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true }));
    expect(state.viewport().zoom).toBeGreaterThan(1);
  });

  it('undoes with Ctrl+Z and deletes the selection with Delete', () => {
    state.apply([{ type: 'add', shape: { id: 'a', kind: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#fff', z: 1 } }]);
    state.select(['a']);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
    expect(state.shapes().size).toBe(0);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    expect(state.shapes().size).toBe(1);
  });

  it('switches tools with keyboard shortcuts', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
    expect(state.tool()).toBe('rect');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(state.tool()).toBe('select');
  });
});
