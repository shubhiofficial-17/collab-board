import { TestBed } from '@angular/core/testing';
import { MemoryStorage, OFFLINE_STORAGE, OfflineCache } from './offline-cache';

describe('OfflineCache', () => {
  let storage: MemoryStorage;
  let cache: OfflineCache;
  const board = { id: 'b1', title: 'Plan', createdAt: '', updatedAt: '' };
  const shape = { id: 's1', kind: 'rect' as const, x: 0, y: 0, w: 1, h: 1, color: '#000000', z: 1 };

  beforeEach(() => {
    storage = new MemoryStorage();
    TestBed.configureTestingModule({ providers: [{ provide: OFFLINE_STORAGE, useValue: storage }] });
    cache = TestBed.inject(OfflineCache);
  });

  it('keeps a board and its unsaved changes', () => {
    cache.saveSnapshot({ ...board, shapes: [], version: 3 } as typeof board, [shape]);
    cache.savePending('b1', [{ type: 'delete', id: 's1', ts: '0000000000001:0000:a' }]);
    cache.saveSnapshot(board, [shape]); // a newer snapshot keeps the pending changes

    expect(cache.load('b1')).toEqual({
      board,
      shapes: [shape],
      pending: [{ type: 'delete', id: 's1', ts: '0000000000001:0000:a' }],
    });
  });

  it('forgets a board', () => {
    cache.saveSnapshot(board, [shape]);
    cache.remove('b1');
    expect(cache.load('b1')).toBeNull();
  });

  it('keeps working when storage is full or broken', () => {
    const setItem = spyOn(storage, 'setItem').and.throwError('QuotaExceededError');
    expect(() => cache.saveSnapshot(board, [shape])).not.toThrow();

    setItem.and.callThrough();
    storage.setItem('collab-board/board/b2', '{not json');
    expect(cache.load('b2')).toBeNull();
  });
});
