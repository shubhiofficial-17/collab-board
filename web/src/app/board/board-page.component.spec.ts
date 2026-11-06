import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { BoardContent } from '../boards/board';
import { BoardsApi } from '../boards/boards-api.service';
import { BoardPageComponent } from './board-page.component';
import { BoardState } from './board-state';
import { StampedOp } from './model/crdt';
import { AuthService } from '../auth/auth.service';
import { FakeHubConnection } from '../realtime/fake-hub-connection';
import { HUB_CONNECTION_FACTORY } from '../realtime/realtime.service';
import { HttpErrorResponse } from '@angular/common/http';
import { MemoryStorage, OFFLINE_STORAGE, OfflineCache } from './offline-cache';

describe('BoardPageComponent', () => {
  let api: jasmine.SpyObj<BoardsApi>;
  let fixture: ComponentFixture<BoardPageComponent>;
  let hub: FakeHubConnection;
  let storage: MemoryStorage;

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
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: BoardsApi, useValue: api },
        { provide: HUB_CONNECTION_FACTORY, useValue: () => hub.asConnection() },
        { provide: OFFLINE_STORAGE, useValue: storage },
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
    storage = new MemoryStorage();
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

    hub.emit('OpsApplied', { ops: [{ type: 'delete', id: 's1', ts: '0000000000001:0000:bob' }], version: 4, from: 'conn-bob' });
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

  it('opens the local copy when the server cannot be reached, and keeps edits on this device', () => {
    seedCache([]);
    api.get.and.returnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
    api.applyOps.and.returnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
    setup();
    fixture.detectChanges();

    expect(state().shapes().has('s1')).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('Offline copy');

    state().apply([{ type: 'delete', id: 's1' }]);

    expect(TestBed.inject(OfflineCache).load('b1')!.pending).toEqual([
      jasmine.objectContaining({ type: 'delete', id: 's1' }),
    ]);
  });

  it('sends changes made offline last time once the board loads', () => {
    const offlineEdit = { type: 'update' as const, id: 's1', patch: { x: 50 }, ts: '0000000000001:0000:me' };
    seedCache([offlineEdit]);
    api.get.and.returnValue(of(content));
    setup();

    expect(state().shape('s1')!.x).toBe(50);
    expect(api.applyOps).toHaveBeenCalledWith('b1', [offlineEdit], null);
    expect(TestBed.inject(OfflineCache).load('b1')!.pending).toEqual([]);
  });

  it('still shows "not found" for a board that is gone, and forgets its local copy', () => {
    seedCache([]);
    api.get.and.returnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    setup();

    expect(fixture.nativeElement.textContent).toContain("doesn't exist");
    expect(TestBed.inject(OfflineCache).load('b1')).toBeNull();
  });

  it('opens in view-only mode for viewers', async () => {
    api.get.and.returnValue(of({ ...content, members: [{ userId: 'u-me', role: 'viewer' as const }] }));
    setup();
    TestBed.inject(AuthService).me.set({ id: 'u-me', email: 'me@example.com', name: 'Me' });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('View only');
    expect(fixture.nativeElement.querySelector('app-toolbar')).toBeNull();
    expect(state().readOnly()).toBeTrue();
    expect(fixture.nativeElement.querySelector('button.share')).toBeNull();
  });

  it('offers sharing to the owner', () => {
    api.get.and.returnValue(of({ ...content, members: [{ userId: 'u-me', role: 'owner' as const }] }));
    setup();
    TestBed.inject(AuthService).me.set({ id: 'u-me', email: 'me@example.com', name: 'Me' });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('button.share')).not.toBeNull();
    expect(state().readOnly()).toBeFalse();
  });

  function seedCache(pending: StampedOp[]) {
    const { shapes, version: _version, ...board } = content;
    storage.setItem('collab-board/board/b1', JSON.stringify({ board, shapes, pending }));
  }
});
