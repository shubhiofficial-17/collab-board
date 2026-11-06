import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BoardState } from '../board-state';
import { ToolbarComponent } from './toolbar.component';

describe('ToolbarComponent', () => {
  let fixture: ComponentFixture<ToolbarComponent>;
  let state: BoardState;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ToolbarComponent], providers: [BoardState] });
    fixture = TestBed.createComponent(ToolbarComponent);
    state = TestBed.inject(BoardState);
    fixture.detectChanges();
  });

  const button = (label: string): HTMLButtonElement => fixture.nativeElement.querySelector(`[aria-label="${label}"]`);

  it('selects a tool', () => {
    button('Rectangle').click();
    fixture.detectChanges();

    expect(state.tool()).toBe('rect');
    expect(button('Rectangle').getAttribute('aria-pressed')).toBe('true');
  });

  it('recolours the selection when a colour is picked', () => {
    state.apply([{ type: 'add', shape: { id: 'a', kind: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#fde68a', z: 1 } }]);
    state.select(['a']);

    button('Colour #bfdbfe').click();

    expect(state.shape('a')!.color).toBe('#bfdbfe');
    expect(state.color()).toBe('#bfdbfe');
  });

  it('disables undo until there is something to undo', () => {
    expect(button('Undo').disabled).toBeTrue();

    state.apply([{ type: 'add', shape: { id: 'a', kind: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#fff', z: 1 } }]);
    fixture.detectChanges();

    expect(button('Undo').disabled).toBeFalse();
  });
});
