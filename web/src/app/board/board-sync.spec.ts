import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, throwError } from 'rxjs';
import { BoardsApi } from '../boards/boards-api.service';
import { BoardSync } from './board-sync';
import { Op } from './model/ops';

describe('BoardSync', () => {
  let api: jasmine.SpyObj<BoardsApi>;
  let sync: BoardSync;
  let changes: Subject<Op[]>;
  let responses: Subject<{ version: number }>[];

  const del = (id: string): Op => ({ type: 'delete', id });

  beforeEach(() => {
    responses = [];
    api = jasmine.createSpyObj<BoardsApi>('BoardsApi', ['applyOps']);
    api.applyOps.and.callFake(() => {
      const response = new Subject<{ version: number }>();
      responses.push(response);
      return response;
    });
    TestBed.configureTestingModule({ providers: [BoardSync, { provide: BoardsApi, useValue: api }] });
    sync = TestBed.inject(BoardSync);
    changes = new Subject<Op[]>();
    sync.start('b1', changes);
  });

  function respond(i: number) {
    responses[i].next({ version: i + 1 });
    responses[i].complete();
  }

  it('saves one batch at a time, sending queued changes together afterwards', () => {
    changes.next([del('a')]);
    changes.next([del('b')]);
    changes.next([del('c')]);

    expect(api.applyOps).toHaveBeenCalledTimes(1);
    expect(api.applyOps.calls.argsFor(0)).toEqual(['b1', [del('a')], null]);
    expect(sync.status()).toBe('saving');

    respond(0);
    expect(api.applyOps.calls.argsFor(1)).toEqual(['b1', [del('b'), del('c')], null]);

    respond(1);
    expect(sync.status()).toBe('saved');
    expect(sync.hasUnsavedChanges).toBeFalse();
  });

  it('keeps changes when the server is unreachable and resends them in order', fakeAsync(() => {
    api.applyOps.and.returnValue(throwError(() => new HttpErrorResponse({ status: 0 })));

    changes.next([del('a')]);
    tick(10_000); // all retries used up
    expect(sync.status()).toBe('offline');
    expect(sync.hasUnsavedChanges).toBeTrue();

    api.applyOps.and.callFake(() => {
      const response = new Subject<{ version: number }>();
      responses.push(response);
      return response;
    });
    changes.next([del('b')]);

    expect(api.applyOps.calls.mostRecent().args).toEqual(['b1', [del('a'), del('b')], null]);
    respond(0);
    expect(sync.status()).toBe('saved');
  }));

  it('drops a batch the server rejects instead of retrying it forever', () => {
    api.applyOps.and.returnValue(throwError(() => new HttpErrorResponse({ status: 400 })));

    changes.next([del('a')]);

    expect(api.applyOps).toHaveBeenCalledTimes(1);
    expect(sync.status()).toBe('rejected');
    expect(sync.hasUnsavedChanges).toBeFalse();
  });
});
