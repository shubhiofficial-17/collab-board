import { TestBed } from '@angular/core/testing';
import { ShapePreviewComponent } from './shape-preview.component';

describe('ShapePreviewComponent', () => {
  it('fits all shapes in view', () => {
    const fixture = TestBed.createComponent(ShapePreviewComponent);
    fixture.componentRef.setInput('shapes', [
      { id: 'a', kind: 'rect', x: 0, y: 0, w: 100, h: 50, color: '#000000', z: 1 },
      { id: 'b', kind: 'ellipse', x: 100, y: 50, w: 100, h: 50, color: '#000000', z: 2 },
    ]);
    fixture.detectChanges();

    expect(fixture.componentInstance.viewBox()).toBe('-10 -10 220 120');
    expect(fixture.nativeElement.querySelectorAll('rect, ellipse').length).toBe(2);
  });
});
