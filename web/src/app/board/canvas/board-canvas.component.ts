import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { RemoteCursor } from '../../realtime/realtime.service';
import { BoardState } from '../board-state';
import { normalizePath, pathData, rectFromPoints } from '../model/geometry';
import { Op } from '../model/ops';
import { STICKY_SIZE, Shape, newId } from '../model/shapes';
import { Point, Viewport, screenToWorld, worldToScreen, zoomAt } from '../model/viewport';

/** What the current pointer drag is doing. */
type Drag =
  | { kind: 'pan'; startScreen: Point; startViewport: Viewport }
  | { kind: 'move'; startWorld: Point; origins: Map<string, Point> }
  | { kind: 'create'; id: string; startWorld: Point }
  | { kind: 'draw'; id: string; origin: Point; points: number[] };

const DEFAULT_SIZE = { w: 160, h: 100 };
/** Smaller drags than this (in screen pixels) count as a click. */
const CLICK_TOLERANCE = 4;

/**
 * Renders the board as SVG and turns pointer, wheel and keyboard input into board operations.
 * SVG rather than <canvas>: every shape is a DOM element, so hit-testing, crisp zooming,
 * text in sticky notes and accessibility come for free. See ADR 0002.
 */
@Component({
  selector: 'app-board-canvas',
  standalone: true,
  templateUrl: './board-canvas.component.html',
  styleUrl: './board-canvas.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoardCanvasComponent {
  readonly state = inject(BoardState);
  private readonly svg = viewChild.required<ElementRef<SVGSVGElement>>('svg');
  private readonly editor = viewChild<ElementRef<HTMLTextAreaElement>>('editor');

  /** Other people's cursors, drawn on top of the board. */
  readonly remoteCursors = input<RemoteCursor[]>([]);

  /** This user's pointer position in world coordinates, for sharing with others. */
  readonly cursorMoved = output<Point>();

  private drag: Drag | null = null;
  private readonly spaceHeld = signal(false);

  constructor() {
    // Focus the sticky-note editor as soon as it appears.
    effect(() => this.editor()?.nativeElement.focus());
  }

  readonly transform = computed(() => {
    const v = this.state.viewport();
    return `translate(${v.x} ${v.y}) scale(${v.zoom})`;
  });

  /** Dot grid that moves and scales with the board. */
  readonly gridStyle = computed(() => {
    const v = this.state.viewport();
    const size = 20 * v.zoom;
    return { 'background-size': `${size}px ${size}px`, 'background-position': `${v.x}px ${v.y}px` };
  });

  readonly cursor = computed(() => {
    if (this.spaceHeld() || this.state.tool() === 'hand') {
      return 'grab';
    }

    return this.state.tool() === 'select' ? 'default' : 'crosshair';
  });

  /**
   * Where the sticky-note editor sits, in screen pixels. The editor is a plain HTML textarea laid
   * over the canvas rather than an element inside the SVG, so it behaves like any text field.
   */
  readonly editorBox = computed(() => {
    const id = this.state.editingId();
    const shape = id ? this.state.shapes().get(id) : undefined;
    if (!shape) {
      return null;
    }

    const v = this.state.viewport();
    const topLeft = worldToScreen(v, { x: shape.x, y: shape.y });
    return {
      text: shape.text ?? '',
      left: topLeft.x,
      top: topLeft.y,
      width: shape.w * v.zoom,
      height: shape.h * v.zoom,
      fontSize: 15 * v.zoom,
    };
  });

  /** Remote cursors keep the same on-screen size whatever the zoom. */
  cursorTransform(cursor: RemoteCursor): string {
    return `translate(${cursor.x} ${cursor.y}) scale(${1 / this.state.viewport().zoom})`;
  }

  pathD(shape: Shape): string {
    return pathData(shape.points ?? []);
  }

  onPointerDown(event: PointerEvent): void {
    const screen = this.screenPoint(event);
    const world = screenToWorld(this.state.viewport(), screen);
    const tool = this.state.tool();

    // Viewers can only look around: any drag pans.
    if (event.button === 1 || tool === 'hand' || this.spaceHeld() || (this.state.readOnly() && event.button === 0)) {
      this.drag = { kind: 'pan', startScreen: screen, startViewport: this.state.viewport() };
      this.capture(event);
      return;
    }

    if (event.button !== 0) {
      return;
    }

    // An open sticky-note editor saves itself on blur, which follows this pointerdown.

    switch (tool) {
      case 'select': {
        const id = this.hitTest(event);
        if (!id) {
          this.state.select([]);
          return;
        }

        if (event.shiftKey) {
          const next = new Set(this.state.selection());
          next.has(id) ? next.delete(id) : next.add(id);
          this.state.select(next);
          return;
        }

        if (!this.state.selection().has(id)) {
          this.state.select([id]);
        }

        const origins = new Map<string, Point>();
        for (const shape of this.state.selectedShapes()) {
          origins.set(shape.id, { x: shape.x, y: shape.y });
        }

        this.state.beginGesture();
        this.drag = { kind: 'move', startWorld: world, origins };
        break;
      }

      case 'rect':
      case 'ellipse': {
        const id = newId();
        this.state.beginGesture();
        this.state.applyLive([{ type: 'add', shape: this.newShape(id, tool, world, 0, 0) }]);
        this.drag = { kind: 'create', id, startWorld: world };
        break;
      }

      case 'sticky': {
        const id = newId();
        const x = world.x - STICKY_SIZE.w / 2;
        const y = world.y - STICKY_SIZE.h / 2;
        this.state.apply([{ type: 'add', shape: { ...this.newShape(id, 'sticky', { x, y }, STICKY_SIZE.w, STICKY_SIZE.h), text: '' } }]);
        this.state.select([id]);
        this.state.tool.set('select');
        this.state.editingId.set(id);
        return;
      }

      case 'pen': {
        const id = newId();
        this.state.beginGesture();
        this.state.applyLive([{ type: 'add', shape: { ...this.newShape(id, 'path', world, 0, 0), points: [0, 0] } }]);
        this.drag = { kind: 'draw', id, origin: world, points: [0, 0] };
        break;
      }
    }

    this.capture(event);
  }

  onPointerMove(event: PointerEvent): void {
    const screen = this.screenPoint(event);
    const world = screenToWorld(this.state.viewport(), screen);
    this.cursorMoved.emit(world);

    const drag = this.drag;
    if (!drag) {
      return;
    }

    switch (drag.kind) {
      case 'pan':
        this.state.viewport.set({
          ...drag.startViewport,
          x: drag.startViewport.x + screen.x - drag.startScreen.x,
          y: drag.startViewport.y + screen.y - drag.startScreen.y,
        });
        break;

      case 'move': {
        const dx = world.x - drag.startWorld.x;
        const dy = world.y - drag.startWorld.y;
        const ops: Op[] = [];
        for (const [id, origin] of drag.origins) {
          ops.push({ type: 'update', id, patch: { x: origin.x + dx, y: origin.y + dy } });
        }

        this.state.applyLive(ops);
        break;
      }

      case 'create':
        this.state.applyLive([{ type: 'update', id: drag.id, patch: rectFromPoints(drag.startWorld, world) }]);
        break;

      case 'draw': {
        const x = world.x - drag.origin.x;
        const y = world.y - drag.origin.y;
        const lastX = drag.points[drag.points.length - 2];
        const lastY = drag.points[drag.points.length - 1];
        // Skip points closer than ~2 screen pixels: keeps strokes small without visible loss.
        if (Math.hypot(x - lastX, y - lastY) * this.state.viewport().zoom >= 2) {
          drag.points.push(x, y);
          this.state.applyLive([{ type: 'update', id: drag.id, patch: { points: [...drag.points] } }]);
        }

        break;
      }
    }
  }

  onPointerUp(): void {
    const drag = this.drag;
    this.drag = null;
    if (!drag) {
      return;
    }

    switch (drag.kind) {
      case 'create': {
        const shape = this.state.shape(drag.id);
        const zoom = this.state.viewport().zoom;
        if (shape && shape.w * zoom < CLICK_TOLERANCE && shape.h * zoom < CLICK_TOLERANCE) {
          // A click rather than a drag: drop a default-sized shape.
          this.state.applyLive([{ type: 'update', id: drag.id, patch: { ...DEFAULT_SIZE } }]);
        }

        this.state.endGesture();
        this.state.select([drag.id]);
        this.state.tool.set('select');
        break;
      }

      case 'draw':
        this.state.applyLive([{ type: 'update', id: drag.id, patch: normalizePath(drag.origin, drag.points) }]);
        this.state.endGesture();
        break;

      case 'move':
        this.state.endGesture();
        break;
    }
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    const screen = this.screenPoint(event);
    if (event.ctrlKey || event.metaKey) {
      // Pinch-to-zoom on trackpads also arrives as ctrl+wheel.
      this.state.viewport.set(zoomAt(this.state.viewport(), screen, Math.exp(-event.deltaY * 0.0015)));
    } else {
      const v = this.state.viewport();
      this.state.viewport.set({ ...v, x: v.x - event.deltaX, y: v.y - event.deltaY });
    }
  }

  onDoubleClick(event: MouseEvent): void {
    if (this.state.readOnly()) {
      return;
    }

    const id = this.hitTest(event);
    if (id && this.state.shape(id)?.kind === 'sticky') {
      this.state.select([id]);
      this.state.editingId.set(id);
    }
  }

  /** Saves the sticky note being edited, as one undo step. */
  commitEdit(text?: string): void {
    const id = this.state.editingId();
    if (!id) {
      return;
    }

    this.state.editingId.set(null);
    const shape = this.state.shape(id);
    if (shape && text !== undefined && text !== (shape.text ?? '')) {
      this.state.apply([{ type: 'update', id, patch: { text } }]);
    }
  }

  onEditorBlur(event: FocusEvent): void {
    this.commitEdit((event.target as HTMLTextAreaElement).value);
  }

  /** Escape cancels; Ctrl/Cmd+Enter saves. Plain Enter adds a new line. */
  onEditorKeydown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') {
      this.state.editingId.set(null);
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      this.commitEdit((event.target as HTMLTextAreaElement).value);
    }
  }

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (isTyping(event)) {
      return;
    }

    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    if (mod && key === 'z') {
      event.preventDefault();
      event.shiftKey ? this.state.redo() : this.state.undo();
      return;
    }

    if (mod && key === 'y') {
      event.preventDefault();
      this.state.redo();
      return;
    }

    if (mod) {
      return;
    }

    switch (key) {
      case ' ':
        event.preventDefault();
        this.spaceHeld.set(true);
        break;
      case 'delete':
      case 'backspace':
        if (this.state.selection().size > 0) {
          event.preventDefault();
          this.state.deleteSelection();
        }
        break;
      case 'escape':
        this.state.select([]);
        this.state.tool.set('select');
        break;
      case 'v':
        this.state.tool.set('select');
        break;
      case 'h':
        this.state.tool.set('hand');
        break;
      case 'r':
        this.state.tool.set('rect');
        break;
      case 'o':
        this.state.tool.set('ellipse');
        break;
      case 's':
        this.state.tool.set('sticky');
        break;
      case 'p':
        this.state.tool.set('pen');
        break;
    }
  }

  @HostListener('window:keyup', ['$event'])
  onKeyup(event: KeyboardEvent): void {
    if (event.key === ' ') {
      this.spaceHeld.set(false);
    }
  }

  private newShape(id: string, kind: Shape['kind'], at: Point, w: number, h: number): Shape {
    return { id, kind, x: at.x, y: at.y, w, h, color: this.state.color(), z: this.state.nextZ() };
  }

  private screenPoint(event: MouseEvent): Point {
    const rect = this.svg().nativeElement.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private hitTest(event: Event): string | null {
    const target = event.target as Element | null;
    return target?.closest('[data-id]')?.getAttribute('data-id') ?? null;
  }

  private capture(event: PointerEvent): void {
    try {
      (event.target as Element).setPointerCapture(event.pointerId);
    } catch {
      // Synthetic events (tests) have no active pointer to capture.
    }
  }
}

function isTyping(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  return !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
}
