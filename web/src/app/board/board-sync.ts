import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { Observable, Subject, Subscription, retry, throwError, timer } from 'rxjs';
import { BoardsApi } from '../boards/boards-api.service';
import { StampedOp } from './model/crdt';

export type SaveStatus = 'saved' | 'saving' | 'offline' | 'rejected';

/**
 * Saves board changes to the server, in order, one request at a time.
 * Changes made while a save is in flight are queued and sent together in the next request.
 * Network and server errors are retried with backoff, and the changes are kept until they're saved.
 * A change the server rejects as invalid (4xx) is dropped, since sending it again can't succeed.
 */
@Injectable()
export class BoardSync {
  private readonly api = inject(BoardsApi);

  readonly status = signal<SaveStatus>('saved');

  private boardId = '';
  private connectionId: () => string | null = () => null;
  private queue: StampedOp[] = [];
  private inFlightBatch: StampedOp[] | null = null;
  private subscription?: Subscription;
  private readonly _unsavedChanged = new Subject<StampedOp[]>();

  /** Emits the unsaved changes whenever they change, so they can be kept across reloads (OfflineCache). */
  readonly unsavedChanged: Observable<StampedOp[]> = this._unsavedChanged.asObservable();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.subscription?.unsubscribe());
  }

  /**
   * Starts saving `changes`. `pending` are changes left unsaved last time (e.g. made offline before a
   * reload); they are sent first.
   */
  start(
    boardId: string,
    changes: Observable<StampedOp[]>,
    connectionId: () => string | null = () => null,
    pending: readonly StampedOp[] = [],
  ): void {
    this.boardId = boardId;
    this.connectionId = connectionId;
    this.subscription?.unsubscribe();
    this.subscription = changes.subscribe((ops) => this.enqueue(ops));
    this.enqueue([...pending]);
  }

  get hasUnsavedChanges(): boolean {
    return this.inFlightBatch !== null || this.queue.length > 0;
  }

  /** Changes not yet confirmed by the server, oldest first. */
  get unsaved(): StampedOp[] {
    return [...(this.inFlightBatch ?? []), ...this.queue];
  }

  /** Tries again now, e.g. when the user clicks "Retry". */
  retryNow(): void {
    this.flush();
  }

  private enqueue(ops: StampedOp[]): void {
    if (ops.length === 0) {
      return;
    }

    this.queue.push(...ops);
    this.notify();
    this.flush();
  }

  private notify(): void {
    this._unsavedChanged.next(this.unsaved);
  }

  private flush(): void {
    if (this.inFlightBatch !== null || this.queue.length === 0) {
      return;
    }

    const batch = this.queue;
    this.queue = [];
    this.inFlightBatch = batch;
    this.status.set('saving');

    this.api
      .applyOps(this.boardId, batch, this.connectionId())
      .pipe(retry({ count: 3, delay: (error, attempt) => (isClientError(error) ? throwError(() => error) : timer(500 * 2 ** attempt)) }))
      .subscribe({
        next: () => {
          this.inFlightBatch = null;
          this.notify();
          if (this.queue.length > 0) {
            this.flush();
          } else {
            this.status.set('saved');
          }
        },
        error: (error: unknown) => {
          this.inFlightBatch = null;
          if (isClientError(error)) {
            this.notify();
            this.status.set('rejected');
            this.flush();
          } else {
            // Keep the batch, ahead of anything queued since, and wait for a retry.
            this.queue = [...batch, ...this.queue];
            this.status.set('offline');
          }
        },
      });
  }
}

function isClientError(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status >= 400 && error.status < 500;
}
