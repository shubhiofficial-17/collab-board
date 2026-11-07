import { Injectable, InjectionToken, inject } from '@angular/core';
import { Board } from '../boards/board';
import { StampedOp } from './model/crdt';
import { Shape } from './model/shapes';

/** Where boards are cached. localStorage in the app; tests provide an in-memory one. */
export const OFFLINE_STORAGE = new InjectionToken<Storage | null>('OFFLINE_STORAGE', {
  providedIn: 'root',
  factory: () => {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null; // e.g. storage disabled by the browser
    }
  },
});

export interface CachedBoard {
  board: Board;
  /** Every shape, including tombstones and clocks, so pending changes merge correctly later. */
  shapes: Shape[];
  /** Changes made here that the server hasn't confirmed yet, oldest first. */
  pending: StampedOp[];
}

const PREFIX = 'collab-board/board/';

/**
 * Keeps the last known copy of each opened board, and the changes not yet saved, in local storage.
 * That lets a board open and be edited without a connection; the changes are sent when it's back.
 * Because changes merge without conflicts (ADR 0005), sending them late is safe.
 * Storage errors (quota, private mode) are ignored: the cache is a convenience, not the source of truth.
 */
@Injectable({ providedIn: 'root' })
export class OfflineCache {
  private readonly storage = inject(OFFLINE_STORAGE);

  load(boardId: string): CachedBoard | null {
    try {
      const raw = this.storage?.getItem(PREFIX + boardId);
      return raw ? (JSON.parse(raw) as CachedBoard) : null;
    } catch {
      return null;
    }
  }

  saveSnapshot({ id, title, createdAt, updatedAt }: Board, shapes: Shape[]): void {
    const board = { id, title, createdAt, updatedAt };
    this.write(id, { board, shapes, pending: this.load(id)?.pending ?? [] });
  }

  savePending(boardId: string, pending: StampedOp[]): void {
    const cached = this.load(boardId);
    if (cached) {
      this.write(boardId, { ...cached, pending });
    }
  }

  remove(boardId: string): void {
    try {
      this.storage?.removeItem(PREFIX + boardId);
    } catch {
      // ignore
    }
  }

  private write(boardId: string, value: CachedBoard): void {
    try {
      this.storage?.setItem(PREFIX + boardId, JSON.stringify(value));
    } catch {
      // Full or unavailable: keep working online-only.
    }
  }
}

/** A Storage kept in memory, for tests. */
export class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();

  get length(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}
