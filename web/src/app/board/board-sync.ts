import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { Observable, Subscription, retry, throwError, timer } from 'rxjs';
import { BoardsApi } from '../boards/boards-api.service';
import { Op } from './model/ops';

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
  private queue: Op[] = [];
  private inFlight = false;
  private subscription?: Subscription;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.subscription?.unsubscribe());
  }

  start(boardId: string, changes: Observable<Op[]>): void {
    this.boardId = boardId;
    this.subscription?.unsubscribe();
    this.subscription = changes.subscribe((ops) => this.enqueue(ops));
  }

  get hasUnsavedChanges(): boolean {
    return this.inFlight || this.queue.length > 0;
  }

  /** Tries again now, e.g. when the user clicks "Retry". */
  retryNow(): void {
    this.flush();
  }

  private enqueue(ops: Op[]): void {
    if (ops.length === 0) {
      return;
    }

    this.queue.push(...ops);
    this.flush();
  }

  private flush(): void {
    if (this.inFlight || this.queue.length === 0) {
      return;
    }

    const batch = this.queue;
    this.queue = [];
    this.inFlight = true;
    this.status.set('saving');

    this.api
      .applyOps(this.boardId, batch)
      .pipe(retry({ count: 3, delay: (error, attempt) => (isClientError(error) ? throwError(() => error) : timer(500 * 2 ** attempt)) }))
      .subscribe({
        next: () => {
          this.inFlight = false;
          if (this.queue.length > 0) {
            this.flush();
          } else {
            this.status.set('saved');
          }
        },
        error: (error: unknown) => {
          this.inFlight = false;
          if (isClientError(error)) {
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
