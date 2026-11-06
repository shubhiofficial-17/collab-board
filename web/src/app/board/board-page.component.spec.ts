import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { BoardContent } from '../boards/board';
import { BoardsApi } from '../boards/boards-api.service';
import { BoardPageComponent } from './board-page.component';
import { BoardState } from './board-state';
import { FakeHubConnection } from '../realtime/fake-hub-connection';
import { HUB_CONNECTION_FACTORY } from '../realtime/realtime.service';

describe('BoardPageComponent', () => {
  let api: jasmine.SpyObj<BoardsApi>;
  let fixture: ComponentFixture<BoardPageComponent>;
  let hub: FakeHubConnection;

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
      providers: [
        provideRouter([]),
        { provide: BoardsApi, useValue: api },
        { provide: HUB_CONNECTION_FACTORY, useValue: () => hub.asConnection() },
      ],
    });
    fixture = TestBed.createComponent(BoardPageComponent);
    fixture.componentRef.setInput('id', 'b1');
    fixture.detectChanges();
  }

  const state = () => fixture.debugElement.injector.get(BoardState);

  beforeEach(() => {
    api = jasmine.createSpyObj<BoardsApi>('BoardsApi', ['get', 'applyOps', 'rename']);
    api.applyOps.and.returnValue(of({ version: 4 }));
    hub = new FakeHubConnection();
    hub.joinResult = {
      version: 3,
      participants: [
        { connectionId: 'conn-me', name: 'Me', color: '#2563eb' },
        { connectionId: 'conn-bob', name: 'Bob Lee', color: '#e11d48' },
      ],
    };
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
      ['b1', [{ type: 'delete', id: 's1', ts: jasmine.any(String) }], 'conn-me'],
      ['b1', [{ type: 'add', shape: content.shapes[0], ts: jasmine.any(String) }], 'conn-me'],
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

  it('shows who else is here and applies their changes', async () => {
    api.get.and.returnValue(of(content));
    setup();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.avatar').textContent.trim()).toBe('BL');

    hub.emit('OpsApplied', { ops: [{ type: 'delete', id: 's1' }], version: 4, from: 'conn-bob' });
    hub.emit('CursorMoved', { connectionId: 'conn-bob', x: 5, y: 5 });
    fixture.detectChanges();

    expect(state().shapes().has('s1')).toBeFalse();
    expect(fixture.nativeElement.querySelector('.cursor-name').textContent).toContain('Bob Lee');
    expect(api.applyOps).not.toHaveBeenCalled(); // remote changes are not saved again
  });

  it('shows a message for a missing board', () => {
    api.get.and.returnValue(throwError(() => new Error('404')));
    setup();

    expect(fixture.nativeElement.textContent).toContain("doesn't exist");
  });
});
