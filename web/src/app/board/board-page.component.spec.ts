import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { BoardContent } from '../boards/board';
import { BoardsApi } from '../boards/boards-api.service';
import { BoardPageComponent } from './board-page.component';
import { BoardState } from './board-state';

describe('BoardPageComponent', () => {
  let api: jasmine.SpyObj<BoardsApi>;
  let fixture: ComponentFixture<BoardPageComponent>;

  const content: BoardContent = {
    id: 'b1',
    title: 'Roadmap',
    createdAt: '',
    updatedAt: '',
    version: 3,
    shapes: [{ id: 's1', kind: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#fde68a', z: 1 }],
  };

  function setup() {
    TestBed.configureTestingModule({
      imports: [BoardPageComponent],
      providers: [provideRouter([]), { provide: BoardsApi, useValue: api }],
    });
    fixture = TestBed.createComponent(BoardPageComponent);
    fixture.componentRef.setInput('id', 'b1');
    fixture.detectChanges();
  }

  const state = () => fixture.debugElement.injector.get(BoardState);

  beforeEach(() => {
    api = jasmine.createSpyObj<BoardsApi>('BoardsApi', ['get', 'applyOps', 'rename']);
    api.applyOps.and.returnValue(of({ version: 4 }));
  });

  it('loads the board and draws its shapes', () => {
    api.get.and.returnValue(of(content));
    setup();

    expect(fixture.nativeElement.textContent).toContain('Roadmap');
    expect(state().shapes().has('s1')).toBeTrue();
    expect(fixture.nativeElement.querySelector('[data-id="s1"]')).not.toBeNull();
  });

  it('saves every committed change', () => {
    api.get.and.returnValue(of(content));
    setup();

    state().apply([{ type: 'delete', id: 's1' }]);
    state().undo();

    expect(api.applyOps.calls.allArgs()).toEqual([
      ['b1', [{ type: 'delete', id: 's1' }]],
      ['b1', [{ type: 'add', shape: content.shapes[0] }]],
    ]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role=status]').textContent).toContain('Saved');
  });

  it('renames the board', () => {
    api.get.and.returnValue(of(content));
    api.rename.and.returnValue(of({ ...content, title: 'Q1 roadmap' }));
    setup();

    fixture.nativeElement.querySelector('button.title').click();
    fixture.detectChanges();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('.title-input');
    input.value = 'Q1 roadmap';
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();

    expect(api.rename).toHaveBeenCalledWith('b1', 'Q1 roadmap');
    expect(fixture.nativeElement.textContent).toContain('Q1 roadmap');
  });

  it('shows a message for a missing board', () => {
    api.get.and.returnValue(throwError(() => new Error('404')));
    setup();

    expect(fixture.nativeElement.textContent).toContain("doesn't exist");
  });
});
