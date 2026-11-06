import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { BoardState, Tool } from '../board-state';
import { PALETTE } from '../model/shapes';
import { zoomAt } from '../model/viewport';

interface ToolButton {
  tool: Tool;
  label: string;
  icon: string;
  key: string;
}

@Component({
  selector: 'app-toolbar',
  standalone: true,
  templateUrl: './toolbar.component.html',
  styleUrl: './toolbar.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolbarComponent {
  readonly state = inject(BoardState);
  readonly palette = PALETTE;

  readonly tools: ToolButton[] = [
    { tool: 'select', label: 'Select', icon: '↖', key: 'V' },
    { tool: 'hand', label: 'Pan', icon: '✋', key: 'H' },
    { tool: 'rect', label: 'Rectangle', icon: '▭', key: 'R' },
    { tool: 'ellipse', label: 'Ellipse', icon: '◯', key: 'O' },
    { tool: 'sticky', label: 'Sticky note', icon: '🗒', key: 'S' },
    { tool: 'pen', label: 'Pen', icon: '✎', key: 'P' },
  ];

  readonly zoomPercent = computed(() => Math.round(this.state.viewport().zoom * 100));

  pickColor(color: string): void {
    this.state.color.set(color);
    if (this.state.selection().size > 0) {
      this.state.recolorSelection(color);
    }
  }

  zoomBy(factor: number): void {
    // Zoom around the middle of the window.
    const center = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    this.state.viewport.set(zoomAt(this.state.viewport(), center, factor));
  }

  resetView(): void {
    this.state.viewport.set({ x: 0, y: 0, zoom: 1 });
  }
}
