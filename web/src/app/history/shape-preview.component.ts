import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { pathData } from '../board/model/geometry';
import { Shape } from '../board/model/shapes';

/** A small, static drawing of a set of shapes, scaled to fit. */
@Component({
  selector: 'app-shape-preview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.viewBox]="viewBox()" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Preview of this version">
      @for (shape of ordered(); track shape.id) {
        @switch (shape.kind) {
          @case ('ellipse') {
            <ellipse [attr.cx]="shape.x + shape.w / 2" [attr.cy]="shape.y + shape.h / 2" [attr.rx]="shape.w / 2" [attr.ry]="shape.h / 2"
              [attr.fill]="shape.color" />
          }
          @case ('path') {
            <path [attr.d]="d(shape)" [attr.transform]="'translate(' + shape.x + ' ' + shape.y + ')'" [attr.stroke]="shape.color"
              fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
          }
          @default {
            <rect [attr.x]="shape.x" [attr.y]="shape.y" [attr.width]="shape.w" [attr.height]="shape.h" [attr.fill]="shape.color"
              [attr.rx]="shape.kind === 'sticky' ? 4 : 0" />
          }
        }
      }
    </svg>
  `,
  styles: `
    svg {
      display: block;
      width: 100%;
      height: 100%;
      background: var(--bg);
      border-radius: 6px;
    }
  `,
})
export class ShapePreviewComponent {
  readonly shapes = input.required<readonly Shape[]>();

  readonly ordered = computed(() => [...this.shapes()].sort((a, b) => a.z - b.z));

  readonly viewBox = computed(() => {
    const shapes = this.shapes();
    if (shapes.length === 0) {
      return '0 0 100 100';
    }

    const minX = Math.min(...shapes.map((s) => s.x));
    const minY = Math.min(...shapes.map((s) => s.y));
    const maxX = Math.max(...shapes.map((s) => s.x + s.w));
    const maxY = Math.max(...shapes.map((s) => s.y + s.h));
    const pad = Math.max(maxX - minX, maxY - minY, 50) * 0.05;
    return `${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`;
  });

  d(shape: Shape): string {
    return pathData(shape.points ?? []);
  }
}
